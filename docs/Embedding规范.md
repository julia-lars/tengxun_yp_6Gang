# Segment Embedding 规范 v3.0

> **版本**：v3.0
> **日期**：2026-08-28
> **状态**：执行版
> **适用范围**：将 Label 阶段已经完成的 Segment 转换为可用于语义检索、证据定位、RAG 和后续分析的向量表示。
> **核心粒度**：**Segment-level**
> **核心规则**：**一个有效 Segment 对应一个 Embedding。**
>
> **直接输入**：Label 文件
> **主要输出**：Segment Embedding 文件 / 向量数据库
> **上游**：《数据清洗规范》《数据标注规范》
> **下游**：语义检索、RAG、Evidence 定位、Profile 证据回溯及其他分析任务

---

# 目录

1. 设计目标与核心原则
2. 数据流与职责边界
3. Embedding 基本单位
4. Label 文件作为直接输入
5. Embedding 输入文本规范
6. Context 的使用规则
7. 语义保真规则
8. Label 与 Metadata
9. M1–M5 的处理
10. Profile 与 Segment Embedding 的关系
11. 空值、无效 Segment 与边界情况
12. 极长 Segment
13. Embedding 模型与向量规范
14. 输出数据结构
15. Metadata 字段规范
16. 文件组织
17. 数据库存储
18. HNSW 索引
19. 生成流程
20. 增量更新
21. 什么时候必须全量重嵌
22. 版本管理
23. 向量检索规范
24. Segment Embedding 与 Profile 聚类
25. 质量评测
26. 自动化质量检查
27. 禁止事项
28. 完整执行流程
29. 最核心的执行规则
30. 最简执行公式
31. 附录 A：Profile 接口约定
32. 附录 B：字段来源约定
33. 附录 C：一句话版本
34. 版本历史

---

# 1. 设计目标与核心原则

## 1.1 核心定位

Segment Embedding 的唯一核心任务是：

> **将 Label 文件中的有效 Segment 转换为语义向量。**

Embedding 阶段不负责：

* 重新清洗文本
* 重新切分 Segment
* 重新合并 Segment
* 重新进行 Label
* 生成 Profile
* 生成 Profile Statement
* 重新推断用户特征
* 生成心理解释
* 生成用户人格判断

正确流程：

```text
Label File
    │
    ↓
有效 Segment 检查
    │
    ↓
embedding_text
    │
    ↓
Embedding Model
    │
    ↓
Segment Embedding
```

---

## 1.2 最核心的粒度原则

> **一个有效 Segment = 一个 Embedding Unit = 一个 Vector。**

例如 Label 文件：

```json
{
  "segment_id": "P006_023",
  "text": "我一般跟朋友一起玩，自己玩的时候比较无聊。"
}
```

生成：

```text
P006_023
    ↓
E_P006_023
    ↓
一个向量
```

不得变成：

```text
P006_023
    ↓
两个向量
```

也不得：

```text
P006_023 + P006_024
    ↓
一个向量
```

---

## 1.3 Embedding 与 Profile 的根本关系

Profile 是 Label Segment 的上层聚合和解释结果。

因此：

```text
                 Label Segment
                       │
             ┌─────────┴─────────┐
             ↓                   ↓
          Profile            Embedding
             │                   │
             ↓                   ↓
      Profile Trait        Segment Vector
```

而不是：

```text
Label
 ↓
Profile
 ↓
Statement
 ↓
Segment Embedding
```

**Segment Embedding 不依赖 Profile 才能生成。**

只要 Label 文件已经完成，Segment Embedding 就可以独立生成。

---

## 1.4 三个层级必须严格分开

### Segment

回答：

> 用户原本表达了什么？

### Profile Statement

回答：

> 根据多个 Segment，可以总结这个用户具有什么特征？

### Embedding

回答：

> 如何将一个 Segment 表示成适合机器检索的向量？

因此：

```text
Segment ≠ Statement ≠ Profile
```

Segment Embedding 只负责：

```text
Segment → Vector
```

---

# 2. 数据流与职责边界

## 2.1 项目整体数据流

