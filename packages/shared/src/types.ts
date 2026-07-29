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
export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  evidenceIds: z.array(z.number().int().positive()).optional(),
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
