-- 证据反馈表 — 用户对证据搜索结果的反馈
-- 用于收集检索质量数据，后续微调检索模型

CREATE TABLE IF NOT EXISTS evidence_feedback (
  id SERIAL PRIMARY KEY,
  evidence_id INTEGER NOT NULL,
  chat_session_id INTEGER,
  message_index INTEGER,
  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  query_text TEXT,
  persona_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ef_evidence_id_idx ON evidence_feedback (evidence_id);
CREATE INDEX IF NOT EXISTS ef_rating_idx ON evidence_feedback (rating);
CREATE INDEX IF NOT EXISTS ef_created_at_idx ON evidence_feedback (created_at);