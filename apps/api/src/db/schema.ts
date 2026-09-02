// --------------------------------------------------------------
// 数据库表定义（Drizzle Schema）
// 一份 TypeScript 代码，Drizzle 会：
//   1. 从这里生成 SQL migration（CREATE TABLE ...）
//   2. 让你写查询时享受完整的类型安全
//
// 这份 schema 本身就是数据库设计课的活教材：
//   - 主键、外键、唯一约束、非空约束
//   - 一对多：course -> chapter -> section
//   - 索引：加在经常查询的列上（如 slug）
//   - jsonb：Postgres 特有的、能存半结构化数据的字段
// --------------------------------------------------------------

import { relations } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ChatMessage, InterviewOutline, BatchInterviewConfig, BatchInterviewReport, PipelineStatus } from "@app/shared";

// pgvector 向量类型（Drizzle 没有内置，用 customType）
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return JSON.stringify(value);
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

// -------------------- courses --------------------

export const courses = pgTable(
  "courses",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    order: integer("order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("courses_slug_idx").on(table.slug),
    orderIdx: index("courses_order_idx").on(table.order),
  }),
);

// -------------------- chapters --------------------

export const chapters = pgTable(
  "chapters",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    order: integer("order").notNull(),
    // 可选：如果不为 null，前端会挂载对应的 Demo 组件
    demoKey: text("demo_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex("chapters_slug_idx").on(table.slug),
    courseIdx: index("chapters_course_id_idx").on(table.courseId),
  }),
);

// -------------------- sections --------------------

// pgEnum 会生成 Postgres 层的 ENUM 类型，比 text + CHECK 约束更规范
export const sectionKindEnum = pgEnum("section_kind", ["text", "code", "note"]);

export const sections = pgTable(
  "sections",
  {
    id: serial("id").primaryKey(),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    kind: sectionKindEnum("kind").notNull().default("text"),
    content: text("content").notNull(),
  },
  (table) => ({
    chapterIdx: index("sections_chapter_id_idx").on(table.chapterId),
  }),
);

// -------------------- demo_events --------------------

// Demo 组件产生的运行时数据：点击计数、留言板等
// payload 用 jsonb —— Postgres 特色，能存半结构化数据、还能对内部字段建索引
export const demoEvents = pgTable(
  "demo_events",
  {
    id: serial("id").primaryKey(),
    demoKey: text("demo_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    demoKeyIdx: index("demo_events_demo_key_idx").on(table.demoKey),
  }),
);

// -------------------- relations --------------------
// relations 让 Drizzle 的 query API 支持 join 时保持类型安全
// （db.query.courses.findFirst({ with: { chapters: true } })）

export const coursesRelations = relations(courses, ({ many }) => ({
  chapters: many(chapters),
}));

export const chaptersRelations = relations(chapters, ({ one, many }) => ({
  course: one(courses, {
    fields: [chapters.courseId],
    references: [courses.id],
  }),
  sections: many(sections),
}));

export const sectionsRelations = relations(sections, ({ one }) => ({
  chapter: one(chapters, {
    fields: [sections.chapterId],
    references: [chapters.id],
  }),
}));

// -------------------- source_segments（AI 标注后的用户原声片段）--------------------

// interviewee：被访者发言；moderator：主持人发言（保留用于还原 preceding_question 语境，不代表最终画像证据）
export const speakerRoleEnum = pgEnum("speaker_role", ["interviewee", "moderator"]);

export const sourceSegments = pgTable(
  "source_segments",
  {
    id: serial("id").primaryKey(),
    sourceFile: text("source_file").notNull(),
    segmentIndex: integer("segment_index").notNull().default(0),
    // 不同来源文件的编号体系不统一（P1-P15 / G3-P1 / 真实姓名等），仅在同一 source_file 内保证唯一，不跨文件关联
    speakerId: text("speaker_id"),
    speakerRole: speakerRoleEnum("speaker_role").notNull().default("interviewee"),
    // 该条发言对应的上一条 moderator 提问，为空代表紧邻上一条就是同一说话人或本来就无提问语境
    precedingQuestion: text("preceding_question"),
    // 提取阶段写入后不再变动，用于清洗规则出问题时回溯重跑
    originalText: text("original_text").notNull(),
    // 清洗前为 null；下游查询用 COALESCE(cleanedText, originalText)
    cleanedText: text("cleaned_text"),
    charCount: integer("char_count"),
    annotation: jsonb("annotation").$type<Record<string, unknown>>(),
    embedding: vector("embedding"),
    embeddingVersion: text("embedding_version"),
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    personaIds: integer("persona_ids").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIdx: index("ss_source_file_idx").on(table.sourceFile),
    speakerIdx: index("ss_speaker_id_idx").on(table.speakerId),
    // GIN 索引：加速 persona_ids 数组查询（如 WHERE persona_ids @> ARRAY[1]）
    personaIdsGinIdx: index("ss_persona_ids_gin_idx").using("gin", table.personaIds),
  }),
);

// -------------------- respondents（受访者背景信息，人物级别）--------------------

