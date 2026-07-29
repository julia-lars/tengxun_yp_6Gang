# =========================================================================
# 后端 API 生产镜像 · 多阶段构建
#
# 为什么用多阶段？
#   构建时需要完整依赖（drizzle-kit / TypeScript / 源码），
#   但运行时只需最小依赖 + 编译产物。多阶段能把构建工具链留在中间层，
#   最终镜像只带必需品 —— 体积小、攻击面小。
#
# build context 是仓库根目录（因为 monorepo 用了 workspaces，
# 装依赖需要看得到 packages/shared 和 apps/api 两处的 package.json）。
# 从根目录构建：
#   docker build -f apps/api/Dockerfile -t api:local .
# =========================================================================


# -------------------- 阶段 1：deps 装依赖 --------------------
FROM oven/bun:1.3.11-alpine AS deps
WORKDIR /app

# 先只 COPY 所有 package.json 与锁文件 —— 只要它们不变，
# 后续 bun install 就能命中 Docker 层缓存，代码修改不会导致重装依赖
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# --frozen-lockfile：只装锁文件里已确定的版本，绝不升级
# 生产构建要的就是 100% 可复现
RUN bun install --frozen-lockfile


# -------------------- 阶段 2：builder 类型检查 --------------------
# 后端由 Bun 直接跑 TypeScript，不需要编译成 JS。
# 这一步只做 typecheck，让"类型错的代码构不出镜像"。
FROM oven/bun:1.3.11-alpine AS builder
WORKDIR /app

# bun workspaces 下每个包各自有 node_modules（不做 hoisting），
# 三处都要从 deps 阶段拷过来
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .

RUN bun --filter @app/api typecheck


# -------------------- 阶段 2.5：prod-deps 只装生产依赖 --------------------
# runner 只需要 hono/drizzle-orm/postgres/zod 等 runtime 包，
# 不需要 vitest / pglite / drizzle-kit / @types/* 等 dev deps。
# 单独一层重装 --production，让 runner 镜像瘦身（~127MB → ~30-40MB）。
FROM oven/bun:1.3.11-alpine AS prod-deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile --production


# -------------------- 阶段 3：runner 最小运行时 --------------------
# 关键：typecheck 由 builder 阶段完成（构成发布的强制门槛，失败则本阶段也无法构建，
# 因为 buildx 会并行调度多个 stage 但最终 target=runner 依赖 builder 通过）。
# node_modules 从 prod-deps 拿 —— 剥离所有 devDependencies，让 push 秒完成。
FROM oven/bun:1.3.11-alpine AS runner
WORKDIR /app

# 让 buildkit 知道 runner 依赖 builder 通过 —— 用一个空 COPY 建立依赖边
# （否则 target=runner 时 builder 阶段可能被跳过，typecheck 就失去意义）
COPY --from=builder /app/package.json /tmp/typecheck-guard.json

# 生产依赖 + 源码 + drizzle migration 目录
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY package.json bun.lock ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY data ./data

# oven/bun 镜像默认自带非 root 用户 "bun"
USER bun

ENV NODE_ENV=production
ENV API_PORT=3000
EXPOSE 3000

# 健康检查 —— docker compose / K8s / 云控制台都会读它决定服务是否就绪
# 用 wget 是因为 alpine 自带；curl 需要另装
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["bun", "run", "apps/api/src/index.ts"]
