# Profile Embedding 规范 v1.0

> **版本**：v1.0
> **日期**：2026-08-28
> **状态**：执行版
> **用途**：将已完成的 Respondent Profile 转换为人物级向量，用于 Respondent 相似度计算、自然聚类、群体发现与后续画像分析。
>
> **上游依赖**：《用户画像（Respondent Profile）生成规范》v1.0
> **并行体系**：《Embedding 规范》负责 Statement Embedding
> **核心原则**：Profile Embedding 不重新生成 Profile，只负责将已有 Profile 转换为可比较的向量。

---

# 1. 核心定位

## 1.1 Profile Embedding 是什么

Profile Embedding 表示：

> **一个 Respondent 在当前 Profile 版本下已经形成的整体特征结构。**

其主要用途：

```text
Profile
    ↓
Profile Embedding
    ↓
Respondent Similarity
    ↓
Natural Clustering
    ↓
Cluster Analysis
```

核心对象：

```text
一个 Respondent
        ↓
一个 Profile
        ↓
一个 Profile Embedding Vector
```

---

## 1.2 与 Statement Embedding 的职责分离

系统同时存在两种 Embedding：

| 项目           | Statement Embedding     | Profile Embedding |
| ------------ | ----------------------- | ----------------- |
| 输入           | 单个 Statement            | 完整 Profile        |
| 粒度           | Trait / Statement       | Respondent        |
| 输出           | 多个 Statement Vector     | 一个 Profile Vector |
| 主要用途         | 语义检索、Evidence Retrieval | 相似度、聚类            |
| 数据来源         | Segment / Trait         | Profile           |
| 是否重新推断       | 否                       | 否                 |
| 是否修改 Profile | 否                       | 否                 |

数据流：

```text
                         Profile
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
        Profile Embedding        Profile Analysis
                │
                ▼
       Similarity / Clustering
```

Statement Embedding 独立运行：

```text
Statement
    ↓
Statement Embedding
    ↓
Semantic Retrieval / RAG
```

两者不得混用。

---

# 2. 设计原则

## PE-01：Profile 是唯一业务输入

Profile Embedding 只读取已经完成的 Profile。

不直接读取：

* Raw
* Clean
* 原始访谈
* Segment
* Segment Annotation
* 原始 Evidence
* review_candidates

除非这些内容已经被合法写入 Profile 的正式字段。

---

## PE-02：Embedding 阶段不得重新画像

Embedding 阶段禁止：

* 新增 Trait
* 删除 Trait
* 修改 Trait
* 重新判断 Trait 所属 Dimension
* 重新判断 Trait Type
* 重新推断 M1–M5
* 新增 Pattern
* 修改 Pattern
* 根据多个 Trait 重新推导人物特征
* 生成人格标签
* 生成人物类型
* 根据 Embedding 结果反向修改 Profile

即：

```text
Profile
   ↓
Embedding
```

而不是：

```text
Profile
   ↓
LLM重新理解
   ↓
新画像
   ↓
Embedding
```

---

## PE-03：不生成持久化 `profile_embedding_text`

系统不保存：

```text
profile_embedding_text
```

也不将其作为 Profile 的正式字段。

Embedding 输入由程序根据本规范**运行时确定性构造**。

允许程序在内存中形成模型所需的输入表示，但该中间表示不作为独立数据资产保存。

---

## PE-04：一个 Respondent 一个 Profile Vector

无论内部采用多少次 Embedding：

```text
Dimension Embedding
Pattern Embedding
其他中间 Vector
```

最终必须得到：

```text
R001 → 一个 Profile Vector
R002 → 一个 Profile Vector
R003 → 一个 Profile Vector
```

聚类的基本数据单位始终是：

> **Respondent-level Profile Vector**

---

## PE-05：必须可重建

同一个 Profile 在以下条件全部一致时：

```text
profile_version
embedding_spec_version
embedding_model
embedding_model_version
embedding_parameters
```

必须能够重新执行 Profile Embedding。

因此 Profile Embedding 必须保存完整重建所需的配置。

---

# 3. Profile 中哪些信息进入 Embedding

当前 Profile v1.0 的正式结构包括：

```text
profile
├── context
├── experience_capability
├── behaviors
├── preferences
├── motivations_needs
└── perceptions_beliefs

patterns
contradictions
summary
review_candidates
```

Profile 本身明确将六个一级维度定义为：

```text
context
experience_capability
behaviors
preferences
motivations_needs
perceptions_beliefs
```

Trait 结构包含：

```text
trait_id
dimension
trait_type
statement
status
temporal_scope
confidence
evidence
supporting_segments
condition
negative_evidence
```

这些结构来自现有 Profile 规范。

---

# 4. Embedding 内容选择

## 4.1 核心进入内容

Profile Embedding 的核心语义来源：

> **六大一级维度中的有效 Trait `statement`。**

即：

```text
context
experience_capability
behaviors
preferences
motivations_needs
perceptions_beliefs
```

每个 Trait 的：

```text
statement
```

作为主要语义内容。

---

## 4.2 Dimension 必须保留

虽然不将：

```text
dimension = preferences
```

作为独立人物特征，但 Dimension 必须作为**语义上下文**保留。

例如：

```text
preferences:
偏好短 TTK

behaviors:
长期游玩 Apex
```

不能只让模型看到：

```text
偏好短 TTK
长期游玩 Apex
```

而应该使 Embedding 模型知道：

```text
这是 Preference
这是 Behavior
```

原因是同一句自然语言在不同 Dimension 下含义可能不同。

现有 Profile 规范本身也明确区分六大维度，并要求 Trait 必须归属于其中之一。

---

# 5. Trait 字段处理规则

