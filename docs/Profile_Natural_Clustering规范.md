# Profile Natural Clustering 规范 v1.0

> **版本**：v1.0
> **日期**：2026-08-28
> **状态**：执行版
> **前置依赖**：`Profile_Embedding规范.md`（Profile Embedding 已完成）、`用户画像Profile生成规范.md`（Profile 已完成）、`画像假设.md`（画像假设已完成）
> **用途**：基于已完成的 Respondent Profile Embedding，自动发现自然形成的人群 Cluster，并通过 Profile/Trait 对聚类结果进行验证、解释和定型。
> **关联文档**：`聚类方案研究.md`（v1.1，Label-based 聚类方案，与本规范互补）

---

# 一、总体目标

本方案的目标不是预先指定：

> "我要把 1039 个 Respondent 分成 5 类。"

而是：

> **从 Respondent Profile Embedding 的几何结构中发现自然存在的群体结构，并使用 Profile 中已经提取的 Trait 对其进行独立验证。**

最终输出：

```text
Respondent
    ↓
Profile
    ↓
Profile Embedding
    ↓
Natural Clustering
    ↓
Cluster Candidate
    ↓
Cluster Validation
    ↓
Cluster Interpretation
    ↓
Final Natural Cluster
```

---

# 二、数据前提

当前系统已有：

```text
data/
├── clean/
├── label/
├── profile/
└── embed/
    └── profiles/
```

其中：

```text
data/embed/profiles/
```

包含：

- 14 个 Profile Embedding 文件
- 1039 个有效 Respondent Embedding
- 20 个无 Trait 的空 Profile
- 1024 维向量
- L2 normalized

因此：

```text
有效聚类样本 = 1039
无有效 Profile = 20
```

20 个空 Profile：

> **不得参与聚类。**

但必须保留其排除记录。

---

# 三、聚类对象

聚类单位必须是：

> **Respondent**

而不是：

- segment
- utterance
- statement
- Trait
- Profile 字段
- 研究项目

即：

```text
1 Respondent
        ↓
1 Profile Embedding
        ↓
1 Cluster assignment
```

最终：

```text
R001 → Cluster 03
R002 → Cluster 01
R003 → Cluster 03
...
```

---

# 四、Embedding 是唯一的聚类输入

正式聚类阶段：

> **不得重新从原始访谈文本生成聚类输入。**

输入来源必须是：

```text
data/embed/profiles/
```

使用已有的 Profile Embedding。

禁止：

```text
原始 transcript → clustering
Label → clustering
单个 statement embedding → clustering
Profile 文本重新拼接 → clustering
```

原因是：

> Cluster 的对象已经定义为"人物 Profile"，因此聚类空间必须由 Profile Embedding 决定。

---

# 五、Embedding 一致性检查

正式聚类之前必须执行：

### 1. 维度检查

所有向量必须：

```text
dimension = 1024
```

发现其他维度：

```text
ERROR
```

不得自动修复。

---

### 2. NaN / Inf 检查

禁止存在：

```text
NaN
Inf
-null
```

发现后：

```text
ERROR
```

---

### 3. L2 Norm 检查

检查：

```text
||embedding||₂ ≈ 1
```

允许微小浮点误差。

明显不符合：

```text
ERROR
```

---

### 4. Respondent ID 唯一性

必须保证：

```text
respondent_id
```

唯一。

重复：

```text
ERROR
```

不得静默覆盖。

---

### 5. Profile ↔ Embedding 对齐

必须检查：

```text
Profile respondent_id
        ↕
Embedding respondent_id
```

确保每个 embedding 都可以追溯到唯一 Profile。

---

# 六、距离度量

由于当前 Embedding 已经进行了：

> **L2 normalization**

聚类距离以：

## Cosine Distance

作为标准距离。

定义：

```text
cosine_distance(a,b)
=
1 - cosine_similarity(a,b)
```

对于 L2-normalized vector：

```text
cosine similarity = dot(a,b)
```

因此整个聚类系统统一采用：

> **Cosine similarity / cosine distance**

不得在不同算法之间随意混用：

```text
Euclidean
Manhattan
Cosine
```

否则不同实验无法直接比较。

