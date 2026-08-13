# Embedding 规范（向量化标准 v1.0）

> 适用范围：`source_segments` 表片段的向量化，与《数据标注标准文档》v2.0 对齐。
> 上游输入：`data/annotated/segments_*.json`（每条的 `label` 字段，扁平格式见标注文档 §9.3）。
> 下游使用：RAG 检索、画像聚类、证据溯源、对话上下文注入（见标注文档附录 D）。
> 存储：`source_segments.embedding vector(1024)` + pgvector HNSW 索引。

---

## 1. 目标与设计原则

1. **一个片段 → 一个确定性「待嵌入文本」→ 一个 1024 维向量**。
2. **向量 = 结构化标注描述 + 原声证据 + 语境**，由模板函数确定性生成：同一输入必得同一文本、同一向量。
3. **与标注对齐**：标注里所有英文 key 经本文档第 4 章固定映射表转为中文描述后进入向量空间；中文是标注规范与检索查询的规范词汇。
4. **宁缺毋滥**：与标注规则一致，不确定 / 为空 / 低置信度的标签不进入待嵌入文本。
5. **L2 归一化 + 余弦相似度**（pgvector `<=>` 算子）。

---

## 2. 嵌入模型与维度

| 项 | 取值 |
|---|---|
| 向量维度 | **1024**（与 `source_segments.embedding vector(1024)` 及现有 KOL 一致） |
| 归一化 | L2 normalize（`normalize_embeddings=True`） |
| 主选模型 | `BAAI/bge-m3`（1024 维，中英多语，覆盖海外英文访谈） |
| 备选模型 | `BAAI/bge-large-zh-v1.5`（1024 维，中文优先，与现有 KOL 向量空间一致） |
| 模型加载 | ModelScope 本地缓存（HuggingFace 不通，参考 `scripts/embed_kol.py`） |
| 距离算子 | `<=>`（cosine，归一化后等价于 1−内积） |

**模型选型说明**（决策依据，最终选型仍需对比评测验证，对应《技术选型记录》「Embedding 待验证」）：

- 语料包含「美国HD端」「漫威争锋中美」访谈，存在大量英文原文 → **主选 bge-m3（多语）**，避免 bge-large-zh-v1.5 对英文检索退化。
- 若只关注中文、且需与 KOL 语料（已用 bge-large-zh-v1.5）**跨表混检**，则统一用 bge-large-zh-v1.5，并把 KOL 与 source_segments 视为同一向量空间。
- **硬约束**：同一检索目标（表）必须用同一模型；查询侧模型必须与写入侧完全一致。改模型 = 全量重嵌入 + 重建 HNSW 索引。

> 建议：source_segments 采用 bge-m3（多语为主）；KOL 表维持 bge-large-zh-v1.5 不动，二者分表检索、不混算。若后续需要 KOL+用户片段统一检索，再做 KOL 重嵌迁移。

---

## 3. 待嵌入文本构造规范（核心）

### 3.1 模板函数

```
build_embed_text(segment, label) -> str
```

输入一条片段及其 `label`，输出换行分隔的纯文本，由若干「节」组成；每节是否出现取决于对应标签是否存在且达标（见 3.3）。

### 3.2 分档规则（谁被嵌入 / 嵌入什么）

| 档 | 判定条件 | 嵌入内容 |
|---|---|---|
| A 完整嵌入 | `meta.rs == "auto_pass"` 且存在任一有效标签 | 标签描述节 + 原声节 + 语境节 |
| B 仅原声 | `meta.rs == "review"`，或无任何标签但 `len(cleaned_text)>=10` | 仅原声节 |
| C 不嵌入 | `meta.rs == "skip"`，或 `len(原文)<10` | `embedding = NULL` |

> 说明：skip 片段（填充词「嗯/对/好的」等）无检索价值，不嵌入；review 片段标签置信不足，只嵌原声、不嵌标签，避免把低置信标签污染进向量空间。

### 3.3 标签纳入阈值

- 单个标签进入「标签描述节」的必要条件：该标签自身 `c >= 0.6` 且 `e != "E0"`（缺省 `c` 按 0.8 处理，与标注 review 阈值一致）。
- `framework` 各维度、`product_tags` 同理：值存在且非 null / 空 / `unknown` 才进入。
- `M1` 中 `primary=true` 的排最前，其余按数组顺序。