| Trait 字段              | Embedding | 原因               |
| --------------------- | --------: | ---------------- |
| `statement`           |         ✅ | 核心人物语义           |
| `dimension`           |         ✅ | 提供语义上下文          |
| `trait_type`          |      ✅/辅助 | 提供更细粒度语义上下文      |
| `temporal_scope`      |         ✅ | 防止历史/当前/稳定状态混淆   |
| `condition`           |         ✅ | 条件是 Trait 语义的一部分 |
| `negative_evidence`   |      特殊处理 | 明确否定不能丢失         |
| `status`              |         ❌ | 质量状态，不是人物特征      |
| `confidence`          |         ❌ | 不确定性 metadata    |
| `evidence`            |         ❌ | 证据溯源，不是人物特征      |
| `supporting_segments` |         ❌ | 技术溯源             |
| `trait_id`            |         ❌ | 技术 ID            |

---

# 6. Temporal Scope 必须进入语义表示

这是强制规则。

现有 Profile 已经将 Trait 的时间范围分为：

```text
temporary
current
recurring
stable
historical
unknown
```

并明确要求不能把"最近玩某个游戏"错误变成长期偏好。

因此：

```text
historical
```

和：

```text
stable
```

必须能够被 Embedding 模型区分。

例如：

```text
historical：以前长期游玩 Apex
stable：长期偏好 FPS
current：目前主要游玩 Valorant
```

不能全部变成：

```text
喜欢 FPS 游戏
```

---

# 7. Condition 必须进入

如果 Trait 有：

```text
condition
```

则 Condition 属于该 Trait 的语义组成部分。

例如：

```text
Trait:
偏好社交游戏

condition:
有固定朋友在线时
```

Embedding 必须保留：

```text
有固定朋友在线时 → 偏好社交游戏
```

而不能只留下：

```text
偏好社交游戏
```

因为条件可能正是人物差异的关键。

Profile 规范本身也要求条件不同的 Trait 不直接合并。

---

# 8. Negative Evidence 的处理

明确否定是人物语义的一部分。

例如：

```text
不喜欢大逃杀
```

不得因为它位于：

```text
negative_evidence
```

就完全丢弃。

但必须注意：

> **negative_evidence 是对 Trait 的否定证据，不应该机械地作为一个新的正向 Trait。**

程序应该将其作为该 Trait 的否定语义进行表示。

---

# 9. Status 不进入语义权重

以下状态：

```text
supported
inferred
conflicted
uncertain
```

是 Profile 的证据状态，不是人物特征。

Profile 规范明确区分了这些状态。

因此：

```text
status = supported
```

不会意味着：

```text
这个 Trait 在 Vector 中权重更高
```

同样：

```text
status = inferred
```

也不会自动删除。

Embedding 不负责重新判断 Profile 的正确性。

---

# 10. Confidence 不作为语义权重

禁止：

```text
vector_weight = confidence
```

例如：

```text
Trait A confidence = 0.95
Trait B confidence = 0.60
```

不能简单变成：

```text
A × 0.95
B × 0.60
```

原因：

> Confidence 衡量的是证据确定性，而不是人物特征的重要性。

Profile 规范也明确将 Profile confidence 定义为证据强度、数量、一致性和推断距离的综合结果。

---

# 11. Evidence 不进入 Profile Embedding

Evidence 用于：

```text
证明 Trait
追溯原文
质量控制
人工审核
聚类解释
```

不作为主要 Embedding 内容。

否则一个 Trait 因为拥有更多 Evidence，就会在向量中获得更多语义贡献。

Profile 已经完成了跨 Segment 聚合：

```text
多个 Segment
 ↓
Evidence Pool
 ↓
Trait
```

因此 Embedding 阶段不应该重新回到 Evidence 层。

---

# 12. Review Candidates 不进入

```text
review_candidates
```

不进入 Profile Embedding。

原因：

它们不是正式 Profile Trait。

现有规范明确将 E1 弱推断放入 review_candidates，而不是正式 Trait。

因此：

```text
正式 Profile
→ Embedding

待复核候选
→ 不 Embedding
```

---

# 13. Summary 不进入主 Profile Embedding

Profile Summary 是：

```text
Evidence
 ↓
Trait
 ↓
Pattern
 ↓
Summary
```

的派生结果，而不是新的事实源。

因此 v1.0：

> **Summary 不进入 Profile Embedding。**

原因是避免：

```text
Trait
 ↓
Summary
 ↓
再次压缩 Trait
 ↓
Embedding
```

造成二次摘要和信息损失。

---

# 14. Pattern 的处理

Pattern 与 Trait 不完全相同。

Profile 规范将 Pattern 定义为：

> **多个 Trait 之间的关系。**

允许：

```text
causal
conditional
correlational
contradictory
```

并要求有明确证据支持。

因此 Pattern 是人物画像的重要信息。

### v1.0 不直接把 Pattern 与 Trait 混在一起。

而采用：

```text
Trait Embedding
        +
Pattern Embedding
        ↓
Profile Embedding
```

其中 Pattern 是辅助信息，而不是主信息。

---

# 15. 推荐的 Profile Embedding 计算架构

最终采用：

```text
                    Profile
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
   6 Dimensions    Patterns        Metadata
       │               │
       │               │
       ▼               ▼
Dimension Vectors   Pattern Vector
       │               │
       └───────┬───────┘
               ▼
       Profile Vector
               │
               ▼
       L2 Normalization
               │
               ▼
        Clustering Vector
```

---

# 16. 为什么采用"维度级 Embedding"

禁止直接：

```text
所有 Trait
 ↓
简单拼接
 ↓
一次 Embedding
```

主要原因：

假设：

```text
A：
Preferences = 20 Traits
Behavior = 2 Traits

B：
Preferences = 3 Traits
Behavior = 10 Traits
```

直接拼接会使：

```text
A → Preferences 对向量影响巨大
B → Behavior 对向量影响巨大
```

最后聚类可能主要反映：

> **"谁在哪个维度写得更多"**

而不是：

> **"谁的人物画像更相似"。**

因此 v1.0 采用：

```text
Dimension
 ↓
Dimension Vector
```

然后进行维度级归一。

### 关于六维等权的重要说明

v1.0 将六个 Dimension 等权处理。应理解这一选择为：

