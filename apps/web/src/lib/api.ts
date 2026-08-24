// 前端 API 客户端 — AI 模拟用户系统
import type {
  BatchInterviewConfig,
  BatchInterviewReport,
  BatchInterviewStatus,
  ChatSession,
  KolChatSession,
  KolProfileDetail,
  KolProfileSummary,
  OutlineGenerateRequest,
  OutlineJobStatus,
  PersonaDetail,
  PersonaSummary,
  PipelineConfig,
  PipelineStatus,
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

export interface PipelineUploadResult {
  fileIds: string[];
  fileNames: string[];
  totalSize: number;
}

export interface RefineQuestionResult {
  original: string;
  refined: string;
  rationale: string;
  suggestedFollowUps?: string[];
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export const api = {
  getTags: () => request<{ dimensions: TagDimension[] }>("/api/tags"),

  listPersonas: (tags?: string, pagination?: PaginationParams) => {
    const params = new URLSearchParams();
    if (tags) params.set("tags", tags);
    if (pagination?.limit) params.set("limit", String(pagination.limit));
    if (pagination?.offset) params.set("offset", String(pagination.offset));
    const qs = params.toString();
    return request<PersonaSummary[]>(`/api/personas${qs ? `?${qs}` : ""}`);
  },

  getPersona: (id: number) => request<PersonaDetail>(`/api/personas/${id}`),

  getChatSessions: (personaId?: number) =>
    request<ChatSession[]>(`/api/chat/sessions${personaId ? `?personaId=${personaId}` : ""}`),

  getChatSession: (id: number) => request<ChatSession>(`/api/chat/sessions/${id}`),

  // KOL
  listKol: () => request<KolProfileSummary[]>("/api/kol"),
  getKol: (id: number) => request<KolProfileDetail>(`/api/kol/${id}`),
  listKolChatSessions: (kolId?: number) =>
    request<KolChatSession[]>(`/api/kol/chat/sessions${kolId ? `?kolId=${kolId}` : ""}`),
  getKolChatSession: (id: number) => request<KolChatSession>(`/api/kol/chat/sessions/${id}`),

  // 数据流水线
  uploadPipelineFiles: async (files: File[]) => {
    const formData = new FormData();
    for (const file of files) formData.append("files", file);
    const res = await fetch("/api/pipeline/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as PipelineUploadResult;
  },
  getPipelineStatus: (jobId: string) =>
    request<PipelineStatus>(`/api/pipeline/status/${jobId}`),
  startPipeline: (config: PipelineConfig) =>
    request<{ jobId: string; status: PipelineStatus }>("/api/pipeline/start", {
      method: "POST",
      body: JSON.stringify(config),
    }),

  // 访谈大纲
  generateOutline: (req: OutlineGenerateRequest) =>
    request<{ jobId: string; estimatedTotalMs: number }>(
      "/api/interview/outline/generate",
      { method: "POST", body: JSON.stringify(req) },
    ),
  getOutlineGenerateStatus: (jobId: string) =>
    request<OutlineJobStatus>(`/api/interview/outline/generate/status/${jobId}`),
  refineQuestion: (body: {
    question: string;
    theme: string;
    personaContext?: string;
  }) =>
    request<RefineQuestionResult>("/api/interview/outline/refine-question", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // 批量访谈
  startBatchInterview: (config: BatchInterviewConfig) =>
    request<{ jobId: string; status: BatchInterviewStatus }>(
      "/api/interview/batch/start",
      { method: "POST", body: JSON.stringify(config) },
    ),
  getBatchInterviewStatus: (jobId: string) =>
    request<BatchInterviewStatus>(`/api/interview/batch/status/${jobId}`),
  getBatchInterviewReport: (jobId: string) =>
    request<BatchInterviewReport>(`/api/interview/batch/report/${jobId}`),
};