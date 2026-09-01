# 证据链全面审查报告

## 一、当前证据算法概述

```
用户消息
  │
  ├─[1] embedQuery(消息) → 调用 BGE-M3 向量化服务 (127.0.0.1:8765)
  │     └─ 失败 → 降级 ILIKE 模糊搜索
  │
  ├─[2] pgvector 余弦距离检索 (<=> 运算符)
  │     SELECT ... WHERE embedding IS NOT NULL
  │       ORDER BY embedding <=> $vecStr::vector
  │       LIMIT 10
  │     └─ 相似度 = 1 - 余弦距离, 过滤 < 0.5 的结果
  │
  ├─[3] computeTagOverlap(画像标签, 证据标注)
  │     └─ 维度级比对: 诉求/能力/风格/平台/模式
  │        persona 中文标签 → cnLabelToEnKey → 英文key
  │        evidence annotation → DIMENSION_EXTRACTORS → 英文value
  │        → 交集/并集 计算重叠度
  │
  ├─[4] calculateConfidence
  │     evidenceScore (0.6) + consistencyScore (0.15) + sampleScore (0.25)
  │     └─ evidenceScore = (topSim*0.6 + avgSim*0.4) * min(1, count/3)
  │
  ├─[5] LLM 对话 (含证据上下文)
  │
  └─[6] SSE 流式输出 + meta 事件 (evidence + confidence + sentenceEvidence)
```

## 二、发现的问题及修复方案

### 🔴 P0 — 严重（导致功能完全不可用）

#### 问题 1: Embed Server 未运行
- **文件**: `apps/api/src/lib/embed.ts` + 系统进程
- **现象**: `curl http://127.0.0.1:8765/embed` → 连接拒绝 (exit code 7)
- **影响链路**:
  1. `embedQuery()` 抛异常 → `searchEvidence` 降级到 ILIKE
  2. ILIKE 只做 `original_text ILIKE '%前30字符%'` 模糊匹配 → 无向量语义相关性
  3. 所有 ILIKE 结果的 similarity 被硬编码为 0.5 → 全部被标记为 `partial` 等级
  4. 如果 ILIKE 也匹配不到（如用户问的是"组队语音"但数据库里写的是"开黑连麦"）→ evidenceCount=0 → evidenceScore=0 → consistencyScore=0
  5. 最终置信度仅靠 sampleScore * 0.25 撑底 → 最高 0.25
- **修复**:
  ```bash
  # 启动 embed server
  cd /path/to/embed-server
  python server.py  # 或对应的启动命令
  ```

#### 问题 2: ILIKE 兜底过于脆弱
- **文件**: `apps/api/src/routes/chat.ts` 第 171 行
- **当前代码**: `ILIKE '%${message.slice(0, 30)}%'`
- **问题**: 只取前 30 字符做子串匹配，完全没有语义理解。如果用户和数据库用词不同（如"开黑" vs "组队"），完全匹配不到
- **修复方案**: 在 embed server 不可用时，使用 `pg_trgm` 三元组相似度做模糊匹配：
  ```sql
  SELECT ... WHERE similarity(original_text, $message) > 0.2
  ORDER BY similarity(original_text, $message) DESC
  LIMIT 10
  ```
  需要先 `CREATE EXTENSION IF NOT EXISTS pg_trgm;`

### 🟠 P1 — 高（导致关键指标异常）

#### 问题 3: Fallback tagSpec 有拼写错误
- **文件**: `apps/api/src/routes/chat.ts` 第 95 行
- **当前**: `风格: ["主动求战刚枪"]`（无斜杠）
- **正确**: `风格: ["主动求战/刚枪"]`（有斜杠）
- **影响**: `cnLabelToEnKey("主动求战刚枪")` 在 `CN_TO_EN_LABEL_MAP` 中找不到，fallback 返回 `["主动求战刚枪"]`（中文原文），与 evidence 中的英文值 `aggressive` 永远无法匹配 → 风格维度一致为 0
- **修复**: 将 `"主动求战刚枪"` 改为 `"主动求战/刚枪"`

#### 问题 4: persona 不存在时 sampleCount=0 导致硬编码 sampleScore=0.3
- **文件**: `apps/api/src/routes/chat.ts` 第 214 行
- **当前**: `sampleCount: persona?.sampleCount ?? 0`
- **影响**: 当 persona 从 DB 查不到时，`sampleCount=0` → `sampleScore=0.3`（因为 < 10），进一步压低置信度
- **修复**: 使用合理的默认值，例如 `persona?.sampleCount ?? 50`（中等样本量）

