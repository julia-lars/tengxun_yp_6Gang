#!/bin/bash
# --------------------------------------------------------------
# 更新部署脚本
# 用法: bash deploy.sh
# 每次本地代码改动后跑一遍，自动同步到服务器并重启
# --------------------------------------------------------------
set -euo pipefail

SERVER="ubuntu@49.232.59.125"
REMOTE_DIR="/opt/muru-thinktank"

echo "📦 1/4 同步源码到服务器..."
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '.turbo' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.DS_Store' \
  -e "ssh -o StrictHostKeyChecking=no" \
  /Users/juliaaa/workspace/tengxun/tengxun_yp_6Gang/ \
  ${SERVER}:${REMOTE_DIR}/src/

echo ""
echo "🔨 2/4 在服务器上重建 Docker 镜像..."
ssh ${SERVER} "cd ${REMOTE_DIR}/src && \
  docker build -f apps/api/Dockerfile -t ghcr.io/julia-lars/muru-thinktank-api:latest . && \
  docker build -f apps/web/Dockerfile -t ghcr.io/julia-lars/muru-thinktank-web:latest ."

echo ""
echo "🗄️  3/4 跑数据库迁移..."
ssh ${SERVER} "cd ${REMOTE_DIR} && \
  docker compose --env-file .env.prod -f docker-compose.prod.yml \
    run --rm --pull never api bun run apps/api/src/db/migrate.ts"

echo ""
echo "🚀 4/4 重启服务..."
ssh ${SERVER} "cd ${REMOTE_DIR} && \
  docker compose --env-file .env.prod -f docker-compose.prod.yml \
    up -d --pull never --force-recreate api web && \
  docker image prune -f"

echo ""
echo "✅ 部署完成！访问 http://49.232.59.125"
