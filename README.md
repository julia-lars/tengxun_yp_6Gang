# 6Gang 项目计划

> 射击品类 AI 模拟用户系统 · MUR × 北大元培

## 本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/julia-lars/tengxun_yp_6Gang.git
cd tengxun_yp_6Gang

# 2. 装依赖（需要 Bun：curl -fsSL https://bun.sh/install | bash）
bun install

# 3. 启动 PostgreSQL（二选一）
# 方式 A — Docker（推荐）
bun run db:up
# 方式 B — Homebrew
brew install postgresql@16 pgvector
brew services start postgresql@16
createuser -s dev && createdb -O dev webtutor

# 4. 初始化数据库
bun run db:migrate
bun run db:seed-personas   # 灌入示例画像

# 5. 配置 API Key（用研经理提供）
echo 'DEEPSEEK_API_KEY=sk-xxx' > apps/api/.env

# 6. 启动
bun run dev
```

打开 **http://localhost:5173**，首页 → 进入画像系统 → 选择画像 → 开始对话。

常用命令：`bun run test`（跑测试）`bun run typecheck`（类型检查）

---

 ✅=已完成 ⬜=待完成 🔧=需优化

---

## 项目到底要做什么

**1. 群体画像**：把 70+ 篇射击游戏玩家访谈笔录，变成一个可对话的虚拟玩家群。

- 用冰山模型给每段玩家原话打标签（M5 行为 → M4 感受 → M3 认知 → M2 期待 → M1 动机）
- 聚类形成 5-8 种典型玩家画像，每种画像包含：标签组合 + 动机因果链 + 代表性原声证据
- 做对话界面：用研人员选标签 → 匹配画像 → 像跟真人深访一样提问 → AI 用画像人设回答 → 可溯源到原始语料

**2. KOL 分身**：基于 B 站 UP 主的公开内容，构建个体级数字孪生。（todo）

---

## 当前进度总览


| 层             | 状态  | 说明                                                        |
| ------------- | --- | --------------------------------------------------------- |
| 数据处理          | ✅   | 68 个文件 → 17,132 个片段，已清洗入库                                 |
| 数据库           | ✅   | 3 张新表 + pgvector + HNSW 索引 + 4 个示例画像                      |
| 共享类型          | ✅   | Persona/Chat/TagDimension Zod Schema                      |
| LLM SDK       | ✅   | chat/chatStream/embed，支持 DeepSeek                         |
| API 路由        | ✅   | /api/tags /api/personas /api/chat(SSE) /api/chat/sessions |
| 前端页面          | ✅   | 首页 + 标签选择器 + 画像列表/详情 + 虚拟访谈室                              |
| 对话功能          | ✅   | 端到端可用，AI 以画像人设回复                                          |
| 品牌替换          | ✅   | 教程内容删除，MUR 暗色主题                                           |
| 测试            | ✅   | typecheck 通过，全部测试通过                                       |
| pgvector      | ✅   | 编译安装 + vector(1024) + HNSW 索引                             |
| **AI 打标**     | ⬜   | 17K 片段尚未标注——这是最关键的上游任务                                    |
| **Embedding** | ⬜   | 表建好了但向量未生成                                                |
| **画像聚类**      | ⬜   | 当前用的是手写种子数据，非真实聚类                                         |
| **证据溯源**      | ⬜   | RAG 检索目前走 ILIKE 模糊匹配，非向量搜索                                |
| **评测**        | ⬜   | 142 道测试题未执行                                               |
| **部署**        | ⬜   | CI/CD 模板就绪但未推送到生产                                         |
| KOL 分身        | ⬜   | 下期                                                        |


---



## 可用材料


| 材料                | 在哪                                               | 干嘛用                 |
| ----------------- | ------------------------------------------------ | ------------------- |
| 70+ 篇访谈笔录 (.docx) | `虚拟用户-笔录 for 元培/`                                | AI 打标的原料            |
| 枪战用户分析框架 (.xlsx)  | `射击品类用研知识输入-枪战用户分析框架.xlsx`                       | 标签体系来源              |
| 心流体验量表 (28 题)     | 同上，附录 Sheet                                      | 甜区维度标注参考            |
| 冰山模型              | 项目介绍 Slide 22-23                                 | 标注方法论               |
| **群体画像测试题集**      | `AI模拟用户画像_测试题集_射击类用户(2).xlsx`                    | **AI 输出质量基准，142 题** |
| **KOL 测试题集**      | `KOL数字孪生_测试题集_硬核测评KOL(2).xlsx`                   | KOL 方向参考，下期直接用      |
| 项目脚手架             | `https://github.com/julia-lars/tengxun_yp_6Gang` | 队伍的所有内容都整理在这个仓库里    |