---

# 七、不要直接把 1024 维压成 2D 聚类

这是一个重要规则。

禁止：

```text
1024D
 ↓
PCA 2D
 ↓
Clustering
```

因为 2D 主要用于：

> visualization

而不是保留完整语义结构。

---

# 八、降维策略

采用两条路径。

## Path A：原始 Embedding

```text
1024D
 ↓
Clustering
```

用于保留完整 Embedding 信息。

---

## Path B：PCA

```text
1024D
 ↓
PCA
 ↓
50D / 100D
 ↓
Clustering
```

PCA 的作用：

- 降低噪声
- 缓解高维距离退化
- 降低计算成本
- 检验聚类结构是否稳定

---

# 九、PCA 参数

至少测试：

```text
PCA-30
PCA-50
PCA-100
```

不允许只测试一个维度后直接定型。

同时记录：

```text
explained_variance_ratio
cumulative_explained_variance
```

---

# 十、核心聚类算法

本方案不采用单一算法。

至少使用：

## 1. HDBSCAN

作为：

> **Primary Natural Clustering Algorithm**

原因：

- 不需要预先指定 Cluster 数量
- 可以识别不同密度的群体
- 可以产生 Noise / Outlier
- 更符合"自然发现 Cluster"的目标

重点参数：

```text
min_cluster_size
min_samples
```

需要进行参数实验。

---

# 十一、HDBSCAN 参数探索

建议测试：

```text
min_cluster_size:
10
20
30
50
75
100
```

以及：

```text
min_samples:
5
10
20
30
50
```

不需要机械组合全部参数。

采用分层实验：

### 第一轮

寻找合理范围。

### 第二轮

在合理范围内细化。

### 第三轮

进行稳定性测试。

---

# 十二、第二核心算法：层次聚类

采用：

> Agglomerative Hierarchical Clustering

主要作用不是替代 HDBSCAN，而是：

> **检查 HDBSCAN 的 Cluster 是否得到另一种聚类方法的支持。**

使用：

```text
cosine distance
```

测试多个：

```text
K
```

例如：

```text
K = 2 ~ 12
```

不代表最终一定选择其中某个 K。

---

# 十三、K-Means 只作为 Baseline

K-Means 不作为最终自然聚类算法。

作用：

> 提供一个简单基准。

测试：

```text
K = 2 ~ 12
```

比较：

```text
Silhouette
Cluster size
Stability
Trait separation
```

如果 K-Means 与 HDBSCAN 得到相似结构：

> 增强可信度。

如果完全不同：

> 需要进一步分析，而不是直接选择某一个。

---

# 十四、最终不允许"算法投票"

例如：

```text
HDBSCAN = 5 clusters
KMeans = 6 clusters
Hierarchical = 7 clusters
```

不能简单说：

> "5、6、7 取平均。"

Cluster 数量不是投票产生的。

最终 Cluster 必须根据：

```text
Embedding structure
+
Stability
+
Separation
+
Internal coherence
+
Trait differentiation
+
Project robustness
```

综合确定。

---

# 十五、聚类评价体系

必须同时使用：

## A. 几何质量

### Silhouette Score

衡量：

> Cluster 内部是否紧密、Cluster 之间是否分离。

---

### Davies-Bouldin Index

越低越好。

---

### Calinski-Harabasz Index

越高通常越好。

---

# 十六、不能只看 Silhouette

例如：

```text
K=2
Silhouette = 0.61
```

可能非常高。

但它可能只是：

> 把整个数据粗暴分成两大半。

而：

```text
K=5
Silhouette = 0.48
```

可能形成了更有业务意义的自然群体。

所以：

> **Silhouette 不是最终裁决指标。**

---

# 十七、Cluster Size 检查

每个 Cluster 必须检查：

```text
size
percentage
```

例如：

```text
Cluster 0    31%
Cluster 1    27%
Cluster 2    19%
Cluster 3    15%
Cluster 4     8%
```

需要重点警惕：

### 极小 Cluster

例如：

```text
3 respondents
```

可能是：

- 真正小众群体
- 噪声
- Embedding 异常
- 数据问题

不能自动删除。

---

