# 评测数据目录

## 评测体系

> **体系设计文档**：[评测体系设计方案_V1.0.md](./评测体系设计方案_V1.0.md)
> **指标字典**：[评测指标字典_V1.0.md](./评测指标字典_V1.0.md) — 30+ 底层指标逐项规定
> **全方向评测内容设计**：[全方向评测内容设计方案_V1.0.md](./全方向评测内容设计方案_V1.0.md) — A/B/C/D 四层各需要什么评测素材
> **题库审查方案**：[题库审查与修改方案_V1.0.md](./题库审查与修改方案_V1.0.md) — 两模块 190 题逐题审查
> **聚类评测报告**：[reports/cluster_eval_latest.md](./reports/cluster_eval_latest.md) — 最新 A 层聚类评测结果

评测对象为整个 Pipeline：**访谈语料 → M1–M5 打标 → 向量化 → 聚类 → 玩家画像 → RAG → 模拟用户**。

采用四层评价体系：

| 一级维度 | 权重 | 核心问题 |
| --- | ---: | --- |
| A. 聚类真实性 | 40% | 聚类结构是否真实、稳定、可解释 |
| B. 画像真实性 | 25% | 画像文本是否忠实于原始数据 |
| C. 模拟忠实度 | 25% | AI 模拟回答是否体现群体特征 |
| D. 评价可靠性 | 10% | 评分体系本身是否可信（质量门槛） |

## 评测素材清单（按层级）

### A 层 — 聚类真实性

| 文件 | 用途 | 状态 |
|------|------|------|
| `player_feature_matrix_spec.json` | A1/A2 玩家特征矩阵数据格式规约 | ✅ 已创建 |
| `stability_test_config.json` | A3 Bootstrap + 参数网格稳定性测试配置 | ✅ 已创建 |
| `cluster_interpretability_rubric.json` | A6 人工评估聚类可解释性评分量规 | ✅ 已创建 |

### B 层 — 画像真实性

| 文件 | 用途 | 状态 |
|------|------|------|
| `persona_claim_evidence_schema.json` | Claim-Evidence Matrix 的 JSON Schema 定义 | ✅ 已创建 |
| `claim_extraction_prompt.md` | LLM 提取 Atomic Claims 的 Prompt 模板 | ✅ 已创建 |
| `contradiction_search_prompt.md` | LLM 搜索反证的 Prompt 模板 | ✅ 已创建 |

### C 层 — 模拟忠实度

| 文件 | 用途 | 状态 |
|------|------|------|
| `test_cases_persona_v1.json` | 群体画像测试题集（122 题） | ✅ 已有 |
| `test_cases_kol_v1.json` | KOL 数字孪生测试题集（68 题） | ✅ 已有 |
| `question_metadata.json` | 190 题的 M 层映射 + 题型 + 量化方式元数据 | ✅ 已创建 |
| `question_M_matrix.json` | M 层 × 模块交叉矩阵 | ✅ 已创建 |

### D 层 — 评价可靠性

| 文件 | 用途 | 状态 |
|------|------|------|
| `retest_sample_config.json` | D1 测试-重测信度实验设计 | ✅ 已创建 |
| `human_calibration_sample.json` | D3 人工校准样本集（60 题）设计 | ✅ 已创建 |
| `judge_robustness_config.json` | D4 Prompt/模型/Temperature 敏感性测试 | ✅ 已创建 |
| `human_rubric_training_guide.md` | 人工评分者培训指南（含 5 道校准练习） | ✅ 已创建 |

## 测试题来源

测试题来自桌面 `腾讯用户画像-data/test/` 下的 Excel 文件：

| 文件 | 目标模块 | 题数 |
|------|----------|------|
| `AI模拟用户画像_测试题集_射击类用户.xlsx` | 群体画像 | 122 题 |
| `KOL数字孪生_测试题集_硬核测评KOL.xlsx` | KOL 数字孪生 | 68 题 |

## M 层覆盖情况（元数据分析）

基于 `question_metadata.json` 的统计：