> **没有先验证据时采用的公平 baseline。**

等权并不等于"没有人为偏见"。例如：

- `context` 可能主要描述背景；
- `preferences`、`motivations_needs`、`behaviors` 可能更直接体现用户之间的体验差异。

因此 v1.0 等权的正确含义是：**在缺乏外部校准证据时，不给任何 Dimension 分配额外权重。** 不应凭主观判断给 `preferences` 30%、`behavior` 20% 之类的权重。

未来版本应通过消融实验（第 64 条）比较 Equal Weight vs Learned/Calibrated Weight，再决定是否调整 Dimension 权重。

---

# 17. 六大 Dimension Embedding

六个 Dimension 分别产生一个 Vector：

```text
V_context
V_experience
V_behaviors
V_preferences
V_motivations
V_perceptions
```

每个 Vector 只使用该 Dimension 中的正式 Trait。

例如：

```text
preferences
    ↓
所有 preferences Trait
    ↓
V_preferences
```

---

# 18. Dimension 内部聚合

同一个 Dimension 中可能有多个 Trait：

```text
T001
T002
T003
T004
```

禁止因为 Trait 数量不同而产生明显数量偏差。

因此：

> **Dimension Vector 使用该 Dimension 的 Trait 语义集合进行集合级表示，而不是简单按照 Trait 数量累加。**

实现上采用**集合平均 + 层级归一化**（Set-level Mean Pooling + Hierarchical L2 Normalization）：

```text
Trait embeddings
      ↓
mean pooling
      ↓
L2 normalization
```

即：

```text
V_dimension =
normalize(
    mean(
        V_trait_1,
        V_trait_2,
        ...
        V_trait_n
    )
)
```

**设计意图**：这是一项结构性设计选择，而非简单的"防止数量偏差"。该流程在 Dimension 内部先 Mean 后 L2，使 Dimension 内部只保留 Trait 之间的方向共识，消除 Trait 数量差异；随后在 Profile 层面再对六个 Dimension 等权聚合。这一设计明确选择**消除 Dimension 内部 Trait 数量差异，同时保留 Dimension 之间的等权结构**。它不是要消除所有数量影响，而是控制在哪一层消除。实现者应理解为"层级归一化架构"，而非临时性归一化技巧。

---

# 19. 空 Dimension

如果某个 Dimension 没有有效 Trait：

```text
V_dimension = null
```

禁止：

```text
AI 补全
```

也禁止：

```text
Embedding 一个"该用户没有该特征"的文本
```

因为：

> **缺失信息 ≠ 负面信息。**

Profile 规范本身明确允许空维度。

---

# 20. Profile-level 聚合

六个 Dimension Vector 不直接简单平均。

因为 Respondent 可能只有：

```text
2 / 6 dimensions
```

而另一个有：

```text
6 / 6 dimensions
```

因此采用：

> **仅对存在的 Dimension Vector 做等权聚合。**

公式：

```text
V_profile =
normalize(
    mean(
        V_d1,
        V_d2,
        ...
        V_dn
    )
)
```

其中：

```text
n = 当前 Respondent 有有效 Trait 的 Dimension 数
```

因此：

```text
6 个维度 → 6 个维度等权
4 个维度 → 4 个维度等权
2 个维度 → 2 个维度等权
```

不会因为某个 Respondent Profile 更长而获得更大权重。

### Coverage 约束

等权聚合的一个隐含后果是：一个只有 2 个 Dimension 的 Profile 和一个有 6 个 Dimension 的 Profile，两者的 Vector 在数学上具有相同的聚合权重，但信息量不同。

**注意**：这不是说缺失维度应该补零。**绝对不能补零。** 缺失信息 ≠ 负面信息，Profile 规范本身明确允许空维度。

但最终 Similarity / Cluster 时，必须知道：

```text
Profile A
coverage = 6/6

Profile B
coverage = 2/6
```

这是非常重要的质量信息。

因此规则为：

> **Profile Embedding 本身仍然只由存在的 Dimension 构成，coverage 作为独立 metadata 记录。**

具体规则：

1. **Profile Vector 不乘 Coverage**：不要直接把 coverage 乘进 Vector，否则会把"信息量"错误地变成"人物语义"。
2. **Coverage 作为独立 metadata**：在输出结构（第 34 条）中记录 `dimensions_present` 和 `dimensions_total`。
3. **Cluster Analysis 阶段报告 Coverage 分布**：在聚类完成后，分析每个 Cluster 内部的 Coverage 分布，识别低覆盖率 Cluster 的可靠性风险。
4. **下游使用可选择性过滤**：不强制排除低覆盖率 Profile，但分析和报告时需要标注 Coverage 差异。

---

# 21. Pattern Vector

Pattern 单独进行 Embedding。

如果：

```text
Pattern = 0
```

则：

```text
V_pattern = null
```

如果存在多个 Pattern：

```text
P1
P2
P3
```

则：

```text
V_pattern =
normalize(
    mean(
        V_p1,
        V_p2,
        V_p3
    )
)
```

Pattern 的语义输入至少包括：

```text
pattern
description
relation_type
```

其中：

```text
chain
```

用于保留关系结构。

例如：

```text
A → B → C
```

不能简单变成三个孤立 Trait。

---

# 22. Pattern 权重

v1.0 默认实验参数：

```text
Trait-derived representation：85%
Pattern representation：15%
```

即：

```text
V_profile =
normalize(
    0.85 × V_trait_profile
    +
    0.15 × V_pattern
)
```

如果没有 Pattern：

```text
V_profile =
normalize(
    V_trait_profile
)
```

### 重要声明

> **0.85 / 0.15 是 v1.0 的实验起始值（experimental baseline），不是理论最优值，也不是永久规范。**

原因：

