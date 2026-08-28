#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Profile Embedding 生成脚本 v1.0

按 docs/Profile_Embedding规范.md 将已完成的 Profile 转换为 Respondent 级向量。

核心流程：
  1. 读取所有 Profile JSON
  2. 按六大 Dimension 提取 Trait → 构造 embedding 输入
  3. 每个 Dimension 内 mean pooling + L2 normalize → Dimension Vector
  4. 等权聚合存在的 Dimension → Trait Profile Vector
  5. Pattern 单独 Embedding → Pattern Vector
  6. 85% Trait + 15% Pattern → L2 normalize → Profile Embedding
  7. 输出到 data/embed/profiles/

用法:
  python3 scripts/embed_profiles.py                          # 处理所有 Profile
  python3 scripts/embed_profiles.py --limit 5                # 只处理前 5 个（测试）
  python3 scripts/embed_profiles.py --respondent P001        # 只处理指定 Respondent
  python3 scripts/embed_profiles.py --dry-run                # 只打印不生成

依赖: pip install sentence-transformers
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

# ── 配置 ──
# 模型路径（与 embed_segments.py / embed_server.py 保持一致）
MODEL_PATH = os.path.expanduser("~/models/bge-m3/BAAI/bge-m3")
MODEL_NAME = "BAAI/bge-m3"
EMBEDDING_DIM = 1024

# 六大 Dimension 固定顺序（Profile_Embedding规范 §27）
DIMENSION_ORDER = [
    "context",
    "experience_capability",
    "behaviors",
    "preferences",
    "motivations_needs",
    "perceptions_beliefs",
]

# 嵌入字段（Profile_Embedding规范 §5）
TRAIT_EMBED_FIELDS = ["dimension", "trait_type", "temporal_scope", "statement"]
# 可选条件字段
TRAIT_OPTIONAL_FIELDS = ["condition", "negative_evidence"]

# 权重（Profile_Embedding规范 §22）
TRAIT_PROFILE_WEIGHT = 0.85
PATTERN_WEIGHT = 0.15

# Profile 输入目录
PROFILE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "群体画像v2.0_profile")
# 输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "embed", "profiles")

# Embedding 配置（用于实验复现 — Profile_Embedding规范 §62）
EMBEDDING_CONFIG = {
    "profile_embedding_version": "1.0",
    "embedding_model": MODEL_NAME,
    "embedding_model_version": "fixed",
    "embedding_dimension": EMBEDDING_DIM,
    "dimension_pooling": "mean",
    "dimension_normalization": "l2",
    "dimension_aggregation": "equal",
    "pattern_weight": PATTERN_WEIGHT,
    "trait_profile_weight": TRAIT_PROFILE_WEIGHT,
    "final_normalization": "l2",
    "similarity_metric": "cosine",
    "clustering_algorithm": "HDBSCAN",
    "dimensionality_reduction_for_clustering": False,
    "umap_for_visualization": True,
}


def load_model():
    """加载 bge-m3 模型"""
    print(f"📥 加载模型: {MODEL_NAME} (from {MODEL_PATH})")
    model = SentenceTransformer(MODEL_PATH)
    dim = model.get_sentence_embedding_dimension()
    print(f"   向量维度: {dim}")
    return model


def load_profile(respondent_id: str):
    """加载单个 Profile JSON"""
    filepath = os.path.join(PROFILE_DIR, f"{respondent_id}_profile.json")
    if not os.path.exists(filepath):
        print(f"⚠️  文件不存在: {filepath}")
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def list_profiles():
    """列出所有可用的 Profile respondent_id"""
    if not os.path.exists(PROFILE_DIR):
        print(f"❌ Profile 目录不存在: {PROFILE_DIR}")
        sys.exit(1)

    profiles = []
    for fname in sorted(os.listdir(PROFILE_DIR)):
        if fname.endswith("_profile.json"):
            rid = fname.replace("_profile.json", "")
            profiles.append(rid)
    return profiles