# 十八、Noise 处理

HDBSCAN 可能产生：

```text
cluster_id = -1
```

表示：

> Noise / insufficiently assignable

Noise：

**不是错误。**

也不能强行塞进最近 Cluster。

必须保留：

```text
cluster_id = -1
```

并记录：

```text
outlier_score
```

---

# 十九、Cluster 稳定性是核心指标

需要进行：

> Resampling Stability

例如：

```text
原始数据
 ↓
重复抽样
 ↓
重新聚类
 ↓
比较 Cluster membership
```

至少进行：

```text
20~50 次
```

稳定性指标可以采用：

- Adjusted Rand Index
- Adjusted Mutual Information
- Jaccard similarity

---

# 二十、参数稳定性

同一个 Cluster 如果：

```text
min_cluster_size = 30
```

时存在，

而：

```text
min_cluster_size = 35
```

时完全消失，

说明：

> Cluster 不稳定。

反之：

```text
30 → Cluster A
40 → Cluster A
50 → Cluster A
```

说明：

> 结构更加可信。

---

# 二十一、跨算法稳定性

最终 Cluster 应该检查：

```text
HDBSCAN
      ↕
Hierarchical
      ↕
KMeans
```

不是要求三者完全一致。

而是检查：

> 是否存在稳定对应的人群结构。

---

# 二十二、最重要的第二层验证：Profile / Trait

Embedding 聚类完成之后：

> **必须回到 Profile。**

因为 Embedding 只能告诉我们：

> 谁和谁相似。

它不能告诉我们：

> 为什么相似。

---

# 二十三、Trait Cluster Analysis

对每一个 Cluster：

```text
Cluster X
 ↓
获取所有 Respondent
 ↓
读取其 Profile
 ↓
读取 Trait
 ↓
统计 Trait 分布
```

计算：

```text
Cluster Trait Frequency
vs
Global Trait Frequency
```

---

# 二十四、Trait Lift

例如：

```text
Trait A

Cluster 03 = 72%
Global = 31%
```

计算：

```text
Lift = 72% / 31%
     = 2.32
```

Lift 越高：

> Trait 越具有 Cluster 区分性。

---

# 二十五、Trait 不只看频率

至少分析：

```text
frequency
lift
effect size
significance
```

如果 Trait 是分类变量，可以进一步使用：

```text
Chi-square
Fisher's exact test
```

但统计显著性不能单独决定 Cluster 是否成立。

---

# 二十六、Cluster 的核心 Trait

最终每个 Cluster 应至少得到三种 Trait：

### Core Trait

Cluster 内高频且稳定。

### Distinctive Trait

Cluster 相比全体明显更高。

### Shared Trait

Cluster 内存在，但并不能区分该 Cluster。

---

# 二十七、必须寻找"反向证据"

不能只寻找：

> Cluster A 有什么。

还必须寻找：

> Cluster A 缺少什么。

例如：

```text
Cluster A
高：探索欲
高：效率导向

低：社交需求
低：稳定偏好
```

这种：

> **presence + absence**

比单纯的高频 Trait 更能定义 Cluster。

---

# 二十八、Cluster 间差异分析

每两个 Cluster：

```text
Cluster A
vs
Cluster B
```

计算：

```text
Embedding centroid distance
Trait distribution difference
```

找出：

> 最能区分 A / B 的 Trait。

最终可以生成：

```text
A vs B
----------------
A：效率导向
B：体验导向

A：低探索
B：高探索
```

---

# 二十九、Cluster Centroid

每个 Cluster 保存：

```text
centroid
```

即：

```text
mean embedding
```

之后可以用于：

- 新 Respondent 分类
- 最近 Cluster 查询
- 相似人群搜索
- Cluster retrieval

---

# 三十、新 Respondent 的归属

未来如果出现新 Respondent：

```text
New Profile
 ↓
Embedding
 ↓
与 Cluster centroid 比较
 ↓
Candidate Cluster
```

但：

> 不建议仅使用 centroid distance 就宣称其属于某 Cluster。

应结合：

```text
distance
+
Cluster density
+
Trait compatibility
```

进行判断。

---

# 三十一、Cluster 不应该命名得太早