### 3.4 各节模板（与标注字段一一对应）

| 节 | 模板 | 数据来源 |
|---|---|---|
| 诉求 | `诉求：{M1 中文，逗号连接，primary 优先}` | `iceberg.M1[].v` |
| 期待 | `期待：{M2 中文，逗号连接}` | `iceberg.M2[].v` |
| 认知 | `认知：{分类中文(具体 value)，分号连接}` | `iceberg.M3[].cat` + `.v` |
| 感受 | `感受：{感受中文（效价/强度/诱因），分号连接}` | `iceberg.M4[].v/.val/.int/.trg` |
| 行为 | `行为：{行为中文（频率），分号连接}` | `iceberg.M5[].v/.freq` |
| 因果 | `因果：{from中文→to中文，分号连接}` | `iceberg.causal_chain[]` |
| 能力 | `能力：等级{等级中文}；强项{str 中文}；短板{wk 中文}；认知强{cog_str}；认知弱{cog_wk}` | `framework.ability` |
| 风格 | `风格：战斗{combat}，决策{decision}，求胜{victory}，成长{growth}，社交{social}` | `framework.style` |
| 平台 | `平台：{p 中文（，s 中文）}` | `framework.platform` |
| 模式 | `模式：{struct 中文}；{子模式中文（态度），逗号连接}` | `framework.mode` |
| 资产 | `资产：时间{..} 能力{..} 精力{..} 情绪{..} 金钱{..}` | `framework.assets` |
| 甜区 | `甜区：{stage 中文}；心流{flow 中文}；峰值{peak}` | `framework.sweet_spot` |
| 产品标签 | `产品标签：{非空字段，逗号连接}` | `product_tags` |
| 原声 | `原声：{cleaned_text 或 original_text}` | 片段文本 |
| 语境 | `语境：上文提问：{preceding_question}`（仅存在且角色为被访者时） | 片段文本 |

规则：

- 各节用「字段名：值」格式，节间换行；无内容的节整行省略（不输出空节）。
- `认知` 节的 `value` 是自由英文短语（如 `aim_decides`），**原样保留**；若原文证据里有对应中文表述，用原文表述。
- `原声` 节直接用 `cleaned_text`（为空则 `original_text`）；`evidence[].q` 通常是原文子串/整句，**不重复嵌入**。
- `语境` 节仅在 `preceding_question` 非空且该片段 `speaker_role == "interviewee"` 时输出。

### 3.5 构造示例

输入（扁平格式 label 片段）：

```json
{
  "iceberg": {
    "M1": [{"v": "competitive_proof", "primary": true}, {"v": "ability_growth"}],
    "M4": [{"v": "achievement", "val": "pos", "int": "high", "trg": "win_loss"}],
    "M5": [{"v": "ranked_grind", "freq": "daily"}],
    "causal_chain": [["M1:competitive_proof", "M5:ranked_grind"]]
  },
  "framework": {
    "needs": {"p": "competitive_proof", "s": ["ability_growth"]},
    "ability": {"lvl": "advanced", "str": ["aim-tracking"], "wk": ["tactics-utility"]},
    "style": {"combat": "aggressive", "decision": "instinctive", "victory": "individual"},
    "platform": {"p": "pc"},
    "mode": {"struct": "pvp_main", "sub": [{"n": "bomb_defusal", "a": "liked"}]}
  }
}
```

对应「待嵌入文本」：

```
诉求：竞技证明、能力成长
感受：成就感（积极/高/胜负）
行为：排位上分（每日）
因果：竞技证明→排位上分
能力：等级高手；强项拉枪；短板投掷物技能
风格：战斗刚枪，决策本能，求胜个人
平台：PC
模式：PVP为主；爆破拆弹（喜欢）
原声：我每天下班先打半小时练枪房，热手了再排位
语境：上文提问：你平时怎么练枪？
```

---

## 4. 英文 key → 中文映射表（与标注值域对齐）

> 标注规范 §附录 G 只给了 M1 速查表；本章补齐 M1–M5 与框架七维的完整映射，作为「待嵌入文本」的唯一中文词表。**后续若标注值域增删，此处必须同步更新。**

### 4.1 M1 动机/诉求