| M 层 | 含义 | Persona primary | KOL primary | 合计 |
|------|------|----------------|-------------|------|
| M1 | 动机 | 5 | 0 | 5 |
| M2 | 期待 | 1 | 0 | 1 |
| M3 | 认知 | 19 | 19 | 38 |
| M4 | 感受 | 2 | 0 | 2 |
| M5 | 行为 | 49 | 27 | 76 |
| 多标签 | — | 46 | 22 | 68 |

**关键发现**：M1（动机）和 M4（感受）严重覆盖不足，M5（行为）过度集中。148/190 题为开放式，140/190 题依赖 LLM Judge（量化方式 D）。

## 测试题结构

### 群体画像（5 类）

| 类别 | 题数 | 说明 |
|------|------|------|
| 一致性测试 | 31 | 验证 AI 回答是否内化群体特征，画像间是否有区分度 |
| 游戏立项 | 20 | 模拟新游戏立项方向的假设性提案 |
| 玩法设计 | 30 | 具体玩法/机制设计方案偏好判断 |
| 运营与商业化 | 20 | 商业化策略、付费意愿和态度 |
| 市场营销 | 21 | 营销策略、推广内容和转化路径 |

### KOL（4 类）

| 类别 | 题数 | 说明 |
|------|------|------|
| 一致性测试 | 21 | 验证 AI 是否还原 KOL 的个人特征和评价体系 |
| 立项判断 | 15 | 模拟开发者向 KOL 展示新项目方向 |
| 推广合作 | 17 | 模拟推广合作方案、内容策略 |
| 设计反馈 | 15 | 具体玩法/设计方案的专业反馈 |

## 评测执行

```bash
# 群体画像评测
python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v1.json

# KOL 评测
python3 scripts/eval_run_v3.py data/eval/test_cases_kol_v1.json

# 限制题数测试
python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v1.json --limit 5

# 跳过 Judge 评分（仅收集回答）
python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v1.json --no-judge
```

## 评测流程

1. **Phase 1 收集回答**：每题向所有画像/KOL 分别发送，收集全部回答
2. **Phase 2 LLM Judge 评分**：7 维评分 + 自动化指标
3. **Phase 3 跨题分析**：画像一致性、区分度、评分分布
4. **Phase 4 回归对比**：与基线对比（可选）

## 评测维度（当前 v3 实现）

当前 `eval_run_v3.py` 实现的是 7 维 LLM Judge + 自动化指标，主要覆盖 C 层（模拟忠实度）的部分评价能力：

| 维度 | 权重 | 说明 |
|------|------|------|
| 人设一致性 | 20% | 语气/立场是否与目标画像一致 |
| 专业准确性 | 15% | 评价逻辑是否成立、有洞察 |
| 知识边界 | 10% | 超出经验时是否诚实说不知道 |
| 具体性 | 10% | 是否有具体例子而非泛泛而谈 |
| 情感真实性 | 10% | 情感表达是否自然 |
| 区分度 | 5% | 该回答能否与其它画像区分开 |
| 深度 | 10% | 表面理解 vs 深层洞察 |
| 自动化指标 | 30% | 长度合理性、幻觉检测、模板化检测、关键词覆盖 |

> 完整四层评价体系（A 聚类真实性 / B 画像真实性 / C 模拟忠实度 / D 评价可靠性）见 [评测体系设计方案_V1.0.md](./评测体系设计方案_V1.0.md)。

## 实施优先级

| 优先级 | 依赖条件 | 可执行内容 |
|--------|----------|-----------|
| P0 ✅ | 无需外部依赖 | C 层 Metadata、M 矩阵、Claim 提取 Prompt、反证搜索 Prompt、Claim Schema |
| P0 ✅ | 无需外部依赖 | A 层配置文件、D 层实验配置、人工评分培训指南 |
| P1 | Persona 画像已生成 | B 层 Claim-Evidence Matrix 实际数据填充 |
| P2 | 聚类 Pipeline 已跑通 | A 层实际数据（player_feature_matrix.json） |
| P3 | C 层评测已跑通第一轮 | D 层实验执行（重测、校准、鲁棒性测试） |
| P4 | P3 完成 | D 层多 Judge 交叉验证、最终 Dashboard 生成 |

## 注意

- 测试题文件和评测结果含业务敏感信息，**不上传 GitHub**
- 评测结果输出到 `data/eval/results/`（已被 .gitignore 屏蔽）