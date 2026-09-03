#!/bin/bash
# 快速重启 dev server
set -e
pkill -f "turbo dev" 2>/dev/null || true
pkill -f "bun run --watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
pkill -f "embed_server" 2>/dev/null || true
sleep 2
lsof -ti:3000 -ti:5173 -ti:8765 | xargs kill -9 2>/dev/null || true
sleep 1
bun run dev