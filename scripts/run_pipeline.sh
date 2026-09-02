#!/usr/bin/env bash
# --------------------------------------------------------------
# 6Gang 数据流水线 — 统一调度入口
# 串联所有 Python 脚本，支持 --resume 断点续跑
#
# 用法:
#   bash scripts/run_pipeline.sh              # 从头开始
#   bash scripts/run_pipeline.sh --resume     # 断点续跑（跳过已完成阶段）
#   bash scripts/run_pipeline.sh --dry-run    # 只打印将要执行的步骤，不实际执行
#   bash scripts/run_pipeline.sh --skip-label # 跳过 AI 标注阶段（使用已有标注）
# --------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RESUME=false
DRY_RUN=false
SKIP_LABEL=false

# 解析参数
for arg in "$@"; do
  case "$arg" in
    --resume) RESUME=true ;;
    --dry-run) DRY_RUN=true ;;
    --skip-label) SKIP_LABEL=true ;;
  esac
done

# 阶段标记文件（用于断点续跑）
STAGE_DIR="$PROJECT_ROOT/data/.pipeline_stages"
mkdir -p "$STAGE_DIR"

# 阶段完成标记
mark_done() {
  local stage="$1"
  touch "$STAGE_DIR/${stage}.done"
  echo "✅ 阶段完成: $stage"
}

is_done() {
  local stage="$1"
  if $RESUME && [ -f "$STAGE_DIR/${stage}.done" ]; then
    echo "⏭️  跳过已完成阶段: $stage"
    return 0
  fi
  return 1
}

run_step() {
  local stage="$1"
  local desc="$2"
  shift 2

  if is_done "$stage"; then
    return 0
  fi

  echo ""
  echo "================================================"
  echo "▶  $desc"
  echo "================================================"

  if $DRY_RUN; then
    echo "[dry-run] 将执行: python3 $@"
    return 0
  fi

  python3 "$@"
  mark_done "$stage"
}

# 切换到项目根目录
cd "$PROJECT_ROOT"

echo "================================================"
echo "6Gang 数据流水线"
echo "项目根目录: $PROJECT_ROOT"
echo "断点续跑: $RESUME"
echo "跳过标注: $SKIP_LABEL"
echo "================================================"

# ── 阶段 1: 文档解析 → segments ──
run_step "extract" "阶段 1/10: 文档解析 → segments" \
  "$SCRIPT_DIR/process_all.py"

# ── 阶段 2: 数据清洗 ──
run_step "clean" "阶段 2/10: 数据清洗 (v2.1-demo)" \
  "$SCRIPT_DIR/clean_segments_v2_demo.py"

# ── 阶段 3: AI 打标 ──
if $SKIP_LABEL; then
  echo "⏭️  跳过阶段 3: AI 打标 (--skip-label)"
else
  run_step "label" "阶段 3/10: AI 打标 (v3.1)" \
    "$SCRIPT_DIR/label_all_v3.py" --resume --workers 3
fi

# ── 阶段 4: 合并标注 ──
run_step "merge" "阶段 4/10: 合并标注" \
  "$SCRIPT_DIR/merge_labeled_by_project.py"

# ── 阶段 5: Segment Embedding ──
run_step "embed_seg" "阶段 5/10: Segment Embedding (bge-m3)" \
  "$SCRIPT_DIR/embed_segments.py"

# ── 阶段 6: 生成画像 ──
run_step "profile" "阶段 6/10: 生成 Profile" \
  "$SCRIPT_DIR/generate_profiles.py"

# ── 阶段 7: Profile Embedding ──
run_step "embed_prof" "阶段 7/10: Profile Embedding (bge-m3)" \
  "$SCRIPT_DIR/embed_profiles_v2.py"

# ── 阶段 8: 导入数据库 ──
run_step "import" "阶段 8/10: 导入 source_segments 表" \
  "$SCRIPT_DIR/import_source_segments.py"

# ── 阶段 9: 受访者分类 ──
run_step "classify" "阶段 9/10: 受访者分类" \
  "$SCRIPT_DIR/classify_respondents.py"

# ── 阶段 10: 聚类分析 ──
run_step "cluster" "阶段 10/10: 聚类分析 (HDBSCAN)" \
  "$SCRIPT_DIR/cluster_personas.py"

echo ""
echo "================================================"
echo "🎉 流水线全部完成！"
echo "================================================"