def build_trait_text(trait: dict) -> str:
    """
    构造单个 Trait 的 embedding 输入文本。

    格式: [dimension: {dim}] [type: {trait_type}] [scope: {temporal_scope}] {statement}
    如果有 condition: 追加 [condition: {condition}]
    如果有 negative_evidence: 追加 [negative: {negative_evidence}]

    按照 Profile_Embedding规范 §5-§8 的规则。
    """
    parts = []

    # 核心字段
    dim = trait.get("dimension", "")
    tt = trait.get("trait_type", "")
    ts = trait.get("temporal_scope", "")
    stmt = trait.get("statement", "")

    # 构造上下文前缀
    context_parts = []
    if dim:
        context_parts.append(f"dimension: {dim}")
    if tt:
        context_parts.append(f"type: {tt}")
    if ts:
        context_parts.append(f"scope: {ts}")

    if context_parts:
        parts.append(f"[{' | '.join(context_parts)}]")

    parts.append(stmt)

    # 条件（§7）
    cond = trait.get("condition")
    if cond:
        parts.append(f"[condition: {cond}]")

    # 否定证据（§8）
    neg = trait.get("negative_evidence")
    if neg:
        if isinstance(neg, list):
            for n in neg:
                parts.append(f"[negative: {n}]")
        elif isinstance(neg, str):
            parts.append(f"[negative: {neg}]")

    return " ".join(parts)


def build_pattern_text(pattern) -> str:
    """
    构造单个 Pattern 的 embedding 输入文本。

    支持两种格式:
    - dict: {pattern_id, description, related_traits, confidence}
    - str: 直接作为 description 使用

    格式: [pattern] {description}
    """
    parts = ["[pattern]"]
    if isinstance(pattern, dict):
        desc = pattern.get("description", "")
    elif isinstance(pattern, str):
        desc = pattern
    else:
        desc = str(pattern)
    parts.append(desc)

    return " ".join(parts)


def compute_dimension_vector(
    traits: list, model: SentenceTransformer
):
    """
    对单个 Dimension 的所有 Trait 生成 embedding 并做 mean pooling + L2 normalize。

    返回: (1024,) numpy array 或 None（如果 Dimension 为空）
    """
    if not traits:
        return None

    texts = [build_trait_text(t) for t in traits]
    # 批量编码
    embeddings = model.encode(texts, normalize_embeddings=False, show_progress_bar=False)
    # mean pooling
    dim_vec = np.mean(embeddings, axis=0)
    # L2 normalize
    norm = np.linalg.norm(dim_vec)
    if norm > 0:
        dim_vec = dim_vec / norm
    return dim_vec


def compute_pattern_vector(
    patterns: list, model: SentenceTransformer
):
    """
    对所有 Pattern 生成 embedding 并做 mean pooling + L2 normalize。

    返回: (1024,) numpy array 或 None（如果没有 Pattern）
    """
    if not patterns:
        return None

    texts = [build_pattern_text(p) for p in patterns]
    embeddings = model.encode(texts, normalize_embeddings=False, show_progress_bar=False)
    pat_vec = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(pat_vec)
    if norm > 0:
        pat_vec = pat_vec / norm
    return pat_vec


def compute_profile_hash(profile: dict) -> str:
    """
    计算参与 Embedding 的 Profile 内容的 hash。

    只 hash 实际进入 Embedding 的字段，不包括 metadata。
    """
    # 提取参与 embedding 的内容
    embed_content = {
        "profile": {},
        "patterns": [],
    }

    for dim in DIMENSION_ORDER:
        traits = profile.get("profile", {}).get(dim, [])
        if traits:
            # 只保留进入 embedding 的字段
            slim_traits = []
            for t in sorted(traits, key=lambda x: x.get("trait_id", "")):
                slim = {}
                for field in TRAIT_EMBED_FIELDS + TRAIT_OPTIONAL_FIELDS:
                    if field in t:
                        slim[field] = t[field]
                slim_traits.append(slim)
            embed_content["profile"][dim] = slim_traits

    patterns = profile.get("patterns", [])
    if patterns:
        def pattern_hash_key(p):
            if isinstance(p, dict):
                return p.get("pattern_id", "")
            elif isinstance(p, str):
                return p
            return str(p)

        embed_content["patterns"] = [
            {
                "pattern_id": p.get("pattern_id", "") if isinstance(p, dict) else "",
                "description": p.get("description", "") if isinstance(p, dict) else p,
            }
            for p in sorted(patterns, key=pattern_hash_key)
        ]

    content_str = json.dumps(embed_content, sort_keys=True, ensure_ascii=False)
    return f"sha256:{hashlib.sha256(content_str.encode('utf-8')).hexdigest()}"


