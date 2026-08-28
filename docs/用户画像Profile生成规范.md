# 用户画像（Respondent Profile）生成规范 v1.0

> **版本**：v1.0 | **日期**：2026-08-27 | **状态**：执行版
>
> **用途**：定义从已标注 Segment 聚合生成 Respondent-level Profile 的完整流程。Profile 是 Segment Annotation 的上一层抽象，负责"总结这个人"，不重复 Segment 层的语义分析工作。
>
> **上游依赖**：《数据标注规范》v3.1（提供 Segment Annotation）
>
> **下游消费者**：Embedding 检索、群体画像聚类、AI 虚拟用户对话、评测体系

---

## 目录

1. [设计目标与核心原则](#1-设计目标与核心原则)
2. [Profile 总体结构](#2-profile-总体结构)
3. [Metadata](#3-metadata)
4. [Profile 六大一级维度](#4-profile-六大一级维度)
5. [Trait 结构与字段规范](#5-trait-结构与字段规范)
6. [Trait 生成流程](#6-trait-生成流程)
7. [Trait 聚合规则](#7-trait-聚合规则)
8. [冲突处理规则](#8-冲突处理规则)
9. [Pattern 生成规则](#9-pattern-生成规则)
10. [Evidence / Provenance 溯源规则](#10-evidence--provenance-溯源规则)
11. [Profile Summary 生成规则](#11-profile-summary-生成规则)
12. [推断规则与安全边界](#12-推断规则与安全边界)
13. [输出格式与 JSON Schema](#13-输出格式与-json-schema)
14. [质量管控标准](#14-质量管控标准)
15. [与上下游的接口约定](#15-与上下游的接口约定)
16. [附录](#16-附录)

---

## 1. 设计目标与核心原则

### 1.1 核心定位

> **Segment 负责"理解每句话"；Profile 负责"总结这个人"；Pattern 负责"连接这个人的特征"；Evidence 负责"证明为什么这么总结"。**

```
                    原始访谈
                       │
                       ↓
                   Segment
                       │
              ┌────────┴────────┐
              ↓                 ↓
           Evidence          M1–M5 标注
              │                 │
              └────────┬────────┘
                       ↓
                Respondent Profile（本文档）
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
    Dimensions       Patterns       Evidence
        │
        ├── Context
        ├── Experience & Capability
        ├── Behaviors
        ├── Preferences
        ├── Motivations & Needs
        └── Perceptions & Beliefs
                       │
                       ↓
              Embedding / 聚类 / 模拟
```

### 1.2 核心原则

| 原则 | 说明 |
|:--|:--|
| **Profile 不反向污染 Segment** | Profile 是 Segment 的聚合结果，不能因为 Profile 已知某特征而修改 Segment 标注。 |
| **固定一级 Dimension，动态二级 Trait** | 六个一级维度固定；Trait 的类型和值由数据驱动，不预设穷举。 |
| **每个 Trait 必须有证据来源** | 无证据的 Trait 不得生成。允许空 Profile。 |
| **不要求 M1–M5 全覆盖** | M1–M5 是 Segment 层的语义分析，不是 Profile 的字段结构。Profile Trait 可以来自任意 M 层证据。 |
| **推断层次越深，证据要求越高** | 直接事实（L1）→ 语义归纳（L2）→ 关系推断（L3），每层有独立的证据门槛。 |
| **Profile 允许为空** | 某 Dimension 无证据时，输出空数组，禁止为"完整画像"编造内容。 |
| **可追溯** | 每个 Trait 必须能追溯到 Segment → Evidence → Original Text。 |
| **可复核** | 不同标注者依据同一规则可得到相近的 Profile 结果。 |

### 1.3 生成单位

> **Profile 的生成单位是 Respondent（受访者），不是 Segment。**

同一 Respondent 的所有 Segment 的 Evidence Pool 合并后，再聚合生成 Profile。单条 Segment 的空白不否定 Respondent 层面的倾向。

---

## 2. Profile 总体结构

```text
Respondent
│
├── Metadata
│
├── Profile
│   ├── Context
│   ├── Experience & Capability
│   ├── Behaviors
│   ├── Preferences
│   ├── Motivations & Needs
│   └── Perceptions & Beliefs
│
├── Patterns
│
├── Contradictions
│
└── Summary
```

### 2.1 一级字段说明

| 一级字段 | 职责 | 是否允许为空 |
|:--|:--|:--:|
| `metadata` | 受访者的基础事实和来源信息，不属于心理/行为画像。 | 否 |
| `profile` | 六个一级维度的 Trait 集合，是 Profile 的核心。 | 否（但每个 Dimension 可为空） |
| `patterns` | 多个 Trait 之间的关系模式，表达 A→B 的因果或条件关系。 | 是 |
| `contradictions` | 同一维度内存在相互冲突的证据，无法裁决时记录。 | 是 |
| `summary` | 从 Evidence → Traits → Patterns 派生的人话总结，不可作为新事实源。 | 是 |

---

## 3. Metadata

### 3.1 定义

Metadata 不属于用户心理/行为画像，而是 Respondent 的基础事实和来源信息。它从参与者档案中提取，不参与 Profile 推断。

### 3.2 字段

```json
{
  "respondent_id": "P004",
  "display_name": "G1-CXY",
  "source_files": ["Deadlock竞品研究/座谈会笔录-G1.docx"],
  "segment_count": 8,
  "demographics": {
    "age": 24,
    "gender": "男",
    "occupation": "短视频运营",
    "education": "本科"
  },
  "gaming_background": {
    "active_games": ["Apex英雄", "守望先锋", "无畏契约"],
    "platform": ["PC"],
    "experience_years": 10,
    "total_hours_estimate": "5000+"
  }
}
```

### 3.3 规则

- **只记录原始资料明确提供的信息。**
- 不能从游戏偏好推断人口属性（如"玩了很多 FPS" → "年轻男性"）。
- 不能从语言风格推断人口属性（城市等级、收入、年龄）。
- `gaming_background` 中的游戏列表、时长、段位等是**事实记录**，不是 Profile Trait。它们作为后续 Experience Trait 的证据来源，但本身不是 Trait。

---

## 4. Profile 六大一级维度

### 4.1 维度概览

| 维度 | 英文 key | 回答的问题 | 示例 Trait |
|:--|:--|:--|:--|
| 1. Context | `context` | 这个人处于什么环境/条件下？ | 近期工作导致固定开黑伙伴减少 |
| 2. Experience & Capability | `experience_capability` | 这个人有什么相关经历和明确能力？ | Apex 1200 小时；具备较强地图意识 |
| 3. Behaviors | `behaviors` | 这个人实际做了什么？ | 偶尔在重大更新时回归游戏 |
| 4. Preferences | `preferences` | 这个人偏好什么、倾向什么？ | 偏好短 TTK；偏好 FPS |
| 5. Motivations & Needs | `motivations_needs` | 为什么？需要什么？ | 追求竞技证明；需要放松解压 |
| 6. Perceptions & Beliefs | `perceptions_beliefs` | 这个人如何理解、判断和解释游戏/体验？ | 认为第一人称看不到动作表现 |

### 4.2 维度选择规则

- **六维度固定，不增不减。** 新发现的语义类型归入已有维度的 Trait Type，不新增一级维度。
- **每个维度可包含 0–N 个 Trait。** 空维度输出 `[]`，不输出 `null`。
- **一个 Trait 只属于一个维度。** 如果一段证据同时支持多个维度的 Trait，分别生成，不合并。

---

### 4.3 维度一：Context

#### 定义

回答"这个人处于什么环境/条件下"。记录影响游戏行为的外部条件、生活状态、时间约束、社交环境等。

#### Trait Type（可选二级分类，非固定字段）

| Trait Type | 说明 | 示例 |
|:--|:--|:--|
| `social_context` | 社交环境 | 有固定开黑伙伴 |
| `time_context` | 时间条件 | 工作后游戏时间碎片化 |
| `life_context` | 生活状态 | 学生阶段，时间充裕 |
| `constraint` | 外部限制 | 设备性能限制 |
| `trigger` | 触发条件 | 重大更新触发回流 |
| `usage_context` | 使用环境 | 主要在 PC 端游玩 |

#### 核心规则

- **Context ≠ Constraint**：Context 包含约束条件，但也包含有利条件。
- **Context 不等于"客观属性"**：年龄、职业等放在 Metadata，Context 关注的是"条件如何影响游戏行为"。
- 例如："工作原因"是 Metadata 中的职业信息；"工作导致没有固定开黑朋友"是 Context Trait。

---

### 4.4 维度二：Experience & Capability

#### 定义

回答"这个人有什么相关经历和明确表现出的能力"。分为 Experience 和 Capability 两个 Trait Type，二者有严格的证据要求区分。

#### Trait Type

| Trait Type | 说明 | 证据要求 |
|:--|:--|:--|
| `experience` | 游戏经历、时长、品类广度 | 有明确时长、游戏列表、或游玩历史陈述 |
| `capability` | 明确表现出的技能、段位、能力 | 必须有段位、胜率、比赛表现、自我能力评价、具体技能描述等 |

#### 核心规则

> **Experience ≠ Capability**

- "Apex 1200 小时" → 可生成 `experience: Apex 长期游玩经验`
- 不可直接生成 `capability: Apex 高水平玩家`
- 除非存在：段位、胜率、具体技能描述、自我能力评价等明确能力证据

#### 禁止推断

- 玩得久 ≠ 高手
- PC 玩家 ≠ 能力高
- 男性 ≠ 枪法强
- 高付费 ≠ 能力强
- 喜欢 PVE ≠ 能力弱

---

### 4.5 维度三：Behaviors

#### 定义

回答"这个人实际做了什么"。记录当前行为、历史行为、重复行为模式。

#### Trait Type（可选）

| Trait Type | 说明 | 示例 |
|:--|:--|:--|
| `current_behavior` | 当前行为 | 每天玩排位 |
| `historical_behavior` | 历史行为 | 曾经长期玩 Apex |
| `recurring_behavior` | 重复模式 | 每次重大更新回归 |
| `play_behavior` | 游玩行为 | 主要玩 FPS |
| `choice_behavior` | 选择行为 | 有朋友时玩社交游戏，没有时玩单人游戏 |
| `cessation_behavior` | 停止/减少行为 | 因工作减少游戏时间 |
| `social_behavior` | 社交行为 | 和朋友玩英雄联盟大乱斗 |
| `consumption_behavior` | 消费行为 | 购买皮肤 |

#### 核心原则

> **Behavior 描述行为，不自动解释原因。**

- "Apex 玩了 1200 小时" → 可记录 `长期大量游玩 Apex`
- 不能仅凭此生成 `Preference: 最喜欢 Apex`
- 行为是偏好的线索，但不是偏好的直接证据

---

### 4.6 维度四：Preferences

#### 定义

回答"这个人偏好什么、倾向什么"。这是 Profile 中最重要的维度之一，直接服务于标签检索和群体画像。

#### Trait Type（可选）

| Trait Type | 说明 | 示例 |
|:--|:--|:--|
| `genre_preference` | 品类偏好 | 偏好 FPS |
| `gameplay_preference` | 玩法偏好 | 偏好短 TTK |
| `combat_preference` | 战斗偏好 | 偏好高机动性 |
| `camera_preference` | 视角偏好 | 偏好第三人称 |
| `social_preference` | 社交偏好 | 偏好熟人开黑 |
| `aesthetic_preference` | 审美偏好 | 偏好写实美术风格 |
| `platform_preference` | 平台偏好 | 偏好 PC 端 |
| `mode_preference` | 模式偏好 | 偏好 PVP 排位 |
| `content_preference` | 内容偏好 | 偏好技术教学类视频 |

#### 核心规则

- **偏好必须有明确态度证据**：喜欢、偏好、更倾向、主要玩等。
- **不能仅凭行为推断偏好**：玩了很久 ≠ 最喜欢。
- **不能仅凭单次陈述过度归纳**："可能偏射击" → confidence 应较低。

#### 特别说明

当用户表达了多个偏好，且它们之间可能存在冲突时（如"偏好短 TTK"和"也喜欢长 TTK 的游戏"），应归入 Contradictions 或标记为 `context_dependent`，不强行裁决。

---

### 4.7 维度五：Motivations & Needs

#### 定义

回答两个相关但不同的问题："为什么玩？"和"需要什么？"。本维度不强行拆分为 Goals、Motivations、Needs、Expectations，因为在实际访谈中这些概念容易互相污染。

#### Trait Type（可选）

| Trait Type | 说明 | 示例 |
|:--|:--|:--|
| `motivation` | 驱动行为的内在原因 | 追求竞技证明 |
| `need` | 需要满足的条件 | 需要公平的匹配机制 |
| `expectation` | 对游戏/队友/自己的期待 | 期待队友能沟通 |
| `goal` | 明确的目标 | 希望上到钻石段位 |
| `desired_outcome` | 期望的结果 | 通过游戏放松解压 |

#### 核心规则

- **Goal 可以存在，但不是一级维度**。只有证据明确支持 Goal 时才生成。
- "我喜欢 FPS" → 不能自动变成 "我的目标是获得 FPS 竞技体验"。
- "我希望游戏能够……" → 可以生成 Goal。
- M1 动机标签是 Motivations 维度的重要证据来源，但不能直接照搬。M1 标签是 Segment 级的语义分析，需要跨 Segment 聚合后才形成 Profile 级的 Motivation Trait。

---

### 4.8 维度六：Perceptions & Beliefs

#### 定义

回答"这个人如何理解、判断和解释游戏/产品/体验"。这是玩家对游戏世界的认知模型，包括归因、评价、自我认知等。

#### Trait Type（可选）

| Trait Type | 说明 | 示例 |
|:--|:--|:--|
| `quality_perception` | 对游戏品质的感知 | 认为某游戏枪感好 |
| `self_identity` | 自我身份认同 | 认为自己是竞技型玩家 |
| `belief` | 关于游戏的信念 | 认为技术决定胜负 |
| `mental_model` | 心智模型 | 对游戏机制的理解方式 |
| `causal_attribution` | 因果归因 | 认为没有朋友导致玩得少 |
| `evaluation` | 评价判断 | 认为某游戏不如另一款 |
| `interpretation` | 对体验的解读 | 认为第一人称视角限制动作表现 |

#### 与 M3 的关系

M3 认知/观点标签是 Perceptions & Beliefs 维度的主要证据来源。但与 Motivation 一样，不能直接照搬 M3 标签值，需要跨 Segment 聚合。

---

## 5. Trait 结构与字段规范

### 5.1 完整 Trait Schema

```json
{
  "trait_id": "T001",
  "dimension": "preferences",
  "trait_type": "gameplay_preference",
  "statement": "偏好短 TTK",
  "status": "supported",
  "temporal_scope": "stable",
  "confidence": 0.92,
  "evidence": [
    {
      "segment_id": "P006_8",
      "quote": "严格意义上来说我更喜欢短TTK，比如彩虹六号那种。",
      "evidence_level": "E3",
      "inference_type": "direct"
    }
  ],
  "supporting_segments": ["P006_8", "P006_12"]
}
```

### 5.2 字段定义

| 字段 | 类型 | 必填 | 说明 |
|:--|:--|:--:|:--|
| `trait_id` | string | 是 | 唯一标识符，格式 `T` + 三位数字，如 `T001` |
| `dimension` | enum | 是 | 六大维度之一：`context`、`experience_capability`、`behaviors`、`preferences`、`motivations_needs`、`perceptions_beliefs` |
| `trait_type` | string | 否 | 可选的二级分类，如 `gameplay_preference`。为空时表示未细分。 |
| `statement` | string | 是 | 自然语言陈述，完整表达该 Trait 的含义。推荐 15–50 字。 |
| `status` | enum | 是 | `supported` / `inferred` / `conflicted` / `uncertain` |
| `temporal_scope` | enum | 是 | `temporary` / `current` / `recurring` / `stable` / `historical` / `unknown` |
| `confidence` | float | 是 | 0.0–1.0，Profile 级聚合后的置信度 |
| `evidence` | array | 是 | 至少一条 Evidence 对象 |
| `supporting_segments` | array | 是 | 支持该 Trait 的所有 Segment ID 列表 |
| `condition` | string | 否 | 当 Trait 在特定条件下才成立时，描述条件。如"有固定开黑伙伴时"。 |
| `negative_evidence` | array | 否 | 明确否定该 Trait 的证据（如用户说"我不喜欢大逃杀"）。仅在有明确否定时填写。 |

### 5.3 Trait Status 定义

| 状态 | 含义 | 进入条件 |
|:--|:--|:--|
| `supported` | 有直接证据支持 | 至少 1 条 E3 证据，或多条 E2 证据方向一致 |
| `inferred` | 通过跨 Segment 聚合或合理关系推导 | 至少 2 条 E2 证据，或 1 条 E2 + 明确因果链 |
| `conflicted` | 存在相互冲突的证据 | 同一维度内两条以上证据指向相反方向 |
| `uncertain` | 证据不足以确定 | 仅有 1 条 E2 证据，或仅有 E1 证据 |

### 5.4 Temporal Scope 定义

| 值 | 含义 | 判定 |
|:--|:--|:--|
| `temporary` | 短期/临时状态 | 原文有"最近""这几天"等时间限定词 |
| `current` | 当前状态 | 原文描述的是当前正在发生的情况 |
| `recurring` | 周期性重复 | 原文有"每次""经常""一……就"等重复模式 |
| `stable` | 长期稳定特征 | 原文无时间限定，或明确表述为长期特征 |
| `historical` | 历史状态（已结束） | 原文有"以前""曾经""过去"等过去时态 |
| `unknown` | 无法判断 | 原文无时间信息 |

> **重要**：不能把"最近刚好玩某个游戏"错误总结成"这个人长期偏好这个游戏"。`temporal_scope` 是防止此类错误的关键字段。

---

## 6. Trait 生成流程

### 6.1 总体流程

```text
Segment Annotation（M1-M5 + Framework + Product Tags）
              │
              ▼
    ① Evidence Pool 构建
      同一 Respondent 的所有 Segment 的 Evidence 合并
              │
              ▼
    ② 候选 Trait 提取
      从 Evidence Pool 中提取候选 Trait
              │
              ▼
    ③ 跨 Segment 聚合
      相同语义的候选 Trait 合并
              │
              ▼
    ④ 去重
      同一维度内语义重复的 Trait 合并
              │
              ▼
    ⑤ 冲突检测
      检查同一维度内是否存在矛盾 Trait
              │
              ▼
    ⑥ 时间判断
      为每个 Trait 确定 temporal_scope
              │
              ▼
    ⑦ 置信度计算
      基于证据数量、强度、一致性计算 Profile 级 confidence
              │
              ▼
    ⑧ 最终 Trait
      进入 Profile
              │
              ▼
    ⑨ Pattern 生成
      跨维度 Trait 之间的关系模式
              │
              ▼
    ⑩ Profile Summary
      派生的人话总结
```

### 6.2 步骤一：Evidence Pool 构建

#### 输入

同一 Respondent 的所有 Segment 的 `annotation.evidence` 和 `annotation.iceberg` / `annotation.framework` / `annotation.product_tags`。

#### 输出

按维度组织的 Evidence 集合。

#### 规则

1. 仅聚合 `status=confirmed` 或 `status=inferred` 的正式标签。
2. `review_candidates` 不进入 Evidence Pool。
3. 每个 Evidence 保留其原始 `segment_id`、`quote`、`evidence_level`、`inference_type`。
4. Framework 和 Product Tags 中的结构化标签也作为 Evidence 进入 Pool（如 `ability.level`、`style.combat`、`platform.primary`）。

### 6.3 步骤二：候选 Trait 提取

#### 规则

1. 从 Evidence Pool 中提取候选 Trait，每个候选 Trait 必须对应到一个一级维度。
2. 同一 Evidence 可以支持多个维度的候选 Trait（如一条发言同时支持 Preference 和 Behavior）。
3. 候选 Trait 的 `statement` 应该是语义归纳后的自然语言，不是 Segment 原文的简单拼接。
4. M1-M5 标签值不能直接作为 Trait statement。例如 M1=`competitive_proof` 应归纳为"追求竞技证明，通过段位和胜负验证自身能力"，而不是直接写 `competitive_proof`。

#### 提取优先级

按照证据直接性从高到低提取：

1. 直接表达（E3 证据）→ 优先提取
2. 强推断（E2 证据）→ 需要至少 2 条独立证据才提取
3. 弱推断（E1 证据）→ 不进入候选 Trait，可记录到 `review_candidates`（Profile 级别）

### 6.4 步骤三：跨 Segment 聚合

#### 核心原则

> **Profile 不是 Segment 的简单汇总，而是对同一 Respondent 的跨 Segment 证据进行归并、去重、冲突处理后的稳定特征集合。**

#### 聚合规则

1. **语义相同 → 合并**：多条 Segment 表达了相同语义（如同一偏好），合并为一个 Trait，`supporting_segments` 列出所有来源。
2. **语义相近但表述不同 → 合并**：如"偏射击"和"主玩 FPS"可合并为"偏好 FPS / 射击类游戏"。
3. **语义不同但互补 → 分列**：如"偏好短 TTK"和"偏好高机动性"是两个独立 Trait。
4. **语义不同且矛盾 → 冲突处理**：进入步骤五。

#### 聚合示例

```text
Segment P001_3: "可能偏射击。"
Segment P002_4: "对自己来说也算是射击类比较多。"
Segment P005_7: "我主玩FPS。"
```

❌ 错误：生成三个独立 Trait
✅ 正确：聚合为一个 Trait

```json
{
  "trait_id": "T001",
  "dimension": "preferences",
  "trait_type": "genre_preference",
  "statement": "偏好 FPS / 射击类游戏",
  "supporting_segments": ["P001_3", "P002_4", "P005_7"]
}
```

### 6.5 步骤四：去重

#### 规则

1. 同一维度内，两个 Trait 的 `statement` 语义重叠超过 80% 时，合并。
2. 合并时保留 confidence 更高的 evidence，合并 `supporting_segments`。
3. 不同维度的 Trait 不去重（如 Preference 和 Behavior 可以都记录"偏好 FPS"和"主要玩 FPS"）。

### 6.6 步骤五：冲突检测

见 [§8 冲突处理规则](#8-冲突处理规则)。

### 6.7 步骤六：时间判断

#### 规则

1. 检查每个 Trait 的 evidence 中是否包含时间信息。
2. 如果 evidence 中有明确的时间限定词（"最近""以前""每次"等），按 [§5.4](#54-temporal-scope-定义) 判定 `temporal_scope`。
3. 如果 evidence 中无时间信息，且该 Trait 属于 Preference / Motivation 等稳定维度，默认 `temporal_scope=stable`。
4. 如果 evidence 中无时间信息，且该 Trait 属于 Behavior / Context 等可变维度，默认 `temporal_scope=unknown`。

### 6.8 步骤七：置信度计算

#### 原则

> **Profile 级 confidence 不能直接照搬 Segment 级 confidence。** 需要综合考虑证据强度、证据数量、一致性和推断距离。

#### 计算公式（参考）

```text
Profile Confidence = f(
    avg_evidence_strength,   // 证据等级均值：E3=1.0, E2=0.7, E1=0.4
    evidence_count,           // 独立证据数量
    consistency,              // 证据一致性：1.0 - (冲突证据数/总证据数)
    inference_distance        // 推断距离：direct=1.0, semantic=0.9, causal=0.8, contextual=0.7
)
```

#### 参考映射

| 证据情况 | 建议 Confidence 范围 |
|:--|:--|
| 3+ 条 E3 证据，方向一致 | 0.90–0.98 |
| 1–2 条 E3 证据 | 0.80–0.90 |
| 多条 E2 证据，方向一致 | 0.75–0.85 |
| 1 条 E2 证据 | 0.60–0.75 |
| 仅有 E1 证据 | 不生成正式 Trait，入 review |

#### 约束

- confidence 必须 ≤ 该 evidence_level 组合的 ceiling（参考《数据标注规范》§2.7.1）。
- 多证据可提升 confidence，但不能超过 ceiling。
- 存在冲突证据时，confidence 应降低，且 `status` 应标记为 `conflicted`。

---

## 7. Trait 聚合规则

### 7.1 聚合触发条件

当以下条件同时满足时，触发聚合：

1. 两个候选 Trait 属于同一维度
2. 两个候选 Trait 的语义相似度 > 阈值
3. 两个候选 Trait 不矛盾

### 7.2 聚合方式

| 情况 | 处理方式 |
|:--|:--|
| 完全同义 | 合并为 1 个 Trait，合并 evidence 和 supporting_segments |
| 相近但表述不同 | 合并为 1 个 Trait，statement 取更概括或更准确的表述 |
| 一个包含另一个 | 保留更具体的 Trait，除非更概括的 Trait 有独立证据 |
| 互补（如"偏好 FPS"+"偏好短 TTK"） | 不合并，分列两个 Trait |

### 7.3 禁止聚合的情况

- 跨维度 Trait（如 Preference 的"偏好 FPS"和 Behavior 的"主要玩 FPS"不合并）
- 存在时间差异（如"以前喜欢 MOBA"和"现在喜欢 FPS"）
- 存在条件差异（如"有朋友时喜欢社交游戏"和"独自时喜欢单人游戏"）

---

## 8. 冲突处理规则

### 8.1 冲突类型

| 类型 | 示例 | 处理方式 |
|:--|:--|:--|
| **时间变化** | 以前喜欢 MOBA → 现在喜欢 FPS | 分别保留，标记不同 `temporal_scope` |
| **情境变化** | 有朋友时喜欢社交游戏，独自时喜欢单人游戏 | 分别保留，标记 `condition` 字段 |
| **真正矛盾** | 同一时间说"喜欢短 TTK"又说"喜欢长 TTK" | 均保留，status=`conflicted`，降低 confidence |
| **证据不足** | 只有一条模糊证据 | status=`uncertain` |

### 8.2 冲突记录格式

当存在冲突时，在 `contradictions` 字段中记录：

```json
{
  "contradictions": [
    {
      "contradiction_id": "C001",
      "dimension": "preferences",
      "trait_a": {
        "trait_id": "T005",
        "statement": "偏好短 TTK"
      },
      "trait_b": {
        "trait_id": "T008",
        "statement": "偏好长 TTK"
      },
      "resolution": "context_dependent",
      "resolution_note": "短 TTK 偏好来自 P006_8，长 TTK 偏好来自 P006_15。可能因游戏模式不同而有不同偏好，但证据不足以确定具体条件。",
      "evidence": ["P006_8", "P006_15"]
    }
  ]
}
```

### 8.3 冲突处理原则

- **一致 → 合并**：多条证据方向一致，合并为一个 Trait。
- **时间变化 → 保留时间**：分别保留，用 `temporal_scope` 区分。
- **情境变化 → 建立条件**：分别保留，用 `condition` 字段描述条件。
- **真正矛盾 → 不强行裁决**：均保留，标记 `conflicted`，不为了"画像完整"而选择其中一条。
- **证据不足 → 保留不确定性**：标记 `uncertain`，不强行确定。

---

## 9. Pattern 生成规则

### 9.1 定义

Pattern 表达**多个 Trait 之间的关系**，不是一级维度。它回答"这个人的特征之间如何关联"。

### 9.2 Pattern 结构

```json
{
  "pattern_id": "P001",
  "pattern": "社交可得性影响游戏选择",
  "description": "当缺乏固定开黑伙伴时，游戏选择从社交游戏转向个人偏好游戏",
  "trigger_trait": "T003",
  "trigger_label": "缺少固定开黑伙伴",
  "context_trait": "T010",
  "context_label": "工作原因",
  "outcome_trait": "T007",
  "outcome_label": "更多选择个人偏好的游戏",
  "relation_type": "causal",
  "evidence": ["P006_8"],
  "confidence": 0.85
}
```

### 9.3 Pattern 生成条件

> **必须存在明确的 A → B 关系，且由证据直接支持。**

允许的关系类型：

| 关系类型 | 含义 | 示例 |
|:--|:--|:--|
| `causal` | A 导致 B | 工作忙 → 缺少开黑朋友 → 选择个人游戏 |
| `conditional` | 当 A 满足时，B 成立 | 有朋友在线时 → 倾向社交游戏 |
| `correlational` | A 和 B 同时出现，但无明确因果 | 偏好 FPS 且偏好短 TTK |
| `contradictory` | A 和 B 相互冲突 | 同一条件下既喜欢短 TTK 又喜欢长 TTK |

### 9.4 禁止生成的 Pattern

- **不能因为两个 Trait 同时出现就自动生成 Pattern**：必须有原文中的因果或条件关系证据。
- **不能跨 Respondent 生成 Pattern**：Pattern 仅限单个 Respondent 内部。
- **不能生成超过 3 跳的因果链**：A → B → C 允许，A → B → C → D 需要特别强的证据。

### 9.5 Pattern 示例

```text
工作变忙
   ↓ (causal)
缺少固定开黑朋友
   ↓ (causal)
社交游戏减少
   ↓ (causal)
转向个人偏好的游戏
```

对应的 Pattern 记录：

```json
{
  "pattern_id": "P001",
  "pattern": "社交可得性影响游戏选择",
  "relation_type": "causal",
  "chain": ["T003", "T010", "T007"],
  "evidence": ["P006_8"]
}
```

---

## 10. Evidence / Provenance 溯源规则

### 10.1 溯源链

每个 Profile Trait 必须能通过以下链路追溯：

```text
Profile Trait
      ↓
Supporting Segment（segment_id）
      ↓
Evidence（quote + evidence_level）
      ↓
Original Text（原文）
```

### 10.2 Evidence 字段

```json
{
  "segment_id": "P004_6",
  "quote": "主要喜欢玩第三人称。",
  "evidence_level": "E3",
  "inference_type": "direct"
}
```

### 10.3 溯源规则

1. 每个 Trait 至少关联 1 条 Evidence。
2. 每条 Evidence 必须包含 `segment_id` 和 `quote`，能精确追溯到原始文本。
3. `evidence_level` 和 `inference_type` 继承自 Segment Annotation，不在 Profile 层重新判断。
4. `supporting_segments` 列出所有支持该 Trait 的 Segment ID，用于下游检索和展示。

---

## 11. Profile Summary 生成规则

### 11.1 定义

Summary 是从 Evidence → Traits → Patterns 派生的人话总结，用于快速理解一个 Respondent 的核心画像。

### 11.2 示例

> "P006 是一名偏杂食型玩家，偏好短 TTK，游戏选择会受到社交可得性的影响。在没有固定开黑伙伴时，更倾向于选择个人偏好的游戏。"

### 11.3 核心约束

> **Summary 必须是 Derived Summary，不能成为新的事实源。**

```text
正确：
Evidence → Traits → Patterns → Summary

错误：
Summary → 再生成 Traits → 再把总结当证据 → 循环污染
```

### 11.4 生成规则

1. Summary 仅基于已有的 Traits 和 Patterns 生成，不引入新信息。
2. Summary 中不出现无证据支撑的推断（如"因此他可能是竞技型玩家"）。
3. Summary 应提及最重要的 Trait（confidence 最高、evidence 最多），而非面面俱到。
4. Summary 可以包含不确定性表述（如"可能""倾向于"），但不能凭空推测。
5. 如果所有 Dimension 为空，Summary 可以为空或输出"暂无足够信息形成用户画像"。

---

## 12. 推断规则与安全边界

### 12.1 三层推断体系

| 层级 | 名称 | 定义 | 进入 Profile？ |
|:--|:--|:--|:--:|
| **L1** | 直接事实 | 原文明确表达。 | 是，`status=supported` |
| **L2** | 低风险语义归纳 | 多个直接证据归纳为更稳定的 Trait。 | 是，`status=supported` 或 `inferred` |
| **L3** | 关系/模式推断 | 存在多个证据或明确因果/条件关系时生成。 | 是，仅进入 Patterns，`status=inferred` |
| **禁止** | 深度推导 | 从 Trait 推导 Trait，形成推导链。 | **否** |

### 12.2 L1 直接事实

- 原文明确表达。
- 例如："我主玩 FPS。" → `Preference: 偏好 FPS`
- 要求：至少 1 条 E3 证据。

### 12.3 L2 低风险语义归纳

- 多个直接证据可以归纳成更稳定的 Trait。
- 例如：3 个 Segment 都提到 FPS 相关游戏 → `长期偏好 FPS`
- 要求：至少 2 条 E2 以上证据，方向一致。

### 12.4 L3 关系/模式推断

- 只有存在多个证据或明确因果/条件关系时才生成。
- 例如：多个 Segment 共同描述了"没有开黑朋友 → 游戏选择改变" → Pattern
- 要求：至少 2 条独立证据，且原文中有明确的因果/条件关系。

### 12.5 禁止的推断

| 禁止推断 | 错误示例 | 正确做法 |
|:--|:--|:--|
| Trait 链式推导 | 喜欢 FPS → 喜欢竞技 → 追求胜利 → 竞争动机 | 每一步都需要独立证据，不能链式推导 |
| 从行为推断偏好（无态度证据） | 玩了 1200 小时 Apex → 最喜欢 Apex | 仅记录 Behavior: 长期游玩 Apex |
| 从偏好推断动机（无动机证据） | 偏好 FPS → 追求竞技证明 | 动机需要独立证据 |
| 从偏好推断能力 | 偏好 FPS → FPS 高水平 | 能力需要段位/胜率等独立证据 |
| 从单次陈述过度归纳 | "可能偏射击" → 核心射击玩家 | confidence 应低，trait_type 应谨慎 |
| 为"完整画像"编造 | 所有维度为空 → 强行填满 | 允许空维度 |
| 人口属性推断 | 玩了很多 FPS → 年轻男性 | 禁止 |
| Summary 反向污染 | 用 Summary 中的归纳作为新 Trait 的证据 | Summary 是派生层，不作为事实源 |

> **越往深层，证据要求越高。** 这是 Profile 推断的核心约束。

---

## 13. 输出格式与 JSON Schema

### 13.1 完整 Profile JSON Schema

```json
{
  "profile_version": "1.0",
  "respondent_id": "P006",
  "generated_at": "2026-08-27T12:00:00Z",
  "source_segments_count": 8,
  "model": "deepseek-v4-pro",

  "metadata": {
    "respondent_id": "P006",
    "display_name": "G1-CXY",
    "source_files": ["Deadlock竞品研究/座谈会笔录-G1.docx"],
    "segment_count": 8,
    "demographics": {
      "age": 24,
      "gender": "男",
      "occupation": "短视频运营"
    },
    "gaming_background": {
      "active_games": ["Apex英雄", "守望先锋", "无畏契约"],
      "platform": ["PC"],
      "experience_years": 10
    }
  },

  "profile": {
    "context": [
      {
        "trait_id": "T001",
        "dimension": "context",
        "trait_type": "constraint",
        "statement": "近期工作导致固定开黑伙伴减少",
        "status": "supported",
        "temporal_scope": "current",
        "confidence": 0.90,
        "evidence": [
          {
            "segment_id": "P006_8",
            "quote": "最近因为工作的原因，没有一起开黑的朋友。",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_8"]
      }
    ],
    "experience_capability": [
      {
        "trait_id": "T002",
        "dimension": "experience_capability",
        "trait_type": "experience",
        "statement": "Apex 英雄长期游玩经验（1200+ 小时）",
        "status": "supported",
        "temporal_scope": "historical",
        "confidence": 0.95,
        "evidence": [
          {
            "segment_id": "P006_3",
            "quote": "Apex英雄-1200+小时",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_3"]
      }
    ],
    "behaviors": [
      {
        "trait_id": "T003",
        "dimension": "behaviors",
        "trait_type": "recurring_behavior",
        "statement": "偶尔在重大更新时回归游戏",
        "status": "supported",
        "temporal_scope": "recurring",
        "confidence": 0.95,
        "evidence": [
          {
            "segment_id": "P006_1",
            "quote": "偶尔有重大更新会上线。",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_1"]
      },
      {
        "trait_id": "T004",
        "dimension": "behaviors",
        "trait_type": "social_behavior",
        "statement": "和朋友玩英雄联盟大乱斗",
        "status": "supported",
        "temporal_scope": "current",
        "confidence": 0.90,
        "evidence": [
          {
            "segment_id": "P006_7",
            "quote": "跟朋友玩，都是玩大乱斗多。",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_7"]
      }
    ],
    "preferences": [
      {
        "trait_id": "T005",
        "dimension": "preferences",
        "trait_type": "gameplay_preference",
        "statement": "偏好短 TTK",
        "status": "supported",
        "temporal_scope": "stable",
        "confidence": 0.95,
        "evidence": [
          {
            "segment_id": "P006_8",
            "quote": "严格意义上来说我更喜欢短TTK，比如彩虹六号那种。",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_8"]
      },
      {
        "trait_id": "T006",
        "dimension": "preferences",
        "trait_type": "genre_preference",
        "statement": "偏好 FPS / 射击类游戏",
        "status": "supported",
        "temporal_scope": "stable",
        "confidence": 0.85,
        "evidence": [
          {
            "segment_id": "P006_4",
            "quote": "主要玩射击游戏。",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_4", "P006_5"]
      },
      {
        "trait_id": "T007",
        "dimension": "preferences",
        "trait_type": "social_preference",
        "statement": "偏好熟人开黑",
        "status": "supported",
        "temporal_scope": "stable",
        "confidence": 0.88,
        "evidence": [
          {
            "segment_id": "P006_7",
            "quote": "主要还是跟朋友玩。",
            "evidence_level": "E3",
            "inference_type": "direct"
          }
        ],
        "supporting_segments": ["P006_7"]
      }
    ],
    "motivations_needs": [
      {
        "trait_id": "T008",
        "dimension": "motivations_needs",
        "trait_type": "motivation",
        "statement": "社交归属是核心游戏动机，朋友不玩会降低自身游戏意愿",
        "status": "inferred",
        "temporal_scope": "stable",
        "confidence": 0.82,
        "evidence": [
          {
            "segment_id": "P006_8",
            "quote": "没有一起开黑的朋友，所以玩的游戏更偏向于我个人喜好的多一点。",
            "evidence_level": "E2",
            "inference_type": "causal"
          }
        ],
        "supporting_segments": ["P006_8"]
      }
    ],
    "perceptions_beliefs": [
      {
        "trait_id": "T009",
        "dimension": "perceptions_beliefs",
        "trait_type": "causal_attribution",
        "statement": "认为社交可得性直接影响游戏选择",
        "status": "inferred",
        "temporal_scope": "stable",
        "confidence": 0.82,
        "evidence": [
          {
            "segment_id": "P006_8",
            "quote": "没有一起开黑的朋友，所以玩的游戏更偏向于我个人喜好的多一点。",
            "evidence_level": "E2",
            "inference_type": "causal"
          }
        ],
        "supporting_segments": ["P006_8"]
      }
    ]
  },

  "patterns": [
    {
      "pattern_id": "P001",
      "pattern": "社交可得性影响游戏选择",
      "description": "当缺乏固定开黑伙伴时，游戏选择从社交游戏转向个人偏好游戏",
      "relation_type": "causal",
      "chain": ["T001", "T008", "T007"],
      "evidence": ["P006_8"],
      "confidence": 0.85
    }
  ],

  "contradictions": [],

  "summary": "P006 是一名偏好短 TTK 的射击游戏玩家，游戏选择会受到社交可得性的影响。在没有固定开黑伙伴时，更倾向于选择个人偏好的游戏。偶尔在重大更新时回归，核心社交场景是和朋友玩英雄联盟大乱斗。",

  "review_candidates": [
    {
      "candidate_trait": "可能偏好竞技型游戏",
      "dimension": "preferences",
      "reason": "有 FPS 偏好和多款竞技游戏经验，但缺乏明确的竞技偏好陈述",
      "evidence_level": "E1",
      "confidence": 0.55
    }
  ]
}
```

### 13.2 扁平化数据库写入格式

当写入数据库 JSONB 列时，可简化为：

```json
{
  "pv": "1.0",
  "rid": "P006",
  "meta": {
    "age": 24, "gender": "男", "occupation": "短视频运营"
  },
  "prof": {
    "ctx": [
      {"id": "T001", "tt": "constraint", "st": "近期工作导致固定开黑伙伴减少", "s": "supported", "ts": "current", "c": 0.90, "ev": [{"sid": "P006_8", "q": "最近因为工作的原因，没有一起开黑的朋友。", "el": "E3"}]}
    ],
    "ec": [
      {"id": "T002", "tt": "experience", "st": "Apex 英雄长期游玩经验", "s": "supported", "ts": "historical", "c": 0.95, "ev": [{"sid": "P006_3", "q": "Apex英雄-1200+小时", "el": "E3"}]}
    ],
    "bhv": [],
    "pref": [],
    "mn": [],
    "pb": []
  },
  "pat": [],
  "ctr": [],
  "sum": "...",
  "rc": []
}
```

字段缩写对照：

| 缩写 | 全称 |
|:--|:--|
| `pv` | profile_version |
| `rid` | respondent_id |
| `meta` | metadata |
| `prof` | profile |
| `ctx` | context |
| `ec` | experience_capability |
| `bhv` | behaviors |
| `pref` | preferences |
| `mn` | motivations_needs |
| `pb` | perceptions_beliefs |
| `pat` | patterns |
| `ctr` | contradictions |
| `sum` | summary |
| `rc` | review_candidates |
| `tid` | trait_id |
| `tt` | trait_type |
| `st` | statement |
| `s` | status |
| `ts` | temporal_scope |
| `c` | confidence |
| `ev` | evidence |
| `sid` | segment_id |
| `q` | quote |
| `el` | evidence_level |

---

## 14. 质量管控标准

### 14.1 核心质量指标

| 指标 | 目标值 | 计算方式 |
|:--|:--:|:--|
| Profile 生成覆盖率 | ≥ 90% | 生成了 Profile 的 Respondent 数 / 总 Respondent 数 |
| Trait 证据覆盖率 | 100% | 有至少一条 Evidence 的 Trait 数 / 总 Trait 数（必须为 100%） |
| 平均 Trait 数 | 监控 | 每个 Respondent 的 Trait 总数均值 |
| 空维度率 | 监控 | 为空的 Dimension 数 / (6 × Respondent 数) |
| 推断 Trait 占比 | 监控 | status=`inferred` 的 Trait 占比 |
| Unsupported Trait Rate | ≤ 2% | 没有足够证据支持的 Trait 比例（核心门禁） |
| 冲突未处理率 | ≤ 5% | 存在冲突但未在 contradictions 中记录的 Respondent 占比 |
| Summary 污染率 | 0% | Summary 中出现非 Trait/Pattern 支持的新事实的比例（必须为 0%） |
| 一致性 | ≥ 85% | 对同一 Respondent 多次生成 Profile 的 Trait 一致性 |

> **Unsupported Trait Rate 是核心质量门禁。** 错误制造一个 Trait 可能污染下游的 Embedding、聚类和 AI 模拟。宁愿少生成 Trait，也不能让 Unsupported Trait Rate 失控。

### 14.2 质量闭环

```text
Profile 规范
    ↓
Segment Annotation（已有标注）
    ↓
Evidence Pool 构建
    ↓
Trait 生成 + 聚合 + 冲突检测
    ↓
自动门禁（Unsupported Trait Rate、Summary 污染率）
    ↓
人工抽检（黄金集）
    ↓
Precision / Recall / 一致性
    ↓
发现问题规则
    ↓
修改规范/规则
    ↓
重新生成
    ↓
冻结版本
```

### 14.3 常见生成错误

| 错误类型 | 错误示例 | 正确做法 |
|:--|:--|:--|
| Evidence 缺失 | Trait 无 evidence 字段 | 每个 Trait 必须至少 1 条 evidence |
| 维度归属错误 | 把"偏好 FPS"归入 Behaviors | 归入 Preferences |
| 行为=偏好混淆 | 把"主要玩 FPS"直接当作"最喜欢 FPS" | 仅记录 Behavior，偏好需要态度证据 |
| 过度推断 | 从"偏好 FPS"推断"追求竞技证明" | 动机需要独立证据 |
| 聚合不足 | 3 条 Segment 都说偏好 FPS，生成 3 个 Trait | 合并为 1 个 Trait |
| 冲突掩盖 | 既喜欢短 TTK 又喜欢长 TTK，只记录其中一条 | 都记录，标记为 conflicted |
| 时间信息丢失 | "最近在玩 The Finals"被记录为长期偏好 | 标记 temporal_scope=`temporary` |
| Summary 污染 | Summary 中添加了"因此他是竞技型玩家" | Summary 只基于已有 Trait |
| 空维度填满 | 所有维度无证据，强行推断填充 | 允许空维度 |

---

## 15. 与上下游的接口约定

### 15.1 上游：Segment Annotation

**输入来源**：《数据标注规范》v3.1 定义的 Segment Annotation。

**依赖字段**：
- `annotation.iceberg.M1–M5`：动机、期待、认知、情绪、行为标签
- `annotation.framework`：框架七维标签（ability、style、platform、mode 等）
- `annotation.product_tags`：产品评测扩展标签
- `annotation.evidence`：Segment 级 Evidence
- `annotation.meta`：标注元信息

**不依赖的字段**：
- `review_candidates`：不进入 Evidence Pool
- `annotation.causal_chain`：Segment 级的因果链不直接进入 Profile，但作为 Pattern 的证据来源

### 15.2 下游：Embedding

**输出用途**：作为 Embedding 的语义 metadata。

**使用方式**：
- Trait 的 `statement` 字段作为 Embedding 输入的一部分
- `dimension` 和 `trait_type` 作为结构化过滤字段
- 不将整个 Profile JSON 直接拼接为 Embedding 输入

**注意**：
- 不要将大量 Trait 直接拼接到原文中作为默认 Embedding 输入
- 后续可通过实验比较：纯 Trait statement / Trait + 原始 Segment / 不同维度的 Trait 组合

### 15.3 下游：群体画像聚类

**输出用途**：作为聚类特征矩阵的输入。

**使用方式**：
- 以 Respondent 为单位，提取 Trait 的向量表示
- 六大维度分别参与聚类，但权重可根据业务需求调整
- `confidence` 可作为特征加权依据
- `temporal_scope` 可用于过滤不稳定特征

### 15.4 下游：AI 虚拟用户对话

**输出用途**：作为 AI 模拟用户的人设依据。

**使用方式**：
- Profile Trait 直接注入 System Prompt 作为人设约束
- Evidence 的 `quote` 可用于生成对话时的原文引用
- Patterns 用于生成跨情境的一致性行为
- Contradictions 用于生成"不确定"或"情境依赖"的回答

**注意**：
- 不要将整个 Profile 全部注入 Prompt（会超出 Token 限制）
- 优先注入 confidence 最高的 Trait（Top 10–15）
- Summary 可作为人设的简短描述，但必须附上关键 Evidence

---

## 16. 附录

### 附录 A：六大维度与 M1–M5 的大致映射

| Profile 维度 | 主要 M 层来源 | 关系 |
|:--|:--|:--|
| Context | M5（行为情境）、M3（环境认知） | M 层提供情境证据 |
| Experience & Capability | M5（行为时长）、Framework.ability | M 层提供时长和段位证据 |
| Behaviors | M5（行为/应对） | 直接对应 |
| Preferences | M3（偏好认知）、Product Tags | M3 是主要来源，但不是唯一来源 |
| Motivations & Needs | M1（动机）、M2（期待） | 直接对应，但需跨 Segment 聚合 |
| Perceptions & Beliefs | M3（认知）、M4（情绪触发） | M3 是主要来源 |

> **注意**：这是大致映射，不是强制规则。一个 Segment 的 M5 标注可能同时支持 Behavior 和 Context 两个维度的 Trait。

### 附录 B：禁止推断清单（Profile 层专用）

- 行为 → 偏好（无态度证据时）
- 偏好 → 动机（无动机证据时）
- 偏好 → 能力（无段位/技能证据时）
- 时长 → 能力水平
- 单次陈述 → 稳定特征（无时间信息时）
- 平台偏好 → 能力水平
- 付费水平 → 能力水平
- PVE 偏好 → 能力弱
- Trait A → Trait B → Trait C 链式推导（每步需独立证据）
- 从语言风格推断人口属性
- 为了"完整画像"编造 Trait
- Summary 中引入非 Trait/Pattern 支持的新事实
- 从 Segment 的 review_candidates 生成 Profile Trait（review_candidates 不进入 Evidence Pool）

### 附录 C：Trait Type 参考列表（非穷举）

| 维度 | 可选 Trait Type |
|:--|:--|
| Context | `social_context`, `time_context`, `life_context`, `constraint`, `trigger`, `usage_context` |
| Experience & Capability | `experience`, `capability` |
| Behaviors | `current_behavior`, `historical_behavior`, `recurring_behavior`, `play_behavior`, `choice_behavior`, `cessation_behavior`, `social_behavior`, `consumption_behavior` |
| Preferences | `genre_preference`, `gameplay_preference`, `combat_preference`, `camera_preference`, `social_preference`, `aesthetic_preference`, `platform_preference`, `mode_preference`, `content_preference` |
| Motivations & Needs | `motivation`, `need`, `expectation`, `goal`, `desired_outcome` |
| Perceptions & Beliefs | `quality_perception`, `self_identity`, `belief`, `mental_model`, `causal_attribution`, `evaluation`, `interpretation` |

> 以上为推荐值，Trait Type 由数据驱动，不强制穷举。

### 附录 D：版本历史

| 版本 | 日期 | 变更 |
|:--|:--|:--|
| v1.0 | 2026-08-27 | 初始版本。定义六大一级维度、Trait 结构、Trait 生成流程（10 步）、聚合规则、冲突处理规则、Pattern 生成规则、Evidence 溯源规则、Profile Summary 规则、三层推断体系、JSON Schema、质量管控标准、上下游接口约定。 |

---

> **文档维护**：本文档随 Profile 生成实践迭代更新。Trait 聚合规则、置信度计算公式、质量指标阈值需在首轮 Profile 生成后依据人工抽检结果调整。
>
> **上游依赖版本**：《数据标注规范》v3.1
>
> **协作**：🤖 Generated with [Claude Code](https://claude.com/claude-code)