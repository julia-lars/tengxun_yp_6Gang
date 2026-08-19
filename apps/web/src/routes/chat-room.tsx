// 虚拟访谈室 — SSE 流式对话 · 交互设计规范 v1.0

import type { PersonaDetail } from "@app/shared";
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
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EvidenceCard } from "@/components/ui/evidence-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SuggestionChip } from "@/components/ui/suggestion-chip";
import { Textarea } from "@/components/ui/textarea";
import { ThinkingDots } from "@/components/ui/thinking-dots";
import { TypingCursor } from "@/components/ui/typing-cursor";
import { api } from "../lib/api.js";

interface Message {
  role: "user" | "assistant";
  content: string;
  evidenceIds?: number[];
  suggestions?: string[];
  isBoundary?: boolean;
}

interface EvidenceData {
  id: number;
  sourceFile: string;
  originalText: string;
  annotation: Record<string, unknown> | null;
}

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const personaId = Number(id);
  const fromParam = searchParams.get("from");
  const backUrl = fromParam === "home" ? "/" : fromParam === "history" ? "/history" : `/personas/${personaId}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(() => {
    // 优先从 URL 恢复，其次从 localStorage 恢复
    const fromUrl = Number(searchParams.get("session")) || null;
    if (fromUrl) return fromUrl;
    try {
      const stored = localStorage.getItem();
      return stored ? Number(stored) : null;
    } catch { return null; }
  });
  const [persona, setPersona] = useState<PersonaDetail | null>(null);
  const [thinking, setThinking] = useState(false);
  const [evidencePanel, setEvidencePanel] = useState<{
    open: boolean;
    evidenceIds: number[];
    evidenceList: EvidenceData[];
  }>({ open: false, evidenceIds: [], evidenceList: [] });
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 加载画像信息
  useEffect(() => {
    if (!personaId || Number.isNaN(personaId)) return;
    api
      .getPersona(personaId)
      .then(setPersona)
      .catch(() => {});
  }, [personaId]);

  // 恢复会话
  useEffect(() => {
    if (!sessionId) return;
    api
      .getChatSession(sessionId)
      .then((s) => {
        const msgs = (s.messages as Message[]) ?? [];
        setMessages(msgs);
        // 滚动到底部
        setTimeout(() => {
          bottomRef.current?.scrollIntoView({ behavior: "auto" });
        }, 100);
      })
      .catch((err) => {
        console.error("会话恢复失败:", err);
        toast.error("会话恢复失败，将开始新对话");
        setSessionId(null);
        setSearchParams({});
        try { localStorage.removeItem(); } catch { /* */ }
      });
  }, [sessionId]);

  // 滚动监听
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = container;
      const nearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setIsNearBottom(nearBottom);
      setShowScrollButton(!nearBottom && messages.length > 3);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [messages.length]);

  // 自动滚动
  useEffect(() => {
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isNearBottom, thinking]);

  // 更新 sessionId 到 URL 和 localStorage
  useEffect(() => {
    if (sessionId) {
      setSearchParams({ session: String(sessionId), ...(fromParam ? { from: fromParam } : {}) });
      try {
        localStorage.setItem(, String(sessionId));
      } catch { /* localStorage 不可用 */ }
    }
  }, [sessionId]);

  // 发送消息
  const send = useCallback(async () => {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setStreaming(true);
    setThinking(true);

    let aiContent = "";
    let evidenceIds: number[] = [];
    let suggestions: string[] = [];
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body: Record<string, unknown> = { personaId, message: userMsg };
      if (sessionId) body.sessionId = sessionId;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = "请求失败";
        if (res.status >= 500) errMsg = "服务暂时不可用，请稍后重试";
        else if (res.status >= 400) errMsg = "请求参数有误，请检查";
        toast.error(errMsg);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) last.content = `[请求失败 (${res.status})]`;
          return [...next];
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();

      setThinking(false);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            // JSON 事件
            if (data.startsWith("{")) {
              try {
                const parsed = JSON.parse(data) as {
                  type?: string;
                  ids?: number[];
                  sessionId?: number;
                  suggestions?: string[];
                };
                if (parsed.type === "evidence" && parsed.ids) {
                  evidenceIds = parsed.ids;
                }
                if (parsed.sessionId) {
                  setSessionId(parsed.sessionId);
                }
                if (parsed.suggestions) {
                  suggestions = parsed.suggestions;
                }
              } catch {
                // skip
              }
              continue;
            }
            aiContent += data;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { ...last, content: aiContent };
              }
              return next;
            });
          }
        }
      }

      // 更新最后一条消息
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
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
        // 用户取消
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && !last.content) {
            next[next.length - 1] = { ...last, content: "[已取消]" };
          }
          return next;
        });
        return;
      }
      console.error("对话失败:", e);
      toast.error("网络连接异常，请检查网络后重试");
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = {
            ...last,
            content: last.content ? last.content + "\n\n[连接中断，请重试]" : "[连接失败，请重试]",
          };
        }
        return next;
      });
    } finally {
      setStreaming(false);
      setThinking(false);
      abortRef.current = null;
    }
  }, [input, streaming, personaId, sessionId, setSearchParams]);

  // 重试最后一条消息
  const retry = useCallback(() => {
    // 找到最后一条用户消息
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;
    // 移除最后一条 AI 消息
    setMessages((prev) => {
      const lastAi = prev.length - 1;
      if (prev[lastAi]?.role === "assistant") {
        return prev.slice(0, lastAi);
      }
      return prev;
    });
    setInput(lastUserMsg.content);
    // 延迟发送
    setTimeout(() => send(), 100);
  }, [messages, send]);

  // 打开证据侧栏
  const openEvidence = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      setEvidencePanel((prev) => ({ ...prev, open: true, evidenceIds: ids }));

      // 获取证据详情
      if (persona) {
        const list = persona.evidenceList.filter((e) => ids.includes(e.id));
        setEvidencePanel((prev) => ({ ...prev, evidenceList: list }));
      }
    },
    [persona],
  );

  // 复制回答
  const copyMessage = useCallback((content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      toast.success("已复制到剪贴板");
    });
  }, []);

  // 导出对话
  const exportChat = useCallback(
    (format: "md" | "json") => {
      if (messages.length === 0) return;
      const dateStr = new Date().toISOString().slice(0, 10);
      const baseName = `6Gang-访谈-${persona?.name ?? personaId}-${dateStr}`;

      if (format === "json") {
        const json = JSON.stringify(
          {
            persona: persona?.name ?? `#${personaId}`,
            date: new Date().toLocaleString("zh-CN"),
            rounds: Math.floor(messages.length / 2),
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
              evidenceIds: m.evidenceIds,
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
          `# 6Gang 虚拟访谈记录`,
          ``,
          `**画像**: ${persona?.name ?? `#${personaId}`}`,
          `**对话时间**: ${new Date().toLocaleString("zh-CN")}`,
          `**对话轮数**: ${Math.floor(messages.length / 2)} 轮`,
          ``,
          `---`,
          ``,
          `## 对话记录`,
          ``,
          ...messages.map((m) => {
            const prefix = m.role === "user" ? "**Q**" : "**A**";
            return `${prefix}: ${m.content}\n`;
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

      setShowExportMenu(false);
      toast.success(`已导出为 ${format.toUpperCase()} 格式`);
    },
    [messages, persona, personaId],
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

  // 键盘事件
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-sm:h-[calc(100vh-6rem)] max-sm:px-2">
      {/* 顶部信息栏 */}
      <div className="flex items-center gap-3 pb-3 border-b border-[--color-border] shrink-0">
        <Link
          to={backUrl}
          className="text-[--color-muted-foreground] hover:text-[--color-primary] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-lg font-bold text-[--color-primary] truncate">
            虚拟访谈室
          </h2>
          <p className="text-xs text-[--color-muted-foreground] truncate">
            {persona ? `${persona.name} · ${persona.sampleCount} 样本` : `画像 #${personaId}`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  className="text-xs h-7"
                  title="导出对话"
                >
                  <Download className="h-3 w-3 mr-1" /> 导出
                </Button>
                {showExportMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setShowExportMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 z-50 rounded-md border border-gray-200 bg-white shadow-lg py-1 min-w-[150px]">
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-100 flex items-center gap-2 whitespace-nowrap"
                        onClick={() => exportChat("md")}
                      >
                        <FileText className="h-3 w-3 flex-shrink-0" /> Markdown (.md)
                      </button>
                      <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-800 hover:bg-gray-100 flex items-center gap-2 whitespace-nowrap"
                        onClick={() => exportChat("json")}
                      >
                        <FileJson className="h-3 w-3 flex-shrink-0" /> JSON (.json)
                      </button>
                    </div>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearChat}
                className="text-xs h-7 text-[--color-muted-foreground]"
                title="清空对话"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 对话区域 */}
      <div
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0 relative"
      >
        {messages.length === 0 && (
          <div className="text-center text-[--color-muted-foreground] py-12 px-4">
            <User className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">开始和这位模拟玩家对话吧</p>
            <p className="text-xs mt-1 opacity-70">试着问他关于射击游戏偏好的问题</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""} animate-fade-in-up`}
          >
            {/* AI 头像 */}
            {m.role === "assistant" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-primary] flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
            )}

            {/* 气泡 */}
            <div className="max-w-[80%] max-sm:max-w-[90%] space-y-1.5">
              <div
                className={`rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap leading-relaxed ${
                  m.role === "user"
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-[--color-secondary] text-[--color-foreground] rounded-bl-sm"
                }`}
              >
                {m.content || (i === messages.length - 1 && streaming ? "" : "")}
                {/* 打字光标 */}
                {i === messages.length - 1 && streaming && m.role === "assistant" && (
                  <TypingCursor active={streaming && m.role === "assistant"} />
                )}
              </div>

              {/* AI 气泡操作 */}
              {m.role === "assistant" && m.content && !(i === messages.length - 1 && streaming) && (
                <div className="flex items-center gap-2 px-1">
                  {/* 证据引用 */}
                  {m.evidenceIds && m.evidenceIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => openEvidence(m.evidenceIds!)}
                      className="text-xs text-[--color-primary] hover:underline flex items-center gap-1"
                    >
                      <FileText className="h-3 w-3" /> 查看引用证据（{m.evidenceIds.length}条）
                    </button>
                  )}
                  {m.evidenceIds && m.evidenceIds.length === 0 && (
                    <span className="text-xs text-[--color-muted-foreground]">
                      ⚠ 该回答无直接证据支持
                    </span>
                  )}
                  {/* 复制 */}
                  <button
                    type="button"
                    onClick={() => copyMessage(m.content)}
                    className="text-xs text-[--color-muted-foreground] hover:text-[--color-foreground] transition-colors"
                    title="复制"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                  {/* 重试（仅失败消息） */}
                  {(m.content.startsWith("[请求失败") ||
                    m.content.startsWith("[连接失败") ||
                    m.content.startsWith("[连接中断")) && (
                    <button
                      type="button"
                      onClick={retry}
                      className="text-xs text-[--color-warning] hover:underline flex items-center gap-1"
                    >
                      <RotateCw className="h-3 w-3" /> 重试
                    </button>
                  )}
                </div>
              )}

              {/* 建议追问 */}
              {m.role === "assistant" &&
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
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-muted] flex items-center justify-center">
                <span className="text-xs text-[--color-muted-foreground]">我</span>
              </div>
            )}
          </div>
        ))}

        {/* 思考指示器 */}
        {thinking && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-primary] flex items-center justify-center">
              <User className="h-4 w-4 text-white" />
            </div>
            <ThinkingDots showText />
          </div>
        )}

        <div ref={bottomRef} />

        {/* 滚动到底部按钮 */}
        {showScrollButton && (
          <button
            type="button"
            className="scroll-to-bottom"
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: "smooth" });
              setShowScrollButton(false);
            }}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 输入区域 */}
      <div className="border-t border-[--color-border] pt-3 flex gap-2 shrink-0 max-sm:flex-col max-sm:gap-1.5">
        <Textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            streaming ? "请等待 AI 回复..." : "输入你的问题...（Enter 发送，Shift+Enter 换行）"
          }
          rows={2}
          disabled={streaming}
          className="flex-1 resize-none"
          maxLength={2000}
        />
        <div className="flex flex-col items-center gap-1 self-end">
          <Button
            onClick={send}
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
            <span className="text-[10px] text-[--color-warning]">{input.length}/2000</span>
          )}
        </div>
      </div>

      {/* 证据溯源侧栏 */}
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
              evidencePanel.evidenceList.map((e, i) => (
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
              <p className="text-sm text-[--color-muted-foreground] text-center py-8">
                暂无证据数据。完成 AI 打标和 Embedding 后，将在此展示引用原文。
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ChatRoomLayout() {
  return <ChatRoomPage />;
}