1. Pattern 通常由 Trait 派生（如 Trait A + Trait B → Pattern），Pattern 与 Trait 天然存在信息相关性；15% 可能导致"Trait A + Trait B + Pattern(A,B)"被重复计权（详见第 23 条）。
2. 最终权重应通过消融实验（第 63 条）在真实数据上校准，比较 95/5、90/10、85/15、80/20 等多组参数对聚类质量的影响。
3. 如果实验证明 Pattern 对聚类没有改善甚至造成不稳定，应将 Pattern 权重降为 0，而不修改 Profile 规范（见第 63 条）。

### 为什么不是 50 / 50？

因为：

```text
Trait
```

是 Profile 的主体。

Pattern 是：

```text
Trait 之间的关系
```

如果 Pattern 权重过高，一个 Respondent 可能因为一个关系模式就被拉到完全不同的 Cluster。

所以 v1.0 将 Pattern 定义为**增强项，而非主体**。

---

# 23. 一个非常重要的限制

Pattern 不得重复扩大 Trait 信息。

例如：

```text
Trait A：偏好 FPS
Trait B：偏好短 TTK

Pattern：
偏好 FPS 且偏好短 TTK
```

这种 Pattern 本质上没有增加多少新信息。

因此：

> **Pattern 的价值主要来自"关系"，而不是再次重复 Trait 内容。**

如果 Pattern 只是把已有 Trait 换一种方式复述，其影响应保持有限。

---

# 24. Contradiction 的处理

`contradictions` 不作为独立 Vector。

因为真正的冲突已经存在于：

```text
Trait
```

中。

例如：

```text
Trait A：偏好短 TTK
Trait B：偏好长 TTK
status = conflicted
```

两个 Trait 都保留。

这符合现有 Profile 规范：

> 真正矛盾时不强行裁决，两者均保留。

因此 Embedding 应保留双方语义，而不是生成：

```text
"该用户偏好存在矛盾"
```

来替代原始 Trait。

---

# 25. 时间冲突

例如：

```text
historical：以前偏好 MOBA
current：现在偏好 FPS
```

两个 Trait 均进入。

不能：

```text
只保留 current
```

也不能：

```text
合并为"喜欢 MOBA/FPS"
```

因为时间变化本身是人物信息。

---

# 26. Embedding 模型

Embedding 模型必须固定。

例如项目当前采用：

```text
BAAI/bge-m3
```

则统一使用同一模型生成同一版本的 Profile Embedding。

禁止：

```text
R001 → bge-m3
R002 → text-embedding-xxx
R003 → 其他模型
```

同一个聚类任务中的 Profile Vector 必须来自：

> **同一 Embedding 模型、同一版本、同一参数配置。**

## 26.1 模型版本标识

模型版本标识必须包含足够信息以保证可重建。`"fixed"` 不足以区分不同 revision 的同一模型。

真正的可重建至少应区分以下字段：

| 字段 | 说明 | 示例 |
|------|------|------|
| `model_name` | 模型标识符 | `BAAI/bge-m3` |
| `model_revision` | 模型的具体 revision / commit | `6904bca` 或 `main` |
| `model_dimension` | 输出向量维度 | `1024` |
| `model_parameters` | 关键参数（如有） | `{}` |
| `serialization_version` | 输入构造规范版本 | `1.0` |

**特别注意**：同一 `BAAI/bge-m3` 在不同 revision 下可能产生不同的 Vector。如果使用 Hugging Face 模型，必须记录具体的 revision / commit hash。如果使用 API 服务，必须记录 API 版本和模型部署日期。

### 推荐配置格式

```json
{
  "embedding_model": {
    "model_name": "BAAI/bge-m3",
    "model_revision": "6904bca",
    "model_dimension": 1024,
    "model_source": "huggingface"
  },
  "serialization_version": "1.0"
}
```

---

# 27. Embedding 输入的确定性构造

虽然不保存 `profile_embedding_text`，但输入构造必须确定。

固定：

```text
Dimension 顺序
↓
Trait 顺序
↓
字段选择
↓
字段序列化规则
```

推荐固定六维顺序：

```text
1. context
2. experience_capability
3. behaviors
4. preferences
5. motivations_needs
6. perceptions_beliefs
```

该顺序与 Profile Schema 保持一致。

## 27.1 Canonical Serialization Rule（规范序列化规则）

**这是保证可重建性的最关键条目之一。** 仅规定 Dimension 和 Trait 的顺序还不够。Embedding 模型看到的文本不同，Vector 就可能不同。因此必须规定每个 Trait 如何序列化为 Embedding 模型输入的文本。

### 27.1.1 字段顺序

每个 Trait 序列化时，字段必须按以下固定顺序：

```text
1. dimension
2. temporal_scope
3. trait_type
4. statement
5. condition
6. negative_evidence
```

### 27.1.2 字段名称保留规则

序列化时**保留字段名称作为标签**，使 Embedding 模型能区分不同字段的语义角色：

```text
Dimension: preferences
Temporal: current
Type: preference
Statement: 偏好短TTK
Condition: 和朋友一起玩时
```

而不是：

```text
preferences | current | 偏好短TTK | 和朋友一起玩时
```

### 27.1.3 空字段处理

空字段不输出，不输出占位符（如 `N/A`、`None`、`null`）。例如如果没有 condition，则跳过该行，不输出 `Condition: N/A`。

### 27.1.4 换行规则

每个字段一行，Traits 之间用空行分隔：

```text
Dimension: preferences
Temporal: current
Statement: 偏好短TTK
Condition: 和朋友一起玩时

Dimension: behaviors
Temporal: stable
Statement: 长期游玩Apex
```

### 27.1.5 分隔符

字段名与字段值之间使用 `: `（冒号 + 空格）。

### 27.1.6 Unicode Normalization

所有文本在序列化前必须进行 Unicode NFC normalization（`unicodedata.normalize('NFC', text)` 或等效操作）。

### 27.1.7 空白字符处理

- 首尾空白字符（leading/trailing whitespace）必须去除（trim）。
- 连续的空白字符（多个空格、制表符）必须压缩为单个空格。
- 换行符（`\n`、`\r\n`）统一为 `\n`。

### 27.1.8 Pattern Chain 的表达方式

