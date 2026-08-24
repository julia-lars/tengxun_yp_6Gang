// 前后端共享类型 — AI 模拟用户系统
import { z } from "zod";

// ---- 标签 ----
export const tagDimensionSchema = z.object({
  name: z.string(),
  label: z.string(),
  values: z.array(
    z.object({
      value: z.string(),
      label: z.string(),
      incompatibleWith: z.array(z.string()).optional(),
    }),
  ),
});
export type TagDimension = z.infer<typeof tagDimensionSchema>;

// ---- 画像 ----
export const personaSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  tagSpec: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  sampleCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type PersonaSummary = z.infer<typeof personaSummarySchema>;

export const evidenceSchema = z.object({
  id: z.number().int().positive(),
  sourceFile: z.string(),
  originalText: z.string(),
  annotation: z.record(z.string(), z.unknown()).nullable(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const personaDetailSchema = personaSummarySchema.extend({
  motivationChain: z.record(z.string(), z.unknown()).nullable(),
  evidenceList: z.array(evidenceSchema),
  clusterId: z.string().nullable(),
});
export type PersonaDetail = z.infer<typeof personaDetailSchema>;

// ---- 对话 ----

export const confidenceBreakdownSchema = z.object({
  evidenceScore: z.number().min(0).max(1),
  consistencyScore: z.number().min(0).max(1),
  sampleScore: z.number().min(0).max(1),
});
export type ConfidenceBreakdown = z.infer<typeof confidenceBreakdownSchema>;

export const confidenceResultSchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(["high", "medium", "low"]),
  breakdown: confidenceBreakdownSchema,
  flags: z.array(z.string()),
});
export type ConfidenceResult = z.infer<typeof confidenceResultSchema>;

export const evidenceMetaSchema = z.object({
  id: z.number().int().positive(),
  similarity: z.number().min(0).max(1),
  matchLevel: z.enum(["direct", "partial", "inferred"]),
  tagOverlap: z.number().min(0).max(1),
});
export type EvidenceMeta = z.infer<typeof evidenceMetaSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  evidenceIds: z.array(z.number().int().positive()).optional(),
  evidenceMeta: z.array(evidenceMetaSchema).optional(),
  confidence: confidenceResultSchema.optional(),
  suggestions: z.array(z.string()).optional(),
  timestamp: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  personaId: z.number().int().positive(),
  sessionId: z.number().int().positive().optional(),
  message: z.string().min(1).max(2000),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatSessionSchema = z.object({
  id: z.number().int().positive(),
  personaId: z.number().int().positive(),
  title: z.string().nullable().optional(),
  messages: z.array(chatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;

// ---- KOL ----
export const kolProfileSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  bilibiliUid: z.string().nullable(),
  description: z.string(),
  videoCount: z.number().int().nonnegative(),
  sampleSegments: z.array(z.string()).optional(),
  createdAt: z.string(),
});
export type KolProfileSummary = z.infer<typeof kolProfileSummarySchema>;

export const kolProfileDetailSchema = kolProfileSummarySchema.extend({
  personaCard: z.record(z.string(), z.unknown()),
  styleProfile: z.record(z.string(), z.unknown()),
  sourceTexts: z.array(z.string()),
});
export type KolProfileDetail = z.infer<typeof kolProfileDetailSchema>;

export const kolChatRequestSchema = z.object({
  kolId: z.number().int().positive(),
  sessionId: z.number().int().positive().optional(),
  message: z.string().min(1).max(2000),
});
export type KolChatRequest = z.infer<typeof kolChatRequestSchema>;

export const kolChatSessionSchema = z.object({
  id: z.number().int().positive(),
  kolId: z.number().int().positive(),
  title: z.string().nullable().optional(),
  messages: z.array(chatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KolChatSession = z.infer<typeof kolChatSessionSchema>;

// ---- 数据流水线 ----
export const pipelineConfigSchema = z.object({
  target: z.enum(["personas", "kol"]).optional(),
  fileNames: z.array(z.string()).optional().default([]),
  uploadedFileIds: z.array(z.string()).optional().default([]),
  enableClustering: z.boolean().optional().default(false),
  enableKol: z.boolean().optional(),
  kolId: z.number().int().positive().optional(),
  notes: z.string().optional(),
});
export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

export const pipelineStatusSchema = z.object({
  jobId: z.string(),
  stage: z.enum([
    "uploading",
    "extracting",
    "cleaning",
    "tagging",
    "embedding",
    "clustering",
    "cancelled",
  ]),
  progress: z.number().min(0).max(100),
  estimatedTotalMs: z.number().int().positive(),
  estimatedRemainingMs: z.number().optional(),
  stats: z.object({
    filesTotal: z.number(),
    filesProcessed: z.number(),
    segmentsExtracted: z.number(),
    segmentsCleaned: z.number(),
    segmentsTagged: z.number(),
    segmentsEmbedded: z.number(),
    errors: z.array(z.string()),
  }),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type PipelineStatus = z.infer<typeof pipelineStatusSchema>;

// ---- 访谈大纲 ----

export const interviewQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  category: z.string(),
  purpose: z.string(),
  expectedInsight: z.string(),
  followUps: z.array(z.string()).optional(),
});
export type InterviewQuestion = z.infer<typeof interviewQuestionSchema>;

export const interviewOutlineSchema = z.object({
  id: z.string(),
  theme: z.string(),
  targetPersona: z.string().optional(),
  description: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      purpose: z.string(),
      durationMinutes: z.number(),
      questions: z.array(interviewQuestionSchema),
    }),
  ),
  totalDurationMinutes: z.number(),
  createdAt: z.string(),
});
export type InterviewOutline = z.infer<typeof interviewOutlineSchema>;

export const outlineGenerateRequestSchema = z.object({
  theme: z.string().min(1).max(500),
  targetPersonaIds: z.array(z.number().int().positive()).optional(),
  targetPersonaNames: z.array(z.string()).optional(),
  focusAreas: z.array(z.string()).optional(),
  additionalContext: z.string().max(2000).optional(),
  questionCount: z.number().int().min(5).max(50).default(15),
});
export type OutlineGenerateRequest = z.infer<typeof outlineGenerateRequestSchema>;

export const outlineJobStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  progress: z.number().min(0).max(100),
  estimatedTotalMs: z.number().int().positive(),
  estimatedRemainingMs: z.number().int().optional(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  result: interviewOutlineSchema.nullable(),
  error: z.string().nullable(),
});
export type OutlineJobStatus = z.infer<typeof outlineJobStatusSchema>;

// ---- 批量访谈 ----

export const batchInterviewConfigSchema = z.object({
  outlineId: z.string().optional(),
  outline: interviewOutlineSchema.optional(),
  personaIds: z.array(z.number().int().positive()),
  personaNames: z.array(z.string()).optional(),
  concurrency: z.number().int().min(1).max(10).default(3),
  maxRoundsPerPersona: z.number().int().min(1).max(20).default(10),
});
export type BatchInterviewConfig = z.infer<typeof batchInterviewConfigSchema>;

export const interviewResultSchema = z.object({
  personaId: z.number().int().positive(),
  personaName: z.string(),
  rounds: z.array(
    z.object({
      question: z.string(),
      answer: z.string(),
      evidenceIds: z.array(z.number().int().positive()).optional(),
    }),
  ),
  keyInsights: z.array(z.string()),
  completedAt: z.string(),
});
export type InterviewResult = z.infer<typeof interviewResultSchema>;

export const batchInterviewReportSchema = z.object({
  jobId: z.string(),
  config: batchInterviewConfigSchema,
  results: z.array(interviewResultSchema),
  summary: z.object({
    totalInterviews: z.number().int(),
    completedInterviews: z.number().int(),
    totalRounds: z.number().int(),
    crossCuttingThemes: z.array(z.string()),
    personaComparison: z.array(
      z.object({
        theme: z.string(),
        observations: z.array(
          z.object({
            personaId: z.number().int().positive(),
            personaName: z.string(),
            stance: z.string(),
            quote: z.string().optional(),
          }),
        ),
      }),
    ),
  }),
  generatedAt: z.string(),
});
export type BatchInterviewReport = z.infer<typeof batchInterviewReportSchema>;

export const batchInterviewStatusSchema = z.object({
  jobId: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  progress: z.number().min(0).max(100),
  estimatedTotalMs: z.number().int().positive(),
  estimatedRemainingMs: z.number().int().optional(),
  completedPersonas: z.array(z.number().int().positive()),
  totalPersonas: z.number().int(),
  totalRounds: z.number().int(),
  progressByPersona: z
    .record(z.object({ name: z.string(), question: z.string() }))
    .optional(),
  startedAt: z.string(),
  estimatedCompletionAt: z.string().nullable(),
  error: z.string().optional(),
});
export type BatchInterviewStatus = z.infer<typeof batchInterviewStatusSchema>;
