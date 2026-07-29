// KOL 分身对话室 — SSE 流式对话
import { ArrowLeft, Send, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function KolChatPage() {
  const { id } = useParams<{ id: string }>();
  const kolId = Number(id);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [kolName, setKolName] = useState<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 获取 KOL 名称
  useEffect(() => {
    fetch(`/api/kol/${kolId}`)
      .then((r) => r.json())
      .then((data: { name: string }) => setKolName(data.name))
      .catch(() => setKolName(`KOL #${kolId}`));
  }, [kolId]);

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
      const res = await fetch("/api/kol/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kolId, message: userMsg }),
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
            if (data.startsWith("{")) continue;
            aiContent += data;
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
          to={`/kol/${kolId}`}
          className="text-[--color-muted-foreground] hover:text-[--color-primary]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h2 className="font-serif text-lg font-bold text-[--color-primary]">
            {kolName || "KOL 分身对话"}
          </h2>
          <p className="text-xs text-[--color-muted-foreground]">
            KOL 数字孪生 · 像与真人 UP 主对话一样提问
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-[--color-muted-foreground] py-8 space-y-2">
            <p>开始和这位 UP 主对话吧。</p>
            <p className="text-xs">
              试试问他关于游戏评价、行业趋势、或者对某款新游戏的看法。
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: messages have no stable id
          <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[--color-accent] flex items-center justify-center">
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
          placeholder={`问 ${kolName || "这位 UP 主"} 任何关于游戏的问题...`}
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

export function KolChatLayout() {
  return (
    <div className="h-[calc(100vh-8rem)]">
      <KolChatPage />
    </div>
  );
}
