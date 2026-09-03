// 统一聊天组件 — Persona / KOL 共用
// 消除 chat-room.tsx 和 kol-chat.tsx 中 ~300 行重复代码

import {
  ArrowDown,
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  FileText,
  RotateCw,
  Send,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfidenceIndicator } from "@/components/ui/confidence-indicator";
import { EvidenceSheet } from "@/components/chat/evidence-sheet";
import { SuggestionChip } from "@/components/ui/suggestion-chip";
import { Textarea } from "@/components/ui/textarea";
import { ThinkingDots } from "@/components/ui/thinking-dots";
import { TypingCursor } from "@/components/ui/typing-cursor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ---- 类型 ----

export interface ConfidenceResult {
  score: number;
  level: "high" | "medium" | "low";
  breakdown: {
    evidenceScore: number;
    consistencyScore: number;
    evidenceCountScore: number;
  };
  flags: string[];
  evidenceCount: number;
}

export interface EvidenceMeta {
  id: number;
  similarity: number;
  matchLevel: "direct" | "partial" | "inferred";
  tagOverlap: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  evidenceIds?: number[];
  evidenceMeta?: EvidenceMeta[];
  /** SSE 流中传输的完整证据数据（含原文，前端直接渲染） */
  evidence?: EvidenceData[];
  /** 逐句证据映射（LLM 标注每句话被哪些证据支撑） */
  sentenceEvidence?: SentenceEvidenceResult;
  confidence?: ConfidenceResult;
  suggestions?: string[];
  isBoundary?: boolean;
  timestamp?: string;
}

export interface EvidenceData {
  id: number;
  sourceFile: string;
  originalText: string;
  annotation: Record<string, unknown> | null;
  similarity?: number;
  matchLevel?: "direct" | "partial" | "inferred";
  tagOverlap?: number;
  speakerId?: string;
  /** 该条发言对应的上一条主持人的提问（语境还原） */
  precedingQuestion?: string | null;
  /** LLM 判断的匹配理由（证据-回答相关性） */
  relevanceReason?: string | null;
  /** LLM 判断的相关性分数（0-1），独立于向量相似度 */
  relevanceScore?: number | null;
}

export interface SentenceEvidenceMapping {
  sentenceIndex: number;
  sentenceText: string;
  supportingEvidenceIds: number[];
}

export interface SentenceEvidenceResult {
  sentences: SentenceEvidenceMapping[];
  userQuestion: string;
  answerText: string;
}

export interface AgentInfo {
  name: string;
  subtitle?: string;
}

export interface SessionRestoreResult {
  messages: ChatMessage[];
  valid: boolean;
  title?: string;
  /** 总消息数，用于判断是否还有更多历史消息可加载 */
  totalMessages?: number;
  /** 是否还有更早的消息 */
  hasMore?: boolean;
}