```text
Raw
 │
 ↓
Clean
 │
 ↓
Label
 │
 ├──────────────────────┐
 ↓                      ↓
Segment Embedding      Profile
 │                      │
 ↓                      ↓
Vector Store       Profile / Trait
```

因此 Label 是一个关键分叉点：

```text
Label
 ├──→ Profile
 └──→ Embedding
```

---

## 2.2 各阶段职责

| 阶段        | 输入                | 输出            | 核心职责             |
| --------- | ----------------- | ------------- | ---------------- |
| Raw       | 原始访谈              | 原始数据          | 保留原始材料           |
| Clean     | Raw               | Clean Segment | 清洗、去噪、确定 Segment |
| Label     | Clean Segment     | Label Segment | 语义标注、M层、维度等      |
| Embedding | **Label Segment** | Vector        | Segment 向量化      |
| Profile   | Label + Segment   | Profile       | 聚合人物特征           |

---

## 2.3 Embedding 的职责边界

Embedding 可以读取：

* Segment 文本
* Segment ID
* Respondent ID
* Source File
* Label
* M1–M5
* Dimension
* Trait Type
* 其他已有 metadata

但：

> **这些字段不意味着全部进入 embedding_text。**

Embedding 必须区分：

```text
Embedding Input
```

和：

```text
Metadata
```

---

# 3. Embedding 基本单位

## 3.1 Segment 是唯一基本单位

Label 文件中的每一个有效 Segment 都是独立 Embedding Unit。

例如：

```json
{
  "segment_id": "P006_023",
  "speaker_id": "Alex M.",
  "text": "我一般跟朋友一起玩。",
  "m_level": "M2",
  "dimension": "preferences"
}
```

Embedding Unit：

```text
segment_id = P006_023
```

---

## 3.2 Segment 不得重新拆分

如果 Label 中已经存在：

```text
P006_023
```

Embedding 阶段不得重新判断：

> 这里其实应该拆成两个 Segment。

禁止：

```text
P006_023-A
P006_023-B
```

---

## 3.3 Segment 不得重新合并

例如：

```text
P006_023
P006_024
P006_025
```

必须分别生成：

```text
E_P006_023
E_P006_024
E_P006_025
```

不得：

```text
E_P006_023_024_025
```

---

## 3.4 Segment ID 是核心主键

推荐：

```text
embedding_id = E_{segment_id}
```

例如：

```text
segment_id = P006_023
embedding_id = E_P006_023
```

这样能够天然建立：

```text
Segment ↔ Embedding
```

一对一关系。

---

# 4. Label 文件作为直接输入

## 4.1 直接输入源

本规范明确规定：

> **Segment Embedding 的直接输入文件是 Label 文件。**

不是：

```text
Clean 文件
```

也不是：

```text
Profile 文件
```

更不是：

```text
Profile Statement 文件
```

---

## 4.2 Label 文件的作用

Label 文件提供：

```text
Segment
+
Label
+
上下文 Metadata
```

Embedding 从中读取：

```text
segment_id
respondent_id
text
source_file
labels
m_level
dimension
trait_type
confidence
```

具体字段以实际 Label Schema 为准。

---

## 4.3 Label 是 Embedding 的上游上下文

Label 可以帮助：

* 识别 Segment 所属类别
* 后续 metadata filtering
* 检索结果解释
* 与 Profile 建立关系

但默认不把 Label 字段拼入 embedding_text。

例如：

```text
text:
我一般跟朋友一起玩。

dimension:
preferences

m_level:
M2
```

默认：

```text
embedding_text:
我一般跟朋友一起玩。
```

而：

```text
dimension = preferences
m_level = M2
```

保存为 metadata。

---

# 5. Embedding 输入文本规范

## 5.1 默认规则

核心规则：

> **`embedding_text = Label 中的 Segment 原始有效文本`**

只要 Segment 本身语义完整，就不做任何语义改写。

例如：

```text
Segment：
我一般跟朋友一起玩，自己玩的时候比较无聊。
```

直接：

```text
embedding_text：
我一般跟朋友一起玩，自己玩的时候比较无聊。
```

---

## 5.2 为什么默认不改写

Segment 本身是最接近用户原始表达的语义单元。

如果把：

```text
我一般跟朋友一起玩。
```

