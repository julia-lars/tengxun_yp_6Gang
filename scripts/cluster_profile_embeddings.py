#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Profile Embedding 聚类脚本 v1.0

按 docs/Profile_Embedding规范.md 对 Profile Embedding 进行 HDBSCAN 聚类。

核心流程：
  1. 读取所有 Profile Embedding JSON
  2. Quality Gate 检查
  3. Cosine Distance 计算
  4. HDBSCAN 聚类（min_cluster_size = max(3, round(N × 0.05))）
  5. 稳定性分析（Bootstrap/Resampling）
  6. 质量指标（Silhouette Score, DBI, Noise Rate）
  7. Cluster 解释（核心共同 Trait, 高区分 Trait, Dimension 分布）
  8. 输出聚类结果

用法:
  python3 scripts/cluster_profile_embeddings.py                  # 默认聚类
  python3 scripts/cluster_profile_embeddings.py --dry-run        # 只分析不输出
  python3 scripts/cluster_profile_embeddings.py --min-cluster 4  # 自定义最小簇大小
  python3 scripts/cluster_profile_embeddings.py --no-pattern     # 只用 Trait，不加 Pattern
  python3 scripts/cluster_profile_embeddings.py --pattern-weight 0.1  # 自定义 Pattern 权重

依赖: pip install numpy scipy scikit-learn hdbscan
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from hdbscan import HDBSCAN
from scipy.spatial.distance import cdist
from sklearn.metrics import davies_bouldin_score, silhouette_score
from sklearn.preprocessing import StandardScaler

# ── 配置 ──
PROFILE_EMBED_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "embed", "profiles"
)
PROFILE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "data", "群体画像v2.0_profile"
)
OUTPUT_CLUSTERS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "data", "embed", "profiles", "clusters.json"
)

# 六大 Dimension 固定顺序
DIMENSION_ORDER = [
    "context",
    "experience_capability",
    "behaviors",
    "preferences",
    "motivations_needs",
    "perceptions_beliefs",
]

# 默认参数
DEFAULT_MIN_CLUSTER_SIZE_RATIO = 0.05
BOOTSTRAP_ITERATIONS = 20


def load_profile_embeddings(embed_dir: str) -> dict[str, dict]:
    """加载所有 Profile Embedding JSON"""
    embeddings = {}
    if not os.path.exists(embed_dir):
        print(f"❌ Embedding 目录不存在: {embed_dir}")
        return embeddings

    for fname in sorted(os.listdir(embed_dir)):
        if fname.endswith("_profile_embedding.json"):
            filepath = os.path.join(embed_dir, fname)
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            rid = data.get("respondent_id", fname.replace("_profile_embedding.json", ""))
            embeddings[rid] = data

    return embeddings


def load_profile(respondent_id: str):
    """加载原始 Profile JSON"""
    filepath = os.path.join(PROFILE_DIR, f"{respondent_id}_profile.json")
    if not os.path.exists(filepath):
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_vectors(
    embeddings: dict[str, dict], use_pattern: bool = True, pattern_weight: float = 0.15
) -> tuple[np.ndarray, list[str], dict]:
    """
    从 embedding 数据中提取最终向量。

    返回: (vectors_matrix, respondent_ids, vector_metadata)
    """
    vectors = []
    respondent_ids = []
    metadata = {}

    for rid, data in sorted(embeddings.items()):
        # 优先使用已保存的 profile_embedding
        vec = data.get("profile_embedding")
        if vec is None:
            continue

        vectors.append(vec)
        respondent_ids.append(rid)
        metadata[rid] = {
            "coverage": data.get("coverage", {}),
            "dimension_vectors": data.get("dimension_vectors", {}),
            "pattern_vector": data.get("pattern_vector"),
            "profile_hash": data.get("profile_hash"),
        }

    if not vectors:
        return np.array([]), [], {}

    return np.array(vectors), respondent_ids, metadata


def run_hdbscan(
    vectors: np.ndarray,
    min_cluster_size: int,
    min_samples=None,
) -> tuple[np.ndarray, HDBSCAN]:
    """
    运行 HDBSCAN 聚类。

    使用 cosine metric（等于 precomputed cosine distance）。
    """
    if min_samples is None:
        min_samples = min_cluster_size

    # HDBSCAN 的 metric='euclidean' + 预先 L2 normalized 向量 ≈ cosine distance
    # 因为对于 L2 normalized 向量，euclidean distance ∝ cosine distance
    clusterer = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
        cluster_selection_method="eom",
        cluster_selection_epsilon=0.0,
    )
    labels = clusterer.fit_predict(vectors)
    return labels, clusterer


