# 开发协作指南：怎么写 + 怎么测 + 怎么对接

> Claude 已经读过这个仓库的全部代码。把这份指南和你那部分任务的说明一起发给 Claude，就能直接在正确的位置写代码、跑测试。

---

## 代码写在哪里（速查表）

| 你要做什么 | 写在哪个文件 | 参考哪个现有文件 |
|-----------|-------------|-----------------|
| 新数据库表 | `apps/api/src/db/schema.ts` | 文件里已有的 `courses`/`chapters` 定义 |
| 前后端共享类型 | `packages/shared/src/types.ts` | 文件里已有的 `courseSchema`/`messageSchema` |
| 新增 API 路由 | `apps/api/src/routes/personas.ts`（新建）<br>`apps/api/src/routes/chat.ts`（新建） | `apps/api/src/routes/courses.ts`<br>`apps/api/src/routes/demo-sandbox.ts` |
| 挂载新路由 | `apps/api/src/app.ts` | 已有的 `app.route("/api/courses", coursesRoute)` |
| LLM 调用封装 | `apps/api/src/lib/llm.ts`（新建） | 无，但所有 AI 模块都 import 它 |
| 画像生成引擎 | `apps/api/src/lib/persona-engine.ts`（新建） | 无 |
| 对话引擎 | `apps/api/src/lib/chat-engine.ts`（新建） | 无 |
| 前端新页面 | `apps/web/src/routes/personas.tsx`（新建） | `apps/web/src/routes/home.tsx` |
| 前端 API 调用方法 | `apps/web/src/lib/api.ts` | 已有的 `listCourses()` / `getChapter()` |
| 前端路由注册 | `apps/web/src/main.tsx` | 已有的 `path: "courses/:slug"` |
| 前端全局布局 | `apps/web/src/root.tsx` | 不需要改，复用三栏布局 |
| 前端样式主题 | `apps/web/src/styles.css` | 改 `@theme` 块里的颜色和字体 |
| 数据 Pipeline 脚本 | 项目根新建 `scripts/` 目录放独立脚本 | 无 |

## 写完代码后怎么验证

### 每次写完都要跑

```bash
bun run typecheck    # 类型对不对
bun run lint         # 格式对不对
bun run test         # 之前的测试有没有被改坏
```

### 写完后端 API 后

```bash
# 1. 先跑已有测试确保没坏
bun run test

# 2. 手动验证接口能通
bun run dev    # 启动服务

# 另开终端
curl http://localhost:3000/api/personas          # 画像列表
curl http://localhost:3000/api/personas?tags=竞技  # 按标签筛选
curl http://localhost:3000/api/tags               # 标签维度

# 3. 加测试文件（参考 courses.test.ts 的写法）
# 新建 apps/api/src/routes/personas.test.ts
# 用 pglite 做集成测试（不需要连真数据库）
```

### 写完前端页面后

```bash
# 1. 跑已有测试
bun run test

# 2. 浏览器打开 http://localhost:5173 手动走流程

# 3. 加组件测试（参考 CountClicks.test.tsx 的写法）
```

### 写完 AI 引擎模块后

```bash
# 1. 类型检查
bun run typecheck

# 2. 写一个简单的手动测试脚本验证功能
# 例如：bun run scripts/test-chat.ts
```

## 角色之间怎么对接

```
用研专家 → AI开发：  标注规范.md + golden_examples.jsonl
                    放到仓库 docs/ 目录，AI开发从文件读取

AI开发 → 后端开发：  lib/llm.ts（统一调用入口）
                    lib/persona-engine.ts（导出 generatePersonas() 函数）
                    lib/chat-engine.ts（导出 streamChat() 函数）
                    约定：函数签名 + 输入输出类型

后端开发 → 前端开发： API 接口文档（就是 PROJECT_PLAN.md 里的 API 部分）
                    packages/shared/src/types.ts（Zod Schema 即接口约定）
                    前端只需 import 类型，调 api.xxx() 方法

交互设计 → 前端开发： Figma 设计稿链接
                    前端参考 shadcn/ui 组件实现（Badge/Card/Sheet/Button）
```

### 对接验证步骤

当你依赖别人的产出时，验证方法：