改成：

```text
用户具有较强的社交游戏偏好。
```

就发生了：

```text
原始表达
    ↓
模型解释
    ↓
Embedding
```

这样向量已经不再纯粹表示 Segment。

正确方式：

```text
原始 Segment
    ↓
Embedding
```

---

# 6. Context 的使用规则

## 6.1 默认不增加 Context

如果 Segment 脱离 Label 结构后仍然可以理解：

```text
embedding_text = segment.text
```

不添加任何上下文。

---

## 6.2 只有语义无法独立理解时才允许补充

例如：

```text
这个我不喜欢。
```

如果没有上下文无法知道"这个"是什么，可以使用 Label 中已经存在的明确上下文进行最小消歧。

例如：

```text
排位匹配：这个我不喜欢。
```

---

## 6.3 Context 来源优先级

允许使用的上下文按照以下优先级：

```text
1. Segment 自身已有文本
        ↓
2. Label 中明确记录的 Segment Context
        ↓
3. 同一 Segment 的明确标签信息
        ↓
4. 原始数据中与该 Segment 直接对应的上下文
```

不允许：

```text
Profile Statement
```

作为默认 Context 来源。

---

## 6.4 Profile 不得反向改写 Segment

例如：

```text
Segment：
我一般跟朋友一起玩。
```

Profile：

```text
用户具有较强社交游戏偏好。
```

不得生成：

```text
embedding_text：
用户具有较强社交游戏偏好，并且一般跟朋友一起玩。
```

因为这已经把 Profile 层的抽象信息注入了 Segment。

---

# 7. 语义保真规则

Embedding_text 如果不是 Segment 原文，则必须保证：

> **新增的内容只用于消歧，不得改变原 Segment 的语义。**

---

## 7.1 程度必须保留

```text
非常喜欢
比较喜欢
有点喜欢
不太喜欢
```

不得统一成：

```text
喜欢
```

---

## 7.2 频率必须保留

```text
偶尔
有时候
通常
经常
总是
很少
从不
```

例如：

```text
偶尔和朋友玩。
```

不得：

```text
和朋友玩。
```

---

## 7.3 时间必须保留

```text
以前
现在
最近
曾经
一直
已经
```

例如：

```text
以前很喜欢竞技游戏，现在很少玩了。
```

不得：

```text
喜欢竞技游戏。
```

---

## 7.4 条件必须保留

```text
如果朋友在线，我一般会玩。
```

不得：

```text
我一般会玩。
```

---

## 7.5 否定必须保留

```text
我不喜欢跟陌生人组队。
```

不得：

```text
我喜欢组队。
```

---

## 7.6 数值必须保留

```text
每周玩 3–5 次。
```

不得：

```text
经常玩。
```

---

## 7.7 因果必须保留

```text
因为匹配等待时间太长，所以我经常退出。
```

不得：

```text
我经常退出。
```

---

## 7.8 转折必须保留

```text
虽然画面很好，但是我还是不喜欢。
```

不得：

```text
我不喜欢。
```

---

## 7.9 比较关系必须保留

```text
我觉得合作模式比竞技模式更轻松。
```

不得：

```text
我喜欢合作模式。
```

---

## 7.10 情境关系必须保留

例如：

```text
输了两三局以后，我就不太想继续玩。
```

不得：

```text
我不想继续玩。
```

因为前者包含明确触发条件。

---

# 8. Label 与 Metadata

## 8.1 Label 不等于 embedding_text

这是本规范的核心规则之一。

例如：

```json
{
  "text": "我一般跟朋友一起玩。",
  "m_level": "M2",
  "dimension": "preferences",
  "trait_type": "social_preference"
}
```

推荐：

```text
embedding_text:
我一般跟朋友一起玩。
```

Metadata：

```json
{
  "m_level": "M2",
  "dimension": "preferences",
  "trait_type": "social_preference"
}
```

---

## 8.2 不推荐结构化标签前缀

不推荐：

```text
M2 | preferences | social_preference | 我一般跟朋友一起玩。
```

原因：

M层和数据库分类属于：

> **结构化信息**

而不是 Segment 的自然语言语义。

---

## 8.3 不为了召回增加同义词

