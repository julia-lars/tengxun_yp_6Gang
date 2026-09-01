#!/usr/bin/env python3
"""
D 层评测：评价可靠性 (Evaluation Reliability)
==============================================
基于评测指标字典 V1.0，实现 D1-D4 全部指标的计算。

D1: Test-Retest Reliability — 同一问题同一画像多次回答的一致性
D2: Judge Agreement — 多个 LLM Judge 之间的评分一致性
D3: Human Agreement — LLM Judge 与人工评分的一致性
D4: Judge Robustness — Judge 对 Prompt/Temperature/Model 变化的敏感度

依赖：C 层评测结果

输入：
  - C 层评测结果（含有 LLM Judge 评分）
  - D1: 重测样本（同一问题重复发送 2-3 次）
  - D2: 多 Judge 配置（不同 Model/Temperature）
  - D3: 人工评分样本
  - D4: 不同 Prompt/Temperature 下的评分结果

输出：
  - data/eval/results/D_layer_report.json

用法：
  python3 scripts/eval_D_layer.py \\
    --c-results data/eval/results/eval_results_*.json \\
    --mode d1|d2|d3|d4|all \\
    [--retest-dir data/eval/results/retest/] \\
    [--human-scores data/eval/results/human_scores.json] \\
    [--out-dir data/eval/results/]
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np

# ============================================================
# 工具函数
# ============================================================

def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_json(data, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def safe_mean(arr):
    arr = [x for x in arr if x is not None and not (isinstance(x, float) and np.isnan(x))]
    return float(np.mean(arr)) if arr else 0.0

# ============================================================
# D1: Test-Retest Reliability (ICC)
# ============================================================

def compute_D1_test_retest(retest_results: list) -> dict:
    """
    D1: 测试-重测信度

    方法：对同一问题 × 同一画像的多次回答，计算各评分维度的 Intraclass Correlation Coefficient (ICC)

    输入格式：
    [
      {
        "question_id": "Q-001",
        "persona_id": 1,
        "scores": [
          {"run": 1, "dimensions": {"人设一致性": 85, "专业准确性": 72, ...}},
          {"run": 2, "dimensions": {"人设一致性": 82, "专业准确性": 75, ...}},
          {"run": 3, "dimensions": {"人设一致性": 88, "专业准确性": 70, ...}}
        ]
      },
      ...
    ]

    使用 ICC(3,1) — Two-way Mixed Effects, Single Rater, Absolute Agreement
    简化实现：使用 Pearson 相关系数作为 ICC 的近似
    """
    # 收集所有评分维度
    all_dimensions = set()
    for item in retest_results:
        for run_data in item.get("scores", []):
            for dim in run_data.get("dimensions", {}):
                all_dimensions.add(dim)

    dim_icc = {}

    for dim in sorted(all_dimensions):
        # 每个 question × persona 组内：收集多次评分
        group_scores = []
        for item in retest_results:
            scores = []
            for run_data in item.get("scores", []):
                d = run_data.get("dimensions", {})
                if dim in d:
                    scores.append(d[dim])
            if len(scores) >= 2:
                group_scores.append(scores)

        if len(group_scores) < 3:
            dim_icc[dim] = {"icc": None, "n_groups": len(group_scores), "note": "Insufficient data"}
            continue

        # 计算 ICC(3,1) 简化版
        # ICC = (MS_between - MS_within) / (MS_between + (k-1) * MS_within)
        # 其中 k = 平均重复次数

        k_avg = safe_mean([len(g) for g in group_scores])

        # 组间方差
        group_means = [safe_mean(g) for g in group_scores]
        grand_mean = safe_mean(group_means)
        ms_between = sum(len(g) * (safe_mean(g) - grand_mean)**2 for g in group_scores) / (len(group_scores) - 1) if len(group_scores) > 1 else 0

        # 组内方差
        ss_within = 0
        df_within = 0
        for g in group_scores:
            g_mean = safe_mean(g)
            ss_within += sum((x - g_mean)**2 for x in g)
            df_within += len(g) - 1
        ms_within = ss_within / df_within if df_within > 0 else 0

        if ms_between + (k_avg - 1) * ms_within > 0:
            icc = (ms_between - ms_within) / (ms_between + (k_avg - 1) * ms_within)
        else:
            icc = 0.0

        # ICC 限制在 [0, 1]
        icc = max(0.0, min(1.0, icc))

        dim_icc[dim] = {
            "icc": icc,
            "score": icc * 100.0,
            "n_groups": len(group_scores),
            "k_avg": k_avg,
            "ms_between": ms_between,
            "ms_within": ms_within,
        }

    # 聚合所有维度的 ICC
    icc_values = [d["icc"] for d in dim_icc.values() if d["icc"] is not None]
    avg_icc = safe_mean(icc_values)

    # 红线：ICC < 0.70
    redline = avg_icc < 0.70

    return {
        "D1_per_dimension": dim_icc,
        "D1_avg_icc": avg_icc,
        "D1_score": avg_icc * 100.0,
        "D1_redline": redline,
        "D1_redline_threshold": 0.70,
    }

# ============================================================
# D2: Judge Agreement (Inter-Rater Reliability)
# ============================================================

def compute_D2_judge_agreement(judge_results: list) -> dict:
    """
    D2: 多个 LLM Judge 之间的评分一致性

    输入格式：
    [
      {
        "question_id": "Q-001",
        "persona_id": 1,
        "judges": [
          {"judge_id": "judge_default", "dimensions": {"人设一致性": 85, ...}},
          {"judge_id": "judge_strict", "dimensions": {"人设一致性": 78, ...}},
          {"judge_id": "judge_lenient", "dimensions": {"人设一致性": 90, ...}}
        ]
      },
      ...
    ]

    使用 Kendall's W (Kendall Coefficient of Concordance) 或 Fleiss' Kappa
    """
    # 收集所有评分维度
    all_dimensions = set()
    for item in judge_results:
        for judge_data in item.get("judges", []):
            for dim in judge_data.get("dimensions", {}):
                all_dimensions.add(dim)

    dim_agreement = {}

    for dim in sorted(all_dimensions):
        # 对每个 question × persona，收集多个 judge 的评分
        pairwise_diffs = []
        judge_scores_by_item = []

        for item in judge_results:
            scores = []
            for judge_data in item.get("judges", []):
                d = judge_data.get("dimensions", {})
                if dim in d:
                    scores.append(d[dim])
            if len(scores) >= 2:
                judge_scores_by_item.append(scores)
                # 计算两两差异
                for i in range(len(scores)):
                    for j in range(i + 1, len(scores)):
                        pairwise_diffs.append(abs(scores[i] - scores[j]))

        if len(pairwise_diffs) < 5:
            dim_agreement[dim] = {"agreement": None, "n_items": len(judge_scores_by_item), "note": "Insufficient data"}
            continue

        # 平均绝对差异 (MAD) — 越小越好
        avg_mad = safe_mean(pairwise_diffs)

        # 转换为一致性分数：MAD=0 → 100, MAD=20 → 0
        agreement = max(0.0, 1.0 - avg_mad / 20.0)

        dim_agreement[dim] = {
            "avg_mad": avg_mad,
            "agreement": agreement,
            "score": agreement * 100.0,
            "n_items": len(judge_scores_by_item),
            "n_comparisons": len(pairwise_diffs),
        }

    # 聚合
    agreement_values = [d["agreement"] for d in dim_agreement.values() if d["agreement"] is not None]
    avg_agreement = safe_mean(agreement_values)

    return {
        "D2_per_dimension": dim_agreement,
        "D2_avg_agreement": avg_agreement,
        "D2_score": avg_agreement * 100.0,
    }

# ============================================================
# D3: Human Agreement (Human-LLM Calibration)
# ============================================================

def compute_D3_human_agreement(human_scores: list, llm_scores: list) -> dict:
    """
    D3: 人工评分与 LLM Judge 评分的一致性

    输入格式：
    human_scores: [
      {"question_id": "Q-001", "persona_id": 1, "dimensions": {"人设一致性": 90, ...}}
    ]
    llm_scores: 同上格式

    使用 Pearson r 和 Spearman rho
    """
    # 收集所有评分维度
    all_dimensions = set()
    for item in human_scores:
        for dim in item.get("dimensions", {}):
            all_dimensions.add(dim)

    # 构建匹配对
    from scipy.stats import pearsonr, spearmanr

    dim_calibration = {}

    for dim in sorted(all_dimensions):
        human_vals = []
        llm_vals = []

        # 按 question_id + persona_id 匹配
        human_map = {}
        for item in human_scores:
            key = (item.get("question_id"), item.get("persona_id"))
            d = item.get("dimensions", {})
            if dim in d:
                human_map[key] = d[dim]

        for item in llm_scores:
            key = (item.get("question_id"), item.get("persona_id"))
            d = item.get("dimensions", {})
            if key in human_map and dim in d:
                human_vals.append(human_map[key])
                llm_vals.append(d[dim])

        if len(human_vals) < 5:
            dim_calibration[dim] = {"pearson_r": None, "n_pairs": len(human_vals), "note": "Insufficient data"}
            continue

        try:
            r, p_r = pearsonr(human_vals, llm_vals)
            rho, p_rho = spearmanr(human_vals, llm_vals)
        except Exception:
            r, rho = 0.0, 0.0

        dim_calibration[dim] = {
            "pearson_r": r,
            "spearman_rho": rho,
            "score": max(0.0, r) * 100.0,  # 用 Pearson r
            "n_pairs": len(human_vals),
            "mean_human": safe_mean(human_vals),
            "mean_llm": safe_mean(llm_vals),
            "bias": safe_mean(llm_vals) - safe_mean(human_vals),  # LLM 系统性偏差
        }

    r_values = [d["pearson_r"] for d in dim_calibration.values() if d["pearson_r"] is not None]
    avg_r = safe_mean(r_values)

    return {
        "D3_per_dimension": dim_calibration,
        "D3_avg_pearson_r": avg_r,
        "D3_score": max(0.0, avg_r) * 100.0,
    }

# ============================================================
# D4: Judge Robustness (Prompt/Model/Temperature Sensitivity)
# ============================================================

def compute_D4_judge_robustness(robustness_results: list) -> dict:
    """
    D4: Judge 对 Prompt/Model/Temperature 变化的敏感度

    输入格式：
    [
      {
        "question_id": "Q-001",
        "persona_id": 1,
        "variants": [
          {"variant": "baseline", "model": "deepseek-v4-flash", "temperature": 0.0, "dimensions": {...}},
          {"variant": "temp_0.5", "model": "deepseek-v4-flash", "temperature": 0.5, "dimensions": {...}},
          {"variant": "model_b", "model": "gpt-4o", "temperature": 0.0, "dimensions": {...}},
          {"variant": "prompt_v2", "model": "deepseek-v4-flash", "temperature": 0.0, "dimensions": {...}},
        ]
      }
    ]

    计算每个 variant 与 baseline 的评分差异
    """
    all_dimensions = set()
    for item in robustness_results:
        for variant in item.get("variants", []):
            for dim in variant.get("dimensions", {}):
                all_dimensions.add(dim)

    variant_analysis = defaultdict(lambda: defaultdict(list))

    for item in robustness_results:
        variants = item.get("variants", [])
        baseline = None
        for v in variants:
            if v.get("variant") == "baseline":
                baseline = v
                break

        if baseline is None:
            continue

        for v in variants:
            if v.get("variant") == "baseline":
                continue
            for dim in all_dimensions:
                base_val = baseline.get("dimensions", {}).get(dim)
                var_val = v.get("dimensions", {}).get(dim)
                if base_val is not None and var_val is not None:
                    variant_analysis[v["variant"]][dim].append(abs(var_val - base_val))

    # 汇总每个 variant 的敏感度
    variant_sensitivity = {}
    for variant_name, dim_diffs in variant_analysis.items():
        dim_stats = {}
        all_diffs = []
        for dim, diffs in dim_diffs.items():
            if diffs:
                avg = safe_mean(diffs)
                dim_stats[dim] = {"avg_diff": avg, "n": len(diffs)}
                all_diffs.extend(diffs)

        avg_diff = safe_mean(all_diffs)
        # 敏感度越低越好：avg_diff=0 → 100, avg_diff=15 → 0
        robustness = max(0.0, 1.0 - avg_diff / 15.0)

        variant_sensitivity[variant_name] = {
            "avg_diff": avg_diff,
            "max_diff": float(max(all_diffs)) if all_diffs else 0.0,
            "robustness": robustness,
            "score": robustness * 100.0,
            "per_dimension": dim_stats,
        }

    # 聚合所有 variant
    robustness_values = [v["robustness"] for v in variant_sensitivity.values()]
    avg_robustness = safe_mean(robustness_values)

    return {
        "D4_variants": variant_sensitivity,
        "D4_avg_robustness": avg_robustness,
        "D4_score": avg_robustness * 100.0,
    }

# ============================================================
# 主函数
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="D 层评测：评价可靠性")
    parser.add_argument("--c-results", default=None, help="C 层评测结果 JSON 文件路径")
    parser.add_argument("--mode", default="d1", choices=["d1", "d2", "d3", "d4", "all"],
                        help="评测模式")
    parser.add_argument("--retest-dir", default=None, help="重测结果目录 (D1)")
    parser.add_argument("--judge-results", default=None, help="多 Judge 评分结果 (D2)")
    parser.add_argument("--human-scores", default=None, help="人工评分 JSON (D3)")
    parser.add_argument("--llm-scores", default=None, help="LLM Judge 评分 JSON (D3)")
    parser.add_argument("--robustness-results", default=None, help="Robustness 测试结果 (D4)")
    parser.add_argument("--out-dir", default="data/eval/results/", help="输出目录")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    results = {}

    if args.mode in ("d1", "all"):
        print("=" * 60)
        print("D1: Test-Retest Reliability")
        print("=" * 60)

        retest_data = []
        if args.retest_dir and os.path.isdir(args.retest_dir):
            for fname in sorted(os.listdir(args.retest_dir)):
                if fname.endswith(".json"):
                    retest_data.extend(load_json(os.path.join(args.retest_dir, fname)))
        print(f"Loaded {len(retest_data)} retest items")
        results["D1"] = compute_D1_test_retest(retest_data)

    if args.mode in ("d2", "all"):
        print("\n" + "=" * 60)
        print("D2: Judge Agreement")
        print("=" * 60)

        judge_data = []
        if args.judge_results and os.path.exists(args.judge_results):
            judge_data = load_json(args.judge_results)
        print(f"Loaded {len(judge_data)} judge comparison items")
        results["D2"] = compute_D2_judge_agreement(judge_data)

    if args.mode in ("d3", "all"):
        print("\n" + "=" * 60)
        print("D3: Human Agreement")
        print("=" * 60)

        human_data = []
        llm_data = []
        if args.human_scores and os.path.exists(args.human_scores):
            human_data = load_json(args.human_scores)
        if args.llm_scores and os.path.exists(args.llm_scores):
            llm_data = load_json(args.llm_scores)
        print(f"Loaded {len(human_data)} human scores, {len(llm_data)} LLM scores")
        results["D3"] = compute_D3_human_agreement(human_data, llm_data)

    if args.mode in ("d4", "all"):
        print("\n" + "=" * 60)
        print("D4: Judge Robustness")
        print("=" * 60)

        robustness_data = []
        if args.robustness_results and os.path.exists(args.robustness_results):
            robustness_data = load_json(args.robustness_results)
        print(f"Loaded {len(robustness_data)} robustness test items")
        results["D4"] = compute_D4_judge_robustness(robustness_data)

    if not results:
        print("No data provided. Use --retest-dir, --judge-results, --human-scores, or --robustness-results")
        print("See --help for details")
        return

    # 加权总分
    weights = {"D1": 4.0, "D2": 2.0, "D3": 2.0, "D4": 2.0}
    total_weighted = 0.0
    total_weight = 0.0
    component_scores = {}

    for key, w in weights.items():
        if key in results:
            score = results[key].get(f"{key}_score", 0)
            if score is not None:
                component_scores[key] = {"score": score, "weight": w, "weighted": score * w / 100.0}
                total_weighted += score * w
                total_weight += w

    results["_summary"] = {
        "total_score": total_weighted / total_weight if total_weight > 0 else 0.0,
        "total_weighted": total_weighted,
        "max_weighted": total_weight * 100.0,
        "component_scores": component_scores,
        "weights": weights,
    }

    out_path = os.path.join(args.out_dir, "D_layer_report.json")
    save_json(results, out_path)

    # 打印
    summary = results["_summary"]
    print(f"\n{'='*60}")
    print(f"D 层评测结果")
    print(f"{'='*60}")
    for key, comp in summary["component_scores"].items():
        print(f"  {key}: {comp['score']:.1f} (weight={comp['weight']}%)")
    print(f"  {'─'*40}")
    print(f"  TOTAL: {summary['total_score']:.1f}/100")

    # 红线
    d1 = results.get("D1", {})
    if d1.get("D1_redline"):
        print(f"\n🚨 REDLINE: D1 Test-Retest ICC = {d1.get('D1_avg_icc', 0):.3f} < 0.70")

    print(f"\nReport saved to: {out_path}")


if __name__ == "__main__":
    main()