算法刚产生：

```text
Cluster 0
Cluster 1
Cluster 2
```

时不要立即命名：

```text
效率型玩家
探索型玩家
社交型玩家
```

正确流程：

```text
Cluster
 ↓
Trait Analysis
 ↓
Representative Respondents
 ↓
Cluster Interpretation
 ↓
Human-readable Label
```

---

# 三十二、Representative Respondents

每个 Cluster 选择：

```text
3~10 个 representative respondents
```

依据：

> 距离 Cluster centroid 最近。

同时可以选择：

```text
medoid
```

而不是随机选择。

这样人工审核 Cluster 时更容易。

---

# 三十三、Cluster Outlier

同时选择：

```text
Cluster 内距离 centroid 最远的 respondents
```

用于检查：

> Cluster 是否实际上混入了不同类型的人。

---

# 三十四、跨项目检查

你有：

> 14 个研究项目。

所以必须保留：

```text
project_id
```

并分析：

```text
Cluster × Project
```

例如：

```text
             P1   P2   P3   P4
Cluster A    30   21   18   25
Cluster B    12   40   22   19
Cluster C    28   19   31   17
```

---

# 三十五、项目偏差警告

如果：

```text
Cluster A
95% respondents
来自 Project 03
```

必须标记：

> **Project concentration warning**

因为这个 Cluster 可能反映：

> 项目差异

而不是真正的：

> 跨项目人物类型。

---

# 三十六、最终 Cluster 接受标准

一个 Cluster 不应该仅因为：

> 算法产生了它

就成为 Final Cluster。

建议至少满足：

### ① 几何上存在

Embedding 空间中具有一定内部凝聚性。

### ② 与其他 Cluster 有区别

存在稳定边界或明显距离。

### ③ 对参数不敏感

轻微参数变化不会完全消失。

### ④ 重采样稳定

多次抽样后结构仍然存在。

### ⑤ Profile 可解释

能够找到一致的 Trait 模式。

### ⑥ 不是纯项目效应

不能完全由某一个研究项目解释。

---

# 三十七、最终 Cluster 状态

每个 Cluster 设置：

```text
status
```

例如：

```text
confirmed
candidate
unstable
noise
```

---

# 三十八、建议的判定逻辑

### Confirmed

```text
几何结构稳定
+
重采样稳定
+
Trait 可解释
+
跨项目合理
```

### Candidate

```text
有结构
+
部分稳定
+
解释性一般
```

### Unstable

```text
参数敏感
或
重采样不稳定
```

### Noise

```text
无法可靠归入任何 Cluster
```

---

# 三十九、目录结构

建议最终：

```text
data/
├── clean/
├── label/
├── profile/
├── embed/
│   └── profiles/
│
└── cluster/
    │
    ├── experiments/
    │   ├── experiment_001/
    │   ├── experiment_002/
    │   └── ...
    │
    ├── assignments/
    │   └── natural_clusters.json
    │
    ├── summaries/
    │   ├── cluster_000.json
    │   ├── cluster_001.json
    │   └── ...
    │
    ├── validation/
    │   ├── clustering_metrics.json
    │   ├── stability.json
    │   ├── trait_analysis.json
    │   └── project_analysis.json
    │
    └── visualization/
        ├── pca.html
        └── umap.html
```

---

# 四十、最终 Assignment Schema

建议：

```json
{
  "respondent_id": "R001",
  "project_id": "P003",
  "cluster_id": 4,
  "cluster_status": "confirmed",
  "membership_strength": 0.87,
  "outlier_score": 0.08
}
```

---

# 四十一、Cluster Summary Schema

```json
{
  "cluster_id": 4,
  "status": "confirmed",
  "size": 183,
  "percentage": 0.176,
  "centroid": [],
  "core_traits": [],
  "distinctive_traits": [],
  "shared_traits": [],
  "representative_respondents": [],
  "outlier_respondents": [],
  "project_distribution": {},
  "validation": {
    "silhouette": 0.42,
    "stability": 0.91
  }
}
```

---

# 四十二、实验记录必须可重建

每次实验必须记录：

