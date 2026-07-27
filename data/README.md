# data/

存放访谈数据处理的中间产物和参考文件。处理流程和字段规范见 `docs/数据处理计划.md`。

## 目录说明

**`segments_cleaned/`** — 第一轮自动化提取的结果（66 个 docx + 2 个 xlsx），覆盖全部来源文件。但这批数据处理时尚未定稿 schema，字段和现在的 `source_segments` 表不对齐，且未经人工核对，**只能作为参考，不能直接入库使用**。

**`sheets_data/`** — xlsx 文件中两个已核实 sheet（"玩家行为&乐趣整理"、"经验认知乐趣对比"）的提取结果，字段已对齐当前 schema.ts：
- `respondents_用户记录表.json`：P1-P13 的人物级别背景信息（对齐 `respondents` 表）
- `segments_玩家行为乐趣整理.json`：365 条发言记录
- `segments_经验认知乐趣对比.json`：90 条发言记录

xlsx 中其余 sheet 及第二个 xlsx（生存撤离类）尚未提取。

**`group_definitions.json`** — G1/G2/G3 组别定义，从"样本条件（中英）"sheet 抽出，供关联查询用。

**`segments_stats.md`**（如存在）— 基于第一轮不完善处理计算的统计数据，已失去参考意义，忽略。