1. **后端对接 AI 引擎**：先让 AI 开发在 `lib/` 里导出一个函数，写一个简单调用验证返回格式正确
2. **前端对接后端 API**：先 `curl` 确认 API 返回的 JSON 结构符合 `packages/shared` 定义的 Zod Schema，前端再开工
3. **测试团队验证全流程**：等前后端联调通了再开始跑 142 道评测题

## 团队协作规范

### Git 分支规则

```
main ──────────────────────────────  只有 TL 合并，始终保持可运行
  │
  ├── feature/schema-seed          一人一个分支，做完提 PR
  ├── feature/llm-sdk
  ├── feature/tag-selector
  ├── feature/chat-engine
  └── ...
```

每条规则：
- 从 main 拉分支 → 写代码 → `git add` + `git commit` + `git push` → 在 GitHub 提 PR
- PR 标题写清楚：`[角色] 做了什么`，如 `[AI] LLM SDK 封装`、`[前端] 标签选择器页面`
- TL 审核合并。**合并前必须 CI 全绿**（lint + typecheck + test）
- 合并后其他人 `git pull` 拉最新代码

## 仓库结构一览

```
tengxun_yp_6Gang/
├── 新手上手指南.md            ← 零经验上手教程
├── PROJECT_PLAN.md           ← 项目计划 + 各角色任务
├── DEV_GUIDE.md              ← 你正在读的文件
│
├── apps/                     ← 📝 代码
│   ├── api/src/
│   │   ├── db/schema.ts      ← 数据库表定义（Drizzle ORM）
│   │   ├── db/client.ts      ← 数据库连接池（支持测试注入）
│   │   ├── routes/           ← API 路由（Hono）
│   │   ├── lib/              ← AI 引擎（llm.ts, chat-engine.ts 等）
│   │   └── app.ts            ← 路由挂载 + 中间件
│   └── web/src/
│       ├── routes/           ← 页面组件（React Router）
│       ├── components/ui/    ← shadcn/ui 组件（Badge/Card/Sheet/Button 等）
│       ├── lib/api.ts        ← 前端 API 客户端
│       └── styles.css        ← Tailwind @theme 主题
│
├── packages/shared/src/      ← 🔗 前后端共享
│   └── types.ts              ← Zod Schema + TypeScript 类型（前后端的"合同"）
│
├── docs/                     ← 📄 用研产出（标注规范、画像假设、审核报告等）
├── data/                     ← 📊 数据文件（标注结果、画像数据。不上传 GitHub）
├── scripts/                  ← 🔧 独立脚本（数据清洗、AI打标、embedding 等）
├── deploy/                   ← 🚀 部署配置（Docker Compose + CI/CD）
│
├── docker-compose.yml        ← 本地 PostgreSQL + pgweb 管理界面
├── biome.json                ← 代码规范（自动格式化 + lint）
├── turbo.json                ← 并行任务编排
└── tsconfig.base.json        ← TypeScript 严格模式配置
```

### 文档放哪里

| 文档类型 | 位置 | 格式 |
|---------|------|------|
| 项目计划、任务分工 | `PROJECT_PLAN.md`（仓库根目录） | Markdown |
| 开发协作指南（本文件） | `DEV_GUIDE.md`（仓库根目录） | Markdown |
| 用研产出（标注规范、画像假设等） | `docs/` 目录 | Markdown |
| 数据文件（标注结果等） | `data/` 目录 | JSONL / JSON |
| 脚本（数据清洗、打标等） | `scripts/` 目录 | .ts |
| 设计稿 | Figma 链接（写在 PROJECT_PLAN 或 PR 描述里） | - |

### 不要做什么

- **不要把 node_modules 传上 git**（.gitignore 已排除）
- **不要把 .env 传上 git**（.gitignore 已排除）
- **不要直接 push main**（走 PR）
- **不要一个人改多个角色的核心文件**（避免冲突）
- **不要改了 schema.ts 不生成 migration**（别人会报错）

---

## 怎么跟 Claude 对话

### 最重要的：给 Claude 上下文

每次跟 Claude 开始工作前，先告诉它三件事：