#### 问题 5: computeTagOverlap 维度粒度不匹配
- **文件**: `apps/api/src/lib/confidence.ts` 第 202-268 行
- **现象**: persona 标签和 evidence 标签虽在同一维度，但值经常不匹配：
  - 能力维度: persona `growth/improvement` vs evidence `advanced` → 0 重叠
  - 模式维度: persona `pvp` vs evidence `pvp_main` → 0 重叠
  - 平台维度: persona `multi_platform` vs evidence `pc` → 0 重叠
- **根因**: persona 标签是聚类粗粒度标签（如"进阶"），evidence 是精细标注（如"advanced"），两者在英文映射后属于不同概念层级
- **修复方案**: 在 `computeTagOverlap` 中增加语义相近匹配（同义词映射表）：
  ```typescript
  const SYNONYM_MAP: Record<string, string[]> = {
    'advanced': ['growth', 'improvement', 'advanced', 'skilled'],
    'pvp_main': ['pvp', 'pvp_main', 'competitive'],
    'pc': ['pc', 'multi_platform'],
    'mobile': ['mobile', 'multi_platform'],
    // ...
  };
  ```

### 🟡 P2 — 中（影响用户体验）

#### 问题 6: evaluateEvidenceRelevance 调用增加显著延迟
- **文件**: `apps/api/src/lib/agent-chat.ts` 第 153-167 行 + 第 333-412 行
- **现象**: 每次回答完成后，额外发起 2 次 LLM 调用（evidenceRelevance + mapSentencesToEvidence）
  - 即使 `Promise.allSettled` 并行执行，每次仍需 2-5 秒
  - 用户看到回答后还要等待证据卡片出现
- **优化方案**: 考虑将证据评分移到流式输出之前（但需要先有完整回答），或使用更轻量的评分方式（如规则匹配）

#### 问题 7: SIMILARITY_THRESHOLD 硬编码
- **文件**: `apps/api/src/routes/chat.ts` 第 123 行
- **当前**: `const SIMILARITY_THRESHOLD = 0.5;`
- **问题**: 阈值固定，无法根据数据分布调整。如果向量质量差，可能过滤掉仍有参考价值的证据
- **修复**: 基于检索结果动态计算阈值，或至少做成可配置参数

#### 问题 8: 证据数量上限硬编码
- **文件**: `apps/api/src/routes/chat.ts` 第 137 行
- **当前**: `LIMIT 10`
- **问题**: 对所有查询固定返回最多 10 条，可能导致遗漏相关证据，或返回过多无关证据
- **修复**: 基于相似度动态截断（如相似度突降处截断），同时设置最小/最大边界

### 🟢 P3 — 低（改进建议）

#### 问题 9: matchLevel 仅基于向量相似度判断
- **文件**: `apps/api/src/lib/agent-chat.ts` 第 178 行
- **当前**: `const matchLevel = similarity >= 0.75 ? "direct" : similarity >= 0.5 ? "partial" : "inferred";`
- **问题**: 向量相似度高 ≠ 直接引用。LLM 的 relevanceScore 能更准确判断相关度，但未被用于 matchLevel
- **修复**: 综合 LLM relevanceScore 和向量相似度判断 matchLevel

#### 问题 10: 逐句证据映射中的句子拆分与渲染不一致
- **文件**: `apps/api/src/lib/agent-chat.ts` 第 436-439 行（拆分） vs `apps/web/src/components/chat/evidence-sheet.tsx` 第 78-81 行（渲染拆分）
- **问题**: 两处使用相同的正则 `/[。！？!?；;\n]+/` 拆分句子，但 LLM 返回的 `sentenceIndex` 是基于服务端拆分结果，而前端渲染时又重新拆分 → 可能导致索引错位
- **修复**: 让服务端将拆分后的句子列表通过 SSE 传给前端，前端直接使用无需重新拆分

## 三、问题优先级总结

| 优先级 | 问题 | 修复难度 | 影响范围 |
|--------|------|----------|----------|
| P0 | Embed server 未运行 | 运维 | 所有向量检索失败 |
| P0 | ILIKE 兜底过于脆弱 | 中 | 向量检索失败时的降级质量 |
| P1 | Fallback tagSpec 拼写错误 | 极低 | 风格维度标签一致性 |
| P1 | persona 不存在时 sampleCount=0 | 极低 | persona 丢失时的置信度 |
| P1 | 维度粒度不匹配 | 中 | 所有标签一致性计算 |
| P2 | LLM 评分增加延迟 | 中 | 用户体验 |
| P2 | 相似度阈值硬编码 | 低 | 召回精度 |
| P2 | 证据数量上限硬编码 | 低 | 召回率 |
| P3 | matchLevel 判断 | 低 | 证据等级准确性 |
| P3 | 句子拆分不一致 | 中 | 逐句高亮准确性 |