#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Profile Embedding 生成脚本 v2.0

严格按照 docs/Profile_Embedding规范.md v1.0 将已完成的 Profile 转换为 Respondent 级向量。

与 v1.0 脚本 (embed_profiles.py) 的主要区别：
  - 输入：读取 '*_profiles.json' 格式（一个文件包含多个 Respondent 的 Profile 数组）
  - 输出：为每个源文件生成一个对应的 embedding 文件
  - Trait 序列化：严格遵循规范 §27.1 的 Canonical Serialization Rule
  - Pattern 序列化：包含 relation_type, chain, description

核心流程：
  1. 读取 Profile JSON 文件（数组格式）
  2. 按六大 Dimension 提取 Trait → 构造 embedding 输入文本
  3. 每个 Dimension 内 mean pooling + L2 normalize → Dimension Vector
  4. 等权聚合存在的 Dimension → Trait Profile Vector
  5. Pattern 单独 Embedding → Pattern Vector
  6. 85% Trait + 15% Pattern → L2 normalize → Profile Embedding
  7. 输出到 data/embed/profiles/

用法:
  python3 scripts/embed_profiles_v2.py                              # 处理所有 Profile 文件
  python3 scripts/embed_profiles_v2.py --file 竞技品类基础研究     # 只处理指定文件
  python3 scripts/embed_profiles_v2.py --limit 5                    # 只处理前 5 个 Respondent
  python3 scripts/embed_profiles_v2.py --dry-run                    # 只打印不生成