// 一个受访者对应多条 source_segments，用 (source_file, speaker_id) 做关联，避免把背景信息重复塞进每条发言
export const respondents = pgTable(
  "respondents",
  {
    id: serial("id").primaryKey(),
    sourceFile: text("source_file").notNull(),
    speakerId: text("speaker_id").notNull(),
    displayName: text("display_name"),
    groupCode: text("group_code"),
    // 背景信息深浅不一（从详细背调到一句自我介绍都有），字段不固定，按来源实际情况填
    background: jsonb("background").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceSpeakerIdx: uniqueIndex("resp_source_speaker_idx").on(table.sourceFile, table.speakerId),
  }),
);

// -------------------- personas（用户画像定义）--------------------

export const personas = pgTable(
  "personas",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    tagSpec: jsonb("tag_spec").$type<Record<string, unknown>>().notNull(),
    motivationChain: jsonb("motivation_chain").$type<Record<string, unknown>>(),
    evidenceIds: integer("evidence_ids").array(),
    clusterId: text("cluster_id"),
    sampleCount: integer("sample_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clusterIdx: index("personas_cluster_idx").on(table.clusterId),
  }),
);

// -------------------- chat_sessions（对话记录）--------------------

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: serial("id").primaryKey(),
    personaId: integer("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    title: text("title"),
    messages: jsonb("messages").$type<ChatMessage[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    personaIdx: index("chat_persona_idx").on(table.personaId),
  }),
);

// -------------------- relations --------------------

export const personasRelations = relations(personas, ({ many }) => ({
  chatSessions: many(chatSessions),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one }) => ({
  persona: one(personas, {
    fields: [chatSessions.personaId],
    references: [personas.id],
  }),
}));

// -------------------- kol_profiles（KOL 画像/分身定义）--------------------

export const kolProfiles = pgTable(
  "kol_profiles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    bilibiliUid: text("bilibili_uid"),
    personaCard: jsonb("persona_card").$type<Record<string, unknown>>().notNull(),
    styleProfile: jsonb("style_profile").$type<Record<string, unknown>>().notNull(),
    sourceTexts: text("source_texts").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uidIdx: index("kol_uid_idx").on(table.bilibiliUid),
  }),
);

// -------------------- kol_segments（KOL 语料片段）--------------------

export const kolSegments = pgTable(
  "kol_segments",
  {
    id: serial("id").primaryKey(),
    kolId: integer("kol_id")
      .notNull()
      .references(() => kolProfiles.id, { onDelete: "cascade" }),
    bvid: text("bvid").notNull(),
    title: text("title").notNull(),
    originalText: text("original_text").notNull(),
    sourceUrl: text("source_url"),
    embedding: vector("embedding"),
    adLabel: text("ad_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kolIdx: index("ks_kol_id_idx").on(table.kolId),
    bvidIdx: index("ks_bvid_idx").on(table.bvid),
  }),
);

// -------------------- kol_chat_sessions（KOL 分身对话记录）--------------------

export const kolChatSessions = pgTable(
  "kol_chat_sessions",
  {
    id: serial("id").primaryKey(),
    kolId: integer("kol_id")
      .notNull()
      .references(() => kolProfiles.id, { onDelete: "cascade" }),
    title: text("title"),
    messages: jsonb("messages").$type<ChatMessage[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kolIdx: index("kcs_kol_id_idx").on(table.kolId),
  }),
);

// -------------------- relations --------------------

export const kolProfilesRelations = relations(kolProfiles, ({ many }) => ({
  segments: many(kolSegments),
  chatSessions: many(kolChatSessions),
}));

export const kolChatSessionsRelations = relations(kolChatSessions, ({ one }) => ({
  kol: one(kolProfiles, {
    fields: [kolChatSessions.kolId],
    references: [kolProfiles.id],
  }),
}));

export const kolSegmentsRelations = relations(kolSegments, ({ one }) => ({
  kol: one(kolProfiles, {
    fields: [kolSegments.kolId],
    references: [kolProfiles.id],
  }),
}));

// -------------------- 便捷类型导出 --------------------

export type CourseRow = typeof courses.$inferSelect;
export type ChapterRow = typeof chapters.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;
export type DemoEventRow = typeof demoEvents.$inferSelect;
export type SourceSegmentRow = typeof sourceSegments.$inferSelect;
export type RespondentRow = typeof respondents.$inferSelect;
export type PersonaRow = typeof personas.$inferSelect;
export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type KolProfileRow = typeof kolProfiles.$inferSelect;
export type KolSegmentRow = typeof kolSegments.$inferSelect;
export type KolChatSessionRow = typeof kolChatSessions.$inferSelect;

// -------------------- import_jobs（批量导入作业记录）--------------------

export const importJobs = pgTable(
  "import_jobs",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    targetTable: text("target_table").notNull(),
    fileName: text("file_name"),
    totalRows: integer("total_rows").default(0),
    inserted: integer("inserted").default(0),
    updated: integer("updated").default(0),
    skipped: integer("skipped").default(0),
    errors: jsonb("errors").$type<Array<{ row: number; message: string }>>().default([]),
    status: text("status").default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("import_jobs_status_idx").on(table.status),
    targetIdx: index("import_jobs_target_idx").on(table.targetTable),
  }),
);