```text
embedding source
embedding model
embedding dimension
distance metric
PCA dimension
clustering algorithm
algorithm version
parameters
random seed
sample count
excluded count
metrics
timestamp
code version
```

核心原则：

> **任何一个最终 Cluster 都必须能够重新运行得到。**

---

# 四十三、禁止事项

正式系统中禁止：

### ❌ 人工指定 Cluster 数量作为唯一依据

### ❌ 直接 PCA 2D 后聚类

### ❌ 强迫 Noise 进入 Cluster

### ❌ 只根据 Silhouette 选结果

### ❌ 只根据 Trait 手工分组

### ❌ 根据 Cluster 大小强行拆分/合并

### ❌ 聚类后修改 Embedding

### ❌ 为了得到"好看的 Cluster"反复调参数

### ❌ 把 Cluster 名称反过来影响 Cluster assignment

### ❌ 混淆 Project 与 Cluster

---

# 四十四、推荐的实际执行顺序

最终 Claude Code 应按照下面顺序执行：

```text
STEP 01
读取 14 个 Profile Embedding 文件
        ↓
STEP 02
合并 1039 个有效 Respondent
        ↓
STEP 03
执行 Embedding integrity check
        ↓
STEP 04
建立 respondent ↔ profile ↔ project mapping
        ↓
STEP 05
计算基础距离统计
        ↓
STEP 06
1024D HDBSCAN baseline
        ↓
STEP 07
PCA 30/50/100
        ↓
STEP 08
PCA + HDBSCAN parameter search
        ↓
STEP 09
Hierarchical clustering
        ↓
STEP 10
K-Means baseline
        ↓
STEP 11
计算 clustering metrics
        ↓
STEP 12
稳定性实验
        ↓
STEP 13
选择 Cluster candidate
        ↓
STEP 14
回读 Profile
        ↓
STEP 15
Trait distribution analysis
        ↓
STEP 16
Cluster differentiation analysis
        ↓
STEP 17
Project concentration analysis
        ↓
STEP 18
确定 confirmed / candidate / unstable
        ↓
STEP 19
生成 Cluster Summary
        ↓
STEP 20
生成最终 assignments
```

---

# 四十五、最终产物

最终应该得到四个核心结果。

### ① Respondent Cluster Assignment

回答：

> **这个人属于哪个 Cluster？**

---

### ② Cluster Summary

回答：

> **这个 Cluster 是什么？**

---

### ③ Cluster Validation

回答：

> **为什么相信这个 Cluster？**

---

### ④ Cluster Visualization

回答：

> **这些 Cluster 在 Embedding 空间中是什么关系？**

---

# 四十六、整个系统的最终逻辑

你现在的系统可以正式形成：

```text
                    ┌──────────────┐
                    │ Raw Interview│
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │    Clean     │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │    Label     │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │   Profile    │
                    └──────┬───────┘
                           ↓
                    ┌──────────────┐
                    │   Embedding  │
                    │  1039×1024   │
                    └──────┬───────┘
                           ↓
                ┌─────────────────────┐
                │ Natural Clustering  │
                └──────────┬──────────┘
                           ↓
             ┌─────────────┴─────────────┐
             ↓                           ↓
      Embedding Validation          Profile Validation
             ↓                           ↓
      Stability / Distance          Trait Analysis
             │                           │
             └─────────────┬─────────────┘
                           ↓
                    ┌──────────────┐
                    │ Final Cluster│
                    └──────┬───────┘
                           ↓
                 Natural User Segments
```

## 我对你这套数据最推荐的最终方案

**不要把目标定义成"跑一个聚类算法"。**

应该定义成：

> **多算法候选发现 → 稳定性筛选 → Embedding 几何验证 → Profile/Trait 独立解释 → 跨项目偏差检查 → Final Cluster。**

尤其是你已经有 **Profile + Trait + Profile Embedding** 三层数据，这意味着你完全可以把**"Embedding 负责发现、Profile 负责解释、Trait 负责验证"**作为整个聚类系统的核心架构。

这样做出来的 Cluster 才不是一个黑盒算法标签，而是后续可以直接用于**用户分群、相似人物检索、问题检索和新 Respondent 归类**的结构化数据。