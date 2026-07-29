// 前端 API 客户端 — AI 模拟用户系统
import type {
  ChatSession,
  KolProfileDetail,
  KolProfileSummary,
  PersonaDetail,
  PersonaSummary,
  TagDimension,
} from "@app/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  getTags: () => request<{ dimensions: TagDimension[] }>("/api/tags"),
  listPersonas: (tags?: string) =>
    request<PersonaSummary[]>(`/api/personas${tags ? `?tags=${tags}` : ""}`),
  getPersona: (id: number) => request<PersonaDetail>(`/api/personas/${id}`),
  getChatSessions: (personaId?: number) =>
    request<ChatSession[]>(`/api/chat/sessions${personaId ? `?personaId=${personaId}` : ""}`),
  getChatSession: (id: number) => request<ChatSession>(`/api/chat/sessions/${id}`),
  // KOL
  listKol: () => request<KolProfileSummary[]>("/api/kol"),
  getKol: (id: number) => request<KolProfileDetail>(`/api/kol/${id}`),
};