| key | 中文 |
|---|---|
| competitive_proof | 竞技证明 |
| ability_growth | 能力成长 |
| dominance | 支配优越 |
| team_cooperation | 团队协作 |
| social_belonging | 社交归属 |
| stimulation | 射击爽感 |
| relaxation_escape | 放松逃避 |
| strategy_mastery | 策略掌控 |
| exploration_collection | 探索收集 |
| narrative_immersion | 叙事沉浸 |
| sensory_aesthetics | 视听审美 |
| expression_creation | 表达创造 |

### 4.2 M2 期待/标准

| key | 中文 |
|---|---|
| fair_competition | 公平竞技 |
| skill_determines | 技术决定 |
| rich_content | 丰富内容 |
| social_convenience | 社交便利 |
| low_barrier | 低门槛 |
| immersive_experience | 沉浸体验 |
| positive_community | 正向社区 |
| continuous_challenge | 持续挑战 |
| respect_time | 尊重时间 |
| monetization_fair | 付费公平 |
| teammate_communication | 队友沟通 |
| teammate_competence | 队友能力匹配 |
| teammate_stability | 队友情绪稳定 |

### 4.3 M3 认知/观点（category）

| cat key | 中文 |
|---|---|
| fairness_perception | 公平性 |
| difficulty_perception | 难度 |
| depth_perception | 深度 |
| quality_perception | 品质 |
| monetization_perception | 商业化 |
| meta_perception | 版本环境 |
| self_ability | 自我能力 |
| self_identity | 自我身份 |
| self_limitation | 自我限制 |
| teammate_perception | 对队友 |
| opponent_perception | 对对手 |
| developer_perception | 对厂商 |
| community_perception | 对社区 |
| causal_attribution | 因果归因 |

> M3 的 `value` 为自由短语（`aim_decides` 等），不属封闭值域，**原样保留**。

### 4.4 M4 感受/情绪（含 val / int / trg）

| v key | 中文 |
|---|---|
| excitement | 兴奋 |
| achievement | 成就感 |
| flow | 心流 |
| joy | 快乐 |
| social_warmth | 社交温暖 |
| anger_frustration | 愤怒挫败 |
| anxiety_tension | 焦虑紧张 |
| boredom_burnout | 无聊倦怠 |
| disappointment | 失望失落 |
| numbness | 麻木无所谓 |

| 子字段 | key → 中文 |
|---|---|
| val | pos=积极 / neg=消极 / neu=中性 |
| int | low=低 / medium=中 / high=高 |
| trg | win_loss=胜负 / growth=成长 / team=队友 / matchmaking=匹配 / monetization=付费 / cheat=外挂 / performance=表现 / content=内容 / social=社交 |

### 4.5 M5 行为/应对（含 freq）

| v key | 中文 |
|---|---|
| ranked_grind | 排位上分 |
| deliberate_practice | 刻意练习 |
| watch_guides | 看攻略学习 |
| social_play | 社交开黑 |
| casual_play | 休闲匹配 |
| switch_mode | 切换模式产品 |
| return | 回流 |
| avoid_strangers | 回避陌生人 |
| content_share | 内容分享 |
| spending | 消费氪金 |
| quit_break | 退坑休息 |
| smurf | 换号炸鱼 |
| watch_esports | 追比赛电竞 |
| community_engage | 社区参与 |

| freq key | 中文 |
|---|---|
| daily | 每日 |
| regular | 经常 |
| occasional | 偶尔 |
| past | 过去 |
| planned | 计划中 |

### 4.6 框架·能力（ability）

| 层级 key | 中文 |
|---|---|
| novice | 新手 |
| beginner | 入门 |
| intermediate | 进阶 |
| advanced | 高手 |
| expert | 专家 |
| unknown | 未知 |

技巧子项（str / wk）：

| key | 中文 | key | 中文 |
|---|---|---|---|
| aim-flick | 拉枪 | aim-micro | 微调 |
| aim-recoil | 压枪 | aim-tracking | 跟枪 |
| aim-prefire | 预瞄 | move-basic | 基础身法 |
| move-peek | 闪身 | move-stop | 急停 |
| move-react | 快速反应 | info-sound | 听声辨位 |
| info-spot | 复杂场景识敌 | info-state | 状态资源收集 |
| tactics-predict | 敌情预测 | tactics-utility | 投掷物技能 |
| tactics-route | 路线规划 | tactics-retreat | 战撤决策 |
| tactics-position | 有利位置 | tactics-map | 地图记忆 |
| know-rules | 规则目标 | know-mechanic | 核心机制 |
| know-meta | 角色武器版本理解 | | |

