#!/usr/bin/env python3
"""
6Gang AI Persona 评测全流程入口
================================
一键运行 A/B/C/D 四层评测。

用法：
  # 完整 C 层评测（150 题 × 5 画像 = 750 次对话）
  python3 scripts/eval_all.py --layer C --all-personas

  # 仅 A 层（需要先有 feature_matrix）
  python3 scripts/eval_all.py --layer A

  # 全部四层
  python3 scripts/eval_all.py --layer all

  # 快速测试
  python3 scripts/eval_all.py --layer C --limit 5 --no-judge

环境要求：
  - Docker + PostgreSQL 运行中
  - API 服务器运行中 (http://localhost:3000)
  - Python 依赖：numpy, scipy, scikit-learn, requests
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path


def run_cmd(cmd: str, cwd: str = None, timeout: int = None):
    """运行命令并打印输出"""
    print(f"\n  > {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.stdout:
        print(result.stdout[-500:])  # 只打印最后 500 字符
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr[-300:]}")
    return result.returncode == 0


def check_prerequisites():
    """检查环境是否就绪"""
    print("=" * 60)
    print("环境检查")
    print("=" * 60)

    checks = []

    # 1. Docker + PostgreSQL
    result = subprocess.run("docker ps --filter name=postgres --format '{{.Status}}'",
                            shell=True, capture_output=True, text=True)
    if "healthy" in result.stdout or "Up" in result.stdout:
        print("  ✅ PostgreSQL (Docker) 运行中")
        checks.append(True)
    else:
        print("  ❌ PostgreSQL 未运行 — 请先启动: docker compose up -d")
        checks.append(False)

    # 2. API Server
    import requests
    try:
        resp = requests.get("http://localhost:3000/api/health", timeout=5)
        if resp.status_code == 200:
            print("  ✅ API 服务器运行中")
            checks.append(True)
        else:
            print(f"  ❌ API 服务器异常: {resp.status_code}")
            checks.append(False)
    except Exception:
        print("  ❌ API 服务器未运行 — 请先启动: cd apps/api && bun run dev")
        checks.append(False)

    # 3. Test cases
    test_file = "data/eval/test_cases_persona_v2.0.json"
    if os.path.exists(test_file):
        with open(test_file) as f:
            data = json.load(f)
        n = data["meta"]["total_questions"]
        print(f"  ✅ 测试题集 v2.0: {n} 题")
        checks.append(True)
    else:
        print(f"  ❌ 测试题集不存在: {test_file}")
        checks.append(False)

    # 4. Personas
    try:
        resp = requests.get("http://localhost:3000/api/personas", timeout=5)
        personas = resp.json()
        print(f"  ✅ 画像数据: {len(personas)} 个画像")
        checks.append(True)
    except Exception:
        print("  ❌ 无法获取画像数据")
        checks.append(False)

    all_ok = all(checks)
    print(f"\n  {'✅ 所有检查通过' if all_ok else '❌ 部分检查未通过'}")
    return all_ok


def run_layer_C(args):
    """运行 C 层评测"""
    print("\n" + "=" * 60)
    print("C 层评测：模拟忠实度")
    print("=" * 60)

    test_file = "data/eval/test_cases_persona_v2.0.json"
    cmd = f"python3 scripts/eval_run_v3.py {test_file} --all-personas"
    if args.limit:
        cmd += f" --limit {args.limit}"
    if args.no_judge:
        cmd += " --no-judge"
    if args.delay:
        cmd += f" --delay {args.delay}"
    if args.out_dir:
        cmd += f" --out-dir {args.out_dir}"

    run_cmd(cmd, timeout=7200)  # 2 hours timeout


def run_layer_A(args):
    """运行 A 层评测"""
    print("\n" + "=" * 60)
    print("A 层评测：聚类真实性")
    print("=" * 60)

    fm_file = "data/eval/player_feature_matrix.json"
    cm_file = "data/eval/segment_cluster_mapping.json"

    if not os.path.exists(fm_file):
        print(f"  ⚠️  {fm_file} 不存在 — A 层需要 Pipeline 先产出特征矩阵")
        print("  跳过 A 层评测")
        return

    if not os.path.exists(cm_file):
        print(f"  ⚠️  {cm_file} 不存在")
        print("  跳过 A 层评测")
        return

    cmd = f"python3 scripts/eval_A_layer.py --feature-matrix {fm_file} --cluster-mapping {cm_file}"
    if args.out_dir:
        cmd += f" --out-dir {args.out_dir}"

    run_cmd(cmd, timeout=600)


def run_layer_B(args):
    """运行 B 层评测"""
    print("\n" + "=" * 60)
    print("B 层评测：画像真实性")
    print("=" * 60)

    matrix_file = "data/eval/results/persona_claim_evidence_matrix.json"

    if os.path.exists(matrix_file):
        cmd = f"python3 scripts/eval_B_layer.py --evaluate --matrix-file {matrix_file}"
        if args.out_dir:
            cmd += f" --out-dir {args.out_dir}"
        run_cmd(cmd, timeout=600)
    else:
        print(f"  ⚠️  {matrix_file} 不存在")
        print("  先运行 Claim 提取: python3 scripts/eval_B_layer.py --extract-claims")
        print("  跳过 B 层评测")


def run_layer_D(args):
    """运行 D 层评测"""
    print("\n" + "=" * 60)
    print("D 层评测：评价可靠性")
    print("=" * 60)

    retest_dir = "data/eval/results/retest/"
    if os.path.isdir(retest_dir) and os.listdir(retest_dir):
        cmd = f"python3 scripts/eval_D_layer.py --mode d1 --retest-dir {retest_dir}"
        if args.out_dir:
            cmd += f" --out-dir {args.out_dir}"
        run_cmd(cmd, timeout=600)
    else:
        print(f"  ⚠️  重测数据不存在: {retest_dir}")
        print("  跳过 D 层评测（D 层需要 C 层结果 + 额外实验数据）")


def generate_summary():
    """生成四层评测总览"""
    results_dir = "data/eval/results/"

    layers = {
        "A": os.path.exists(os.path.join(results_dir, "A_layer_report.json")),
        "B": os.path.exists(os.path.join(results_dir, "B_layer_report.json")),
        "C": False,  # 从最近的 C 层结果中找
        "D": os.path.exists(os.path.join(results_dir, "D_layer_report.json")),
    }

    # 找最近的 C 层结果
    for fname in sorted(os.listdir(results_dir), reverse=True):
        if fname.startswith("群体画像") and fname.endswith(".json"):
            layers["C"] = True
            break

    summary = {
        "timestamp": datetime.now().isoformat(),
        "layers_available": layers,
        "total_score": None,
        "notes": []
    }

    print("\n" + "=" * 60)
    print("评测总览")
    print("=" * 60)
    for layer, available in layers.items():
        status = "✅" if available else "❌"
        print(f"  {status} {layer} 层: {'已完成' if available else '未完成'}")

    return summary


def main():
    parser = argparse.ArgumentParser(description="6Gang AI Persona 评测全流程")
    parser.add_argument("--layer", default="C", choices=["A", "B", "C", "D", "all"],
                        help="要运行的评测层 (default: C)")
    parser.add_argument("--all-personas", action="store_true", default=True,
                        help="所有画像共用一套测试题")
    parser.add_argument("--limit", type=int, default=None, help="限制测试题数（用于快速测试）")
    parser.add_argument("--no-judge", action="store_true", help="跳过 Judge 评分")
    parser.add_argument("--delay", type=float, default=1.0, help="请求间隔（秒）")
    parser.add_argument("--out-dir", default=None, help="输出目录")
    parser.add_argument("--skip-check", action="store_true", help="跳过环境检查")
    args = parser.parse_args()

    print("╔══════════════════════════════════════════════════════════╗")
    print("║   6Gang AI Persona 评测系统 v2.0                        ║")
    print("║   四层评价体系：A聚类真实性 | B画像真实性 | C模拟忠实度 | D评价可靠性 ║")
    print("╚══════════════════════════════════════════════════════════╝")

    # 环境检查
    if not args.skip_check:
        if not check_prerequisites():
            print("\n请先解决环境问题后再运行评测")
            sys.exit(1)

    # 运行评测
    if args.layer in ("A", "all"):
        run_layer_A(args)
    if args.layer in ("B", "all"):
        run_layer_B(args)
    if args.layer in ("C", "all"):
        run_layer_C(args)
    if args.layer in ("D", "all"):
        run_layer_D(args)

    # 生成总览
    generate_summary()

    print(f"\n✅ 评测完成")
    print(f"结果目录: data/eval/results/")


if __name__ == "__main__":
    main()