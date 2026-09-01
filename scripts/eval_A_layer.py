#!/usr/bin/env python3
"""
A 层评测：聚类真实性 (Cluster Authenticity)
============================================
基于评测指标字典 V1.0，实现 A1-A6 全部指标的计算。

输入：
  - player_feature_matrix.json：玩家×特征矩阵（M1-M5 特征向量）
  - segment_cluster_mapping.json：玩家→聚类标签映射
  - persona_claim_evidence_matrix.json（用于 A6）

输出：
  - data/eval/results/A_layer_report.json：完整 A 层报告 + 各指标分数

用法：
  python3 scripts/eval_A_layer.py \\
    --feature-matrix data/eval/player_feature_matrix.json \\
    --cluster-mapping data/eval/segment_cluster_mapping.json \\
    [--claim-evidence data/eval/persona_claim_evidence_matrix.json] \\
    [--bootstrap-iterations 100] \\
    [--out-dir data/eval/results/]
"""

import argparse
import json
import math
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.metrics.pairwise import cosine_similarity
from scipy.spatial.distance import pdist, squareform
from scipy.stats import entropy as scipy_entropy

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

def to_score(raw: float, reverse: bool = False) -> float:
    """将原始值转为 0-100 分数"""
    raw = max(0.0, min(1.0, raw))
    if reverse:
        return 100.0 * (1.0 - raw)
    return 100.0 * raw

