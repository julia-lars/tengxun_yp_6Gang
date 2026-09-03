#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Segment Embedding 生成脚本 v3.0

按 docs/Embedding规范.md v3.0 从 Label 文件（merged）生成 Segment Embedding。

核心流程：
  1. 读取 Label 文件（merged JSON）
  2. 过滤有效 Segment（is_player_evidence=true 且 cleaned_text 非空）
  3. embedding_text = cleaned_text（默认不改写）
  4. 批量 encode（bge-m3，L2 normalize）
  5. 收集 metadata（iceberg/M1-M5 + framework + validity）
  6. 输出 JSON + 质量检查报告

用法:
  python3 scripts/embed_segments.py                                    # 全量跑
  python3 scripts/embed_segments.py --dry-run                           # 只分析不输出
  python3 scripts/embed_segments.py --input 瓦洛兰特海外人群玩法研究    # 指定单个项目
  python3 scripts/embed_segments.py --batch-size 64                     # 自定义 batch size

依赖: pip install sentence-transformers torch
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# ── 配置 ──
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

MERGED_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_merged"
EMBED_OUTPUT_DIR = PROJECT_ROOT / "data" / "embed" / "segments"

# Embedding 模型配置
EMBEDDING_MODEL_NAME = "BAAI/bge-m3"
EMBEDDING_VERSION = "v3.0"
EMBEDDING_DIMENSION = 1024
BATCH_SIZE = 32

# 六大 Dimension（用于从 framework 推断 dimension）
DIMENSION_ORDER = [
    "context",
    "experience_capability",
    "behaviors",
    "preferences",
    "motivations_needs",
    "perceptions_beliefs",
]

# M1-M5 级别映射
ICEBERG_LEVELS = ["M1_motivation", "M2_expectation", "M3_perception", "M4_feeling", "M5_behavior"]


def load_model():
    """加载 bge-m3 模型"""
    from sentence_transformers import SentenceTransformer

    print(f"📥 加载模型: {EMBEDDING_MODEL_NAME} ...")
    model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    print(f"   模型维度: {model.get_sentence_embedding_dimension()}")
    return model


def load_merged_files(input_filter=None):
    """加载 merged 目录中的所有 JSON 文件。

    Args:
        input_filter: 可选，指定文件名关键词过滤

    Returns:
        [(file_path, data_dict), ...]
    """
    if not MERGED_DIR.exists():
        print(f"❌ Merged 目录不存在: {MERGED_DIR}")
        return []

    files = []
    for fpath in sorted(MERGED_DIR.glob("*.json")):
        if fpath.name.startswith("."):
            continue
        if input_filter and input_filter not in fpath.stem:
            continue
        files.append(fpath)

    if not files:
        print(f"❌ 未找到 merged JSON 文件（filter={input_filter}）")
        return []

    results = []
    for fpath in files:
        with open(fpath, "r", encoding="utf-8") as f:
            data = json.load(f)
        results.append((fpath, data))

    print(f"📥 加载了 {len(results)} 个 merged 文件")
    return results


def normalize_text(text):
    """Unicode NFC 规范化 + 空白字符处理（规范 §27.1.6, §27.1.7）"""
    text = unicodedata.normalize("NFC", text)
    text = text.strip()
    text = " ".join(text.split())
    return text


def is_valid_segment(seg):
    """判断 Segment 是否有效，应生成 Embedding。

    规则（规范 §11）：
    - is_player_evidence 为 true
    - cleaned_text 非空且非纯空白
    """
    # 检查 validity
    validity = seg.get("annotation", {}).get("validity", {})
    if not validity.get("is_player_evidence", True):
        return False

    # 检查文本
    text = seg.get("cleaned_text", "")
    if not text or not text.strip():
        return False

    return True


def extract_iceberg_values(seg):
    """从 annotation.iceberg 提取 M1-M5 标注值。

    Returns:
        {m_level: [value_string, ...]}
    """
    result = {}
    ice = seg.get("annotation", {}).get("iceberg", {})
    for level in ICEBERG_LEVELS:
        items = ice.get(level, [])
        if items:
            result[level] = [item.get("value") for item in items if item.get("value")]
    return result