禁止：

```text
喜欢 FPS
```

改成：

```text
喜欢 FPS、第一人称射击游戏以及各类竞技射击游戏。
```

除非原 Segment 本身明确包含这些内容。

---

# 9. M1–M5 的处理

M1–M5 应作为 metadata 保存。

例如：

```json
{
  "segment_id": "P006_023",
  "m_level": "M2"
}
```

不要：

```text
embedding_text：
M2 偏好：我一般跟朋友一起玩。
```

原因：

M1–M5 是分析框架，不是用户原始表达。

---

# 10. Profile 与 Segment Embedding 的关系

## 10.1 Profile 不参与 Segment Embedding 生成

Profile 可以在之后引用 Segment：

```text
Profile Trait
    ↓
evidence_ids
    ↓
segment_id
    ↓
segment_embedding
```

但：

```text
Profile
    ↓
embedding_text
```

不是本规范的流程。

---

## 10.2 一个 Profile 可以对应多个 Segment Embedding

例如：

```text
Profile Trait T001
    ├── S001
    ├── S014
    ├── S032
    └── S087
```

对应：

```text
T001
 ├── E_S001
 ├── E_S014
 ├── E_S032
 └── E_S087
```

---

## 10.3 Profile 修改不必导致 Segment Embedding 重算

如果：

```text
Profile Statement 改变
```

但：

```text
Label Segment 没有改变
```

则：

> **Segment Embedding 不需要重新生成。**

这可以避免 Profile 更新导致整个 Evidence Embedding 层重复计算。

---

# 11. 空值、无效 Segment 与边界情况

## 11.1 空 Segment

以下不生成 Embedding：

```text
null
""
纯空白
纯标点
纯占位符
纯系统噪声
```

例如：

```text
...
嗯嗯
[笑]
[沉默]
```

是否属于有效 Segment，应以 Label / Clean 阶段的最终结果为准。

Embedding 不重新制定清洗标准。

---

## 11.2 已被 Label 判定为有效的短 Segment

例如：

```text
好。
```

如果 Label 阶段已经判定其为有效语义 Segment：

> 不因为字数短而自动删除。

Embedding 阶段不应该重新进行语义价值判断。

---

## 11.3 低置信度 Segment

低置信度不自动删除。

例如：

```text
confidence = 0.42
```

仍可以生成：

```text
embedding
```

同时保存：

```text
confidence = 0.42
```

是否过滤由 Retrieval / Analysis 层决定。

---

# 12. 极长 Segment

如果 Segment 超过模型最大输入长度：

### 原则 1

Embedding 阶段不重新拆分。

### 原则 2

优先检查 Label / Clean 阶段是否存在 Segment 过长问题。

### 原则 3

如果确认该 Segment 本身就是不可拆分的完整语义单元，则按照 Embedding Model 的合法截断策略处理。

必须记录：

```json
{
  "truncated": true
}
```

禁止静默截断。

---

# 13. Embedding 模型与向量规范

## 13.1 主模型

推荐：

```text
BAAI/bge-m3
```

理由：

* 支持中文
* 支持英文
* 支持多语言
* 适合语义检索
* 1024 维
* 适合当前访谈数据场景

---

## 13.2 备选模型

可以使用：

```text
BAAI/bge-large-zh-v1.5
```

但如果数据包含较多英文或需要跨语言检索：

> 优先使用 bge-m3。

---

## 13.3 模型一致性

同一个向量索引中的：

```text
写入模型
查询模型
```

必须一致。

不能：

```text
写入：bge-m3
查询：bge-large-zh-v1.5
```

---

## 13.4 向量维度

bge-m3：

```text
1024
```

数据库必须与实际模型维度保持一致。

---

## 13.5 归一化

推荐：

```python
normalize_embeddings=True
```

统一使用 L2 normalization。

---

## 13.6 距离

推荐：

```text
Cosine Similarity
```

如果使用 pgvector：

```sql
vector_cosine_ops
```

---

# 14. 输出数据结构

## 14.1 单个 Embedding Unit

推荐：