认知子项（cog_str / cog_wk）：

| key | 中文 | key | 中文 |
|---|---|---|---|
| reasoning | 推理 | procedural_motor | 程序化动作 |
| game_knowledge | 游戏知识 | visual_spatial | 视觉空间 |
| auditory_processing | 听觉处理 | motor_control | 运动控制 |
| processing_speed | 加工速度 | reaction_speed | 反应速度 |
| psychomotor_speed | 心理运动速度 | short_term_memory | 短时记忆 |
| long_term_memory | 长时记忆 | | |

### 4.7 框架·风格（style）

| 维度 | key → 中文 |
|---|---|
| combat | passive=苟活 / balanced=灵活 / aggressive=刚枪 |
| decision | strategic=策略 / contextual=情境 / instinctive=本能 |
| victory | team=团队 / balanced=平衡 / individual=个人 |
| growth | progression=数值 / mixed=混合 / skill=操作 |
| social | friends=熟人 / flexible=均可 / solo=单人 |

### 4.8 框架·平台（platform）

| key | 中文 |
|---|---|
| pc | PC |
| console | 主机 |
| mobile | 移动 |
| multi_platform | 多平台 |
| cloud_other | 云及其他 |
| unknown | 未知 |

### 4.9 框架·模式（mode）

| struct key | 中文 |
|---|---|
| pure_pve | 纯PVE |
| pve_main | PVE为主 |
| balanced | 平衡 |
| pvp_main | PVP为主 |
| pure_pvp | 纯PVP |
| contextual | 视情境 |

| sub `n` key | 中文 |
|---|---|
| team_deathmatch | 团队死斗 |
| bomb_defusal | 爆破拆弹 |
| battle_royale | 大逃杀 |
| extraction | 撤离 |
| large_scale | 大战场 |
| coop_pve | 合作PVE |
| story_pve | 剧情PVE |
| boss_loot | BOSS掉落 |
| party_mode | 派对模式 |
| open_world | 开放世界 |

| sub `a` key | 中文 |
|---|---|
| liked | 喜欢 |
| accepted | 接受 |
| neutral | 中立 |
| disliked | 不喜欢 |
| rejected | 拒绝 |
| not_experienced | 未体验 |

### 4.10 框架·甜区（sweet_spot）

| 字段 | key → 中文 |
|---|---|
| stage | novice_understanding=新手理解期 / rapid_improvement=快速成长期 / stable_mastery=稳定精通期 / plateau=平台期 / churn=流失期 / unknown=未知 |
| duration | short=短 / medium=中 / long=长 / unknown=未知 |
| quality | low=低 / medium=中 / high=高 / unknown=未知 |
| flow | clear_goals=清晰目标 / immediate_feedback=即时反馈 / skill_challenge_balance=技能挑战平衡 / sense_of_control=掌控感 / focus=专注 / action_awareness_merge=行动意识融合 / selflessness=忘我 / time_distortion=时间失真 / autotelic=自驱动 |

### 4.11 资产（assets）与产品标签（product_tags）

`assets`（time / ability_asset / energy / emotion / money）与 `product_tags` 的值域**本身已是中文**（如「充足/有约束/严重稀缺/未知」「新一线/中付费/固定队」），无需映射，直接拼接。

---

## 5. 存储与索引

### 5.1 存储

- 列：`source_segments.embedding vector(1024)`。
- 写入值：L2 归一化后的 `number[]`（长度恒为 1024）。
- 建议新增版本追踪列（用于判断哪些片段需重嵌）：

```sql
ALTER TABLE source_segments
  ADD COLUMN embedding_version text,          -- 如 "bge-m3@v1"（模型+模板版本）
  ADD COLUMN embedded_at timestamptz;
```

### 5.2 索引