def extract_framework_summary(seg):
    """从 annotation.framework 提取结构化的 framework 标注。

    Returns:
        {framework_key: value}（过滤掉 None、unknown、空列表）
    """
    fw = seg.get("annotation", {}).get("framework", {})
    result = {}
    for key, val in fw.items():
        if val is None:
            continue
        if isinstance(val, dict):
            # 提取有意义的子字段
            sub = {}
            for sk, sv in val.items():
                if sv is None:
                    continue
                if isinstance(sv, str) and sv in ("unknown", "未知", ""):
                    continue
                if isinstance(sv, list) and len(sv) == 0:
                    continue
                sub[sk] = sv
            if sub:
                result[key] = sub
        elif isinstance(val, list):
            if len(val) > 0:
                result[key] = val
        elif isinstance(val, str) and val not in ("unknown", "未知", ""):
            result[key] = val
    return result


def extract_confidence(seg):
    """从 annotation 中提取置信度。

    优先取 annotation.meta.confidence，否则取 iceberg 中各项的平均值。
    """
    meta = seg.get("annotation", {}).get("meta", {})
    if "confidence" in meta and meta["confidence"] is not None:
        return meta["confidence"]

    # 从 iceberg 各项取平均值
    confidences = []
    ice = seg.get("annotation", {}).get("iceberg", {})
    for level in ICEBERG_LEVELS:
        for item in ice.get(level, []):
            c = item.get("confidence")
            if c is not None:
                confidences.append(c)
    if confidences:
        return sum(confidences) / len(confidences)
    return None


def build_embedding_text(seg):
    """生成 embedding_text。

    规则（规范 §5, §6）：
    - 默认 embedding_text = cleaned_text
    - 仅当语义无法独立理解时才补充最小必要 context
    - 短文本（< 10 字）拼接前置问题作为上下文消歧

    Returns:
        (embedding_text, needs_context)
    """
    text = seg.get("cleaned_text", "")
    text = normalize_text(text)

    if not text:
        return "", False

    # 短文本（< 10 字）：拼接前置问题消歧
    # 避免 "喜欢"、"嗯"、"为什么" 等短回复与复杂查询产生虚假高相似度
    needs_context = len(text) < 10
    if needs_context:
        preceding = seg.get("preceding_question", "")
        if preceding:
            preceding = normalize_text(preceding)
            text = f"问题：{preceding}\n回答：{text}"

    return text, needs_context