def compute_quality_metrics(
    vectors: np.ndarray, labels: np.ndarray
) -> dict:
    """
    计算聚类质量指标（Profile_Embedding规范 §46）。

    返回:
        silhouette_score, davies_bouldin_index, noise_rate, n_clusters
    """
    metrics = {}

    # 过滤 noise 点计算 silhouette 和 DBI
    non_noise_mask = labels != -1
    n_noise = np.sum(~non_noise_mask)
    n_total = len(labels)

    metrics["noise_count"] = int(n_noise)
    metrics["noise_rate"] = float(n_noise / n_total) if n_total > 0 else 0.0
    metrics["total_respondents"] = n_total

    if non_noise_mask.sum() > 1:
        non_noise_vectors = vectors[non_noise_mask]
        non_noise_labels = labels[non_noise_mask]
        n_clusters = len(set(non_noise_labels))

        metrics["n_clusters"] = n_clusters

        if n_clusters > 1:
            try:
                metrics["silhouette_score"] = float(
                    silhouette_score(non_noise_vectors, non_noise_labels, metric="euclidean")
                )
            except Exception:
                metrics["silhouette_score"] = None

            try:
                metrics["davies_bouldin_index"] = float(
                    davies_bouldin_score(non_noise_vectors, non_noise_labels)
                )
            except Exception:
                metrics["davies_bouldin_index"] = None
        else:
            metrics["silhouette_score"] = None
            metrics["davies_bouldin_index"] = None
    else:
        metrics["n_clusters"] = 0
        metrics["silhouette_score"] = None
        metrics["davies_bouldin_index"] = None

    return metrics


def bootstrap_stability(
    vectors: np.ndarray,
    base_labels: np.ndarray,
    min_cluster_size: int,
    n_iterations: int = BOOTSTRAP_ITERATIONS,
) -> dict:
    """
    Bootstrap 稳定性分析（Profile_Embedding规范 §45）。

    对数据重复抽样，重新聚类，比较成员归属变化。
    """
    if len(vectors) < 10 or n_iterations < 1:
        return {"stability_score": None, "iterations": 0, "note": "sample_too_small"}

    n_samples = len(vectors)
    # 使用 80% 的样本进行 bootstrap
    sample_size = max(int(n_samples * 0.8), min_cluster_size * 2)

    stability_scores = []
    for _ in range(n_iterations):
        indices = np.random.choice(n_samples, size=sample_size, replace=True)
        sample_vectors = vectors[indices]

        try:
            sample_labels, _ = run_hdbscan(sample_vectors, min_cluster_size)
            # 统计 cluster 数量的一致性
            n_clusters_sample = len(set(sample_labels)) - (1 if -1 in sample_labels else 0)
            stability_scores.append(n_clusters_sample)
        except Exception:
            continue

    if not stability_scores:
        return {"stability_score": None, "iterations": n_iterations, "note": "all_failed"}

    # 稳定性 = 1 - (cluster 数量的变异系数)
    mean_clusters = np.mean(stability_scores)
    if mean_clusters > 0:
        cv = np.std(stability_scores) / mean_clusters
        stability = max(0.0, 1.0 - cv)
    else:
        stability = 0.0

    return {
        "stability_score": float(stability),
        "iterations": n_iterations,
        "cluster_counts": [int(c) for c in stability_scores],
        "mean_clusters": float(mean_clusters),
        "std_clusters": float(np.std(stability_scores)),
    }


def compute_cluster_centroids(
    vectors: np.ndarray, labels: np.ndarray
) -> dict[int, np.ndarray]:
    """计算每个 cluster 的质心（L2 normalized）"""
    centroids = {}
    unique_labels = sorted(set(labels))
    for label in unique_labels:
        if label == -1:
            continue
        mask = labels == label
        centroid = np.mean(vectors[mask], axis=0)
        norm = np.linalg.norm(centroid)
        if norm > 0:
            centroid = centroid / norm
        centroids[int(label)] = centroid
    return centroids


def compute_cluster_similarity_matrix(centroids: dict[int, np.ndarray]) -> dict:
    """计算 cluster 间的余弦相似度矩阵"""
    labels = sorted(centroids.keys())
    centroids_array = np.array([centroids[l] for l in labels])
    # dot product = cosine similarity for L2 normalized vectors
    sim_matrix = np.dot(centroids_array, centroids_array.T)

    result = {}
    for i, label_i in enumerate(labels):
        result[str(label_i)] = {}
        for j, label_j in enumerate(labels):
            result[str(label_i)][str(label_j)] = float(sim_matrix[i][j])
    return result