/** 加载更多历史消息的返回结果 */
export interface LoadMoreResult {
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface AgentChatProps {
  type: "persona" | "kol";
  agentId: number;
  title: string;
  subtitle?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  placeholder?: string;
  chatEndpoint: string;
  buildRequestBody: (message: string, sessionId: number | null) => Record<string, unknown>;
  restoreSession: (sessionId: number) => Promise<SessionRestoreResult>;
  /** 加载更早的历史消息（offset = 已加载数） */
  loadMoreMessages?: (sessionId: number, offset: number) => Promise<LoadMoreResult>;
  avatarClassName?: string;
  avatarContent?: React.ReactNode;
  features?: {
    evidence?: boolean;
    evidenceList?: EvidenceData[];
    export?: boolean;
    suggestions?: boolean;
    copy?: boolean;
    retry?: boolean;
    thinking?: boolean;
    scrollButton?: boolean;
    clearChat?: boolean;
    typingCursor?: boolean;
  };
}

const defaultFeatures: Required<AgentChatProps["features"]> = {
  evidence: true,
  evidenceList: [],
  export: true,
  suggestions: true,
  copy: true,
  retry: true,
  thinking: true,
  scrollButton: true,
  clearChat: true,
  typingCursor: true,
};

const MESSAGE_PAGE_SIZE = 40;

export function AgentChat({
  type,
  agentId,
  title,
  subtitle,
  emptyTitle,
  emptyDescription,
  placeholder,
  chatEndpoint,
  buildRequestBody,
  restoreSession,
  loadMoreMessages,
  avatarClassName,
  avatarContent,
  features,
}: AgentChatProps) {
  const f = { ...defaultFeatures, ...features };

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(
    () => Number(searchParams.get("session")) || null,
  );
  const [agentInfo, setAgentInfo] = useState<AgentInfo>({ name: "" });
  const [thinking, setThinking] = useState(false);
  // 右侧 Sheet 面板：当前展示证据的消息索引，null 表示关闭
  const [evidenceSheetIndex, setEvidenceSheetIndex] = useState<number | null>(null);
  // 逐句证据映射交互状态
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [highlightedEvidenceIds, setHighlightedEvidenceIds] = useState<Set<number>>(new Set());
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  // 无限滚动向上加载历史消息
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadedCountRef = useRef(0); // 已加载的消息数（用于计算 offset）
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 恢复会话（仅在 URL 带有 session 参数时恢复，send 中新建的 sessionId 不触发）
  useEffect(() => {
    const urlSid = Number(searchParams.get("session")) || null;
    if (!urlSid) return;
    // 如果 messages 已有内容，说明是 send 中新建的 session，不需要恢复
    if (messages.length > 0) return;
    restoreSession(urlSid)
      .then((result) => {
        if (!result.valid) {
          setSessionId(null);
          setSearchParams({});
          return;
        }
        setMessages(result.messages);
        setHasMore(result.hasMore ?? false);
        loadedCountRef.current = result.messages.length;
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
        }, 100);
      })
      .catch((err) => {
        console.error("会话恢复失败:", err);
        toast.error("会话恢复失败，将开始新对话");
        setSessionId(null);
        setSearchParams({});
      });
  }, [sessionId, searchParams, setSearchParams]);

  // 滚动监听
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = container;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setIsNearBottom(nearBottom);
      if (f.scrollButton) {
        setShowScrollButton(!nearBottom && messages.length > 3);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [messages.length, f.scrollButton]);

  // 自动滚动
  useEffect(() => {
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isNearBottom, thinking]);

  // 无限滚动：滚动到已加载消息末尾时，加载更早的历史消息
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = chatContainerRef.current;
    if (!sentinel || !container || !loadMoreMessages || !sessionId) return;

    let loading = false;

    const observer = new IntersectionObserver(
      async (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loading) return;
        if (!hasMore) return;

        loading = true;
        setIsLoadingMore(true);

        try {
          const result = await loadMoreMessages(sessionId, loadedCountRef.current);
          // 更早的消息追加在末尾（时间线是从新到旧排列）
          setMessages((prev) => [...prev, ...result.messages]);
          setHasMore(result.hasMore);
          loadedCountRef.current += result.messages.length;
        } catch (err) {
          console.error("加载历史消息失败:", err);
        } finally {
          loading = false;
          setIsLoadingMore(false);
        }
      },
      {
        root: container,
        rootMargin: "200px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMoreMessages, sessionId]);

  // 更新 sessionId
  useEffect(() => {
    if (sessionId) {
      setSearchParams({ session: String(sessionId) }, { replace: true });
    }
  }, [sessionId]);

  // 发送消息
  const send = useCallback(async (msg?: string) => {
    const userMsg = (msg ?? input).trim();
    if (!userMsg || streaming) return;
    const timestamp = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMsg, timestamp },
    ]);
    setInput("");
    setStreaming(true);
    if (f.thinking) setThinking(true);

    let aiContent = "";
    let evidenceIds: number[] = [];
    let suggestions: string[] = [];
    let confidence: ConfidenceResult | undefined;
    let evidenceMeta: EvidenceMeta[] = [];
    let evidenceData: EvidenceData[] = [];
    let sentenceEvidence: SentenceEvidenceResult | undefined;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body = buildRequestBody(userMsg, sessionId);

      const res = await fetch(chatEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        await res.text();
        toast.error(res.status >= 500 ? "服务暂时不可用" : "请求参数有误");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `[请求失败 (${res.status})]`, timestamp: new Date().toISOString() },
        ]);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "[响应异常，请重试]", timestamp: new Date().toISOString() },
        ]);
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";

      if (f.thinking) setThinking(false);
      const assistantMsgIndex = messages.length; // 当前即将添加的 assistant 消息索引
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", timestamp: new Date().toISOString() },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data.startsWith("{")) {
              try {
                const parsed = JSON.parse(data) as {
                  type?: string;
                  ids?: number[];
                  sessionId?: number;
                  suggestions?: string[];
                  confidence?: ConfidenceResult;
                  evidenceMeta?: EvidenceMeta[];
                  evidence?: EvidenceData[];
                  sentenceEvidence?: SentenceEvidenceResult;
                  message?: string;
                };
                if (parsed.type === "error") {
                  if (parsed.message) toast.error(parsed.message);
                  continue;
                }
                if (parsed.type === "meta") {
                  if (parsed.sessionId) setSessionId(parsed.sessionId);
                  if (parsed.ids) evidenceIds = parsed.ids;
                  if (parsed.suggestions) suggestions = parsed.suggestions;
                  if (parsed.confidence) confidence = parsed.confidence;
                  if (parsed.evidenceMeta) evidenceMeta = parsed.evidenceMeta;
                  if (parsed.evidence) evidenceData = parsed.evidence;
                  if (parsed.sentenceEvidence) sentenceEvidence = parsed.sentenceEvidence;
                  // 立即更新消息，让证据面板即时显示，不等流结束
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === "assistant") {
                      next[next.length - 1] = {
                        ...last,
                        evidenceIds,
                        evidenceMeta,
                        evidence: evidenceData,
                        sentenceEvidence,
                        confidence,
                        suggestions,
                      };
                    }
                    return next;
                  });
                  // 自动打开证据面板，与对话结果同时出现
                  if (evidenceData.length > 0) {
                    setEvidenceSheetIndex(assistantMsgIndex);
                  }
                }
                if (parsed.type === "sentenceEvidence" && parsed.sentenceEvidence) {
                  sentenceEvidence = parsed.sentenceEvidence;
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === "assistant") {
                      next[next.length - 1] = { ...last, sentenceEvidence };
                    }
                    return next;
                  });
                }
                if (parsed.type === "evidenceUpdate") {
                  // 增量更新：relevance 分数 + 逐句证据映射
                  if (parsed.evidence) evidenceData = parsed.evidence;
                  if (parsed.sentenceEvidence) sentenceEvidence = parsed.sentenceEvidence;
                  setMessages((prev) => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === "assistant") {
                      next[next.length - 1] = {
                        ...last,
                        evidence: evidenceData,
                        ...(sentenceEvidence ? { sentenceEvidence } : {}),
                      };
                    }
                    return next;
                  });
                }
                if (parsed.type === "evidence" && parsed.ids) evidenceIds = parsed.ids;
                if (parsed.sessionId) setSessionId(parsed.sessionId);
                if (parsed.suggestions) suggestions = parsed.suggestions;
              } catch {
                /* skip */
              }
              continue;
            }
            aiContent += data;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last?.role === "assistant") {
                next[next.length - 1] = { ...last, content: aiContent };
              }
              return next;
            });
          }
        }
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: aiContent,
            evidenceIds,
            evidenceMeta,
            evidence: evidenceData,
            sentenceEvidence,
            confidence,
            suggestions,
          };
        }
        return next;
      });
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content) {
            next[next.length - 1] = { ...last, content: "[已取消]" };
          } else if (last?.role !== "assistant") {
            next.push({ role: "assistant", content: "[已取消]", timestamp: new Date().toISOString() });
          }
          return next;
        });
        return;
      }
      toast.error("网络连接异常，请检查网络后重试");
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: last.content
              ? `${last.content}\n\n[连接中断，请重试]`
              : "[连接失败，请重试]",
          };
        } else {
          next.push({ role: "assistant", content: "[连接失败，请重试]", timestamp: new Date().toISOString() });
        }
        return next;
      });
    } finally {
      setStreaming(false);
      if (f.thinking) setThinking(false);
      abortRef.current = null;
    }
  }, [input, streaming, sessionId, chatEndpoint, buildRequestBody, f.thinking, setSearchParams]);

  // 重试
  const retry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    setMessages((prev) => {
      const lastAi = prev.length - 1;
      if (prev[lastAi]?.role === "assistant") return prev.slice(0, lastAi);
      return prev;
    });
    send(lastUserMsg.content);
  }, [messages, send]);

  // 打开右侧证据面板
  const openEvidenceSheet = useCallback((msgIndex: number) => {
    setActiveSentenceIndex(null);
    setHighlightedEvidenceIds(new Set());
    setEvidenceSheetIndex(msgIndex);
  }, []);

  // 逐句交互：点击句子 → 高亮对应证据
  const handleSentenceClick = useCallback((index: number) => {
    setActiveSentenceIndex(index);
    if (evidenceSheetIndex !== null) {
      const msg = messages[evidenceSheetIndex];
      const sEvidence = msg?.sentenceEvidence;
      if (sEvidence) {
        const mapping = sEvidence.sentences.find((s) => s.sentenceIndex === index);
        if (mapping) {
          setHighlightedEvidenceIds(new Set(mapping.supportingEvidenceIds));
        }
      }
    }
  }, [evidenceSheetIndex, messages]);

  // 逐句交互：点击证据卡片 → 反向定位对应句子
  const handleEvidenceClick = useCallback((evidenceId: number) => {
    if (evidenceSheetIndex !== null) {
      const msg = messages[evidenceSheetIndex];
      const sEvidence = msg?.sentenceEvidence;
      if (sEvidence) {
        const firstSentence = sEvidence.sentences.find(
          (s) => s.supportingEvidenceIds.includes(evidenceId),
        );
        if (firstSentence) {
          setActiveSentenceIndex(firstSentence.sentenceIndex);
          setHighlightedEvidenceIds(new Set(firstSentence.supportingEvidenceIds));
        }
      }
    }
  }, [evidenceSheetIndex, messages]);

  // 获取某条消息对应的证据数据
  // 优先从消息自带的 evidence 字段（SSE 实时传输），fallback 到 evidenceList
  const getEvidenceForMessage = useCallback(
    (msg: ChatMessage): EvidenceData[] => {
      // 优先使用 SSE 流中传输的完整证据数据
      if (msg.evidence && msg.evidence.length > 0) {
        // 如果消息还有 evidenceMeta，补充 tagOverlap（evidence 中可能没有）
        if (msg.evidenceMeta && msg.evidenceMeta.length > 0) {
          const metaMap = new Map(msg.evidenceMeta.map((m) => [m.id, m]));
          return msg.evidence.map((e) => {
            const m = metaMap.get(e.id);
            if (m) {
              return { ...e, tagOverlap: e.tagOverlap ?? m.tagOverlap, similarity: e.similarity ?? m.similarity, matchLevel: e.matchLevel ?? m.matchLevel };
            }
            return e;
          });
        }
        return msg.evidence;
      }
      // Fallback: 从 evidenceList 中按 evidenceIds 匹配
      if (!msg.evidenceIds || msg.evidenceIds.length === 0) return [];
      const list = (f.evidenceList ?? []).filter((e) => msg.evidenceIds!.includes(e.id));
      if (msg.evidenceMeta && msg.evidenceMeta.length > 0) {
        const metaMap = new Map(msg.evidenceMeta.map((m) => [m.id, m]));
        for (const item of list) {
          const m = metaMap.get(item.id);
          if (m) {
            item.similarity = m.similarity;
            item.matchLevel = m.matchLevel;
            item.tagOverlap = m.tagOverlap;
          }
        }
      }
      return list;
    },
    [f.evidenceList],
  );

  // 复制
  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).then(() => toast.success("已复制到剪贴板"));
  }, []);

  // 导出
  const exportChat = useCallback(
    (format: "md" | "json") => {
      if (messages.length === 0) return;
      const dateStr = new Date().toISOString().slice(0, 10);
      const label = type === "persona" ? "访谈" : "对话";
      const baseName = `6Gang-${label}-${agentInfo.name || agentId}-${dateStr}`;

      if (format === "json") {
        const json = JSON.stringify(
          {
            agent: agentInfo.name ?? `#${agentId}`,
            type,
            date: new Date().toLocaleString("zh-CN"),
            rounds: Math.floor(messages.length / 2),
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
              evidenceIds: m.evidenceIds,
              timestamp: m.timestamp,
            })),
          },
          null,
          2,
        );
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const md = [
          `# 6Gang 虚拟${label}记录`,
          ``,
          `**${type === "persona" ? "画像" : "KOL"}**: ${agentInfo.name ?? `#${agentId}`}`,
          `**${label}时间**: ${new Date().toLocaleString("zh-CN")}`,
          `**${label}轮数**: ${Math.floor(messages.length / 2)} 轮`,
          ``,
          `---`,
          ``,
          `## ${label}记录`,
          ``,
          ...messages.map((m) => {
            const prefix = m.role === "user" ? "**Q**" : "**A**";
            const time = m.timestamp
              ? ` (${new Date(m.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })})`
              : "";
            return `${prefix}${time}: ${m.content}\n`;
          }),
        ].join("\n");

        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.md`;
        a.click();
        URL.revokeObjectURL(url);
      }

      toast.success(`已导出为 ${format.toUpperCase()} 格式`);
    },
    [messages, agentInfo, agentId, type],
  );

  // 清空
  const clearChat = useCallback(async () => {
    if (messages.length === 0) return;
    if (!window.confirm("确定要清空当前对话吗？此操作不可恢复。")) return;

    try {
      if (sessionId) {
        if (type === "persona") {
          await api.deleteChatSession(sessionId);
        } else {
          await api.deleteKolChatSession(sessionId);
        }
      }
      setMessages([]);
      setSessionId(null);
      setSearchParams({});
      setEvidenceSheetIndex(null);
      setHasMore(false);
      loadedCountRef.current = 0;
      toast.success("对话已清空");
    } catch {
      toast.error("清空失败，请重试");
    }
  }, [messages, sessionId, type, setSearchParams]);

  // 应用建议追问
  const applySuggestion = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const defaultPlaceholder = streaming
    ? "请等待 AI 回复..."
    : type === "persona"
      ? "输入你的问题...（Enter 发送，Shift+Enter 换行）"
      : `问这位 ${type === "kol" ? "UP 主" : "玩家"} 任何问题...`;

  const defaultEmptyTitle = type === "persona"
    ? "开始和这位模拟玩家对话吧"
    : "开始和这位 UP 主对话吧";
  const defaultEmptyDesc = type === "persona"
    ? "试着问他关于射击游戏偏好的问题"
    : "试试问他关于游戏评价、行业趋势、或者对某款新游戏的看法";

  return (
    <div className="flex flex-col h-full">
      {/* 顶部信息栏 */}
      <div className="flex items-center gap-3 pb-3 border-b border-(--color-border-default) shrink-0 sticky top-0 z-10 bg-(--color-surface-primary) pt-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-lg font-bold text-black truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs text-(--color-content-tertiary) truncate">
              {subtitle}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <>
              {f.export && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-xs h-7">
                      <Download className="h-3 w-3 mr-1" /> 导出
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={() => exportChat("md")}>
                      <FileText className="h-3.5 w-3.5" />
                      Markdown (.md)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => exportChat("json")}>
                      <FileJson className="h-3.5 w-3.5" />
                      JSON (.json)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {f.clearChat && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearChat}
                  className="text-xs h-7 text-(--color-content-tertiary)"
                  title="清空对话"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 对话区域 */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0 relative scrollbar-hide"
      >
        {messages.length === 0 && (
          <div className="text-center py-12 px-4">
            <div className="w-14 h-14 rounded-2xl bg-(--color-surface-secondary) flex items-center justify-center mx-auto mb-3">
              <User className="h-7 w-7 text-(--color-content-tertiary)" />
            </div>
            <p className="text-sm font-medium text-(--color-content-secondary)">
              {emptyTitle ?? defaultEmptyTitle}
            </p>
            <p className="text-xs text-(--color-content-tertiary) mt-1">
              {emptyDescription ?? defaultEmptyDesc}
            </p>
          </div>
        )}

        {messages.map((m, i) => {
          const evidenceForMsg = getEvidenceForMessage(m);

          return (
          <div
            key={i}
            className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""} animate-fade-in-up`}
          >
            {/* AI 头像 */}
            {m.role === "assistant" && (
              <div
                className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  avatarClassName ?? "bg-(--color-brand-500)"
                }`}
              >
                {avatarContent ?? <User className="h-4 w-4 text-white" />}
              </div>
            )}

            {/* 气泡 + 操作 + 内联证据 */}
            <div className="max-w-[80%] max-sm:max-w-[90%] space-y-1.5">
              {/* 消息气泡 */}
              <div
                className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "chat-bubble-user"
                    : "chat-bubble-ai"
                }`}
              >
                {m.content ||
                  (i === messages.length - 1 && streaming ? "" : "")}
                {f.typingCursor &&
                  i === messages.length - 1 &&
                  streaming &&
                  m.role === "assistant" && (
                    <TypingCursor active={streaming && m.role === "assistant"} />
                  )}
              </div>

              {/* 时间戳 */}
              {m.timestamp && (
                <p className="text-[10px] text-(--color-content-tertiary) px-1">
                  {new Date(m.timestamp).toLocaleTimeString("zh-CN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              )}

              {/* AI 气泡操作 */}
              {m.role === "assistant" && m.content && !(i === messages.length - 1 && streaming) && (
                <div className="flex flex-col gap-1.5 px-1">
                  {/* 可信度 + 证据展开按钮 */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {m.confidence && (
                      <ConfidenceIndicator
                        score={m.confidence.score}
                        breakdown={m.confidence.breakdown}
                        flags={m.confidence.flags}
                        evidenceCount={m.confidence.evidenceCount}
                        size="sm"
                        showLabel
                      />
                    )}

                    {f.evidence && m.evidenceIds && m.evidenceIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openEvidenceSheet(i)}
                        className="text-xs text-(--color-brand-500) hover:underline flex items-center gap-1"
                      >
                        <ChevronRight className="h-3 w-3" />
                        证据支持（{m.evidenceIds.length}条）
                      </button>
                    )}

                    {f.evidence && (!m.evidenceIds || m.evidenceIds.length === 0) && (
                      <span className="text-xs text-(--color-content-tertiary)">
                        无直接证据
                      </span>
                    )}

                    {f.copy && (
                      <button
                        type="button"
                        onClick={() => copyMessage(m.content)}
                        className="text-xs text-(--color-content-tertiary) hover:text-(--color-content-primary) transition-colors"
                        title="复制"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}

                    {f.retry &&
                      (m.content.startsWith("[请求失败") ||
                        m.content.startsWith("[连接失败") ||
                        m.content.startsWith("[连接中断")) && (
                        <button
                          type="button"
                          onClick={retry}
                          className="text-xs text-(--color-warning-500) hover:underline flex items-center gap-1"
                        >
                          <RotateCw className="h-3 w-3" /> 重试
                        </button>
                      )}
                  </div>

                  {/* 风险标记 */}
                  {m.confidence && m.confidence.flags.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {m.confidence.flags.includes("low_sample") && (
                        <span className="text-[10px] text-(--color-muted-foreground) bg-(--color-surface-secondary) px-1.5 py-0.5 rounded">
                          低样本
                        </span>
                      )}
                      {m.confidence.flags.includes("inferred") && (
                        <span className="text-[10px] text-(--color-muted-foreground) bg-(--color-surface-secondary) px-1.5 py-0.5 rounded">
                          基于推断
                        </span>
                      )}
                      {m.confidence.flags.includes("boundary") && (
                        <span className="text-[10px] text-(--color-muted-foreground) bg-(--color-surface-secondary) px-1.5 py-0.5 rounded">
                          边界外推
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 建议追问 */}
              {f.suggestions &&
                m.role === "assistant" &&
                m.suggestions &&
                m.suggestions.length > 0 &&
                !(i === messages.length - 1 && streaming) && (
                  <div className="flex flex-wrap gap-1.5 px-1 pt-1">
                    {m.suggestions.map((s, si) => (
                      <SuggestionChip key={si} text={s} onClick={applySuggestion} />
                    ))}
                  </div>
                )}
            </div>

            {/* 用户头像 */}
            {m.role === "user" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-(--color-surface-secondary) flex items-center justify-center border border-(--color-border-default)">
                <span className="text-xs text-(--color-content-secondary) font-medium">我</span>
              </div>
            )}
          </div>
        );
        })}

        {/* 思考指示器 */}
        {f.thinking && thinking && (
          <div className="flex gap-3 animate-fade-in-up">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                avatarClassName ?? "bg-(--color-brand-500)"
              }`}
            >
              {avatarContent ?? <User className="h-4 w-4 text-white" />}
            </div>
            <div className="flex items-center h-8 px-3 rounded-lg bg-(--color-surface-secondary)">
              <ThinkingDots showText />
            </div>
          </div>
        )}

        {/* 底部哨兵 + 加载指示器：滚动到此触发加载更早的历史消息 */}
        <div ref={loadMoreSentinelRef} className="h-0.5" />

        {isLoadingMore && (
          <div className="flex justify-center py-2">
            <div className="flex items-center gap-2 text-xs text-(--color-content-tertiary)">
              <div className="thinking-dots gap-1">
                <span className="dot" style={{ width: 3, height: 3, background: "var(--color-content-tertiary)" }} />
                <span className="dot" style={{ width: 3, height: 3, background: "var(--color-content-tertiary)", animationDelay: "0.15s" }} />
                <span className="dot" style={{ width: 3, height: 3, background: "var(--color-content-tertiary)", animationDelay: "0.3s" }} />
              </div>
              加载更早的对话...
            </div>
          </div>
        )}

        <div ref={bottomRef} />

        {f.scrollButton && showScrollButton && (
          <button
            type="button"
            className="scroll-to-bottom-btn"
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              setShowScrollButton(false);
            }}
            aria-label="滚动到底部"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-(--color-border-default) pt-3 flex gap-2 shrink-0">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? defaultPlaceholder}
          rows={2}
          disabled={streaming}
          className="flex-1 resize-none"
          maxLength={2000}
        />
        <div className="flex flex-col items-center gap-1 self-end">
          <Button
            onClick={() => send()}
            disabled={streaming || !input.trim()}
            size="icon"
            className="self-end"
          >
            {streaming ? (
              <div className="thinking-dots gap-1.5">
                <span className="dot" style={{ width: 3, height: 3, background: "white" }} />
                <span
                  className="dot"
                  style={{ width: 3, height: 3, background: "white", animationDelay: "0.15s" }}
                />
                <span
                  className="dot"
                  style={{ width: 3, height: 3, background: "white", animationDelay: "0.3s" }}
                />
              </div>
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
          {input.length > 1800 && (
            <span className="text-[10px] text-(--color-warning-500)">{input.length}/2000</span>
          )}
        </div>
      </div>

      {/* 右侧证据详情 Sheet（逐句标注模式） */}
      {f.evidence && evidenceSheetIndex !== null && (() => {
        const sheetMsg = messages[evidenceSheetIndex];
        if (!sheetMsg || sheetMsg.role !== "assistant") return null;
        const sheetEvidence = getEvidenceForMessage(sheetMsg);
        const userQuestion = messages[evidenceSheetIndex - 1]?.content ?? "";
        return (
          <EvidenceSheet
            evidenceData={sheetEvidence}
            sentenceEvidence={sheetMsg.sentenceEvidence}
            userQuestion={userQuestion}
            answerText={sheetMsg.content}
            activeSentenceIndex={activeSentenceIndex}
            highlightedEvidenceIds={highlightedEvidenceIds}
            onSentenceClick={handleSentenceClick}
            onEvidenceClick={handleEvidenceClick}
            onCopy={copyMessage}
            onClose={() => {
              setEvidenceSheetIndex(null);
              setActiveSentenceIndex(null);
              setHighlightedEvidenceIds(new Set());
            }}
          />
        );
      })()}
    </div>
  );
}