### 仓库结构

```
tengxun_yp_6Gang/
├── PROJECT_PLAN.md           ← 你正在读的文件
├── DEV_GUIDE.md              ← 代码写在哪 + 怎么跟 Claude 对话
├── 新手上手指南.md            ← 零经验组员上手教程
│
├── apps/api/src/             ← 后端（Hono + Drizzle）
│   ├── db/schema.ts          ← 数据库表（7 张表）
│   ├── db/seed-personas.ts   ← 示例画像种子
│   ├── routes/personas.ts    ← 画像 API
│   ├── routes/chat.ts        ← 对话 API（SSE）
│   └── lib/llm.ts            ← LLM SDK
├── apps/web/src/             ← 前端（React + Tailwind + shadcn/ui）
│   ├── routes/home.tsx       ← 首页
│   ├── routes/personas.tsx   ← 标签选择器 + 画像列表
│   ├── routes/persona-detail.tsx ← 画像详情
│   ├── routes/chat-room.tsx  ← 虚拟访谈室
│   └── components/ui/        ← shadcn 组件
├── packages/shared/src/      ← 前后端共享 Zod Schema
│
├── docs/                     ← 用研产出（标注规范、画像假设等）
├── data/                     ← 处理后的数据（all_segments.jsonl 等）
├── scripts/                  ← 独立脚本
└── deploy/                   ← 部署配置
```

---



## 各职能任务



### 产品经理 × 1（类恺平）

- [ ] **任务 1：用户流程与场景定义** —— 梳理用研经理和游戏策划的典型使用场景，画出用户流程图（打开→选标签→预览画像→对话→溯源），标注 AI 自动 vs 人工操作的边界，明确异常路径。同时简要调研 Character.AI / Synthetic Users 的交互模式。产物：用户流程图 + 场景说明文档。

- [ ] **任务 2：标签体系产品化设计** —— 基于枪战框架 5 维度设计标签选择器产品方案：每个维度的值域、互斥规则、组合规则、默认值、实时匹配反馈。产物：标签体系产品方案文档。

- [ ] **任务 3：全程验收把关** —— 前端出来对照交互稿验收、API 出来对照接口文档验收、画像出来和用研一起看、对话出来用测试题实测。产物：验收记录。

---



### 技术负责人 × 1（朱丽烨）

- [x] **任务 1：技术方案定稿** —— LLM 选 DeepSeek，RAG 用 pgvector，聚类 HDBSCAN，Embedding bge-large-zh。~~产物：技术选型记录~~ 🔧 需要写成一页纸文档。

- [ ] **任务 2：pgvector 安装与环境就绪** —— 从源码编译 pgvector 0.8.5 到 PG16，建 HNSW 索引。CI/CD 模板就绪。~~产物：pgvector 安装记录~~ 🔧 生产环境未部署。

- [x] **任务 3：数据库与 API 设计 Review** —— 三张表已建，API 已跑通，路由冲突已修复。🔧 需要写设计 Review 记录。

- [x] **任务 4：技术难点攻关** —— 角色一致性（System Prompt + 滑动窗口）、SSE 流式（Hono streamSSE）、RAG 检索（待 vector 有数据后调优）。🔧 RAG 延迟控制在 embedding 灌入后需要实测。

- [ ] **任务 5：Code Review** —— 建立分支规范 + PR 模板 + CR Checklist。当前所有人直接 push main，需要改为 feature 分支 → PR → TL 审核 → 合并。

- [ ] **任务 6：技术总结** —— 架构亮点 + 关键取舍 + 可复用资产。用于结课汇报。



#### 🔧 优化建议

- **pgvector 安装方法要文档化**：当前只在你的机器上编译安装，组员 Mac 上也需要。写一个 `docs/pgvector-setup.md` 说明两种安装方式：Docker 一键（推荐给新手）和源码编译（当前方式）。
- **CI/CD 需要实际跑一次**：模板 `.github/workflows/` 已就绪但从未触发过。推一次代码到 main 看 CI 是否全绿，CD 是否能部署到 CVM。
- **开发环境标准化**：当前用 Homebrew PG16 + 源码编译 pgvector，新人上手复杂。Docker Compose 里加一个带 pgvector 的 PG 镜像会让组员 1 分钟跑起来。

