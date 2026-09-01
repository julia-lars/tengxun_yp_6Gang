-- 添加 pgvector IVFFlat 索引以加速向量检索
-- 当前无向量索引，每次检索均为全表扫描 17K+ 条记录
-- IVFFlat 需要 lists 参数，建议 lists = sqrt(总行数) ≈ 100

-- source_segments 向量索引（优先使用 cleaned_embedding，fallback 到 embedding）
CREATE INDEX IF NOT EXISTS ss_embedding_ivfflat_idx
  ON source_segments
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- kol_segments 向量索引
CREATE INDEX IF NOT EXISTS ks_embedding_ivfflat_idx
  ON kol_segments
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);