> 1. **仓库在哪**：`/Users/xxx/tengxun_yp_6Gang`
> 2. **你的角色和任务**：从 `PROJECT_PLAN.md` 里复制你的任务描述
> 3. **参考哪些文件**：从下面的模板里选你的场景

### 各角色对话模板

#### 后端开发

```
我在 tengxun_yp_6Gang 仓库做后端开发。

我的任务：[从 PROJECT_PLAN.md 复制你的具体任务]

请参考 apps/api/src/db/schema.ts 的表定义方式，
参考 apps/api/src/routes/courses.ts 的路由写法，
参考 packages/shared/src/types.ts 的 Zod Schema 定义方式。

请在 [具体文件路径] 中实现 [具体功能]。
写完代码后，请跑 bun run typecheck && bun run test 验证。
```

#### 前端开发

```
我在 tengxun_yp_6Gang 仓库做前端开发。

我的任务：[从 PROJECT_PLAN.md 复制你的具体任务]

请参考 apps/web/src/main.tsx 的路由配置方式，
参考 apps/web/src/routes/home.tsx 的页面组件写法，
参考 apps/web/src/lib/api.ts 的 API 调用方式。

已有的 shadcn/ui 组件在 apps/web/src/components/ui/，
可以复用：Badge、Card、Button、Sheet、Input、Textarea 等。

请在 [具体文件路径] 中实现 [具体功能]。
写完代码后，请跑 bun run typecheck && bun run test 验证。
```

#### AI 开发

```
我在 tengxun_yp_6Gang 仓库做 AI 开发。

我的任务：[从 PROJECT_PLAN.md 复制你的具体任务]

数据在这：虚拟用户-笔录 for 元培/ 目录下的 docx 文件。
枪战分析框架在这：射击品类用研知识输入-枪战用户分析框架.xlsx。
项目脚手架在 tengxun_yp_6Gang/，数据库 schema 在 apps/api/src/db/schema.ts。

请在 [具体文件路径] 中实现 [具体功能]。
写完代码后，请跑 bun run typecheck 验证类型正确。
```

#### 用研专家（产出文档而非代码）

```
我在 tengxun_yp_6Gang 项目做用研专家。

我的任务：[从 PROJECT_PLAN.md 复制你的具体任务]

相关材料：
- 枪战用户分析框架：射击品类用研知识输入-枪战用户分析框架.xlsx
- 冰山模型说明：在项目介绍 HTML 的 Slide 22-23
- 测试题集：AI模拟用户画像_测试题集_射击类用户(2).xlsx
- 访谈笔录：虚拟用户-笔录 for 元培/ 目录下

请帮我 [具体要做的事，如"写标注规范/标注黄金案例"]。
产出放到 docs/ 目录下。
```

#### 产品经理 / 交互设计 / 测试

```
我在 tengxun_yp_6Gang 项目做 [产品经理/交互设计/测试]。

我的任务：[从 PROJECT_PLAN.md 复制你的具体任务]

相关材料在 PROJECT_PLAN.md 的"可用材料"表格里列出了路径。
测试题集在 AI模拟用户画像_测试题集_射击类用户(2).xlsx。

请帮我 [具体要做的事]。
```

### 对话技巧

**分批做，不要一次让 Claude 做太多。**

- ❌ "帮我完成所有后端任务"
- ✅ "帮我在 schema.ts 里新增 source_segments 表"
- ✅ 上一个完成后 → "现在帮我在 routes/personas.ts 里实现 GET /api/personas 接口"

**每次改完代码，让 Claude 跑验证。**

```
请跑 bun run typecheck && bun run test 确认没有破坏已有功能。
```

**遇到报错，直接把错误信息贴给 Claude。**

```
跑 bun run test 报了这个错：[贴错误信息]。请帮我修复。
```

**不确定代码放哪，先问。**

```
我要实现 [功能描述]，这个代码应该放在仓库的哪个文件里？
```

---

## 常用命令

```bash
bun run dev           # 启动前后端
bun run test          # 跑全部测试
bun run typecheck     # 类型检查
bun run lint          # 代码规范检查
bun run db:generate   # schema 改了之后生成 migration
bun run db:migrate    # 执行 migration
bun run db:studio     # 可视化看数据库
```