```json
{
  "embedding_id": "E_P006_023",
  "segment_id": "P006_023",
  "respondent_id": "R001",

  "source_file": "座谈会笔录-G2.json",

  "embedding_text": "我一般跟朋友一起玩，自己玩的时候比较无聊。",

  "dimension": "preferences",
  "trait_type": "social_preference",
  "m_level": "M2",

  "label_ids": [
    "L_P006_023"
  ],

  "profile_trait_ids": [
    "T_R001_012"
  ],

  "confidence": 0.94,

  "embedding_model": "BAAI/bge-m3",
  "embedding_version": "v3.0",
  "dimension_size": 1024,
  "normalized": true,

  "truncated": false,

  "embedding": [
    0.0123,
    -0.0234
  ],

  "created_at": "2026-08-28T07:00:00Z"
}
```

---

# 15. Metadata 字段规范

| 字段                  | 必须 | 说明                 |
| ------------------- | -: | ------------------ |
| `embedding_id`      |  ✅ | Embedding 唯一 ID    |
| `segment_id`        |  ✅ | Label 中 Segment ID |
| `respondent_id`     |  ✅ | Respondent ID      |
| `source_file`       |  ✅ | 原始来源文件             |
| `embedding_text`    |  ✅ | 实际送入模型的文本          |
| `dimension`         |  否 | Label 中的维度         |
| `trait_type`        |  否 | Label 中的 Trait 类型  |
| `m_level`           |  否 | M1–M5              |
| `label_ids`         |  否 | Label ID           |
| `profile_trait_ids` |  否 | 后续 Profile 关联      |
| `confidence`        |  否 | 上游置信度              |
| `embedding_model`   |  ✅ | 模型名称               |
| `embedding_version` |  ✅ | Embedding 规范版本     |
| `dimension_size`    |  ✅ | 向量维度               |
| `normalized`        |  ✅ | 是否归一化              |
| `truncated`         |  ✅ | 是否发生截断             |
| `embedding`         |  ✅ | 向量                 |
| `created_at`        |  ✅ | 创建时间               |

---

# 16. 文件组织

推荐：

```text
data/
├── raw/
├── clean/
├── label/
├── profile/
└── embedding/
```

其中：

```text
data/label/
```

是 Segment Embedding 的输入。

```text
data/embedding/
```

是 Segment Embedding 的输出。

---

## 16.1 推荐文件

例如：

```text
data/
├── label/
│   └── labeled_segments.json
│
├── profile/
│   └── respondent_profiles.json
│
└── embedding/
    └── segment_embeddings.json
```

如果数据量较大，可以使用：

```text
data/embedding/
├── metadata.jsonl
└── vectors.npy
```

生产环境推荐：

```text
PostgreSQL + pgvector
```

而 JSON 作为交换 / 调试 / 备份格式。

---

# 17. 数据库存储

推荐：

```sql
CREATE TABLE segment_embeddings (
    embedding_id      TEXT PRIMARY KEY,

    segment_id        TEXT NOT NULL UNIQUE,

    respondent_id     TEXT NOT NULL,

    source_file       TEXT NOT NULL,

    embedding_text    TEXT NOT NULL,

    dimension         TEXT,
    trait_type        TEXT,
    m_level           TEXT,

    label_ids         TEXT[],
    profile_trait_ids TEXT[],

    confidence        REAL,

    embedding_model   TEXT NOT NULL,
    embedding_version TEXT NOT NULL,

    dimension_size    INTEGER NOT NULL,

    normalized        BOOLEAN NOT NULL DEFAULT TRUE,

    truncated         BOOLEAN NOT NULL DEFAULT FALSE,

    embedding         vector(1024) NOT NULL,

    created_at        TIMESTAMPTZ DEFAULT now()
);
```

---

# 18. HNSW 索引

推荐：

```sql
CREATE INDEX segment_embedding_hnsw_idx
ON segment_embeddings
USING hnsw (embedding vector_cosine_ops)
WITH (
    m = 16,
    ef_construction = 64
);
```

实际参数应根据：

* 数据规模
* 查询速度
* Recall@K
* 内存占用

进行实验调整。

---

# 19. 生成流程

## Step 1：读取 Label 文件

读取所有 Segment：

```text
segment_id
respondent_id
text
source_file
labels
metadata
```

