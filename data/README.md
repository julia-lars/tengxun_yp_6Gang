# data/

存放访谈数据处理的中间产物和参考文件。处理流程和字段规范见 `docs/数据处理计划.md`。

## 目录说明

**`segments_cleaned/`** — 第一轮自动化提取的结果（66 个 docx + 2 个 xlsx），覆盖全部来源文件。但这批数据处理时尚未定稿 schema，字段和现在的 `source_segments` 表不对齐，且未经人工核对，**只能作为参考，不能直接入库使用**。

**`sheets_data/`** — `枪战类长线新手体验研究/用户记录表.xlsx` 中已核实 sheet 的提取结果，字段已对齐当前 `schema.ts`。详见下一节。

**`group_definitions.json`** — G1/G2/G3 组别定义，从"样本条件（中英）"sheet 抽出。**注意其适用范围有限，见下方"组别代号的坑"。**

**`segments_stats.md`**（如存在）— 基于第一轮不完善处理计算的统计数据，已失去参考意义，忽略。

---

## sheets_data/ 的内容

这个 workbook 里其实装了**两批完全不同的受访者**，处理时按批次区分：

| 批次 | 受访者 | 被测游戏 | 测试时间 |
|---|---|---|---|
| **EFT** | P1-P13，塔科夫老玩家（美国） | 逃离塔科夫 / DMZ 等 | — |
| **ABIvsDF** | P1-P8，枪战类玩家（国内，CS/瓦/PUBG/CF 背景） | 三角洲行动 / 暗区突围 | 2024-08-26 ~ 08-30 |

两批的 `speaker_id` 都是 P1、P2… 但**编号撞车纯属巧合，不是同一批人**。

### 产出文件

| 文件 | 条数 | 对齐表 | 来源 sheet |
|---|--:|---|---|
| `segments_用户记录表_玩家行为乐趣整理.json` | 365 | `source_segments` | 玩家行为&乐趣整理 |
| `segments_用户记录表_经验认知乐趣对比.json` | 90 | `source_segments` | 经验认知乐趣对比 |
| `respondents_用户记录表_经验认知乐趣对比&玩家行为乐趣整理.json` | 13 | `respondents` | 上述两个 sheet 合并 |
| `segments_用户记录表_ABIvsDF记录表.json` | 374 | `source_segments` | ABIvsDF记录表 |
| `respondents_用户记录表_ABIvsDF记录表&特征诉求.json` | 8 | `respondents` | ABIvsDF记录表 + 特征诉求 |
| `analysis_notes_用户记录表_特征诉求.json` | 35 | **不入库** | 特征诉求 |
| `group_definitions.json` | — | 不入库 | 样本条件（中英） |

### `source_file` 用批次级粒度

```
枪战类长线新手体验研究/用户记录表.xlsx#EFT       ← EFT 批，13 人
枪战类长线新手体验研究/用户记录表.xlsx#ABIvsDF   ← ABIvsDF 批，8 人
```

不是 workbook 级（那样两批人会混在一起查出来），也不是 sheet 级（一条 respondent 的背景信息来自多个 sheet，sheet 级会切断它与另一个 sheet 的 segments 的关联）。具体来自哪个 sheet 记在 `annotation.sheet` 里，信息不丢。

因为 `source_file` 已经把两批人分开，`speaker_id` 直接用 P1-P8 / P1-P13，不需要加前缀。`(source_file, speaker_id)` 唯一约束已校验无冲突，829 条 segments 全部能关联到对应 respondent。

### 特征诉求 sheet 为什么不产 segments

该 sheet 逐行核实后的构成：

- 行 1-5：元信息（玩家编号 / 录像链接 / 玩家属性 / 游玩顺序 / 测试时间）→ 进 respondents
- 行 6-7：行为特征、主要诉求的逐人摘要 → 进 respondents
- 行 8-14：**研究员已经下好的结论**（如"P1P2 属于能快速建立游戏目标型"）→ 存进 `analysis_notes_*.json`，**不进 segments**。把结论喂进 `source_segments` 参与画像聚类等于让 AI 去"发现"人已经写好的答案，属于循环论证；留作对照/验证材料
- 行 16-29 / 38-49：DF / ABI 的 UX 缺陷清单（序号 + 环节模块 + 问题描述），产品侧问题，无 speaker 归属，与玩家画像任务无关 → **舍弃，不产出**

