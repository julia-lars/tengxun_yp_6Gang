// KOL 分身对话室 — 使用统一聊天组件 AgentChat
import { User } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { AgentChat, type ChatMessage, type SessionRestoreResult } from "@/components/chat/agent-chat.js";
import { api } from "../lib/api.js";

export function KolChatPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const kolId = Number(id);
  const fromParam = searchParams.get("from");
  const backUrl = fromParam === "kol" ? "/kol" : `/kol/${kolId}`;
  const [kolName, setKolName] = useState<string>("");

  useEffect(() => {
    fetch(`/api/kol/${kolId}`)
      .then((r) => r.json())
      .then((data: { name: string }) => setKolName(data.name))
      .catch(() => setKolName(`KOL #${kolId}`));
  }, [kolId]);

  const restoreSession = async (sessionId: number): Promise<SessionRestoreResult> => {
    const s = await api.getKolChatSession(sessionId);
    if (s.kolId !== kolId) {
      return { messages: [], valid: false };
    }
    return { messages: (s.messages as ChatMessage[]) ?? [], valid: true };
  };

  return (
    <AgentChat
      type="kol"
      agentId={kolId}
      backUrl={backUrl}
      title={kolName || "KOL 分身对话"}
      subtitle="KOL 数字孪生 · 像与真人 UP 主对话一样提问"
      chatEndpoint="/api/kol/chat"
      buildRequestBody={(message, sessionId) => {
        const body: Record<string, unknown> = { kolId, message };
        if (sessionId) body.sessionId = sessionId;
        return body;
      }}
      restoreSession={restoreSession}
      avatarClassName="bg-gradient-to-br from-(--color-brand-500) to-(--color-brand-600)"
      avatarContent={<User className="h-4 w-4 text-white" />}
      features={{
        evidence: true,
        export: true,
        suggestions: true,
        copy: true,
        retry: true,
        thinking: true,
        scrollButton: true,
        clearChat: true,
        typingCursor: true,
      }}
    />
  );
}

export function KolChatLayout() {
  return (
    <div className="h-[calc(100vh-12rem)] max-sm:h-[calc(100vh-10rem)]">
      <KolChatPage />
    </div>
  );
}