---

## Step 2：验证 Segment

检查：

```text
是否为空？
是否有效？
是否已经生成 embedding？
```

---

## Step 3：确定 embedding_text

默认：

```text
embedding_text = segment.text
```

只有无法独立理解时，才允许最小 Context 补充。

---

## Step 4：批量生成向量

例如：

```python
embeddings = model.encode(
    texts,
    batch_size=32,
    normalize_embeddings=True
)
```

---

## Step 5：建立 ID 映射

确保：

```text
segment_id
        ↕
embedding_id
```

严格一对一。

---

## Step 6：保存 Metadata

保存 Label 中必要字段。

---

## Step 7：写入 Vector Store

写入：

```text
segment_embeddings
```

---

## Step 8：执行完整性检查

验证：

```text
有效 Segment 数
=
Embedding Unit 数
```

以及：

```text
每个 segment_id 最多一个 Embedding
```

---

# 20. 增量更新

## 20.1 新增 Segment

只处理没有 Embedding 的 Segment：

```text
embedding_id 不存在
```

---

## 20.2 Segment 文本发生变化

如果：

```text
segment_id 相同
text 改变
```

必须重新 Embedding。

---

## 20.3 Label 发生变化

如果：

```text
Segment text 不变
Label 改变
```

通常：

> **不需要重新生成向量。**

只更新 metadata。

---

## 20.4 Profile 发生变化

如果：

```text
Profile Statement 改变
```

但：

```text
Segment text 不变
```

不需要重新生成 Segment Embedding。

---

# 21. 什么时候必须全量重嵌

以下情况需要重新生成：

### ① Embedding 模型改变

```text
bge-m3
→
其他模型
```

必须全量重嵌。

### ② 模型版本发生变化

需要根据实际模型兼容性决定。

### ③ embedding_text 规则改变

例如从：

```text
纯 Segment
```

改成：

```text
Segment + Context
```

需要重新生成。

### ④ 归一化方式改变

需要重新生成。

### ⑤ 向量维度改变

必须重新建表 / 索引。

---

# 22. 版本管理

建议：

```json
{
  "embedding_version": "v3.0",
  "embedding_model": "BAAI/bge-m3",
  "dimension_size": 1024,
  "normalized": true
}
```

Embedding 版本应该记录：

```text
规范版本
模型
模型版本
输入文本规则
归一化规则
```

---

# 23. 向量检索规范

## 23.1 基础流程

```text
User Query
    ↓
Query Embedding
    ↓
Vector Search
    ↓
Top-N Segment
    ↓
Metadata Filter
    ↓
Evidence / Profile
```

---

## 23.2 Query 必须使用同一个模型

例如写入：

```text
bge-m3
```

查询也必须：

```text
bge-m3
```

---

## 23.3 Metadata Filter

可以使用：

```text
respondent_id
dimension
trait_type
m_level
confidence
source_file
```

进行过滤。

例如：

```text
Query
+
dimension = preferences
+
m_level = M2
```

---

## 23.4 不要把分类任务强行交给向量

例如：

> 只找 M4 Segment。

优先：

```text
WHERE m_level = 'M4'
```

而不是期待：

```text
Vector Similarity
```

自动区分 M4。

---

# 24. Segment Embedding 与 Profile 聚类

这一点必须特别明确：

> **Segment Embedding 本身不是 Respondent Profile Embedding。**

Segment Embedding：

```text
S001 → V001
S002 → V002
S003 → V003
```

一个 Respondent 会拥有很多向量。

因此不能简单：

```text
所有 Segment Vector
      ↓
直接把每个 Vector 当作一个 Respondent
      ↓
人物聚类
```

否则聚类单位会变成：

> Segment

而不是：

> Respondent。

---

## 24.1 如果未来进行人物聚类

应该另行建立 Respondent-level 表示：

```text
Segment Embeddings
       ↓
Respondent-level aggregation / Profile representation
       ↓
Respondent Vector
       ↓
Clustering
```

或者基于 Profile 构建独立的 Profile Embedding。

但这是**另一份规范**，不属于本 Segment Embedding 规范。

---

# 25. 质量评测

## 25.1 Embedding Coverage

定义：