def collect_embedding_inputs(merged_data):
    """收集中所有有效 Segment，构建 embedding 输入。

    Returns:
        (units_without_embedding, embedding_texts, skipped_count)
    """
    units = []
    texts = []
    skipped = 0
    dup_skipped = 0
    seen_segment_ids = set()  # 跨项目去重：同一个 unique_segment_id 只保留第一个

    for fpath, data in merged_data:
        project_name = data.get("project", fpath.stem)
        meta = data.get("meta", {})

        for seg in data.get("segments", []):
            if not is_valid_segment(seg):
                skipped += 1
                continue

            segment_id = seg["segment_id"]
            cleaned_text = normalize_text(seg.get("cleaned_text", ""))

            if not cleaned_text:
                skipped += 1
                continue

            # 用项目名 + segment_id 生成全局唯一 ID
            proj_slug = re.sub(r'[^a-zA-Z0-9一-鿿]', '', project_name)[:20]
            unique_segment_id = f"{proj_slug}_{segment_id}"

            if unique_segment_id in seen_segment_ids:
                dup_skipped += 1
                continue
            seen_segment_ids.add(unique_segment_id)

            embedding_id = f"E_{unique_segment_id}"

            embedding_text, needs_context = build_embedding_text(seg)

            # 提取 iceberg M1-M5
            iceberg_values = extract_iceberg_values(seg)

            # 提取 framework
            framework = extract_framework_summary(seg)

            # 提取 confidence
            confidence = extract_confidence(seg)

            # 提取 evidence IDs
            evidence = seg.get("annotation", {}).get("evidence", [])
            evidence_ids = [e.get("id") for e in evidence if e.get("id")]

            # 提取 validity
            validity = seg.get("annotation", {}).get("validity", {})

            unit = {
                "embedding_id": embedding_id,
                "segment_id": unique_segment_id,
                "original_segment_id": segment_id,
                "respondent_id": seg.get("speaker_id", ""),
                "source_file": seg.get("source_file", ""),
                "project": project_name,
                "embedding_text": embedding_text,
                "needs_context": needs_context,
                # iceberg M1-M5
                "iceberg": iceberg_values,
                # framework
                "framework": framework,
                # evidence
                "evidence_ids": evidence_ids,
                # validity
                "is_player_evidence": validity.get("is_player_evidence", True),
                "skip_reason": validity.get("skip_reason"),
                "requires_context": validity.get("requires_context", False),
                # confidence
                "confidence": confidence,
                # annotation version
                "annotation_version": seg.get("annotation", {}).get("annotation_version"),
                # model info
                "embedding_model": EMBEDDING_MODEL_NAME,
                "embedding_version": EMBEDDING_VERSION,
                "dimension_size": EMBEDDING_DIMENSION,
                "normalized": True,
                "truncated": False,
                "embedding": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

            units.append(unit)
            texts.append(embedding_text)

    return units, texts, skipped, dup_skipped


def generate_embeddings(model, texts, batch_size=BATCH_SIZE):
    """批量生成 embedding 向量。

    Args:
        model: sentence-transformers 模型
        texts: 输入文本列表
        batch_size: 批次大小

    Returns:
        向量列表 [[float, ...], ...]
    """
    print(f"🔢 生成 Embedding: {len(texts)} 条文本, batch_size={batch_size} ...")

    # bge-m3 的 encode 默认 normalize_embeddings=False
    # 规范要求 L2 normalize
    embeddings = model.encode(
        texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    # 转换为 Python list
    return embeddings.tolist()


def run_quality_checks(units, total_segments, skipped):
    """执行自动化质量检查（规范 §26）。"""
    checks = {
        "total_segments_in_label": total_segments,
        "valid_segments": len(units),
        "skipped": skipped,
        "coverage": len(units) / total_segments if total_segments > 0 else 0,
    }

    # segment_id 重复检查
    segment_ids = [u["segment_id"] for u in units]
    id_counts = Counter(segment_ids)
    duplicates = {k: v for k, v in id_counts.items() if v > 1}
    checks["segment_id_duplicates"] = len(duplicates)
    checks["segment_id_duplicate_list"] = list(duplicates.keys())

    # embedding_id 重复检查
    eids = [u["embedding_id"] for u in units]
    eid_counts = Counter(eids)
    eid_dups = {k: v for k, v in eid_counts.items() if v > 1}
    checks["embedding_id_duplicates"] = len(eid_dups)

    # embedding_text 空值检查
    empty_texts = [u for u in units if not u["embedding_text"].strip()]
    checks["empty_embedding_text"] = len(empty_texts)

    # embedding 维度检查
    wrong_dim = [u for u in units if u["embedding"] and len(u["embedding"]) != EMBEDDING_DIMENSION]
    checks["wrong_dimension"] = len(wrong_dim)

    # truncated 检查
    truncated = [u for u in units if u["truncated"]]
    checks["truncated_count"] = len(truncated)

    # 各项目统计
    project_counts = Counter(u["project"] for u in units)
    checks["projects"] = dict(project_counts)

    # iceberg M1-M5 覆盖率
    has_iceberg = sum(1 for u in units if u["iceberg"])
    checks["has_iceberg_rate"] = has_iceberg / len(units) if units else 0

    checks["passed"] = (
        checks["segment_id_duplicates"] == 0
        and checks["empty_embedding_text"] == 0
        and checks["wrong_dimension"] == 0
    )

    return checks


def save_output(units, checks, input_filter=None):
    """保存 Embedding 输出 JSON 文件。"""
    EMBED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 文件名
    if input_filter:
        fname = f"{input_filter}_segment_embeddings.json"
    else:
        fname = "segment_embeddings.json"

    output_path = EMBED_OUTPUT_DIR / fname

    # 分离 embedding 为独立文件（避免 JSON 过大）
    # 主文件存 metadata（不含向量）
    metadata_units = []
    for u in units:
        mu = {k: v for k, v in u.items() if k != "embedding"}
        metadata_units.append(mu)

    output = {
        "meta": {
            "embedding_model": EMBEDDING_MODEL_NAME,
            "embedding_version": EMBEDDING_VERSION,
            "dimension_size": EMBEDDING_DIMENSION,
            "normalized": True,
            "total_units": len(units),
            "skipped": checks["skipped"],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
        "quality_checks": checks,
        "units": metadata_units,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # 向量单独存为 .npy 格式（对齐 segment_id 顺序）
    vectors_path = output_path.with_suffix(".npy")
    import numpy as np

    vectors = np.array([u["embedding"] for u in units], dtype=np.float32)
    np.save(vectors_path, vectors)

    # 同时保存 segment_id 映射文件
    mapping_path = output_path.with_name(output_path.stem + "_ids.json")
    id_mapping = [u["segment_id"] for u in units]
    with open(mapping_path, "w", encoding="utf-8") as f:
        json.dump(id_mapping, f, ensure_ascii=False, indent=2)

    return output_path


def main():
    parser = argparse.ArgumentParser(description="Segment Embedding 生成脚本 v3.0")
    parser.add_argument("--dry-run", action="store_true", help="只分析不输出文件")
    parser.add_argument("--input", type=str, default=None, help="指定项目名称（如：瓦洛兰特海外人群玩法研究）")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help=f"批次大小（默认 {BATCH_SIZE}）")
    parser.add_argument("--no-embed", action="store_true", help="跳过向量生成，只输出 metadata")
    args = parser.parse_args()

    # ── Step 1: 加载 merged 文件 ──
    print("=" * 60)
    print("📥 Step 1: 加载 Label 文件（merged）")
    merged_files = load_merged_files(args.input)
    if not merged_files:
        sys.exit(1)

    total_segments = sum(len(data.get("segments", [])) for _, data in merged_files)
    total_respondents = sum(len(data.get("respondents", [])) for _, data in merged_files)
    print(f"   总 Segment 数: {total_segments}")
    print(f"   总 Respondent 数: {total_respondents}")

    # ── Step 2: 收集有效 Segment ──
    print(f"\n📋 Step 2: 收集有效 Segment")
    units, texts, skipped, dup_skipped = collect_embedding_inputs(merged_files)
    print(f"   有效 Segment: {len(units)}")
    print(f"   跳过（无效）: {skipped}")
    print(f"   跳过（重复）: {dup_skipped}")

    if not units:
        print("❌ 无有效 Segment，退出")
        sys.exit(1)

    # ── Step 3: 生成 Embedding ──
    if not args.no_embed:
        print(f"\n🔢 Step 3: 生成 Embedding 向量")
        model = load_model()
        vectors = generate_embeddings(model, texts, args.batch_size)

        # 将向量写入 units
        for i, vec in enumerate(vectors):
            units[i]["embedding"] = vec
        print(f"   生成 {len(vectors)} 条向量")
    else:
        print(f"\n⏭️  Step 3: 跳过（--no-embed）")

    # ── Step 4: 质量检查 ──
    print(f"\n✅ Step 4: 质量检查")
    checks = run_quality_checks(units, total_segments, skipped + dup_skipped)
    print(f"   Coverage: {checks['coverage']:.2%}")
    print(f"   segment_id 重复: {checks['segment_id_duplicates']}")
    print(f"   embedding_text 空值: {checks['empty_embedding_text']}")
    print(f"   维度错误: {checks['wrong_dimension']}")
    print(f"   truncated: {checks['truncated_count']}")
    print(f"   iceberg 覆盖率: {checks['has_iceberg_rate']:.2%}")
    print(f"   结果: {'✅ PASS' if checks['passed'] else '❌ FAIL'}")

    # 各项目分布
    print(f"\n   项目分布:")
    for proj, count in checks.get("projects", {}).items():
        print(f"     {proj}: {count}")

    # ── Step 5: 保存 ──
    if not args.dry_run:
        print(f"\n💾 Step 5: 保存输出")
        output_path = save_output(units, checks, args.input)
        print(f"   Metadata: {output_path}")
        print(f"   Vectors:  {output_path.with_suffix('.npy')}")
        print(f"   ID Map:   {output_path.with_name(output_path.stem + '_ids.json')}")
    else:
        print(f"\n🔍 Dry-run 模式，不保存文件")

    # ── 总结 ──
    print("\n" + "=" * 60)
    print("📊 生成总结")
    print(f"   输入文件数: {len(merged_files)}")
    print(f"   总 Segment 数: {total_segments}")
    print(f"   有效 Segment: {len(units)}")
    print(f"   跳过（无效）: {skipped}")
    print(f"   输出目录: {EMBED_OUTPUT_DIR}")
    print("=" * 60)


if __name__ == "__main__":
    main()