Pattern 序列化时，chain 结构必须保留关系方向。如果 Pattern 包含 chain：

```text
Trait A → Trait B → Trait C
```

则序列化为：

```text
Relation: causal
Chain: [Trait A statement] → [Trait B statement] → [Trait C statement]
Description: [pattern description]
```

### 27.1.9 Negative Evidence 的表达方式

Negative Evidence 不得作为独立 Trait。应在所属 Trait 的序列化中以否定语义表示：

```text
Dimension: preferences
Statement: 偏好短TTK
Negative: 不喜欢大逃杀
```

而不是将其丢弃或作为独立的"偏好大逃杀"正向 Trait。

### 27.1.10 Dimension 间文本构造

每个 Dimension 的 Trait 序列化完成后，按 Dimension 顺序拼接。Dimension 之间用 Dimension 名称作为分隔标题：

```text
[context]
Dimension: context
Temporal: current
Statement: 大学生
...

[experience_capability]
Dimension: experience_capability
Temporal: stable
Statement: 5年FPS经验
...
```

### 27.1.11 实现要求

- 所有序列化规则必须在代码中实现，不得依赖人工判断。
- 序列化必须可单元测试：给定相同 Profile → 产生完全相同的序列化文本。
- 序列化版本变更必须更新 `serialization_version`（见第 26.1 条），并触发重新生成（见第 52 条）。

---

# 28. Trait 排序规则

为了确保可重建，Trait 必须确定性排序。

优先：

```text
trait_id
```

作为稳定排序键。

禁止依赖：

```text
JSON 原始生成顺序
```

因为不同程序或重新生成 Profile 后，数组顺序可能变化。

---

# 29. Pattern 排序规则

Pattern 使用：

```text
pattern_id
```

进行稳定排序。

同样禁止依赖：

```text
JSON 原始数组顺序
```

---

# 30. Metadata 不进入语义 Vector

以下字段默认只作为 metadata：

```text
respondent_id
profile_version
generated_at
source_segments_count
model
source_files
demographics
gaming_background
trait_id
evidence
supporting_segments
confidence
```

特别是：

```text
respondent_id
```

绝对不能进入 Embedding。

否则模型可能学习：

```text
P006
```

这样的无意义标识符。

---

# 31. 人口统计信息的特殊规则

当前 Profile `metadata` 中可能存在：

```text
age
gender
occupation
```

这些信息：

> **v1.0 默认不进入 Profile Embedding。**

原因：

1. 不是所有 Respondent 都有完整人口属性；
2. 容易导致 Cluster 被人口属性主导；
3. 与"基于用户体验/行为/偏好形成自然群体"的目标不完全一致；
4. 某些属性属于敏感信息，不应无意间成为语义聚类的主要依据。

如果以后需要研究：

```text
人口属性 × Profile Cluster
```

应该在聚类完成之后作为**外部分析变量**加入，而不是直接污染 Profile Vector。

---

# 32. gaming_background 的处理

同理：

```text
active_games
platform
experience_years
```

如果这些信息已经在正式 Profile Dimension 中形成 Trait：

```text
experience_capability
behaviors
preferences
```

则使用 Trait。

不要同时：

```text
metadata.active_games
+
Profile Trait
```

重复加入。

原则：

> **同一语义只能通过正式 Profile Trait 进入主 Profile Embedding 一次。**

---

# 33. 防重复规则

如果：

```text
metadata
```

和：

```text
Trait
```

表达同一信息：

> 只使用正式 Profile Trait。

例如：

```text
metadata:
active_games = ["Apex"]

Trait:
长期游玩 Apex
```

只使用 Trait。

避免：

```text
Apex
+
长期游玩 Apex
```

被重复计算。

---

# 34. Profile Embedding 输出结构

推荐：

```json
{
  "profile_embedding_version": "1.0",

  "respondent_id": "P006",

  "profile_version": "1.0",

  "embedding_model": "BAAI/bge-m3",

  "embedding_model_revision": "6904bca",

  "embedding_dimension": 1024,

  "dimension_vectors": {
    "context": [ ... ],
    "experience_capability": [ ... ],
    "behaviors": [ ... ],
    "preferences": [ ... ],
    "motivations_needs": [ ... ],
    "perceptions_beliefs": [ ... ]
  },

  "pattern_vector": [ ... ],

  "profile_embedding": [ ... ],

  "coverage": {
    "dimensions_present": 5,
    "dimensions_total": 6,
    "trait_count": 17,
    "pattern_count": 2
  },

  "normalization": "L2",

  "created_at": "2026-08-28T..."
}
```

---

# 35. 是否必须保存 Dimension Vector

建议：

> **保存。**

虽然最终聚类只使用：

```text
profile_embedding
```

但保存：

```text
dimension_vectors
```

有三个巨大好处：

### 1. 聚类解释

可以分析：

```text
两个 Cluster
到底在哪个 Dimension 最相似？
```

### 2. Debug

如果 Profile Cluster 异常：

```text
context
experience
behavior
preference
motivation
perception
```

可以逐层检查。

### 3. 后续实验

以后可以比较：

```text
六维等权
vs
不同维度权重
vs
只使用部分 Dimension
```

而无需重新调用 Embedding API。

---

# 36. 聚类前必须 L2 Normalize

最终：

```text
Profile Vector
↓
L2 normalization
↓
Clustering
```

推荐使用：

```text
Cosine Similarity
```

作为人物相似度的主要度量。

因为 Profile Embedding 的核心问题是：

> **方向上的语义相似性**

而不是向量绝对长度。

---

# 37. Respondent Similarity

两个 Respondent：

```text
A
B
```

相似度：

```text
cosine_similarity(VA, VB)
```

范围：

```text
-1 ~ 1
```

实际阈值：

> **不得直接使用未经数据校准的固定阈值。**

例如：

```text
0.7 = 相似
0.8 = 很相似
```

不能在 v1.0 中直接认定。

必须根据真实数据分布校准。

---

# 38. 聚类算法：默认 HDBSCAN