```text
Coverage =
成功生成 Embedding 的有效 Segment
/
Label 中有效 Segment 总数
```

目标：

> **≥ 99.5%**

---

## 25.2 一对一对应率

必须：

```text
一个 Segment
        ↓
最多一个 Embedding
```

目标：

> **100%**

---

## 25.3 丢失率

检查：

```text
Label Segment
```

是否有：

```text
embedding_id 缺失
```

目标：

> 除明确无效 Segment 外，缺失率接近 0。

---

## 25.4 重复率

检查：

```text
segment_id
```

是否出现多个 Embedding。

目标：

> **0%**

---

## 25.5 文本保真度

检查：

```text
embedding_text
```

是否与：

```text
Label.text
```

保持语义一致。

重点检查：

* 否定
* 程度
* 频率
* 时间
* 条件
* 数值
* 因果
* 转折
* 比较
* 触发条件

---

## 25.6 检索效果

建立 Query Set：

```text
Query
→
Target Segment
```

评估：

```text
Recall@5
Recall@10
MRR
NDCG@K
```

---

# 26. 自动化质量检查

生成完成后必须执行：

```text
1. Label 有效 Segment 数
2. Embedding 数
3. 两者差异
4. segment_id 重复检查
5. segment_id 缺失检查
6. embedding_id 重复检查
7. embedding_text 空值检查
8. embedding dimension 检查
9. model 一致性检查
10. normalization 一致性检查
11. truncated 检查
12. embedding_text 与 Label.text 差异检查
```

---

# 27. 禁止事项

## 27.1 禁止重新拆分

```text
一个 Segment
→
多个 Embedding
```

禁止。

---

## 27.2 禁止重新合并

```text
多个 Segment
→
一个 Embedding
```

禁止。

---

## 27.3 禁止 Profile 注入

禁止：

```text
Segment
+
Profile Statement
→
Embedding
```

---

## 27.4 禁止人格化

```text
我喜欢跟朋友玩。
```

禁止变成：

```text
用户是高度社交型人格。
```

---

## 27.5 禁止心理推断

```text
输了以后不想玩。
```

禁止变成：

```text
用户挫败耐受度低。
```

---

## 27.6 禁止增加因果

```text
我喜欢和朋友一起玩。
```

禁止：

```text
因为用户具有强烈社交需求，所以喜欢和朋友一起玩。
```

---

## 27.7 禁止同义词扩写

```text
喜欢 FPS
```

禁止：

```text
喜欢 FPS、第一人称射击、竞技射击等游戏。
```

---

## 27.8 禁止删除修饰信息

禁止删除：

```text
非常
比较
偶尔
通常
以前
现在
可能
如果
因为
但是
3–5 次
```

---

## 27.9 禁止 Label 污染 embedding_text

禁止：

```text
M2 | Preferences | Social | Segment
```

作为默认 Embedding 输入。

---

## 27.10 禁止 Evidence 重复拼接

如果 Segment 本身就是 Evidence：

```text
embedding_text = Segment
```

无需再次追加：

```text
quote
evidence
source
```

---

## 27.11 禁止因为低 confidence 自动删除

Embedding 阶段不负责质量过滤。

---

## 27.12 禁止修改 Label

Embedding 不得反向修改：

```text
Label
Clean
Raw
Profile
```

---

# 28. 完整执行流程

最终执行流程固定为：

```text
                    RAW
                     │
                     ↓
                   CLEAN
                     │
                     ↓
                    LABEL
                     │
          ┌──────────┴──────────┐
          │                     │
          ↓                     ↓
       PROFILE              EMBEDDING
          │                     │
          ↓                     ↓
   Profile / Trait       Segment Vector
                                │
                                ↓
                          Vector Store
                                │
                  ┌─────────────┼─────────────┐
                  ↓             ↓             ↓
               Retrieval       RAG       Evidence定位
```

---

# 29. 最核心的执行规则

## 铁律 1

> **Embedding 的直接输入文件是 Label 文件。**

## 铁律 2

> **Label 文件中的一个有效 Segment 对应一个 Embedding。**

## 铁律 3

> **Embedding 不重新拆分 Segment。**

## 铁律 4