def get_cluster_traits(
    cluster_respondents: list[str],
    embeddings: dict[str, dict],
    top_n: int = 10,
) -> dict:
    """
    获取 Cluster 的 Trait 分析。

    包括：
    - 核心共同 Trait（出现频率最高的 statement）
    - 高区分 Trait（正在开发中...）
    """
    trait_counter = Counter()
    dimension_counter = Counter()
    all_traits = []

    for rid in cluster_respondents:
        profile = load_profile(rid)
        if profile is None:
            continue

        for dim in DIMENSION_ORDER:
            traits = profile.get("profile", {}).get(dim, [])
            for t in traits:
                stmt = t.get("statement", "")
                if stmt:
                    trait_counter[stmt] += 1
                    dimension_counter[dim] += 1
                all_traits.append({
                    "statement": stmt,
                    "dimension": dim,
                    "trait_type": t.get("trait_type", ""),
                    "temporal_scope": t.get("temporal_scope", ""),
                    "respondent_id": rid,
                })

    return {
        "common_traits": [
            {"statement": stmt, "count": count}
            for stmt, count in trait_counter.most_common(top_n)
        ],
        "dimension_distribution": dict(dimension_counter.most_common()),
        "total_traits": len(all_traits),
    }


def generate_cluster_interpretation(
    cluster_id: int,
    cluster_respondents: list[str],
    embeddings: dict[str, dict],
    vectors: np.ndarray,
    labels: np.ndarray,
    centroids: dict[int, np.ndarray],
) -> dict:
    """
    生成单个 Cluster 的解释信息（Profile_Embedding规范 §48）。
    """
    # 计算 cluster 内部平均相似度
    cluster_mask = labels == cluster_id
    cluster_vectors = vectors[cluster_mask]
    if len(cluster_vectors) > 1:
        # cosine similarity = dot product for L2 normalized vectors
        sim_matrix = np.dot(cluster_vectors, cluster_vectors.T)
        # 去掉对角线（自己跟自己）
        n = len(cluster_vectors)
        if n > 1:
            intra_sim = (sim_matrix.sum() - n) / (n * (n - 1))
        else:
            intra_sim = 1.0
    else:
        intra_sim = 1.0

    # 与其他 cluster 的距离
    centroid = centroids.get(cluster_id)
    inter_distances = {}
    if centroid is not None:
        for other_id, other_centroid in centroids.items():
            if other_id == cluster_id:
                continue
            # cosine similarity
            sim = float(np.dot(centroid, other_centroid))
            inter_distances[str(other_id)] = sim

    # Trait 分析
    trait_analysis = get_cluster_traits(cluster_respondents, embeddings)

    return {
        "cluster_id": f"C{cluster_id:03d}",
        "member_respondents": sorted(cluster_respondents),
        "member_count": len(cluster_respondents),
        "intra_cluster_similarity": float(intra_sim),
        "inter_cluster_similarity": inter_distances,
        "common_traits": trait_analysis["common_traits"],
        "dimension_distribution": trait_analysis["dimension_distribution"],
        "total_traits": trait_analysis["total_traits"],
    }