如果目标是：

> **自然发现用户群，而不是预先规定有几个群体。**

v1.0 默认：

```text
Profile Embedding
 ↓
Cosine distance
 ↓
HDBSCAN
 ↓
Clusters
```

原因：

* 不需要预先指定 K；
* 可以识别不同密度的群体；
* 可以产生 Noise / Outlier；
* 更适合探索性用户分群。

---

# 39. 不建议默认 K-Means

不要默认：

```text
K-Means
K = 3
```

因为：

> K 本身就是一个人为假设。

如果真实用户存在：

```text
2 个群体
```

或者：

```text
7 个群体
```

预设：

```text
K=3
```

会强行切割。

K-Means 可以作为**对照实验**，不作为默认聚类算法。

---

# 40. HDBSCAN 参数

v1.0 实验 baseline：

```text
metric = cosine

min_cluster_size
    = max(3, round(N × 0.05))

min_samples
    = null / auto
```

**重要声明**：

> `min_cluster_size = max(3, round(N × 0.05))` 作为实验 baseline 是合理的。但 `min_samples = min_cluster_size` 比较激进，容易产生大量 Noise，尤其对于非超大规模数据。

因此 v1.0 默认 `min_samples = null`（由 HDBSCAN 自动选择），并将 `min_samples = min_cluster_size` 作为对照实验方案而非默认参数。

**首轮实验必须测试**：

```text
min_samples ∈ {1, 3, 5, null/auto, min_cluster_size}
```

比较各参数下的 Noise Rate、Cluster Stability 和人工解释性，再决定生产参数。

**这些都不是永久固定参数。**

对于小样本：

```text
N < 50
```

不应过度依赖 HDBSCAN 单次结果。

应该同时进行：

```text
Bootstrap / Resampling
+
参数敏感性分析
```

---

# 41. 不要用 UMAP 后的二维坐标直接聚类

正确：

```text
Profile Embedding
        ↓
HDBSCAN
```

UMAP：

```text
Profile Embedding
        ↓
UMAP
        ↓
Visualization
```

主要用于：

> **可视化 Cluster**

而不是默认作为聚类输入。

因为二维/低维投影会改变原始距离结构。

---

# 42. PCA 的使用

如果 Embedding 维度很高：

```text
1024 dimensions
```

可以在聚类前进行 PCA 作为实验方案：

```text
1024
 ↓
PCA 95% variance
 ↓
HDBSCAN
```

但必须同时保留：

```text
原始 Embedding
```

并比较：

```text
Original → HDBSCAN
PCA → HDBSCAN
```

不要未经验证就认为降维一定更好。

---

# 43. Cluster 数量不得人为规定

系统输出：

```text
cluster_001
cluster_002
...
```

Cluster 数量由算法和数据决定。

禁止：

```text
必须生成 3 个群体
```

或者：

```text
至少 5 个群体
```

除非业务分析阶段另行指定。

---

# 44. Noise / Outlier 必须保留

HDBSCAN 可能输出：

```text
cluster = -1
```

表示：

> 当前数据中无法稳定归入任何群体。

不能强行：

```text
Noise
↓
最近 Cluster
```

否则会降低自然聚类的真实性。

---

# 45. Cluster 稳定性必须评估

不能：

```text
跑一次 HDBSCAN
↓
Cluster 1/2/3
↓
直接认为是真实用户群
```

至少应该进行：

```text
Bootstrap / Resampling
```

例如：

```text
重复抽样
↓
重新聚类
↓
比较成员归属
```

得到：

```text
Cluster Stability
```

---

# 46. Cluster 质量指标

至少记录：

### Silhouette Score

衡量：

> Cluster 内部紧密程度与 Cluster 间分离程度。

### Davies-Bouldin Index

衡量：

> Cluster 间重叠情况。

### Cluster Stability

衡量：

> 换样本 / 换参数后 Cluster 是否稳定。

### Noise Rate

记录：

```text
Noise Respondents / Total Respondents
```

---

# 47. 不能只看数学指标

这是本项目非常重要的一条。

一个数学指标很好看的 Cluster：

```text
Cluster A
```

如果 Profile 中无法解释：

```text
为什么这些人相似？
```

仍然不能认为 Cluster 有业务意义。

所以最终 Cluster 必须进行：

```text
Vector similarity
+
Profile Trait comparison
+
Dimension comparison
+
Pattern comparison
```

综合验证。

---

# 48. Cluster 解释

每个 Cluster 最终应该生成：

```text
Cluster
│
├── 成员
├── 核心共同 Trait
├── 高区分 Trait
├── Dimension 分布
├── Pattern 分布
├── Cluster 内部相似度
├── Cluster 与其他 Cluster 的差异
└── Outlier
```

特别注意：

> Cluster Summary 只能总结 Cluster 中实际存在的 Profile Trait，不能因为聚类结果重新创造一个人物类型。

例如：

```text
❌ "这是典型竞技型人格。"

✅ "该群体多数 Respondent 具有：
- 偏好竞技射击游戏
- 重视匹配公平性
- 对失败具有较强负面反应
"
```

---

# 49. Cluster 不反向修改 Profile

禁止：

```text
Profile
 ↓
Embedding
 ↓
Cluster
 ↓
发现"这个人像竞技玩家"
 ↓
修改 Profile
```

正确：

```text
Profile
 ↓
Embedding
 ↓
Cluster
 ↓
Analysis
```

Cluster 是 Profile 的**下游分析结果**。

不是 Profile 的新证据。

---

# 50. Profile Embedding 版本控制

每一个 Vector 必须绑定：

```text
profile_embedding_version
profile_version
embedding_model
embedding_model_revision
embedding_parameters
```

例如：

```json
{
  "profile_embedding_version": "1.0",
  "profile_version": "1.0",
  "embedding_model": "BAAI/bge-m3",
  "embedding_model_revision": "6904bca",
  "embedding_dimension": 1024,
  "normalization": "L2"
}
```

如果 Profile 修改：