---



### AI 开发 × 3（崔续衡 闫瑾 林钰坤）

- [x] **任务 1：数据提取与清洗** —— 68 个文件（6 种格式）→ 17,132 个清洗后片段，已输出 `data/all_segments.jsonl`。🔧 英文片段混在中文数据集中，建议按语言分文件。

- [x] **任务 2：打标 Schema 设计** —— 冰山五层 + 框架四维度的 JSON Schema 已在 `docs/数据处理计划.md` 中定义。🔧 需要和用研专家确认 Schema 字段是否完整，确认后固化为 `annotation_schema.json`。

- [x] **任务 3：LLM SDK 封装** —— `apps/api/src/lib/llm.ts`：chat/chatStream/embed，支持 DeepSeek/GLM/MiniMax，内置重试+流式。🔧 embed() 方法用 DeepSeek 的通用 embedding API 可能不如专用模型（bge-large-zh），需要做对比评测。

- [ ] **任务 4：AI 打标 Pipeline** —— **这是当前最关键的未完成项。** 17K 片段需要逐一过 LLM 打标。实现方式：
  1. 基于黄金案例（需用研专家先产出）写 Few-shot 打标 Prompt
  2. 批量调 `chat()` 对每个片段标注，输出结构化 JSON
  3. 低置信度（<0.6）标记为待人工复核
  4. 结果写回 `source_segments` 表
  - 产物：`scripts/label.ts` + `annotated_corpus.jsonl`

- [ ] **任务 5：Embedding 与向量存储** —— 选 bge-large-zh-v1.5，对所有标注片段调 `embed()` 生成向量，写入 `source_segments.embedding` 列。长文本按 500 字切片、overlap 100 字。产物：`scripts/embed.ts`。

- [x] **任务 6：画像生成引擎** —— 当前用手写种子数据（`seed-personas.ts`）模拟了 4 个画像。🔧 真正的聚类流程未实现：标注→Embedding→HDBSCAN→提取标签+动机链+原声。实现方式：
  1. 从 `source_segments` 读已标注+Embedding 的数据
  2. HDBSCAN 聚类（min_cluster_size=5），UMAP 降维可视化
  3. 每个 cluster 统计高频标签值→画像标签，提取 M1→M5 典型路径→动机链，选 3-5 条中心原文→原声证据
  4. 结果写入 `personas` 表
  - 产物：`apps/api/src/lib/persona-engine.ts`

- [x] **任务 7：对话引擎** —— System Prompt 模板 + RAG（当前用 ILIKE 模糊匹配，非向量搜索）+ SSE 流式。端到端可用，AI 以画像人设回复。🔧 优化项：
  1. **RAG 升级**：pgvector 已就绪，Embedding 灌入后把 `ILIKE` 替换为向量相似搜索 `ORDER BY embedding <=> query_vector LIMIT 3`
  2. **对话记忆**：当前用滑动窗口取最近 12 条历史，超过后丢失旧上下文。需要加摘要压缩
  3. **知识边界**：Prompt 里写了"超出知识说不知道"但未验证效果
  4. **System Prompt 模板**：当前硬编码在 `chat.ts`，应该读配置文件或从 persona 的 `motivationChain` 动态生成

- [ ] **任务 8：Prompt 迭代优化** —— 需要等用研专家产出评测反馈后再迭代。产物：Prompt 版本记录 + 优化日志。

- [ ] **任务 9：自动化评测脚本** —— 已和测试任务合并，由测试角色统一负责。AI 开发提供 LLM-as-judge 评分接口。



#### 🔧 优化建议

- **打标是阻塞项**：画像聚类和 RAG 都依赖打标结果。3 个 AI 开发应该并行：1 人打标 Pipeline + 1 人 Embedding + 1 人 Prompt 优化。
- **LLM SDK 缺少 embed() 模型切换**：当前 `embed()` 用 `text-embedding-3-small`，但 DeepSeek 不一定支持。bge-large-zh 需要本地部署或通过硅基流动等第三方 API 调用。建议实际测试后再定。