def build_cluster_output(
    labels: np.ndarray,
    respondent_ids: list[str],
    vectors: np.ndarray,
    embeddings: dict[str, dict],
    centroids: dict[int, np.ndarray],
    quality_metrics: dict,
    stability_result: dict,
    params: dict,
) -> dict:
    """
    构建完整的聚类输出 JSON。
    """
    clusters = {}
    noise_respondents = []

    for label in sorted(set(labels)):
        mask = labels == label
        rids = [respondent_ids[i] for i in range(len(respondent_ids)) if mask[i]]

        if label == -1:
            noise_respondents = sorted(rids)
        else:
            cluster_info = generate_cluster_interpretation(
                int(label), rids, embeddings, vectors, labels, centroids
            )
            clusters[str(label)] = cluster_info

    return {
        "clustering_version": "1.0",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "parameters": params,
        "quality_metrics": quality_metrics,
        "stability_analysis": stability_result,
        "cluster_similarity": compute_cluster_similarity_matrix(centroids),
        "clusters": clusters,
        "noise": {
            "respondent_ids": noise_respondents,
            "count": len(noise_respondents),
        },
        "summary": {
            "total_respondents": len(respondent_ids),
            "n_clusters": quality_metrics.get("n_clusters", 0),
            "n_noise": len(noise_respondents),
            "noise_rate": quality_metrics.get("noise_rate", 0),
            "silhouette_score": quality_metrics.get("silhouette_score"),
            "davies_bouldin_index": quality_metrics.get("davies_bouldin_index"),
            "stability_score": stability_result.get("stability_score"),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Profile Embedding 聚类")
    parser.add_argument("--dry-run", action="store_true", help="只分析不输出文件")
    parser.add_argument("--min-cluster", type=int, default=0, help="最小簇大小（0=自动计算）")
    parser.add_argument("--no-pattern", action="store_true", help="只用 Trait 向量，不加 Pattern")
    parser.add_argument(
        "--pattern-weight", type=float, default=0.15, help="Pattern 权重（默认 0.15）"
    )
    parser.add_argument(
        "--no-bootstrap", action="store_true", help="跳过 Bootstrap 稳定性分析"
    )
    args = parser.parse_args()

    # ── 加载 Profile Embedding ──
    print("📥 加载 Profile Embedding...")
    embeddings = load_profile_embeddings(PROFILE_EMBED_DIR)
    if not embeddings:
        print("❌ 未找到任何 Profile Embedding 文件")
        print(f"   请先运行: python3 scripts/embed_profiles.py")
        sys.exit(1)

    print(f"   加载了 {len(embeddings)} 个 Profile Embedding")

    # ── 提取向量 ──
    vectors, respondent_ids, metadata = extract_vectors(
        embeddings, use_pattern=not args.no_pattern, pattern_weight=args.pattern_weight
    )

    if len(vectors) == 0:
        print("❌ 无有效向量")
        sys.exit(1)

    print(f"   有效向量: {len(vectors)} (dim={vectors.shape[1]})")

    # ── 确定参数 ──
    n = len(vectors)
    min_cluster_size = args.min_cluster if args.min_cluster > 0 else max(3, round(n * DEFAULT_MIN_CLUSTER_SIZE_RATIO))
    print(f"\n⚙️  聚类参数:")
    print(f"   min_cluster_size: {min_cluster_size}")
    print(f"   pattern_weight: {0.0 if args.no_pattern else args.pattern_weight}")
    print(f"   metric: euclidean (L2 normalized vectors ≈ cosine)")

    # ── HDBSCAN 聚类 ──
    print(f"\n🔍 运行 HDBSCAN...")
    labels, clusterer = run_hdbscan(vectors, min_cluster_size)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    n_noise = int(np.sum(labels == -1))
    print(f"   发现 {n_clusters} 个 Cluster, {n_noise} 个 Noise")

    # ── 质量指标 ──
    print(f"\n📊 计算质量指标...")
    quality_metrics = compute_quality_metrics(vectors, labels)
    print(f"   Silhouette Score: {quality_metrics.get('silhouette_score')}")
    print(f"   Davies-Bouldin Index: {quality_metrics.get('davies_bouldin_index')}")
    print(f"   Noise Rate: {quality_metrics['noise_rate']:.2%}")

    # ── 稳定性分析 ──
    if not args.no_bootstrap and len(vectors) >= 10:
        print(f"\n🔄 Bootstrap 稳定性分析 ({BOOTSTRAP_ITERATIONS} iterations)...")
        stability_result = bootstrap_stability(vectors, labels, min_cluster_size)
        print(f"   Stability Score: {stability_result.get('stability_score')}")
        print(f"   Mean Clusters: {stability_result.get('mean_clusters')}")
    else:
        stability_result = {"stability_score": None, "iterations": 0, "note": "skipped"}
        print(f"\n⏭️  跳过稳定性分析（样本过小或手动跳过）")

    # ── 计算质心 ──
    centroids = compute_cluster_centroids(vectors, labels)

    # ── Cluster 解释 ──
    print(f"\n📝 生成 Cluster 解释...")
    for cluster_id in sorted(set(labels)):
        if cluster_id == -1:
            continue
        rids = [respondent_ids[i] for i in range(n) if labels[i] == cluster_id]
        print(f"\n   Cluster {cluster_id}: {len(rids)} 人")
        for rid in rids:
            profile = load_profile(rid)
            if profile:
                cov = embeddings.get(rid, {}).get("coverage", {})
                print(f"     - {rid}: {cov.get('trait_count', '?')} traits, {cov.get('dimensions_present', '?')}/{cov.get('dimensions_total', '?')} dims")

    # ── 构建输出 ──
    params = {
        "algorithm": "HDBSCAN",
        "metric": "euclidean",
        "min_cluster_size": min_cluster_size,
        "min_samples": min_cluster_size,
        "pattern_weight": 0.0 if args.no_pattern else args.pattern_weight,
        "use_pattern": not args.no_pattern,
    }

    output = build_cluster_output(
        labels, respondent_ids, vectors, embeddings, centroids, quality_metrics, stability_result, params
    )

    # ── 输出 ──
    if not args.dry_run:
        os.makedirs(os.path.dirname(OUTPUT_CLUSTERS_PATH), exist_ok=True)
        with open(OUTPUT_CLUSTERS_PATH, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(f"\n💾 聚类结果已保存: {OUTPUT_CLUSTERS_PATH}")

    # ── 最终总结 ──
    print("\n" + "━" * 50)
    print("📊 聚类总结")
    print(f"   Total Respondents: {n}")
    print(f"   Clusters: {n_clusters}")
    print(f"   Noise: {n_noise}")
    print(f"   Silhouette: {quality_metrics.get('silhouette_score')}")
    print(f"   DBI: {quality_metrics.get('davies_bouldin_index')}")
    print(f"   Stability: {stability_result.get('stability_score')}")
    print("━" * 50)


if __name__ == "__main__":
    main()