> **Embedding 不重新合并 Segment。**

## 铁律 5

> **默认 `embedding_text = Label Segment.text`。**

## 铁律 6

> **只有 Segment 无法独立理解时，才允许添加最小必要 Context。**

## 铁律 7

> **Label、M1–M5、Dimension 等默认进入 Metadata，而不是 embedding_text。**

## 铁律 8

> **Profile Statement 不进入 Segment Embedding。**

## 铁律 9

> **Embedding 不重新推断人物特征。**

## 铁律 10

> **程度、频率、时间、否定、条件、数值、因果、转折、比较关系不得丢失。**

## 铁律 11

> **低 confidence 不由 Embedding 阶段自动过滤。**

## 铁律 12

> **每个 Embedding 必须能够通过 `segment_id` 追溯到 Label Segment 及原始证据。**

---

# 30. 最简执行公式

整个规范可以压缩成：

```text
Label Segment
      │
      ↓
有效？
  │       │
  否       是
  │        │
跳过       ↓
       语义完整？
        │      │
       是      否
        │       │
        ↓       ↓
   原始 Segment   +
                 最小必要 Context
        │       │
        └───┬───┘
            ↓
       embedding_text
            ↓
      Embedding Model
            ↓
       一个 Vector
            ↓
      segment_id 绑定
            ↓
       Vector Store
```

最终定义：

> **Segment Embedding = Label 文件中的有效 Segment → 一个独立 embedding。**
>
> **Label 决定 Segment 的结构化上下文，Profile 决定人物级抽象，而 Embedding 只负责把 Segment 表示成向量。三者职责严格分离。**

---

# 31. 附录 A：Profile 接口约定

Profile 可以通过 `segment_id` 引用 Segment：

```json
{
  "trait_id": "T_R001_012",
  "statement": "偏好与朋友一起进行游戏。",
  "evidence_ids": [
    "P006_023",
    "P006_031",
    "P006_087"
  ]
}
```

对应：

```text
T_R001_012
    │
    ├── P006_023 → E_P006_023
    ├── P006_031 → E_P006_031
    └── P006_087 → E_P006_087
```

因此：

> **Profile 是 Segment Embedding 的消费者之一，而不是 Segment Embedding 的输入。**

---

# 32. 附录 B：字段来源约定

| Embedding 字段        | 来源                         |
| ------------------- | -------------------------- |
| `embedding_id`      | Embedding Pipeline         |
| `segment_id`        | Label                      |
| `respondent_id`     | Label                      |
| `source_file`       | Label / 上游                 |
| `embedding_text`    | Label Segment + 必要 Context |
| `dimension`         | Label                      |
| `trait_type`        | Label                      |
| `m_level`           | Label                      |
| `label_ids`         | Label                      |
| `profile_trait_ids` | Profile 建立后关联              |
| `confidence`        | Label / 上游                 |
| `embedding_model`   | Embedding Pipeline         |
| `embedding_version` | Embedding Pipeline         |
| `dimension_size`    | Embedding Model            |
| `normalized`        | Embedding Pipeline         |
| `truncated`         | Embedding Pipeline         |
| `embedding`         | Embedding Model            |

---

# 33. 附录 C：一句话版本

> **从 Label 文件读取每一个有效 Segment，以 Segment 原文为默认 embedding_text，不重新拆分、不合并、不推断、不 Profile 化；每个 Segment 独立生成一个向量，Label/M1–M5/Dimension 等作为 metadata 保存，并通过 segment_id 与原始证据及后续 Profile 建立可追溯关系。**

---

# 34. 版本历史

| 版本   | 日期         | 变更                                                                                                                                                                                |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v3.0 | 2026-08-28 | 重构为真正的 Segment-level Embedding；明确 Label 文件为直接输入；确立一个 Segment 一个 Embedding；明确 Label/Profile/Embedding 职责边界；取消 Profile Statement 作为 Embedding 输入；增加 Context、Metadata、版本、增量更新及质量评测规范 |
| v2.0 | 2026-08-27 | 原为 Statement-level Embedding 方案                                                                                                                                                   |
| v1.0 | 2026-08-13 | Segment-level 初版                                                                                                                                                                  |