所以它是**纯 respondents 来源**，segments 贡献为 0。

⚠️ **`analysis_notes_*.json` 里的编号不是玩家编号。** 那些 `1. 2. 3.` 是类型序号，每条后面自己挂着对应哪些玩家，已解析进 `mentioned_speaker_ids`：

```
1.→P1P2   2.→P3P7   3.→P6   4.→P7   5.→P6   6.→P4
```

P6 出现两次，P5/P8 一次没出现。**不要按 1↔P1 的位置映射去理解**（8 条里会错 6 条）。同理，行 9 的"可能的原因 1.-6."、行 12-14 的编号完全没有玩家标记，是设计问题归因，不是玩家清单。

### annotation 字段约定

- **值为 null 的键不输出**，不写 null 占位
- `games` / `game_codes`：游戏名用中文全名（`三角洲行动` / `暗区突围` / `逃离塔科夫`），原始代号留在 `game_codes` 便于回溯。测试后访谈（行 48-62）是逐条对比两款游戏，所以 `games` 是两个元素；测试前的过往经验摸底与被测游戏无关，`games` 是空列表（区别于"未知"）
- `category_l1` / `category_l2` / `session_order`：三个 sheet 共用同一套字段名。`session_order` 表示同一场景的第几轮对局（零号大坝、农场各测两轮）
- ~~`round_label`~~：已废弃。原是"玩家行为&乐趣整理"的专用字段（值形如 `EFT - PVE - R1`），套到 ABIvsDF 上会大量为 null，且同时承载"地图+轮次"和"观察第几轮"两种语义，已拆成 `category_l1` + `session_order`
- `speaker_role`：观察员（星宇）补充笔记是"关于该玩家"的行为观察而非玩家原话，标 `moderator`，但保留 `speaker_id` 以便按玩家检索其行为证据，`annotation.type = observer_note` 标明来源

### 组别代号的坑

`group_definitions.json` 来自"样本条件（中英）"sheet，定义的是**美国受访者 + 逃离塔科夫**（如 G2 初学组要求"近 1 年内开始玩塔科夫、累计 100-500h"）。

**它只适用于 EFT 批，不适用于 ABIvsDF 批。** ABIvsDF 批是中国玩家，核对其"EFT品类游戏经验摸底"（ABIvsDF记录表 行 7）后确认：4 个 G2 里 P3「听说过塔科夫…不想了解」、P5「听过塔科夫」、P6「听过塔科夫，没玩过」，**没有一个符合初学组条件**。该批的 G1/G2 是另一套批次内部编号，已在 respondents 的 `background.group_code_scope` 里显式标注，查询时不要跨批次比较。

组别代号带不确定标记的（如 EFT 批 P7 的 `G3?`）原样保留，不抹平成确定值。

---

## 提取脚本

xlsx 提取脚本放在各自的本地工作目录，**不纳入版本管理**（避免 openpyxl 依赖和中间缓存影响组内其他成员）。每个 sheet 一个专用脚本，行号→类目的映射在脚本头部注释里逐行记录核对结论。需要重跑或核对映射依据时找对应的处理人。

ABIvsDF 批产出已做的校验：

- 374 个有效单元格 ↔ 374 条 segments 一一对应（唯一被过滤的是一个 `-` 占位符单元格）
- 每条的 `annotation` 与其所在行的 A/B 列自洽，0 处不一致
- 观察员笔记的游戏归属用"游玩顺序"和笔记首行标签（如`【P3瓦DF】`）双向交叉验证，14 格全部一致
- `(source_file, speaker_id)` 唯一约束无冲突；829 条 segments 全部能关联到对应 respondent

---

## 尚未处理

- `生存撤离类新手引导体验研究/整合记录表.xlsx` —— 结构未逐格核实，处理前需重复"合并单元格 + 分类列"的人工核实步骤，不要直接照搬枪战类的列位置假设
- 用户记录表.xlsx 剩余 sheet：`用户列表`（受访者背景，需先确认与哪一批 P 编号对应）、`访谈大纲（中文）` / `Manuscript (EN)` / `ABIvsDF新手访谈大纲`（大纲性质，无被访者回应）、`研究计划` / `测试安排`（内部规划，不处理）
