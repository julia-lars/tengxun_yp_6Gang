// 前端 API 客户端 — AI 模拟用户系统
import type {
  BatchInterviewConfig,
  BatchInterviewReport,
  BatchInterviewStatus,
  ChatSession,
  InterviewOutline,
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

export interface AdminListResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface AdminStats {
  tables: Record<string, number>;
  sourceDistribution: Array<{ sourceFile: string; count: number }>;
}

export interface ImportJob {
  id: number;
  source: string;
  targetTable: string;
  fileName: string | null;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }> | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DryRunResult {
  format: { format: string; rowCount: number; sampleKeys: string[] };
  sampleKeys: string[];
  targetFields: string[];
  fieldMatch: {
    matched: string[];
    unmatched: string[];
    missing: string[];
    matchRate: number;
  };
  validation: {
    valid: boolean;
    errorCount: number;
    warningCount: number;
    sampleErrors: Array<{ row: number; field: string; message: string }>;
    sampleWarnings: Array<{ row: number; message: string }>;
  };
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

  deleteChatSession: (id: number) =>
    request<{ success: boolean }>(`/api/chat/sessions/${id}`, { method: "DELETE" }),

  // KOL
  listKol: () => request<KolProfileSummary[]>("/api/kol"),
  getKol: (id: number) => request<KolProfileDetail>(`/api/kol/${id}`),
  listKolChatSessions: (kolId?: number) =>
    request<KolChatSession[]>(`/api/kol/chat/sessions${kolId ? `?kolId=${kolId}` : ""}`),
  getKolChatSession: (id: number) => request<KolChatSession>(`/api/kol/chat/sessions/${id}`),
  deleteKolChatSession: (id: number) =>
    request<{ success: boolean }>(`/api/kol/chat/sessions/${id}`, { method: "DELETE" }),

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
  listPipelineJobs: () =>
    request<PipelineStatus[]>("/api/pipeline/jobs"),
  startPipeline: (config: PipelineConfig) =>
    request<{ jobId: string; status: PipelineStatus }>("/api/pipeline/start", {
      method: "POST",
      body: JSON.stringify(config),
    }),
  cancelPipeline: (jobId: string) =>
    request<{ success: boolean; message: string }>(`/api/pipeline/cancel/${jobId}`, {
      method: "POST",
    }),

  // 访谈大纲
  generateOutline: (req: OutlineGenerateRequest) =>
    request<{ jobId: string; estimatedTotalMs: number }>(
      "/api/interview/outline/generate",
      { method: "POST", body: JSON.stringify(req) },
    ),
  getOutlineGenerateStatus: (jobId: string) =>
    request<OutlineJobStatus>(`/api/interview/outline/generate/status/${jobId}`),
  cancelOutlineGeneration: (jobId: string) =>
    request<{ success: boolean; message: string }>(`/api/interview/outline/cancel/${jobId}`, {
      method: "POST",
    }),
  getOutline: (id: string) =>
    request<InterviewOutline>(`/api/interview/outline/${id}`),
  listOutlines: () =>
    request<InterviewOutline[]>("/api/interview/outline"),
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
  cancelBatchInterview: (jobId: string) =>
    request<{ success: boolean; message: string }>(`/api/interview/batch/cancel/${jobId}`, {
      method: "POST",
    }),
  getBatchInterviewReport: (jobId: string) =>
    request<BatchInterviewReport>(`/api/interview/batch/report/${jobId}`),
  listBatchInterviewJobs: () =>
    request<BatchInterviewStatus[]>("/api/interview/batch/jobs"),

  // ====== 管理后台 ======

  /** 获取仪表盘统计 */
  getAdminStats: () => request<AdminStats>("/api/admin/stats"),

  /** 审计日志 */
  getAuditLog: (params?: { limit?: number; table?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.table) qs.set("table", params.table);
    return request<{ data: unknown[] }>(`/api/admin/audit-log${qs.toString() ? `?${qs}` : ""}`);
  },

  /** 通用表格列表 */
  adminList: <T>(table: string, params?: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: string;
    search?: string;
    filters?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.sort) qs.set("sort", params.sort);
    if (params?.order) qs.set("order", params.order);
    if (params?.search) qs.set("search", params.search);
    if (params?.filters) qs.set("filters", params.filters);
    return request<AdminListResponse<T>>(`/api/admin/${table}${qs.toString() ? `?${qs}` : ""}`);
  },

  /** 通用记录详情 */
  adminGet: <T>(table: string, id: number) =>
    request<{ data: T }>(`/api/admin/${table}/${id}`),

  /** 通用新增 */
  adminCreate: <T>(table: string, data: Record<string, unknown>) =>
    request<{ data: T }>(`/api/admin/${table}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** 通用更新 */
  adminUpdate: <T>(table: string, id: number, data: Record<string, unknown>) =>
    request<{ data: T }>(`/api/admin/${table}/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  /** 通用删除 */
  adminDelete: (table: string, id: number) =>
    request<{ success: boolean }>(`/api/admin/${table}/${id}`, {
      method: "DELETE",
    }),

  // ====== 数据导入 ======

  /** 上传 JSON 文件导入 */
  importJson: async (file: File, targetTable: string, strategy: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_table", targetTable);
    formData.append("strategy", strategy);
    const res = await fetch("/api/import/json", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as {
      jobId: number;
      fileName: string;
      targetTable: string;
      totalRows: number;
      format: string;
      status: string;
    };
  },

  /** 从 data/ 目录导入 */
  importFromDataDir: (body: {
    dataPath?: string;
    targetTable: string;
    filePattern?: string;
    strategy?: string;
  }) =>
    request<{ jobId: number; files: string[]; targetTable: string; dataPath: string; status: string }>(
      "/api/import/from-data-dir",
      { method: "POST", body: JSON.stringify(body) },
    ),

  /** 导入作业列表 */
  listImportJobs: (limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return request<{ data: ImportJob[] }>(`/api/import/jobs${qs}`);
  },

  /** 导入作业详情 */
  getImportJob: (id: number) =>
    request<{ data: ImportJob }>(`/api/import/jobs/${id}`),

  /** 导入预检 */
  importDryRun: async (file: File, targetTable: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_table", targetTable);
    const res = await fetch("/api/import/dry-run", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return (await res.json()) as DryRunResult;
  },
};