依赖: pip install sentence-transformers numpy
"""

import argparse
import hashlib
import json
import os
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

# ── 配置 ──────────────────────────────────────────────────────────────
MODEL_PATH = os.path.expanduser("~/models/bge-m3/BAAI/bge-m3")
MODEL_NAME = "BAAI/bge-m3"
MODEL_REVISION = "6904bca"  # 规范 §26.1
EMBEDDING_DIM = 1024

# 六大 Dimension 固定顺序（规范 §27）
DIMENSION_ORDER = [
    "context",
    "experience_capability",
    "behaviors",
    "preferences",
    "motivations_needs",
    "perceptions_beliefs",
]

# 权重（规范 §22）
TRAIT_PROFILE_WEIGHT = 0.85
PATTERN_WEIGHT = 0.15

# Profile 输入目录
PROFILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "群体画像v2.0_profile")
# 输出目录
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "embed", "profiles")

# Embedding 配置（规范 §62）
EMBEDDING_CONFIG = {
    "profile_embedding_version": "1.0",
    "embedding_model": MODEL_NAME,
    "embedding_model_revision": MODEL_REVISION,
    "embedding_dimension": EMBEDDING_DIM,
    "dimension_pooling": "mean",
    "dimension_normalization": "l2",
    "dimension_aggregation": "equal",
    "pattern_weight": PATTERN_WEIGHT,
    "trait_profile_weight": TRAIT_PROFILE_WEIGHT,
    "final_normalization": "l2",
    "serialization_version": "1.0",
    "similarity_metric": "cosine",
    "clustering_algorithm": "HDBSCAN",
    "dimensionality_reduction_for_clustering": False,
    "umap_for_visualization": True,
}


# ── 文本规范化工具函数（规范 §27.1.6, §27.1.7）───────────────────────

def normalize_text(text: str) -> str:
    """
    Unicode NFC normalization + whitespace cleanup.
    规范 §27.1.6: NFC normalization
    规范 §27.1.7: trim + collapse whitespace + normalize newlines
    """
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.strip()
    text = re.sub(r"[ \t]+", " ", text)
    return text


# ── Trait 序列化（规范 §27.1）────────────────────────────────────────

def serialize_trait(trait: dict) -> str:
    """
    将单个 Trait 序列化为 Embedding 模型输入的文本。

    严格遵循规范 §27.1 Canonical Serialization Rule：

    字段顺序（§27.1.1）:
      1. dimension
      2. temporal_scope
      3. trait_type
      4. statement
      5. condition
      6. negative_evidence

    字段名称保留为标签（§27.1.2）: "Dimension: preferences"
    空字段不输出（§27.1.3）: 不输出占位符
    分隔符（§27.1.5）: ": " (冒号+空格)
    """
    lines = []

    # 1. dimension
    dim = normalize_text(trait.get("dimension", ""))
    if dim:
        lines.append(f"Dimension: {dim}")

    # 2. temporal_scope
    ts = normalize_text(trait.get("temporal_scope", ""))
    if ts:
        lines.append(f"Temporal: {ts}")

    # 3. trait_type
    tt = normalize_text(trait.get("trait_type", ""))
    if tt:
        lines.append(f"Type: {tt}")

    # 4. statement
    stmt = normalize_text(trait.get("statement", ""))
    if stmt:
        lines.append(f"Statement: {stmt}")

    # 5. condition
    cond = normalize_text(trait.get("condition", ""))
    if cond:
        lines.append(f"Condition: {cond}")

    # 6. negative_evidence（规范 §27.1.9: 作为否定语义表示）
    neg = trait.get("negative_evidence")
    if neg:
        if isinstance(neg, str):
            neg_text = normalize_text(neg)
            if neg_text:
                lines.append(f"Negative: {neg_text}")
        elif isinstance(neg, list):
            for n in neg:
                neg_text = normalize_text(n) if isinstance(n, str) else str(n)
                if neg_text:
                    lines.append(f"Negative: {neg_text}")

    return "\n".join(lines)


# ── Pattern 序列化（规范 §27.1.8）────────────────────────────────────

def serialize_pattern(pattern) -> str:
    """
    将单个 Pattern 序列化为 Embedding 输入文本。

    规范 §27.1.8: Pattern 序列化时保留 chain 结构和 relation_type

    支持两种 Pattern 格式:
      - dict: {pattern_id, description, relation_type, chain, ...}
      - str: 纯文本描述
    """
    lines = ["[Pattern]"]

    if isinstance(pattern, str):
        # 纯文本 Pattern
        lines.append(f"Description: {normalize_text(pattern)}")
        return "\n".join(lines)

    if not isinstance(pattern, dict):
        return "\n".join(lines)

    # relation_type（规范 §21: 必须包含）
    rel = pattern.get("relation_type", "")
    if rel:
        lines.append(f"Relation: {rel}")

    # chain（规范 §21: 保留关系结构）
    chain = pattern.get("chain", [])
    if chain:
        chain_str = " → ".join(str(c) for c in chain)
        lines.append(f"Chain: {chain_str}")

    # description（规范 §21: 必须包含）
    desc = pattern.get("description", "")
    if desc:
        lines.append(f"Description: {normalize_text(desc)}")

    # pattern 名称（规范 §21: 必须包含）
    pat_name = pattern.get("pattern", "")
    if pat_name:
        lines.append(f"Name: {normalize_text(pat_name)}")

    return "\n".join(lines)


# ── Dimension 级文本构造（规范 §27.1.10）─────────────────────────────

def build_dimension_text(dim_name: str, traits: list) -> str:
    """
    构造单个 Dimension 的 embedding 输入文本。

    规范 §27.1.10: Dimension 之间用 Dimension 名称作为分隔标题
    规范 §27.1.4: Traits 之间用空行分隔
    """
    if not traits:
        return ""

    trait_texts = []
    for trait in traits:
        serialized = serialize_trait(trait)
        if serialized:
            trait_texts.append(serialized)

    if not trait_texts:
        return ""

    # 用 Dimension 名称作为标题
    header = f"[{dim_name}]"
    body = "\n\n".join(trait_texts)
    return f"{header}\n{body}"


# ── 模型加载 ──────────────────────────────────────────────────────────

def load_model():
    """加载 bge-m3 模型"""
    print(f"📥 加载模型: {MODEL_NAME} (from {MODEL_PATH})")
    model = SentenceTransformer(MODEL_PATH)
    dim = model.get_sentence_embedding_dimension()
    print(f"   向量维度: {dim}")
    return model


# ── Profile 文件列表 ──────────────────────────────────────────────────

def list_profile_files():
    """列出所有可用的 Profile JSON 文件"""
    if not os.path.exists(PROFILE_DIR):
        print(f"❌ Profile 目录不存在: {PROFILE_DIR}")
        sys.exit(1)

    files = []
    for fname in sorted(os.listdir(PROFILE_DIR)):
        if fname.endswith("_profiles.json"):
            files.append(fname)
    return files


def load_profiles_from_file(filename: str):
    """
    从 '*_profiles.json' 文件加载所有 Profile。

    返回: list[dict] — 每个元素是一个 Respondent 的 Profile
    """
    filepath = os.path.join(PROFILE_DIR, filename)
    if not os.path.exists(filepath):
        print(f"⚠️  文件不存在: {filepath}")
        return []

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        profiles = data
    elif isinstance(data, dict):
        # 兼容单个 Profile 的格式
        profiles = [data]
    else:
        print(f"⚠️  未知格式: {filepath}")
        return []

    return profiles


# ── Dimension Embedding 计算 ──────────────────────────────────────────

def compute_dimension_vector(
    traits: list, model: SentenceTransformer
):
    """
    对单个 Dimension 的所有 Trait 生成 embedding 并做 mean pooling + L2 normalize。

    规范 §18: 集合平均 + 层级归一化
        V_dimension = normalize(mean(V_trait_1, V_trait_2, ..., V_trait_n))

    返回: (1024,) numpy array 或 None（如果 Dimension 为空）
    """
    if not traits:
        return None

    # 序列化每个 Trait 为独立文本
    texts = [serialize_trait(t) for t in traits]
    # 批量编码
    embeddings = model.encode(texts, normalize_embeddings=False, show_progress_bar=False)
    # mean pooling
    dim_vec = np.mean(embeddings, axis=0)
    # L2 normalize
    norm = np.linalg.norm(dim_vec)
    if norm > 0:
        dim_vec = dim_vec / norm
    return dim_vec


# ── Pattern Embedding 计算 ────────────────────────────────────────────

def compute_pattern_vector(
    patterns: list, model: SentenceTransformer
):
    """
    对所有 Pattern 生成 embedding 并做 mean pooling + L2 normalize。

    规范 §21: V_pattern = normalize(mean(V_p1, V_p2, V_p3))

    返回: (1024,) numpy array 或 None（如果没有 Pattern）
    """
    if not patterns:
        return None

    texts = [serialize_pattern(p) for p in patterns]
    embeddings = model.encode(texts, normalize_embeddings=False, show_progress_bar=False)
    pat_vec = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(pat_vec)
    if norm > 0:
        pat_vec = pat_vec / norm
    return pat_vec


# ── Hash 计算（规范 §51）─────────────────────────────────────────────

def compute_profile_hash(profile: dict) -> str:
    """
    计算参与 Embedding 的 Profile 内容的 hash。

    只 hash 实际进入 Embedding 的字段，不包括 metadata。
    规范 §51: 用于判断 Profile 是否发生变化
    """
    embed_content = {"profile": {}, "patterns": []}

    for dim in DIMENSION_ORDER:
        traits = profile.get("profile", {}).get(dim, [])
        if traits:
            slim_traits = []
            for t in sorted(traits, key=lambda x: x.get("trait_id", "")):
                slim = {}
                for field in ["dimension", "trait_type", "temporal_scope", "statement", "condition", "negative_evidence"]:
                    if t.get(field):
                        slim[field] = t[field]
                slim_traits.append(slim)
            embed_content["profile"][dim] = slim_traits

    patterns = profile.get("patterns", [])
    if patterns:
        def pattern_hash_key(p):
            if isinstance(p, dict):
                return p.get("pattern_id", "")
            return str(p)
        embed_content["patterns"] = [
            {
                "pattern_id": p.get("pattern_id", "") if isinstance(p, dict) else "",
                "description": p.get("description", "") if isinstance(p, dict) else str(p),
                "relation_type": p.get("relation_type", "") if isinstance(p, dict) else "",
            }
            for p in sorted(patterns, key=pattern_hash_key)
        ]

    content_str = json.dumps(embed_content, sort_keys=True, ensure_ascii=False)
    return f"sha256:{hashlib.sha256(content_str.encode('utf-8')).hexdigest()}"


def compute_embedding_config_hash() -> str:
    """计算 embedding 配置的 hash（规范 §51）"""
    config_str = json.dumps(EMBEDDING_CONFIG, sort_keys=True, ensure_ascii=False)
    return f"sha256:{hashlib.sha256(config_str.encode('utf-8')).hexdigest()}"


# ── Quality Gate（规范 §54-§55）──────────────────────────────────────

def validate_profile(profile: dict) -> tuple:
    """
    Profile Quality Gate。

    规范 §54: 进入 Profile Embedding 前必须通过 Quality Gate
    规范 §55: 至少检查 Profile 存在、version 存在、至少一个有效 Dimension、至少一个有效 Trait
    """
    if not profile:
        return False, "profile_missing"

    if "profile_version" not in profile:
        return False, "profile_version_missing"

    if "profile" not in profile:
        return False, "profile_section_missing"

    total_traits = 0
    for dim in DIMENSION_ORDER:
        traits = profile.get("profile", {}).get(dim, [])
        if isinstance(traits, list):
            total_traits += len(traits)

    if total_traits == 0:
        return False, "no_traits"

    return True, "ok"


# ── 主流程：生成单个 Profile Embedding ────────────────────────────────

def generate_profile_embedding(
    profile: dict, model: SentenceTransformer
):
    """
    对单个 Profile 生成 Profile Embedding。

    规范 §59 最终聚类 Pipeline:
        Profile → Quality Gate → 读取六大 Dimension Traits
        → Dimension-level Embedding → Mean Pooling → L2 Normalize
        → 六个 Dimension 等权聚合 → Trait Profile Vector
        → Pattern Embedding → 85% Trait + 15% Pattern
        → L2 Normalize → Profile Embedding

    返回: 输出 JSON 字典，或 None（如果质量检查失败）
    """
    respondent_id = profile.get("respondent_id", "unknown")
    profile_version = profile.get("profile_version", "unknown")

    # ── Quality Gate（规范 §54-§55）──
    valid, reason = validate_profile(profile)
    if not valid:
        return None

    # ── 按 Dimension 提取 Trait（规范 §28: 按 trait_id 排序）──
    dimension_traits = {}
    for dim in DIMENSION_ORDER:
        traits = profile.get("profile", {}).get(dim, [])
        if not isinstance(traits, list):
            traits = []
        # 按 trait_id 稳定排序
        traits_sorted = sorted(traits, key=lambda x: x.get("trait_id", ""))
        dimension_traits[dim] = traits_sorted

    # ── 提取 Pattern（规范 §29: 按 pattern_id 排序）──
    patterns = profile.get("patterns", [])
    if not isinstance(patterns, list):
        patterns = []

    def pattern_sort_key(p):
        if isinstance(p, dict):
            return p.get("pattern_id", "")
        return str(p)
    patterns_sorted = sorted(patterns, key=pattern_sort_key)

    # ── Dimension Embedding（规范 §17-§18）──
    dimension_vectors = {}
    for dim in DIMENSION_ORDER:
        traits = dimension_traits[dim]
        vec = compute_dimension_vector(traits, model)
        dimension_vectors[dim] = vec.tolist() if vec is not None else None

    # ── Trait Profile Vector（规范 §20: 等权聚合存在的 Dimension）──
    valid_dim_vectors = [
        np.array(v) for v in dimension_vectors.values() if v is not None
    ]
    if not valid_dim_vectors:
        return None

    trait_profile_vec = np.mean(valid_dim_vectors, axis=0)
    norm = np.linalg.norm(trait_profile_vec)
    if norm > 0:
        trait_profile_vec = trait_profile_vec / norm

    # ── Pattern Vector（规范 §21）──
    pattern_vec = compute_pattern_vector(patterns_sorted, model)

    # ── 融合（规范 §22: 85% Trait + 15% Pattern）──
    if pattern_vec is not None:
        profile_vec = TRAIT_PROFILE_WEIGHT * trait_profile_vec + PATTERN_WEIGHT * pattern_vec
    else:
        profile_vec = trait_profile_vec

    # Final L2 normalization（规范 §36）
    norm = np.linalg.norm(profile_vec)
    if norm > 0:
        profile_vec = profile_vec / norm

    # ── Coverage 统计（规范 §20: dimensions_present / dimensions_total）──
    dimensions_present = sum(1 for v in dimension_vectors.values() if v is not None)
    total_traits = sum(len(traits) for traits in dimension_traits.values())

    # ── Hash（规范 §51）──
    profile_hash = compute_profile_hash(profile)
    config_hash = compute_embedding_config_hash()

    # ── 构建输出（规范 §34）──
    output = {
        "profile_embedding_version": EMBEDDING_CONFIG["profile_embedding_version"],
        "respondent_id": respondent_id,
        "profile_version": profile_version,
        "embedding_model": EMBEDDING_CONFIG["embedding_model"],
        "embedding_model_revision": EMBEDDING_CONFIG["embedding_model_revision"],
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


# ── 主入口 ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Profile Embedding 生成 v2.0")
    parser.add_argument("--file", type=str, default="", help="只处理指定文件（不含路径，如 '竞技品类基础研究_profiles.json'）")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个 Respondent（用于测试）")
    parser.add_argument("--respondent", type=str, default="", help="只处理指定 Respondent ID")
    parser.add_argument("--dry-run", action="store_true", help="只打印不生成文件")
    args = parser.parse_args()

    # ── 加载模型 ──
    model = load_model()

    # ── 列出文件 ──
    if args.file:
        # 支持带或不带路径的文件名
        fname = os.path.basename(args.file)
        if not fname.endswith(".json"):
            fname = fname + "_profiles.json"
        profile_files = [fname]
    else:
        profile_files = list_profile_files()

    print(f"\n📊 共 {len(profile_files)} 个 Profile 文件待处理\n")

    # ── 确保输出目录存在 ──
    if not args.dry_run:
        os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── 逐个文件处理 ──
    total_success = 0
    total_skip = 0
    total_error = 0

    for file_idx, fname in enumerate(profile_files):
        print(f"\n{'='*60}")
        print(f"📁 [{file_idx+1}/{len(profile_files)}] {fname}")
        print(f"{'='*60}")

        try:
            profiles = load_profiles_from_file(fname)
        except Exception as e:
            print(f"  ❌ 文件加载失败: {e}")
            total_error += 1
            continue

        if not profiles:
            print(f"  ⚠️  文件为空或格式不正确")
            total_skip += 1
            continue

        # 如果指定了 respondent_id，只处理对应的
        if args.respondent:
            profiles = [p for p in profiles if p.get("respondent_id") == args.respondent]
            if not profiles:
                print(f"  ⚠️  未找到 Respondent: {args.respondent}")
                continue

        # 如果指定了 limit
        if args.limit > 0:
            profiles = profiles[:args.limit]

        print(f"  📊 {len(profiles)} 个 Respondent\n")

        file_success = 0
        file_skip = 0
        file_error = 0
        results = []

        for i, profile in enumerate(profiles):
            rid = profile.get("respondent_id", f"unknown_{i}")

            try:
                result = generate_profile_embedding(profile, model)
                if result is None:
                    valid, reason = validate_profile(profile)
                    print(f"  [{i+1}/{len(profiles)}] {rid}: ⏭️  跳过 ({reason})")
                    file_skip += 1
                    continue

                results.append(result)

                trait_count = result["coverage"]["trait_count"]
                pat_count = result["coverage"]["pattern_count"]
                dims = result["coverage"]["dimensions_present"]
                print(f"  [{i+1}/{len(profiles)}] {rid}: ✅ {trait_count} traits, {pat_count} patterns, {dims}/{len(DIMENSION_ORDER)} dims")
                file_success += 1

            except Exception as e:
                print(f"  [{i+1}/{len(profiles)}] {rid}: ❌ 错误: {e}")
                file_error += 1

        # ── 写入输出文件 ──
        if not args.dry_run and results:
            # 输出文件名：将 _profiles.json 替换为 _profile_embeddings.json
            output_fname = fname.replace("_profiles.json", "_profile_embeddings.json")
            if output_fname == fname:
                output_fname = fname.replace(".json", "_profile_embeddings.json")
            output_path = os.path.join(OUTPUT_DIR, output_fname)

            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(results, f, ensure_ascii=False, indent=2)
            print(f"\n  📁 输出: {output_path}")

        print(f"\n  ── 文件汇总 ──")
        print(f"  ✅ 成功: {file_success}")
        print(f"  ⏭️  跳过: {file_skip}")
        print(f"  ❌ 错误: {file_error}")

        total_success += file_success
        total_skip += file_skip
        total_error += file_error

    # ── 全局汇总 ──
    print("\n" + "═" * 60)
    print(f"✅ 全部成功: {total_success}")
    print(f"⏭️  全部跳过: {total_skip}")
    print(f"❌ 全部错误: {total_error}")
    print(f"📊 总计: {total_success + total_skip + total_error}")
    if not args.dry_run:
        print(f"📁 输出目录: {OUTPUT_DIR}")
    print("═" * 60)


if __name__ == "__main__":
    main()