def safe_mean(arr):
    arr = [x for x in arr if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return float(np.mean(arr)) if arr else 0.0

# ============================================================
# A1: 类内一致性 (Cohesion)
# ============================================================

def compute_A1_cohesion(features_by_cluster: dict, m_labels: list = None) -> dict:
    """
    A1-1 ~ A1-5: 每个 M 层的类内平均余弦相似度
    A1-6: 整体语义凝聚力（所有特征的类内平均余弦相似度）

    输入：features_by_cluster = {cluster_id: np.array(n_samples, n_features)}
    输出：各子指标分数 + 聚合分数
    """
    if m_labels is None:
        m_labels = ["M1", "M2", "M3", "M4", "M5"]

    results = {}
    all_cohesions = []

    for cluster_id, feats in features_by_cluster.items():
        if len(feats) < 2:
            continue
        sim_matrix = cosine_similarity(feats)
        # 取上三角（排除对角线）
        triu_indices = np.triu_indices_from(sim_matrix, k=1)
        mean_sim = float(np.mean(sim_matrix[triu_indices]))
        results[f"cluster_{cluster_id}"] = {
            "cohesion": mean_sim,
            "n_samples": len(feats)
        }
        all_cohesions.append(mean_sim)

    avg_cohesion = safe_mean(all_cohesions)

    return {
        "A1_overall_cohesion": avg_cohesion,
        "A1_score": to_score(avg_cohesion),
        "A1_per_cluster": results,
        "A1_note": "M-layer specific cohesion requires M-layer feature subsets; this computes overall cohesion"
    }

# ============================================================
# A2: 类间区分度 (Separation)
# ============================================================

def compute_A2_separation(features_by_cluster: dict) -> dict:
    """
    A2: 类间区分度
    方法：计算所有聚类中心两两之间的余弦距离（1 - 余弦相似度）
    距离越大 → 区分度越好
    """
    centroids = {}
    for cluster_id, feats in features_by_cluster.items():
        centroids[cluster_id] = np.mean(feats, axis=0)

    cluster_ids = sorted(centroids.keys())
    n_clusters = len(cluster_ids)

    if n_clusters < 2:
        return {"A2_note": "Need at least 2 clusters for separation analysis", "A2_score": 0}

    distances = []
    pairs = []
    for i in range(n_clusters):
        for j in range(i + 1, n_clusters):
            c1, c2 = cluster_ids[i], cluster_ids[j]
            sim = cosine_similarity([centroids[c1]], [centroids[c2]])[0][0]
            dist = 1.0 - sim
            distances.append(dist)
            pairs.append({"cluster_a": int(c1), "cluster_b": int(c2), "cosine_distance": float(dist)})

    avg_separation = safe_mean(distances)

    return {
        "A2_avg_separation": avg_separation,
        "A2_score": to_score(avg_separation),
        "A2_per_pair": pairs,
        "A2_min_separation": float(min(distances)),
        "A2_max_separation": float(max(distances)),
    }

# ============================================================
# A3: 聚类稳定性 (Stability)
# ============================================================

def compute_A3_stability(features: np.ndarray, labels: np.ndarray,
                         n_iterations: int = 100, sample_ratio: float = 0.8) -> dict:
    """
    A3-1: Bootstrap ARI — 对样本做 Bootstrap 重采样，计算 ARI 的均值和方差
    A3-2: Cluster Jaccard — Bootstrap 下每个聚类成员的重叠度
    A3-3: Parameter Robustness — 不同参数下的聚类稳定性（需要多次运行聚类）

    输入：features = (n_samples, n_features), labels = (n_samples,)
    """
    n_samples = len(features)
    n_bootstrap = int(n_samples * sample_ratio)

    ari_values = []
    jaccard_values = []

    unique_labels = sorted(set(labels))
    orig_clusters = {l: set(np.where(labels == l)[0]) for l in unique_labels}

    for iteration in range(n_iterations):
        # Bootstrap 采样
        indices = np.random.choice(n_samples, n_bootstrap, replace=True)
        unique_idx = np.unique(indices)
        boot_features = features[unique_idx]
        boot_labels = labels[unique_idx]

        # 对 Bootstrap 样本做 KMeans（用原始聚类数）
        from sklearn.cluster import KMeans
        n_clusters = len(unique_labels)
        if len(unique_idx) < n_clusters:
            continue

        km = KMeans(n_clusters=n_clusters, random_state=iteration, n_init=10)
        boot_pred = km.fit_predict(boot_features)

        # ARI
        ari = adjusted_rand_score(boot_labels, boot_pred)
        ari_values.append(ari)

        # Jaccard: 每个原始聚类的成员在 Bootstrap 聚类中的最大重叠
        boot_clusters = {l: set(np.where(boot_pred == l)[0]) for l in range(n_clusters)}
        for orig_label, orig_members in orig_clusters.items():
            # 找出 Bootstrap 中与原始聚类重叠最大的聚类
            boot_members_in_sample = orig_members & set(unique_idx)
            if not boot_members_in_sample:
                continue
            max_jaccard = 0.0
            for boot_label, boot_members in boot_clusters.items():
                intersection = len(boot_members_in_sample & boot_members)
                union = len(boot_members_in_sample | boot_members)
                j = intersection / union if union > 0 else 0.0
                max_jaccard = max(max_jaccard, j)
            jaccard_values.append(max_jaccard)

    avg_ari = safe_mean(ari_values)
    std_ari = float(np.std(ari_values)) if ari_values else 0.0
    avg_jaccard = safe_mean(jaccard_values)

    # ARI 分数：直接使用
    ari_score = to_score(avg_ari)
    jaccard_score = to_score(avg_jaccard)

    return {
        "A3_1_bootstrap_ARI": avg_ari,
        "A3_1_ARI_std": std_ari,
        "A3_1_score": ari_score,
        "A3_2_avg_jaccard": avg_jaccard,
        "A3_2_score": jaccard_score,
        "A3_3_note": "Parameter robustness requires running clustering with different parameters (e.g., n_clusters ± 2, different linkage methods). Not computed here.",
        "A3_n_iterations": n_iterations,
        "A3_redline": avg_ari < 0.70  # 红线：ARI < 0.70
    }

# ============================================================
# A4: 玩家级一致性 (Player Consistency)
# ============================================================

def compute_A4_player_consistency(features: np.ndarray, labels: np.ndarray) -> dict:
    """
    A4-1: Player Purity — 每个玩家到其聚类中心的平均距离
    A4-2: Player Entropy — 玩家到各聚类中心的距离分布的熵
    A4-3: Player Dominance — 最近聚类 vs 次近聚类的距离比

    输入：features = (n_samples, n_features), labels = (n_samples,)
    """
    unique_labels = sorted(set(labels))
    n_samples = len(features)

    # 计算各聚类中心
    centroids = {}
    for l in unique_labels:
        mask = labels == l
        centroids[l] = np.mean(features[mask], axis=0)

    purities = []
    entropies = []
    dominances = []

    for i in range(n_samples):
        feat = features[i]
        true_label = labels[i]

        # 到各聚类中心的距离
        distances = {}
        for l in unique_labels:
            sim = cosine_similarity([feat], [centroids[l]])[0][0]
            distances[l] = 1.0 - sim  # 余弦距离

        # A4-1: 到所属聚类中心的距离（越小越好）
        purity = 1.0 - distances[true_label]  # 转为相似度
        purities.append(purity)

        # A4-2: 距离分布的熵（越高表示越均匀，越不好）
        dist_array = np.array([distances[l] for l in unique_labels])
        # 归一化距离为概率分布
        if dist_array.sum() > 0:
            prob = dist_array / dist_array.sum()
        else:
            prob = np.ones(len(unique_labels)) / len(unique_labels)
        ent = scipy_entropy(prob)
        # 归一化熵：除以最大可能熵
        max_ent = math.log(len(unique_labels))
        norm_ent = ent / max_ent if max_ent > 0 else 0.0
        entropies.append(norm_ent)

        # A4-3: 最近 vs 次近
        sorted_dists = sorted(distances.items(), key=lambda x: x[1])
        if len(sorted_dists) >= 2:
            nearest = sorted_dists[0][1]
            second = sorted_dists[1][1]
            if second > 0:
                dominance = nearest / second  # 越小越好
            else:
                dominance = 0.0
            dominances.append(dominance)

    avg_purity = safe_mean(purities)
    avg_entropy = safe_mean(entropies)
    avg_dominance = safe_mean(dominances)

    # 转换分数
    purity_score = to_score(avg_purity)
    entropy_score = to_score(1.0 - avg_entropy)  # 低熵 → 高分
    dominance_score = to_score(1.0 - avg_dominance)  # 低 ratio → 高分

    return {
        "A4_1_avg_purity": avg_purity,
        "A4_1_score": purity_score,
        "A4_2_avg_entropy": avg_entropy,
        "A4_2_score": entropy_score,
        "A4_3_avg_dominance_ratio": avg_dominance,
        "A4_3_score": dominance_score,
    }

# ============================================================
# A5: 聚类覆盖率 (Cluster Coverage)
# ============================================================

def compute_A5_coverage(labels: np.ndarray, total_population: int = None) -> dict:
    """
    A5-1: Segment Coverage — 聚类覆盖的玩家段位/类型数
    A5-2: Player Coverage — 被聚类的玩家占总玩家的比例
    """
    unique_labels = set(labels)
    n_clusters = len(unique_labels)
    n_players = len(labels)

    # 每个聚类的大小
    cluster_sizes = Counter(labels.tolist() if hasattr(labels, 'tolist') else list(labels))

    # 最小聚类比例
    min_cluster_ratio = min(cluster_sizes.values()) / n_players if n_players > 0 else 0.0

    # 最大聚类比例
    max_cluster_ratio = max(cluster_sizes.values()) / n_players if n_players > 0 else 0.0

    # A5-1: 聚类数是否合理
    segment_coverage = min(n_clusters / 10.0, 1.0)  # 假设 10 个聚类 = 满分

    # A5-2: 玩家覆盖率
    player_coverage = n_players / total_population if total_population else 1.0

    return {
        "A5_1_n_clusters": n_clusters,
        "A5_1_segment_coverage_score": to_score(segment_coverage),
        "A5_2_n_players": n_players,
        "A5_2_player_coverage": player_coverage,
        "A5_2_score": to_score(player_coverage),
        "A5_cluster_sizes": {str(k): v for k, v in cluster_sizes.items()},
        "A5_min_cluster_ratio": min_cluster_ratio,
        "A5_max_cluster_ratio": max_cluster_ratio,
    }

# ============================================================
# A6: 聚类可解释性 (Interpretability)
# ============================================================

def compute_A6_interpretability(claim_evidence: list = None) -> dict:
    """
    A6-1: Evidence-backed Claims — 有证据支撑的 Claims 比例
    A6-2: Human Interpretability — 人工评估聚类标签是否可理解

    需要 claim_evidence_matrix 或人工标注数据
    """
    if claim_evidence is None:
        return {
            "A6_note": "Claim-Evidence Matrix not available. A6 requires B-layer output.",
            "A6_1_score": None,
            "A6_2_score": None,
        }

    # 统计有证据支撑的 claims
    total_claims = len(claim_evidence)
    backed_claims = sum(1 for c in claim_evidence if c.get("evidence_count", 0) > 0)

    if total_claims > 0:
        evidence_ratio = backed_claims / total_claims
    else:
        evidence_ratio = 0.0

    return {
        "A6_1_total_claims": total_claims,
        "A6_1_backed_claims": backed_claims,
        "A6_1_evidence_ratio": evidence_ratio,
        "A6_1_score": to_score(evidence_ratio),
        "A6_2_note": "Human interpretability requires manual evaluation. Use rubric from cluster_interpretability_rubric.json",
    }

# ============================================================
# 主函数
# ============================================================

def compute_A_layer(feature_matrix: np.ndarray, labels: np.ndarray,
                    claim_evidence: list = None,
                    bootstrap_iterations: int = 100,
                    total_population: int = None) -> dict:
    """
    计算所有 A 层指标
    """
    # 组织为 per-cluster 特征
    unique_labels = sorted(set(labels))
    features_by_cluster = {}
    for l in unique_labels:
        mask = labels == l
        features_by_cluster[int(l)] = feature_matrix[mask]

    results = {}

    # A1: 类内一致性
    print("  Computing A1: Cohesion...")
    results["A1"] = compute_A1_cohesion(features_by_cluster)

    # A2: 类间区分度
    print("  Computing A2: Separation...")
    results["A2"] = compute_A2_separation(features_by_cluster)

    # A3: 聚类稳定性
    print(f"  Computing A3: Stability ({bootstrap_iterations} iterations)...")
    results["A3"] = compute_A3_stability(feature_matrix, labels, n_iterations=bootstrap_iterations)

    # A4: 玩家级一致性
    print("  Computing A4: Player Consistency...")
    results["A4"] = compute_A4_player_consistency(feature_matrix, labels)

    # A5: 聚类覆盖率
    print("  Computing A5: Coverage...")
    results["A5"] = compute_A5_coverage(labels, total_population)

    # A6: 可解释性
    print("  Computing A6: Interpretability...")
    results["A6"] = compute_A6_interpretability(claim_evidence)

    # 加权总分
    weights = {
        "A1": 10.0, "A2": 10.0, "A3": 8.0,
        "A4": 7.0, "A5": 3.0, "A6": 2.0
    }

    total_score = 0.0
    total_weight = 0.0
    component_scores = {}

    for key, w in weights.items():
        scores = []
        for sub_key, val in results[key].items():
            if sub_key.endswith("_score") and val is not None:
                scores.append(val)
        if scores:
            avg = safe_mean(scores)
            component_scores[key] = {
                "avg_score": avg,
                "weight": w,
                "weighted": avg * w / 100.0
            }
            total_score += avg * w
            total_weight += w

    results["_summary"] = {
        "total_score": total_score / total_weight if total_weight > 0 else 0.0,
        "total_weighted": total_score,
        "max_weighted": total_weight * 100.0,
        "component_scores": component_scores,
        "weights": weights,
    }

    return results


def main():
    parser = argparse.ArgumentParser(description="A 层评测：聚类真实性")
    parser.add_argument("--feature-matrix", required=True, help="玩家特征矩阵 JSON")
    parser.add_argument("--cluster-mapping", required=True, help="玩家→聚类标签映射 JSON")
    parser.add_argument("--claim-evidence", default=None, help="Claim-Evidence Matrix JSON (用于 A6)")
    parser.add_argument("--bootstrap-iterations", type=int, default=100, help="Bootstrap 迭代次数")
    parser.add_argument("--total-population", type=int, default=None, help="总玩家数（用于 A5 覆盖率）")
    parser.add_argument("--out-dir", default="data/eval/results/", help="输出目录")
    args = parser.parse_args()

    print("=" * 60)
    print("A 层评测：聚类真实性 (Cluster Authenticity)")
    print("=" * 60)

    # 加载数据
    print(f"\nLoading feature matrix: {args.feature_matrix}")
    fm_data = load_json(args.feature_matrix)

    print(f"Loading cluster mapping: {args.cluster_mapping}")
    cm_data = load_json(args.cluster_mapping)

    # 解析数据格式
    # 支持两种格式：
    # 格式1: {features: [[...], ...], labels: [...]}
    # 格式2: [{player_id, features: [...], cluster_id}]
    if isinstance(fm_data, dict) and "features" in fm_data:
        features = np.array(fm_data["features"])
        labels = np.array(fm_data.get("labels", cm_data.get("labels", [])))
    elif isinstance(fm_data, list):
        features = np.array([item["features"] for item in fm_data])
        labels = np.array([item.get("cluster_id", item.get("label")) for item in fm_data])
    else:
        print("ERROR: Unrecognized feature matrix format")
        sys.exit(1)

    print(f"  Features: {features.shape}")
    print(f"  Clusters: {len(set(labels))}")
    print(f"  Samples: {len(labels)}")

    # 加载 Claim Evidence（可选）
    claim_evidence = None
    if args.claim_evidence and os.path.exists(args.claim_evidence):
        claim_evidence = load_json(args.claim_evidence)
        if isinstance(claim_evidence, dict):
            claim_evidence = claim_evidence.get("claims", claim_evidence.get("data", []))

    # 计算
    results = compute_A_layer(
        features, labels,
        claim_evidence=claim_evidence,
        bootstrap_iterations=args.bootstrap_iterations,
        total_population=args.total_population,
    )

    # 输出
    out_path = os.path.join(args.out_dir, "A_layer_report.json")
    save_json(results, out_path)

    # 打印摘要
    summary = results["_summary"]
    print(f"\n{'='*60}")
    print(f"A 层评测结果")
    print(f"{'='*60}")
    for key, comp in summary["component_scores"].items():
        print(f"  {key}: {comp['avg_score']:.1f} (weight={comp['weight']}%)")
    print(f"  {'─'*40}")
    print(f"  TOTAL: {summary['total_score']:.1f}/100")
    print(f"\nReport saved to: {out_path}")

    # 红线检查
    redlines = []
    a3 = results.get("A3", {})
    if a3.get("A3_redline"):
        redlines.append(f"⚠️  A3 Bootstrap ARI = {a3.get('A3_1_bootstrap_ARI', 0):.3f} < 0.70 (REDLINE)")

    if redlines:
        print(f"\n🚨 REDLINE WARNINGS:")
        for r in redlines:
            print(f"  {r}")
    else:
        print(f"\n✅ No redline violations detected")


if __name__ == "__main__":
    main()