---



### 产品开发 × 2（崔续衡 张江宇）



#### 后端开发（1 人）

- [x] **任务 1：数据库建表** —— source_segments / personas / chat_sessions 三张表已建，migration 已执行，pgvector 已安装。
  🔧 需要加更多索引：`source_segments` 的 `persona_ids` 列（GIN 索引）。

- [x] **任务 2：共享类型** —— `packages/shared/src/types.ts` 已有 Persona / Chat / TagDimension 完整 Zod Schema。

- [x] **任务 3：API 实现** —— `/api/tags` `/api/personas` `/api/personas/:id` `/api/chat`(SSE) `/api/chat/sessions/:id` 全部可用。
  🔧 优化项：
  1. `/api/tags` 数据硬编码在 `app.ts`，应抽到 `shared` 或配置文件
  2. `/api/personas` 的标签筛选用 `JSON.stringify` 做字符串匹配，数据量大时会慢，应改用 PostgreSQL `@>` jsonb 操作符
  3. 缺少分页——画像多了之后 `/api/personas` 会一次返回全部

- [x] **任务 4：对接 AI 引擎** —— 对话引擎和画像引擎已对接（当前画像用种子数据）。

- [ ] **任务 5：后端测试** —— 当前只有 `courses.test.ts`（测 /api/health + /api/tags + 404）。需要新增 `personas.test.ts` 和 `chat.test.ts`，使用 pglite 集成测试。注意 pglite 不支持 pgvector，含向量的测试需连真 PG。



#### 前端开发（1 人）

- [x] **任务 1：路由与页面骨架** —— 首页 `/`、画像列表 `/personas`、画像详情 `/personas/:id`、虚拟访谈室 `/personas/:id/chat` 全部可用。教程路由已删除。

- [x] **任务 2：标签选择器页面** —— Badge 组件实现多选标签，URL searchParams 同步状态，实时显示匹配画像数。🔧 缺少互斥规则校验（如选了"纯PVE"后"竞技核心"应该灰掉）。

- [x] **任务 3：画像列表与详情页** —— 列表卡片展示画像摘要，详情页展示完整标签+动机链+原声证据（当前无真实证据数据）。

- [x] **任务 4：虚拟访谈室** —— SSE 流式对话、打字机效果、聊天气泡布局。端到端可用。🔧 优化项：
  1. 对话历史不持久——刷新页面后历史丢失（sessionId 存在 state 里未恢复）
  2. 缺少 loading 状态指示（AI 思考中时没有动画）
  3. 输入框不支持 Shift+Enter 换行

- [ ] **任务 5：证据溯源面板** —— 点击 AI 回答查看引用原文+冰山标签路径。当前未实现。实现方式：chat-room.tsx 中解析 SSE 返回的最后一个 `{"type":"evidence","ids":[...]}` 事件，调 `/api/personas/:id` 获取 evidenceList，用 Sheet 组件侧滑展示。



#### 🔧 优化建议

- **前端错误处理脆弱**：网络断开、API 超时、SSE 中断都没有友好提示。建议加 toast（sonner 已安装）。
- **移动端适配**：聊天页面在小屏幕上输入框和气泡重叠。需要加 `sm:` 断点适配。

---



### 交互设计 × 1（闫瑾）

- [ ] **任务 1：标签选择器交互与视觉设计** —— 五个维度的展示方式、标签选中/禁用四态、互斥灰化+tooltip、匹配数变化动效。产物：Figma 高保真稿。

- [ ] **任务 2：虚拟访谈室交互与视觉设计** —— 对话气泡样式、流式打字规范、模拟用户信息卡、溯源入口+面板动画、对话状态指示。产物：Figma 高保真稿。

- [ ] **任务 3：整体视觉风格定义** —— 暗色主题为主，基于现有 `styles.css` 的 @theme 做微调。标题/正文/代码排版规范。产物：一页纸视觉规范。

---



### 测试 × 2（张江宇 林钰坤）

- [ ] **任务 1：测试策略与题库整理** —— 定义测试层次，将 142 题按画像类型和维度分类编号。产物：测试策略文档 + 题库分类表。

- [ ] **任务 2：自动化评测脚本** —— 将 142 题从 xlsx 转为结构化 JSON，写评测执行脚本遍历用例→调 `/api/chat`→保存回答→调 LLM-as-judge 打分。产物：评测脚本 + 评测报告。

