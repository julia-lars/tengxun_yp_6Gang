// 虚拟访谈室 — SSE 流式对话
import { ArrowLeft, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const personaId = Number(id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || streaming) return;
    const userMsg = input.trim();
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setInput("");
    setStreaming(true);

    let aiContent = "";
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const body: Record<string, unknown> = { personaId, message: userMsg };
      if (sessionId) body.sessionId = sessionId;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("API错误:", res.status, errText);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last) last.content = `[请求失败 ${res.status}]`;
          return [...next];
        });
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            // 跳过 JSON 事件
            if (data.startsWith("{")) continue;
            aiContent += data;
            // 用函数式更新确保基于最新 state
            setMessages((prev) => {
              const next = prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: aiContent } : m,
              );
              return next;
            });
          }
        }
      }
    } catch (e) {
      console.error("对话失败:", e);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: "[连接失败，请重试]" };
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 pb-3 border-b border-[--color-border] shrink-0">
        <Link
          to={`/personas/${personaId}`}
          className="text-[--color-muted-foreground] hover:text-[--color-primary]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h2 className="font-serif text-lg font-bold text-[--color-primary]">虚拟访谈室</h2>
          <p className="text-xs text-[--color-muted-foreground]">画像 #{personaId} · 模拟用户</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <p className="text-center text-[--color-muted-foreground] py-8">
            开始和这位模拟玩家对话吧。试着问他关于射击游戏的看法。
          </p>
        )}
        {messages.map((m) => (
          <div key={m.timestamp} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-primary] flex items-center justify-center">
                <User className="h-4 w-4 text-white" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-[--color-primary] text-white"
                  : "bg-[--color-secondary] text-[--color-foreground]"
              }`}
            >
              {m.content || (i === messages.length - 1 && streaming ? "..." : "")}
            </div>
            {m.role === "user" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-muted] flex items-center justify-center">
                <span className="text-xs">我</span>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-[--color-border] pt-3 flex gap-2 shrink-0">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="输入你的问题..."
          rows={2}
          disabled={streaming}
          className="flex-1 resize-none"
        />
        <Button
          onClick={send}
          disabled={streaming || !input.trim()}
          size="icon"
          className="self-end"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ChatRoomLayout() {
  return (
    <div className="h-[calc(100vh-8rem)]">
      <ChatRoomPage />
    </div>
  );
}
