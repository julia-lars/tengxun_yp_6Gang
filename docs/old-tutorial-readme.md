# 元培学院 Web 开发教程 · 项目脚手架

> **元培学院 与 腾讯 IEG 用户研究与市场部门合作的"AI 模拟用户"研究项目的一部分成果。**

面向大一学生的 Web 全栈开发启蒙项目。

**双重身份：**

1. **教学内容载体** —— 项目跑起来之后，打开浏览器就能看到成体系的教程（前端基础 → React/Tailwind → 工程化 → 后端 → 数据库 → ORM → 单元测试 → 部署），每章带可交互 Demo
2. **技术栈实战范本** —— 项目源码本身就是要学的现代 Web 工程。读源码就是读"如何搭一个真实项目"，未来可以直接把它 clone 下来当脚手架，做自己的第一个真实项目

## 技术栈全景

| 层次 | 技术 | 版本 | 用途 |
|---|---|---|---|
| **包管理 / 运行时** | [Bun](https://bun.sh) | 1.3.11 | 装依赖 + 跑 TS + workspaces |
| **任务编排** | [Turborepo](https://turborepo.com) | 2.x | 并行任务 + 构建缓存 |
| **代码规范** | [Biome](https://biomejs.dev) | 2.x | 一体化 lint + format |
| **语言** | [TypeScript](https://www.typescriptlang.org) | 5.9+ | 全栈类型安全 |
| **前端构建** | [Vite](https://vite.dev) | 6.x | dev + 生产打包 |
| **前端框架** | [React](https://react.dev) | 18.x | 组件化 UI |
| **前端路由** | [React Router](https://reactrouter.com) | 7.x | data-mode 路由（loader） |
| **前端样式** | [Tailwind CSS](https://tailwindcss.com) | 4.x | 原子化 CSS，`@theme` 管理主题 |
| **前端组件库** | [shadcn/ui](https://ui.shadcn.com) | new-york | 复制源码到项目、可自由改 |
| **前端图标** | [lucide-react](https://lucide.dev) | 0.469 | 图标库 |
| **前端交互** | [sonner](https://sonner.emilkowal.ski) | 1.x | toast 提示 |
| **前端 markdown** | react-markdown + remark-gfm | 9.x | 章节内容渲染 |
| **后端运行时** | Bun / Node.js 兼容 | - | 直接跑 TS |
| **后端框架** | [Hono](https://hono.dev) | 4.x | 现代极简 web 框架 |
| **数据库** | [PostgreSQL](https://www.postgresql.org) | 16 | 关系型数据库（Docker 起） |
| **ORM** | [Drizzle](https://orm.drizzle.team) | 0.38 | 类型安全的 SQL 构造器 |
| **数据校验** | [Zod](https://zod.dev) | 3.24 | 前后端共享 schema |
| **测试** | [Vitest](https://vitest.dev) | 2.x | 单测 + 集成测试 |
| **测试 DB** | [pglite](https://pglite.dev) | 0.2 | in-memory Postgres WASM |
| **容器化** | [Docker](https://www.docker.com) + Compose | - | 本地 pg + 生产部署 |
| **CI/CD** | [GitHub Actions](https://github.com/features/actions) | - | build + test + deploy |
| **镜像仓库** | 腾讯云 [TCR](https://cloud.tencent.com/product/tcr) | - | 私有镜像仓库 |
| **部署目标** | 腾讯云 [CVM](https://cloud.tencent.com/product/cvm) | Ubuntu | self-hosted runner 拉取部署 |

## 目录结构

```
web-dev-tutorial/
├── apps/
│   ├── web/                # React 前端 · 详见 apps/web/README.md
│   └── api/                # Hono 后端 · 详见 apps/api/README.md
├── packages/
│   └── shared/             # 前后端共享 zod schema · 详见 packages/shared/README.md
├── deploy/
│   ├── docker-compose.prod.yml   # 生产环境编排
│   ├── .env.prod.example         # 生产环境变量模板
│   └── README.md                 # CVM 首次准备手册
├── .github/workflows/
│   ├── ci.yml              # PR / feature 分支：lint + typecheck + test + build
│   └── deploy.yml          # main 分支：构建镜像 → 推 TCR → self-hosted runner 部署
├── docker-compose.yml      # 本地开发用（只跑 postgres）
├── biome.json              # 代码规范
├── turbo.json              # 任务编排
├── package.json            # workspaces 根
├── tsconfig.base.json      # 共享 TS 配置
└── bun.lock                # 依赖锁定
```

## 快速开始

**准备：** [Bun](https://bun.sh)、[Docker Desktop](https://www.docker.com/products/docker-desktop/)、[Git](https://git-scm.com/downloads)、GitHub 账号。

```bash
# 1. clone
git clone https://github.com/mur-yuanpei/web-dev-tutorial.git
cd web-dev-tutorial

# 2. 装依赖
bun install

# 3. 起数据库 + 初始化
bun run db:up          # 启动 postgres 容器
bun run db:migrate     # 建表
bun run db:seed        # 灌入教程内容

# 4. 起前后端
bun run dev
```

打开 http://localhost:5173 —— 教程首页。
后端 API 在 http://localhost:3000（试试 `/api/health`）。
数据库可视化管理在 http://localhost:8081 （pgweb，本地开发已配置直连，点开即用）。

## 常用命令

```bash
# 开发
bun run dev              # turbo 并行起前后端
bun run typecheck        # 全仓库类型检查
bun run lint             # biome lint + format 检查
bun run lint:fix         # 自动修可修的
bun run test             # 全仓库单元测试
bun run build            # 生产构建

# 数据库
bun run db:up            # 起 postgres 容器
bun run db:down          # 停
bun run db:generate      # 首次 / schema 变更后：生成 migration SQL
bun run db:migrate       # 应用 migration
bun run db:seed          # 灌入教程内容（幂等，空库才灌）
bun run db:studio        # Drizzle Studio 可视化
bun run db:reset         # 推倒重来（删库 → 重建 → 灌数据）

# 直接连数据库
docker exec -it web-tutor-postgres psql -U dev -d webtutor
```

## AI Agent 提示

**本项目对 AI Agent 友好** —— 每个配置文件顶部都有中文注释解释"是干什么、为什么这么配"。以下是 AI 快速理解本项目的推荐阅读顺序：

1. **根 `README.md`（本文件）** —— 技术栈全景 + 目录结构
2. **`apps/api/README.md`** —— 后端子项目详解
3. **`apps/web/README.md`** —— 前端子项目详解
4. **`packages/shared/README.md`** —— 共享包的意义
5. **`apps/api/src/db/schema.ts`** —— 数据模型（Drizzle table）
6. **`packages/shared/src/types.ts`** —— API 契约（zod schema）
7. **`apps/api/src/app.ts`** —— 后端路由挂载入口
8. **`apps/web/src/main.tsx`** + **`apps/web/src/root.tsx`** —— 前端入口 + 三栏布局
9. **`deploy/README.md`** —— 生产部署机制
10. **`.github/workflows/deploy.yml`** —— CI/CD 流水线

## 学习路径

按项目内教程顺序：

- **课程 0** 先跑起来再说
- **课程 1** 认识 Web 开发
- **课程 2** 前端基础（HTML/CSS/JS）
- **课程 3** React 与 Tailwind
- **课程 4** 工程化（Bun/Vite/monorepo/Biome）
- **课程 5** 后端入门（HTTP + Hono）
- **课程 6** 数据库设计
- **课程 7** Drizzle ORM 实战
- **课程 8** 单元测试
- **课程 9** 本项目全景
- **课程 10** 使用脚手架开发指南
- **课程 11** 用 AI 一起写代码（Claude Code）

## 部署

已配好完整 GitHub Actions CI/CD：push 到 `main` 自动构建镜像、推 TCR、由 CVM 上的 self-hosted runner 完成部署。**详见 [deploy/README.md](./deploy/README.md)**。

## 常见问题

**为什么用 Bun 而不是 npm/pnpm？** 装依赖快 10 倍、原生跑 TS 无需编译、内置 workspaces。教学最简单。

**为什么加 Turborepo？** `bun run dev` 一条命令并行起前后端；build 有缓存。企业标配。

**为什么用 Drizzle 而不是 Prisma？** Drizzle 更贴近 SQL、类型推导好、bundle 小；学 SQL 和学 ORM 同步进行。

**为什么用 pglite 而不是真 pg 做测试？** 200ms 冷启动、in-memory、CI 无需外部服务、90%+ 兼容真 pg。

**为什么用 self-hosted runner 而不是 SSH？** CVM 不用对公网开 SSH 端口，主动连 GitHub 拉任务，安全面最小。

**为什么不加认证？** 认证是独立的大主题（session/JWT/OAuth），加进来稀释教学焦点。留作学生后续项目扩展点。

## 项目源码就是活教材

对照教程读源码，最快理解现代 Web 项目：

- `apps/api/src/db/schema.ts` —— 数据库设计课的活样例
- `apps/api/src/routes/` —— HTTP 路由怎么组织
- `apps/api/src/routes/demo-sandbox.ts` —— zod 请求校验实战
- `packages/shared/src/types.ts` —— 前后端如何共享类型
- `apps/web/src/lib/api.ts` —— 前端如何组织 API 调用
- `apps/web/src/routes/chapter.tsx` —— React Router v7 loader 模式
- `apps/web/src/components/demos/` —— 真实的可交互 Demo 组件

祝学习愉快 🌱