- [ ] **任务 3：一致性评测** —— 对每种画像用 35 道一致性题验证：同画像不矛盾、不同画像可区分、多轮对话 ≥10 轮不崩人设。产物：一致性评测报告。

- [ ] **任务 4：假设性评测** —— 用 107 道假设性题（立项+玩法+商业化+市场）验证 AI 回答是否符合画像动机链和行为模式。产物：假设性评测报告。

- [ ] **任务 5：盲测** —— 选 20 道代表性题，AI vs 真人回答混合，评委盲评。目标区分准确率 ≤50%。需要用研专家提供 ground truth。产物：盲测报告。

- [ ] **任务 6：功能 + 性能测试** —— 端到端流程、异常流、Chrome/Edge/Safari 兼容性、5 路并发延迟、画像生成速度、首屏加载。产物：功能+性能报告。

---



### 用研专家 × 2（类恺平 朱丽烨）

- [ ] **任务 1：写标注规范** —— 冰山五层每层写明定义/标注方法/值域/正反面示例/边界 case。枪战框架四维度同样。**关键约束**：值域必须覆盖测试题集 142 题所有区分维度。产物：`docs/标注规范.md`。

- [ ] **任务 2：标注黄金案例 30 条** —— 从 17K 片段中挑选 30 条典型原文，覆盖不同玩家类型、表达方式、中英文。完整冰山五层+框架标注，每条记下推断逻辑。这 30 条会嵌入 AI 打标 Prompt。产物：`docs/golden_examples.jsonl`。

- [ ] **任务 3：提出画像假设** —— 提出 5-8 个典型画像假设（名称+描述+冰山五层+框架四维度的典型取值+预期测试题表现）。产物：`docs/画像假设.md`。

- [ ] **任务 4：审核 AI 打标质量** —— 抽检 30 条 AI 打标结果，逐条打分，汇总错误模式反馈给 AI 开发。准确率 <70% 需重调重检。产物：`docs/打标审核报告.md`。

- [ ] **任务 5：校验聚类画像** —— 逐个审核 AI 产出画像：是否对应真实人群、标签是否自洽、画像间区分是否清晰、有无遗漏。产物：`docs/画像校验报告.md`。

- [ ] **任务 6：盲测材料 + 业务验证** —— 从测试题集选 20 道，找真实用户对照回答；模拟真实用研场景用产品跑一遍。产物：盲测对照材料 + 业务验证报告。

---

## 关键依赖链

```
用研: 标注规范 + 黄金案例 ──→ AI: 打标 Pipeline ──→ AI: Embedding ──→ AI: 聚类画像
                                                                        │
                                                                        ▼
                                                              后端: personas 表有真实数据
                                                                        │
                                                                        ▼
                                                              前端: 画像列表展示真实聚类结果
                                                                        │
                                                                        ▼
                                                              AI: RAG 向量搜索替换 ILIKE
                                                                        │
                                                                        ▼
                                                              测试: 142 题评测 + 盲测
```

**当前阻塞点：用研专家尚未产出标注规范和黄金案例 → AI 打标无法开始 → 聚类和 RAG 只能用手写种子数据。**

---



## MVP 功能清单（P0）


| 功能       | 状态  | 说明                                   |
| -------- | --- | ------------------------------------ |
| 标签选择器    | ✅   | 五维度选标签，实时反馈匹配画像数。🔧 缺互斥校验            |
| 画像预览     | ✅   | 展示 4 个手写种子画像。⬜ 等聚类后替换为真实画像           |
| 虚拟访谈室    | ✅   | SSE 流式对话，气泡布局。🔧 缺历史恢复+溯源面板          |
| 对话引擎     | ✅   | 角色 Prompt + DeepSeek。🔧 RAG 需升级为向量搜索 |
| 证据溯源     | ⬜   | 未实现                                  |
| 标签查询 API | ✅   | /api/tags 返回 5 个维度                   |


暂缓：KOL 分身、多模拟用户同时对话、对话导出、管理后台、登录认证

---

## 评测标准

- 一致性测试通过率 ≥ 70%（同画像不矛盾，不同画像可区分）
- 假设性测试平均评分 ≥ 3/5（回答符合画像人设和动机链）
- 盲测评委区分准确率 ≤ 50%（AI 与真人难以区分）

---

