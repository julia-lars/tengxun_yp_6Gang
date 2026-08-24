// 统一聊天组件 — Persona / KOL 共用
// 消除 chat-room.tsx 和 kol-chat.tsx 中 ~300 行重复代码

import {
  ArrowDown,
  ArrowLeft,
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
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EvidenceCard } from "@/components/ui/evidence-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  evidenceIds?: number[];
  suggestions?: string[];
  isBoundary?: boolean;
  timestamp?: string;
}

export interface EvidenceData {
  id: number;
  sourceFile: string;
  originalText: string;
  annotation: Record<string, unknown> | null;
}

export interface AgentInfo {
  name: string;
  subtitle?: string;
}

export interface SessionRestoreResult {
  messages: ChatMessage[];
  /** 如果会话不属于当前 agent，返回 false */
  valid: boolean;
}

export interface AgentChatProps {
  /** Agent 类型标识，用于导出文件名等 */
  type: "persona" | "kol";
  /** Agent ID */
  agentId: number;
  /** 返回按钮的目标 URL */
  backUrl: string;
  /** 顶部标题 */
  title: string;
  /** 顶部副标题 */
  subtitle?: string;
  /** 空状态标题 */
  emptyTitle?: string;
  /** 空状态描述 */
  emptyDescription?: string;
  /** 输入框占位符 */
  placeholder?: string;
  /** 聊天 API 端点 */
  chatEndpoint: string;
  /** 构建请求体 */
  buildRequestBody: (message: string, sessionId: number | null) => Record<string, unknown>;
  /** 恢复会话（返回 messages 和 valid 标志） */
  restoreSession: (sessionId: number) => Promise<SessionRestoreResult>;
  /** 头像样式类名 */
  avatarClassName?: string;
  /** 头像内容（ReactNode，默认 User 图标） */
  avatarContent?: React.ReactNode;
  /** 功能开关 */
  features?: {
    /** 证据溯源面板 */
    evidence?: boolean;
    /** 证据数据列表（从 agent 详情获取） */
    evidenceList?: EvidenceData[];
    /** 导出对话 */
    export?: boolean;
    /** 建议追问 */
    suggestions?: boolean;
    /** 复制消息 */
    copy?: boolean;
    /** 重试失败消息 */
    retry?: boolean;
    /** 思考中动画 */
    thinking?: boolean;
    /** 滚动到底部按钮 */
    scrollButton?: boolean;
    /** 清空对话 */
    clearChat?: boolean;
    /** 打字光标动画 */
    typingCursor?: boolean;
  };
}

// ---- 默认值 ----

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

// ---- 组件 ----

export function AgentChat({
  type,
  agentId,
  backUrl,
  title,
  subtitle,
  emptyTitle,
  emptyDescription,
  placeholder,
  chatEndpoint,
  buildRequestBody,
  restoreSession,
  avatarClassName,
  avatarContent,
  features,
}: AgentChatProps) {
  const f = { ...defaultFeatures, ...features };

  const [searchParams, setSearchParams] = useSearchParams();
  const fromParam = searchParams.get("from");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(
    () => Number(searchParams.get("session")) || null,
  );
  const [agentInfo, setAgentInfo] = useState<AgentInfo>({ name: "" });
  const [thinking, setThinking] = useState(false);
  const [evidencePanel, setEvidencePanel] = useState<{
    open: boolean;
    evidenceIds: number[];
    evidenceList: EvidenceData[];
  }>({ open: false, evidenceIds: [], evidenceList: [] });
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 恢复会话
  useEffect(() => {
    if (!sessionId) return;
    restoreSession(sessionId)
      .then((result) => {
        if (!result.valid) {
          setSessionId(null);
          setSearchParams({});
          return;
        }
        setMessages(result.messages);
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
  }, [sessionId, setSearchParams]);

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

  // 更新 sessionId（写入 URL）
  useEffect(() => {
    if (sessionId) {
      setSearchParams({
        session: String(sessionId),
        ...(fromParam ? { from: fromParam } : {}),
      });
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
                };
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

      // 完成
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: aiContent,
            evidenceIds,
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

  // 打开证据侧栏
  const openEvidence = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      setEvidencePanel((prev) => ({ ...prev, open: true, evidenceIds: ids }));
      const list = (f.evidenceList ?? []).filter((e) => ids.includes(e.id));
      setEvidencePanel((prev) => ({ ...prev, evidenceList: list }));
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

  // 清空对话
  const clearChat = useCallback(() => {
    if (messages.length === 0) return;
    if (window.confirm("确定要清空当前对话吗？此操作不可恢复。")) {
      setMessages([]);
      setSessionId(null);
      setSearchParams({});
      toast.success("对话已清空");
    }
  }, [messages, setSearchParams]);

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
        <Link
          to={backUrl}
          className="text-(--color-content-secondary) hover:text-(--color-brand-500) transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
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

        {messages.map((m, i) => (
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

            {/* 气泡 + 操作 */}
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
                <div className="flex items-center gap-2 px-1">
                  {f.evidence && m.evidenceIds && m.evidenceIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openEvidence(m.evidenceIds!)}
                      className="text-xs text-(--color-brand-500) hover:underline flex items-center gap-1"
                    >
                      <FileText className="h-3 w-3" /> 查看引用证据（{m.evidenceIds.length}条）
                    </button>
                  )}
                  {f.evidence && m.evidenceIds && m.evidenceIds.length === 0 && (
                    <span className="text-xs text-(--color-content-tertiary)">
                      ⚠ 该回答无直接证据支持
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
        ))}

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

        <div ref={bottomRef} />

        {/* 滚动到底部按钮 */}
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

      {/* 证据溯源侧栏 */}
      {f.evidence && (
        <Sheet
          open={evidencePanel.open}
          onOpenChange={(open) => setEvidencePanel((prev) => ({ ...prev, open }))}
        >
          <SheetContent side="right" className="w-[380px] sm:w-[420px] overflow-y-auto">
            <SheetHeader>
              <SheetTitle className="text-lg font-serif">证据溯源</SheetTitle>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              {evidencePanel.evidenceList.length > 0 ? (
                evidencePanel.evidenceList.map((e) => (
                  <EvidenceCard
                    key={e.id}
                    id={e.id}
                    sourceFile={e.sourceFile}
                    originalText={e.originalText}
                    annotation={e.annotation}
                    onCopy={() => copyMessage(e.originalText)}
                  />
                ))
              ) : (
                <p className="text-sm text-(--color-content-secondary) text-center py-8">
                  暂无证据数据。完成 AI 打标和 Embedding 后，将在此展示引用原文。
                </p>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}