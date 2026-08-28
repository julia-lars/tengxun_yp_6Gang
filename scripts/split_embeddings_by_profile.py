#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按 Profile 拆分 Segment Embedding

从全量 segment_embeddings.json 中，按 Profile 文件（群体画像v2.0_profile）的
respondent_id 匹配，生成每个项目独立的 Segment Embedding 文件。

用法:
  python3 scripts/split_embeddings_by_profile.py
  python3 scripts/split_embeddings_by_profile.py --dry-run
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

PROFILE_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_profile"
SEGMENT_EMBED_PATH = PROJECT_ROOT / "data" / "embed" / "segments" / "segment_embeddings.json"
SEGMENT_NPY_PATH = PROJECT_ROOT / "data" / "embed" / "segments" / "segment_embeddings.npy"
OUTPUT_BASE = PROJECT_ROOT / "data" / "embed" / "profiles"


def load_profile_respondents(profile_path):
    """加载 Profile 文件，提取 respondent_id 列表。"""
    with open(profile_path, "r", encoding="utf-8") as f:
        profiles = json.load(f)
    return [p["respondent_id"] for p in profiles]


def load_segment_embeddings():
    """加载全量 Segment Embedding 数据。"""
    with open(SEGMENT_EMBED_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    vectors = np.load(SEGMENT_NPY_PATH)

    # 按 (project, respondent_id) 建立索引
    index = defaultdict(list)
    for i, unit in enumerate(data["units"]):
        key = (unit["project"], unit["respondent_id"])
        index[key].append((i, unit))

    return data, vectors, index


def main():
    parser = argparse.ArgumentParser(description="按 Profile 拆分 Segment Embedding")
    parser.add_argument("--dry-run", action="store_true", help="只分析不输出")
    args = parser.parse_args()

    # 加载 Profile 文件列表
    profile_files = sorted(PROFILE_DIR.glob("*_profiles.json"))
    if not profile_files:
        print(f"❌ 未找到 Profile 文件: {PROFILE_DIR}")
        sys.exit(1)

    print(f"📥 加载 {len(profile_files)} 个 Profile 文件")

    # 加载全量 Segment Embedding
    print(f"📥 加载全量 Segment Embedding ...")
    seg_data, vectors, seg_index = load_segment_embeddings()
    total_units = len(seg_data["units"])
    print(f"   全量 Segment: {total_units}")

    # 统计
    stats = {}
    total_matched = 0
    total_not_found = 0

    for pf_path in profile_files:
        project_name = pf_path.stem.replace("_profiles", "")
        profile_rids = load_profile_respondents(pf_path)

        # 匹配 segments
        matched_units = []
        matched_indices = []
        not_found_rids = []

        for rid in profile_rids:
            key = (project_name, rid)
            if key in seg_index:
                for idx, unit in seg_index[key]:
                    matched_indices.append(idx)
                    matched_units.append(unit)
            else:
                not_found_rids.append(rid)

        stats[project_name] = {
            "profile_respondents": len(profile_rids),
            "matched_segments": len(matched_units),
            "not_found_rids": not_found_rids,
            "matched_indices": matched_indices,
            "matched_units": matched_units,
        }
        total_matched += len(matched_units)
        total_not_found += len(not_found_rids)

    # 打印统计
    print(f"\n📊 匹配统计:")
    print(f"{'项目':<30} {'Profile':>8} {'匹配Segments':>12} {'未匹配':>8}")
    print("-" * 62)
    for proj, st in sorted(stats.items()):
        print(f"{proj:<30} {st['profile_respondents']:>8} {st['matched_segments']:>12} {len(st['not_found_rids']):>8}")
    print("-" * 62)
    print(f"{'合计':<30} {sum(s['profile_respondents'] for s in stats.values()):>8} {total_matched:>12} {total_not_found:>8}")

    if not args.dry_run:
        print(f"\n💾 写入输出文件到 {OUTPUT_BASE} ...")
        for proj, st in sorted(stats.items()):
            proj_dir = OUTPUT_BASE / proj
            proj_dir.mkdir(parents=True, exist_ok=True)

            units = st["matched_units"]
            indices = st["matched_indices"]

            if not units:
                print(f"   ⚠️  {proj}: 无匹配 segments，跳过")
                continue

            # 提取向量
            proj_vectors = vectors[indices]

            # metadata（不含向量）
            metadata_units = []
            for u in units:
                mu = {k: v for k, v in u.items() if k != "embedding"}
                metadata_units.append(mu)

            output = {
                "meta": {
                    "embedding_model": seg_data["meta"]["embedding_model"],
                    "embedding_version": seg_data["meta"]["embedding_version"],
                    "dimension_size": seg_data["meta"]["dimension_size"],
                    "normalized": True,
                    "total_units": len(units),
                    "project": proj,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "source": "split from full segment_embeddings.json by profile respondent_id",
                },
                "units": metadata_units,
            }

            # 写 JSON
            json_path = proj_dir / "segment_embeddings.json"
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)

            # 写 npy
            npy_path = proj_dir / "segment_embeddings.npy"
            np.save(npy_path, proj_vectors.astype(np.float32))

            # 写 ID 映射
            ids_path = proj_dir / "segment_embeddings_ids.json"
            id_mapping = [u["segment_id"] for u in units]
            with open(ids_path, "w", encoding="utf-8") as f:
                json.dump(id_mapping, f, ensure_ascii=False, indent=2)

            print(f"   ✅ {proj}: {len(units)} segments → {json_path}")

        print(f"\n✅ 完成！输出目录: {OUTPUT_BASE}")

        # 验证：检查是否有项目没有生成
        all_projects_in_seg = set(u["project"] for u in seg_data["units"])
        generated_projects = set(stats.keys())
        print(f"\n🔍 验证: Segment Embedding 中 {len(all_projects_in_seg)} 个项目全部已生成 Profile 目录")
    else:
        print(f"\n🔍 Dry-run 模式，不输出文件")


if __name__ == "__main__":
    main()