```text
Profile v1.0
↓
Profile v1.1
```

必须重新生成：

```text
Profile Embedding v1.1
```

不得覆盖后无法追溯。

---

# 51. Hash / Fingerprint

为了保证可重建，建议保存：

```text
profile_hash
embedding_config_hash
```

例如：

```json
{
  "profile_hash": "sha256:...",
  "embedding_config_hash": "sha256:..."
}
```

其中：

```text
profile_hash
```

由参与 Embedding 的 Profile 内容计算。

这样可以判断：

```text
Profile 是否发生变化？
```

以及：

```text
当前 Vector 是否对应当前 Profile？
```

---

# 52. 重新生成触发条件

出现以下任一情况，必须重新生成 Profile Embedding：

```text
Profile 内容变化
Profile Version 变化
Embedding Specification 变化
Embedding Model 变化
Embedding Model Revision 变化
Embedding Parameters 变化
Dimension 聚合规则变化
Pattern 权重变化
```

---

# 53. 不触发重新生成的情况

仅修改：

```text
created_at
source_file metadata
evidence display
supporting_segments
review metadata
```

如果这些字段不参与 Embedding，则不需要重新生成。

---

# 54. 数据质量门禁

进入 Profile Embedding 前：

```text
Profile 必须通过 Profile Quality Gate
```

至少检查：

```text
Trait Evidence Coverage = 100%
Unsupported Trait Rate ≤ 2%
冲突未处理率 ≤ 5%
Summary 污染率 = 0%
```

这些指标已经存在于 Profile v1.0。

如果 Profile 没有通过门禁：

```text
不要生成正式 Profile Embedding
```

或者标记：

```text
embedding_status = "review"
```

而不是把问题直接带入生产聚类。

---

# 55. Embedding 数据完整性检查

每个 Respondent 必须检查：

```text
Profile exists
AND
Profile version exists
AND
至少一个有效 Dimension
AND
至少一个有效 Trait
```

如果：

```text
0 Trait
```

则：

```text
Profile Embedding = null
```

不能生成一个"空人物 Vector"。

---

# 56. 最终数据库结构

建议：

```text
profile_embeddings
```

独立于：

```text
profiles
```

例如：

```json
{
  "respondent_id": "P006",

  "profile_version": "1.0",

  "embedding_spec_version": "1.0",

  "embedding_model": "BAAI/bge-m3",

  "embedding_model_revision": "6904bca",

  "embedding_dimension": 1024,

  "profile_hash": "sha256:...",

  "embedding_config_hash": "sha256:...",

  "profile_embedding": [ ... ],

  "dimension_vectors": {
    "context": [ ... ],
    "experience_capability": [ ... ],
    "behaviors": [ ... ],
    "preferences": [ ... ],
    "motivations_needs": [ ... ],
    "perceptions_beliefs": [ ... ]
  },

  "pattern_vector": [ ... ],

  "coverage": {
    "trait_count": 17,
    "pattern_count": 2,
    "dimensions_present": 5,
    "dimensions_total": 6
  },

  "normalization": "L2",

  "created_at": "2026-08-28T..."
}
```

---

# 57. 推荐文件结构

你之前的：

```text
data
label
clean
profile
embed
```

仍然合理。

建议：

```text
embed/
├── statements/
│   └── ...
│
└── profiles/
    └── ...
```

即：

```text
embed
├── statement embeddings
└── profile embeddings
```

不需要把 Profile 和 Embedding 合并成一个文件。

---

# 58. 推荐的数据关系

```text
Respondent
    │
    └── Profile
          │
          ├── Traits
          ├── Patterns
          ├── Contradictions
          └── Summary
                  │
                  ▼
          Profile Embedding
                  │
                  ├── Dimension Vectors
                  ├── Pattern Vector
                  └── Final Vector
                          │
                          ▼
                    Clustering
```

---

# 59. 最终聚类 Pipeline

生产环境直接采用：

```text
Profile JSON
     ↓
Profile Quality Gate
     ↓
读取六大 Dimension Traits
     ↓
Dimension-level Embedding
     ↓
每个 Dimension 内 Mean Pooling
     ↓
Dimension L2 Normalize
     ↓
六个 Dimension 等权聚合
     ↓
Trait Profile Vector
     ↓
Pattern Embedding
     ↓
0.85 × Trait Vector
+
0.15 × Pattern Vector
     ↓
L2 Normalize
     ↓
Profile Embedding
     ↓
Cosine Distance
     ↓
HDBSCAN
     ↓
Cluster
     ↓
Stability Analysis
     ↓
Cluster Interpretation
```

---

# 60. 最终核心公式

对于 Respondent \(r\)：

六个 Dimension：

```text
D = {
context,
experience_capability,
behaviors,
preferences,
motivations_needs,
perceptions_beliefs
}
```

每个 Dimension：

```text
V_d = Normalize(
        Mean(
            TraitEmbedding(T_d1),
            TraitEmbedding(T_d2),
            ...
        )
      )
```

只对非空 Dimension 聚合：

```text
V_trait_profile =
Normalize(
    Mean(V_d1, V_d2, ..., V_dn)
)
```

Pattern：

```text
V_pattern =
Normalize(
    Mean(PatternEmbedding(P1), PatternEmbedding(P2), ...)
)
```

最终：

```text
V_profile =
Normalize(
    0.85 × V_trait_profile
    +
    0.15 × V_pattern
)
```

没有 Pattern：

```text
V_profile =
Normalize(V_trait_profile)
```

---

# 61. 为什么这是 v1.0，而不是把权重永久固定

以下参数：

```text
0.85 / 0.15
HDBSCAN min_cluster_size
min_samples
PCA 是否使用
```

都属于：

> **可实验校准参数**

而不是 Profile 事实。

因此必须保存：

```text
embedding_config
```

使实验结果可复现。

---

# 62. v1.0 默认配置