// -------------------- audit_log（数据变更审计日志）--------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    tableName: text("table_name").notNull(),
    recordId: integer("record_id").notNull(),
    action: text("action").notNull(),
    changedBy: text("changed_by").default("admin"),
    oldData: jsonb("old_data").$type<Record<string, unknown>>(),
    newData: jsonb("new_data").$type<Record<string, unknown>>(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tableRecordIdx: index("audit_log_table_record_idx").on(table.tableName, table.recordId),
    actionIdx: index("audit_log_action_idx").on(table.action),
    changedAtIdx: index("audit_log_changed_at_idx").on(table.changedAt),
  }),
);

export type ImportJobRow = typeof importJobs.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;

// -------------------- evidence_feedback（证据反馈）--------------------

export const evidenceFeedback = pgTable(
  "evidence_feedback",
  {
    id: serial("id").primaryKey(),
    evidenceId: integer("evidence_id").notNull(),
    rating: text("rating").notNull(), // "helpful" | "not_helpful"
    chatSessionId: integer("chat_session_id"),
    messageIndex: integer("message_index"),
    queryText: text("query_text"),
    personaId: integer("persona_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    evidenceIdx: index("ef_evidence_id_idx").on(table.evidenceId),
    sessionIdx: index("ef_chat_session_idx").on(table.chatSessionId),
  }),
);

export type EvidenceFeedbackRow = typeof evidenceFeedback.$inferSelect;

// -------------------- interview_outlines（访谈大纲持久化）--------------------

export const interviewOutlines = pgTable(
  "interview_outlines",
  {
    id: text("id").primaryKey(),
    theme: text("theme").notNull(),
    targetPersona: text("target_persona"),
    description: text("description"),
    sections: jsonb("sections").$type<InterviewOutline["sections"]>().notNull(),
    totalDurationMinutes: integer("total_duration_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

// -------------------- outline_jobs（大纲生成异步作业）--------------------

export const outlineJobs = pgTable(
  "outline_jobs",
  {
    jobId: text("job_id").primaryKey(),
    status: text("status").notNull().default("pending"),
    progress: integer("progress").default(0),
    estimatedTotalMs: integer("estimated_total_ms"),
    estimatedRemainingMs: integer("estimated_remaining_ms"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultOutlineId: text("result_outline_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("outline_jobs_status_idx").on(table.status),
    startedIdx: index("outline_jobs_started_idx").on(table.startedAt),
  }),
);

// -------------------- batch_interview_jobs（批量访谈异步作业）--------------------

export const batchInterviewJobs = pgTable(
  "batch_interview_jobs",
  {
    jobId: text("job_id").primaryKey(),
    status: text("status").notNull().default("pending"),
    progress: integer("progress").default(0),
    estimatedTotalMs: integer("estimated_total_ms"),
    estimatedRemainingMs: integer("estimated_remaining_ms"),
    completedPersonas: integer("completed_personas").array().default([]),
    totalPersonas: integer("total_personas"),
    totalRounds: integer("total_rounds").default(0),
    progressByPersona: jsonb("progress_by_persona").$type<Record<string, { name: string; question: string }>>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    estimatedCompletionAt: timestamp("estimated_completion_at", { withTimezone: true }),
    error: text("error"),
    config: jsonb("config").$type<BatchInterviewConfig>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("batch_jobs_status_idx").on(table.status),
    startedIdx: index("batch_jobs_started_idx").on(table.startedAt),
  }),
);

// -------------------- batch_interview_reports（批量访谈报告）--------------------

export const batchInterviewReports = pgTable(
  "batch_interview_reports",
  {
    jobId: text("job_id").primaryKey(),
    report: jsonb("report").$type<BatchInterviewReport>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type InterviewOutlineRow = typeof interviewOutlines.$inferSelect;
export type OutlineJobRow = typeof outlineJobs.$inferSelect;
export type BatchInterviewJobRow = typeof batchInterviewJobs.$inferSelect;
export type BatchInterviewReportRow = typeof batchInterviewReports.$inferSelect;

// -------------------- pipeline_jobs（数据流水线异步作业持久化）--------------------

export const pipelineJobs = pgTable(
  "pipeline_jobs",
  {
    jobId: text("job_id").primaryKey(),
    stage: text("stage").notNull().default("uploading"),
    progress: integer("progress").default(0),
    estimatedTotalMs: integer("estimated_total_ms"),
    estimatedRemainingMs: integer("estimated_remaining_ms"),
    stats: jsonb("stats").$type<PipelineStatus["stats"]>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stageIdx: index("pipeline_jobs_stage_idx").on(table.stage),
    startedIdx: index("pipeline_jobs_started_idx").on(table.startedAt),
  }),
);

export type PipelineJobRow = typeof pipelineJobs.$inferSelect;