```sql
-- 归一化后余弦距离用 <=>；HNSW 参数沿用现有规划
CREATE INDEX ss_embedding_hnsw_idx ON source_segments
  USING hnsw (embedding vector_cosine_ops);
-- 建索引时设 m=16, ef_construction=64；查询时 SET hnsw.ef_search = 64;
```

- 维度在索引创建时固定；改模型/维度 = `DROP INDEX` → 全量重嵌 → 重建索引。
- 数据量（~6110 条）远小于 HNSW 性能上限，索引开销可忽略。

---

## 6. 生成与刷新流程

| 触发 | 动作 | 范围 |
|---|---|---|
| 首次灌入 | 全量生成 embedding | 全部 A/B 档片段 |
| 新增片段 / 新增标注 | 增量生成 | 仅 `embedding IS NULL` 的行 |
| 标注重跑（label 变更） | 按 `embedding_version`/`embedded_at` 判定重嵌 | 受影响片段 |
| 模板/映射表变更 | 升 `embedding_version`，全量重嵌 | 全部 |
| 模型变更 | 全量重嵌 + 重建索引 | 全部 |

配套脚本 `scripts/embed_segments.py` 设计要点（对齐现有 `embed_kol.py` + `embed_server.py`）：

1. 加载本地 ModelScope 模型（bge-m3 或 bge-large-zh-v1.5）。
2. 从 `data/annotated/segments_*.json` 读取片段 + `label`，用 §3 模板构造待嵌入文本。
3. 按 §3.2 分档：C 档跳过（写 `embedding = NULL`），B 档只嵌原声，A 档嵌完整文本。
4. 批量 `encode(..., normalize_embeddings=True)`（BATCH_SIZE=32），写回 PG 的 `embedding` 列，并记录 `embedding_version`/`embedded_at`。
5. 支持 `--limit` / `--resume`（断点续跑，参照 `label_segments.py`）。

---

## 7. 查询侧规范

1. **同模型 / 同归一化 / 同 `<=>` 距离**：查询文本与写入文本用完全相同的 embedding 服务。
2. 自然语言问题：直接 `embed(question)` 做向量检索。
3. 「标签定向检索」（如「找竞技证明动机的玩家」）**优先走结构化过滤**（`annotation` JSONB 或 `framework.needs.p` 精确匹配），不依赖向量；如需用向量，把查询改写为标签描述风格（如「诉求：竞技证明」）以对齐向量空间。
4. 混合检索推荐流程：**向量 Top-N 初筛 → 结构化过滤（speaker_id / persona_ids / annotation 字段）→ 按 `meta.c` 与证据等级精排**。
5. 检索建议：Top-5（沿用现有规划）；跨语言召回（中文问 → 英文片段）依赖多语模型，评测见 §8。

---

## 8. 质量评测

| 指标 | 方法 | 目标 |
|---|---|---|
| 同标签内聚 | 同一 `M1.v` / `framework.needs.p` 的片段向量平均相似度 | 高于全局均值 |
| 异标签分离 | 不同 `M1.v` 片段簇间相似度 | 低于簇内 |
| 同义召回 | 语义等价问题（改写/口语化）的 recall@k | 高 |
| 跨语言召回 | 中文 query → 英文原文片段 | 由多语模型保证，需评测 |
| 证据一致性 | 相同 `evidence.q` 子串在不同片段间的向量相似度 | 高 |

评测集来源：`docs/golden_examples.jsonl`、`label.evidence[].q`、以及标注阶段 `meta.rs=="review"` 的复核样本。

---

## 9. 与 KOL embedding 的关系

- KOL 语料已用 `bge-large-zh-v1.5` 嵌入（`kol_segments.embedding`），**与 source_segments 若采用 bge-m3，两表向量空间不同，不可跨表混算相似度**。
- 两表用途不同（KOL 风格语料 vs 用户画像证据），分表检索即可；若需统一检索，须把 KOL 重嵌到与 source_segments 相同的模型与模板。

---

## 10. 版本与维护

- 本文档随标注体系迭代更新；**标注值域增删、映射表变更、模型切换、模板调整均需升版本并全量重嵌**。
- 版本历史：
  - v1.0 (2026-08-13)：初版，对齐《数据标注标准文档》v2.0；确定 bge-m3 主选 / bge-large-zh-v1.5 备选；给出待嵌入文本模板与完整 key→中文映射表。