def compute_embedding_config_hash() -> str:
    """计算 embedding 配置的 hash"""
    config_str = json.dumps(EMBEDDING_CONFIG, sort_keys=True, ensure_ascii=False)
    return f"sha256:{hashlib.sha256(config_str.encode('utf-8')).hexdigest()}"


def validate_profile(profile: dict) -> tuple:
    """
    Profile Quality Gate — Profile_Embedding规范 §54-§55.

    检查:
    - Profile 存在
    - Profile version 存在
    - 至少一个有效 Dimension
    - 至少一个有效 Trait
    """
    if not profile:
        return False, "profile_missing"

    if "profile_version" not in profile:
        return False, "profile_version_missing"

    total_traits = 0
    for dim in DIMENSION_ORDER:
        traits = profile.get("profile", {}).get(dim, [])
        total_traits += len(traits)

    if total_traits == 0:
        return False, "no_traits"

    return True, "ok"


def generate_profile_embedding(
    profile: dict, model: SentenceTransformer
):
    """
    对单个 Profile 生成 Profile Embedding。

    返回: 输出 JSON 字典，或 None（如果质量检查失败）
    """
    respondent_id = profile.get("respondent_id", "unknown")
    profile_version = profile.get("profile_version", "unknown")

    # ── Quality Gate ──
    valid, reason = validate_profile(profile)
    if not valid:
        print(f"  ⚠️  {respondent_id}: Quality Gate 失败 ({reason}), 跳过")
        return None

    # ── 提取 Trait（按 trait_id 排序，§28）──
    dimension_traits = {}
    for dim in DIMENSION_ORDER:
        traits = profile.get("profile", {}).get(dim, [])
        # 按 trait_id 稳定排序
        traits_sorted = sorted(traits, key=lambda x: x.get("trait_id", ""))
        dimension_traits[dim] = traits_sorted

    # ── 提取 Pattern（按 pattern_id 排序，§29）──
    patterns = profile.get("patterns", [])
    # 处理两种格式：dict 和 str
    def pattern_sort_key(p):
        if isinstance(p, dict):
            return p.get("pattern_id", "")
        elif isinstance(p, str):
            return p
        return str(p)
    patterns_sorted = sorted(patterns, key=pattern_sort_key)

    # ── Dimension Embedding ──
    dimension_vectors = {}
    for dim in DIMENSION_ORDER:
        traits = dimension_traits[dim]
        vec = compute_dimension_vector(traits, model)
        dimension_vectors[dim] = vec.tolist() if vec is not None else None

    # ── Trait Profile Vector（等权聚合存在的 Dimension，§20）──
    valid_dim_vectors = [
        np.array(v) for v in dimension_vectors.values() if v is not None
    ]
    if not valid_dim_vectors:
        print(f"  ⚠️  {respondent_id}: 无有效 Dimension Vector, 跳过")
        return None

    trait_profile_vec = np.mean(valid_dim_vectors, axis=0)
    norm = np.linalg.norm(trait_profile_vec)
    if norm > 0:
        trait_profile_vec = trait_profile_vec / norm

    # ── Pattern Vector ──
    pattern_vec = compute_pattern_vector(patterns_sorted, model)

    # ── 融合（§22）──
    if pattern_vec is not None:
        profile_vec = TRAIT_PROFILE_WEIGHT * trait_profile_vec + PATTERN_WEIGHT * pattern_vec
    else:
        profile_vec = trait_profile_vec

    # Final L2 normalization
    norm = np.linalg.norm(profile_vec)
    if norm > 0:
        profile_vec = profile_vec / norm

    # ── Coverage 统计 ──
    dimensions_present = sum(1 for v in dimension_vectors.values() if v is not None)
    total_traits = sum(len(traits) for traits in dimension_traits.values())

    # ── Hash ──
    profile_hash = compute_profile_hash(profile)
    config_hash = compute_embedding_config_hash()

    # ── 构建输出 ──
    output = {
        "profile_embedding_version": EMBEDDING_CONFIG["profile_embedding_version"],
        "respondent_id": respondent_id,
        "profile_version": profile_version,
        "embedding_model": EMBEDDING_CONFIG["embedding_model"],
        "embedding_model_version": EMBEDDING_CONFIG["embedding_model_version"],
        "embedding_dimension": EMBEDDING_CONFIG["embedding_dimension"],
        "dimension_vectors": dimension_vectors,
        "pattern_vector": pattern_vec.tolist() if pattern_vec is not None else None,
        "profile_embedding": profile_vec.tolist(),
        "coverage": {
            "dimensions_present": dimensions_present,
            "dimensions_total": len(DIMENSION_ORDER),
            "trait_count": total_traits,
            "pattern_count": len(patterns_sorted),
        },
        "normalization": EMBEDDING_CONFIG["final_normalization"],
        "profile_hash": profile_hash,
        "embedding_config_hash": config_hash,
        "embedding_config": EMBEDDING_CONFIG,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    return output


def main():
    parser = argparse.ArgumentParser(description="Profile Embedding 生成")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个 Profile")
    parser.add_argument("--respondent", type=str, default="", help="只处理指定 Respondent ID")
    parser.add_argument("--dry-run", action="store_true", help="只打印不生成文件")
    args = parser.parse_args()

    # ── 加载模型 ──
    model = load_model()

    # ── 列出 Profile ──
    if args.respondent:
        profile_ids = [args.respondent]
    else:
        profile_ids = list_profiles()
        if args.limit > 0:
            profile_ids = profile_ids[: args.limit]

    print(f"\n📊 共 {len(profile_ids)} 个 Profile 待处理\n")

    # ── 确保输出目录存在 ──
    if not args.dry_run:
        os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── 逐个处理 ──
    success_count = 0
    skip_count = 0
    error_count = 0

    for i, rid in enumerate(profile_ids):
        print(f"[{i+1}/{len(profile_ids)}] 处理 {rid}...", end=" ", flush=True)

        try:
            profile = load_profile(rid)
            if profile is None:
                skip_count += 1
                print("❌ 文件加载失败")
                continue

            result = generate_profile_embedding(profile, model)
            if result is None:
                skip_count += 1
                print("⏭️  跳过")
                continue

            if not args.dry_run:
                output_path = os.path.join(OUTPUT_DIR, f"{rid}_profile_embedding.json")
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False, indent=2)

            trait_count = result["coverage"]["trait_count"]
            pat_count = result["coverage"]["pattern_count"]
            dims = result["coverage"]["dimensions_present"]
            print(
                f"✅ {trait_count} traits, {pat_count} patterns, {dims}/{len(DIMENSION_ORDER)} dims"
            )
            success_count += 1

        except Exception as e:
            print(f"❌ 错误: {e}")
            error_count += 1

    # ── 汇总 ──
    print("\n" + "━" * 50)
    print(f"✅ 成功: {success_count}")
    print(f"⏭️  跳过: {skip_count}")
    print(f"❌ 错误: {error_count}")
    print(f"📊 总计: {len(profile_ids)}")
    if not args.dry_run:
        print(f"📁 输出目录: {OUTPUT_DIR}")
    print("━" * 50)


if __name__ == "__main__":
    main()