```json
{
  "embedding_model": "BAAI/bge-m3",

  "embedding_model_revision": "6904bca",

  "dimension_pooling": "mean",

  "dimension_normalization": "l2",

  "dimension_aggregation": "equal",

  "pattern_weight": 0.15,

  "trait_profile_weight": 0.85,

  "final_normalization": "l2",

  "similarity_metric": "cosine",

  "clustering_algorithm": "HDBSCAN",

  "dimensionality_reduction_for_clustering": false,

  "umap_for_visualization": true
}
```

---

# 63. 必须进行的首轮实验

v1.0 虽然可以直接生产，但第一次聚类完成后必须做参数验证。

至少比较：

```text
Experiment A
Trait only

Experiment B
Trait + Pattern 95/5

Experiment C
Trait + Pattern 90/10

Experiment D
Trait + Pattern 85/15

Experiment E
Trait + Pattern 80/20
```

比较：

```text
Silhouette
DBI
Noise Rate
Cluster Stability
Cluster Size
人工解释性
```

如果：

```text
85/15
```

明显优于：

```text
95/5
```

则保留。

如果 Pattern 对 Cluster 没有改善甚至造成不稳定：

> 可以将 Pattern 权重降为 0，而不修改 Profile 规范。

---

# 64. 更重要的消融实验

必须比较：

```text
A：全 Profile Trait
B：只 Trait，不 Pattern
C：Dimension-balanced Trait
D：不做 Dimension balancing
```

尤其比较：

```text
C vs D
```

如果 C 的 Cluster 更稳定、更容易解释，就证明：

> **Dimension balancing 确实解决了 Profile Trait 数量不均衡问题。**

---

# 65. Cluster 最终输出

建议：

```json
{
  "cluster_id": "C001",

  "member_respondents": [
    "P001",
    "P007",
    "P012"
  ],

  "member_count": 3,

  "algorithm": "HDBSCAN",

  "similarity_metric": "cosine",

  "cluster_stability": 0.87,

  "noise": false,

  "core_dimensions": [
    "preferences",
    "motivations_needs"
  ],

  "representative_traits": [
    "...",
    "..."
  ],

  "distinguishing_traits": [
    "...",
    "..."
  ]
}
```

---

# 66. 最终职责边界

整个系统最终固定为：

```text
DATA
负责保存原始数据

CLEAN
负责清洗和标准化

LABEL
负责 Segment 层理解、标签和 Evidence

PROFILE
负责 Respondent 层特征聚合、冲突、Pattern 和 Summary

STATEMENT EMBEDDING
负责 Statement 级语义检索

PROFILE EMBEDDING
负责 Respondent 级整体向量表示

CLUSTERING
负责从 Profile Embedding 中发现自然群体

CLUSTER ANALYSIS
负责解释群体，而不是修改 Profile
```

最终形成：

```text
                    ┌───────────────┐
                    │     DATA      │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │     CLEAN     │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │     LABEL     │
                    └───────┬───────┘
                            ↓
                    ┌───────────────┐
                    │    PROFILE    │
                    └───────┬───────┘
                            │
               ┌────────────┴────────────┐
               ↓                         ↓
       Statement Embedding       Profile Embedding
               │                         │
               ↓                         ↓
          Semantic RAG            Similarity
                                         ↓
                                    HDBSCAN
                                         ↓
                                     Clusters
                                         ↓
                                  Cluster Analysis
```

---

# 67. v1.0 最终硬规则

最后将以下规则视为**不可违反规则**：

1. **Profile 文件是 Profile Embedding 的唯一业务输入。**
2. **不生成持久化 `profile_embedding_text`。**
3. **Embedding 阶段不得重新画像。**
4. **一个 Respondent 最终只有一个 Profile Embedding。**
5. **Profile Embedding 必须可重建。**
6. **Trait 是 Profile Embedding 的主要语义来源。**
7. **六大 Dimension 用于控制语义结构和防止 Trait 数量偏差。**
8. **Dimension 内部采用集合级聚合，不允许 Trait 数量直接决定人物权重。**
9. **六大 Dimension 在 v1.0 默认等权。**
10. **Pattern 作为辅助关系信息进入，默认权重 15%。**
11. **Summary 不进入主 Profile Embedding。**
12. **Evidence 不进入主 Profile Embedding。**
13. **Confidence 不直接作为向量权重。**
14. **review_candidates 不进入 Profile Embedding。**
15. **时间、条件、否定和真正冲突不得被静默删除。**
16. **缺失 Dimension 不等于负面特征。**
17. **Metadata 默认不进入语义 Embedding。**
18. **同一语义不得通过 Metadata + Trait 重复进入。**
19. **最终 Vector 必须 L2 Normalize。**
20. **人物相似度默认使用 Cosine Similarity。**
21. **自然聚类默认使用 HDBSCAN，而不是预设 K。**
22. **Noise 不得强制归入 Cluster。**
23. **UMAP 默认只用于可视化，不直接用于聚类。**
24. **Cluster 必须进行稳定性验证。**
25. **Cluster 结果不得反向修改 Profile。**

---

# 68. 最终结论

因此，你整个系统现在可以非常清晰地定成：

```text
Profile
   │
   ├── Trait → Dimension Embedding
   │              ↓
   │       Dimension-balanced
   │              ↓
   │       Trait Profile Vector
   │
   └── Pattern → Pattern Vector
                      ↓
              85% + 15% Fusion
                      ↓
              Profile Embedding
                      ↓
               Cosine Similarity
                      ↓
                  HDBSCAN
                      ↓
              Natural Clusters
```

**这个版本可以直接进入实现。**

而且我认为它比最初的"整个 Profile JSON → 一个 Embedding"明显更适合你的数据：你的 Profile 已经有明确的六大一级维度、Trait 聚合、时间范围、条件、冲突和 Pattern 结构，因此最合理的做法不是让 Embedding 模型重新理解这些结构，而是**利用已有结构控制向量形成过程**。现有 Profile 规范本身也明确把 Trait、Pattern、Evidence、Summary 分成不同职责，并把 Trait `statement` 作为下游 Embedding 的主要语义来源。