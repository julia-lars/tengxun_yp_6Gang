# =========================================================================
# 前端 Web 生产镜像 · 多阶段构建
#
# 阶段一：用 Bun 装依赖 + 让 Vite 打包出静态资源（dist/）
# 阶段二：把 dist/ 拷进 nginx:alpine 镜像，让 nginx 托管
#
# 为什么最终跑在 nginx 而不是 node？
#   前端打包完是纯静态文件（HTML + JS + CSS），
#   不需要 Node 运行时。nginx 静态托管性能远高于 Node，
#   镜像也更小（~30MB vs ~200MB）。
#
# 从仓库根目录构建：
#   docker build -f apps/web/Dockerfile -t web:local .
# =========================================================================


# -------------------- 阶段 1：deps 装依赖 --------------------
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

RUN bun install --frozen-lockfile


# -------------------- 阶段 2：builder 打包 --------------------
FROM oven/bun:1.3.14-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .

# --filter @app/web build 会同时跑 tsc --noEmit + vite build
# 类型错 = 构建失败 = 镜像无法生成，这是"质量门"
RUN bun --filter @app/web build


# -------------------- 阶段 3：runner nginx 静态托管 --------------------
FROM nginx:1.27-alpine AS runner

# 覆盖默认站点配置
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# 拷贝 Vite 打包产物（默认输出到 apps/web/dist/）
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# nginx:alpine 默认 EXPOSE 80，此处显式声明便于阅读
EXPOSE 80

# nginx 官方镜像自带健康检查？没有 —— 自己加一个：拉首页应返回 200
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/ > /dev/null || exit 1

# nginx:alpine 的 ENTRYPOINT/CMD 已配好，无需覆盖
