// 虚拟访谈室 — 使用统一聊天组件 AgentChat
import type { PersonaDetail } from "@app/shared";
import { User } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { AgentChat, type ChatMessage, type SessionRestoreResult } from "@/components/chat/agent-chat.js";
import { api } from "../lib/api.js";

export function ChatRoomPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const personaId = Number(id);
  const fromParam = searchParams.get("from");
  const backUrl =
    fromParam === "home"
      ? "/"
      : fromParam === "history"
        ? "/history"
        : fromParam === "personas"
          ? "/personas"
          : `/personas/${personaId}`;
  const [persona, setPersona] = useState<PersonaDetail | null>(null);

  // 加载画像信息
  useEffect(() => {
    if (!personaId || Number.isNaN(personaId)) return;
    api
      .getPersona(personaId)
      .then(setPersona)
      .catch(() => {});
  }, [personaId]);

  const subtitle = persona
    ? `${persona.name} · ${persona.sampleCount} 样本`
    : `画像 #${personaId}`;

  const restoreSession = async (sessionId: number): Promise<SessionRestoreResult> => {
    const s = await api.getChatSession(sessionId);
    if (s.personaId !== personaId) {
      console.warn(
        `会话 #${sessionId} 属于画像 #${s.personaId}，与当前画像 #${personaId} 不匹配`,
      );
      return { messages: [], valid: false };
    }
    return { messages: (s.messages as ChatMessage[]) ?? [], valid: true };
  };

  return (
    <AgentChat
      type="persona"
      agentId={personaId}
      backUrl={backUrl}
      title={persona?.name ?? "虚拟访谈室"}
      subtitle={subtitle}
      chatEndpoint="/api/chat"
      buildRequestBody={(message, sessionId) => {
        const body: Record<string, unknown> = { personaId, message };
        if (sessionId) body.sessionId = sessionId;
        return body;
      }}
      restoreSession={restoreSession}
      avatarClassName="bg-(--color-brand-500)"
      avatarContent={<User className="h-4 w-4 text-white" />}
      features={{
        evidence: true,
        evidenceList: persona?.evidenceList ?? [],
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

export function ChatRoomLayout() {
  return (
    <div className="h-[calc(100vh-12rem)] max-sm:h-[calc(100vh-10rem)]">
      <ChatRoomPage />
    </div>
  );
}