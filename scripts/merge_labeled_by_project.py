#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按项目文件夹合并标注结果，并重新编号受访者。

用法:
  python3 merge_labeled_by_project.py

输入:
  data/群体画像v2.0_labeled/<项目名>/<文件>.json
  data/群体画像v2.0_cleaned/<项目名>/<文件>_cleaned.json（读取受访者元信息）

输出:
  data/群体画像v2.0_merged/<项目名>.json
  结构: {project, respondents, segments, meta}
"""

import json
import os
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_labeled")
CLEANED_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_cleaned")
OUT_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_merged")


def find_project_dirs():
    """返回所有项目目录（直接子目录）。"""
    projects = []
    if not os.path.exists(SRC_DIR):
        return projects
    for name in sorted(os.listdir(SRC_DIR)):
        path = os.path.join(SRC_DIR, name)
        if os.path.isdir(path) and not name.startswith("."):
            projects.append((name, path))
    return projects


def collect_json_files(project_dir):
    """收集项目目录下所有标注 JSON 文件（排除 checkpoint 和 demo）。"""
    files = []
    for root, _, fs in os.walk(project_dir):
        for f in fs:
            if f.endswith(".json") and "demo" not in f.lower():
                files.append(os.path.join(root, f))
    return sorted(files)


def cleaned_path_for(labeled_path: str) -> str:
    """根据 labeled 文件路径推导对应的 cleaned 文件路径。"""
    rel = os.path.relpath(labeled_path, SRC_DIR)
    if rel.endswith(".json"):
        cleaned_rel = rel[:-5] + "_cleaned.json"
    else:
        cleaned_rel = rel
    return os.path.join(CLEANED_DIR, cleaned_rel)


def load_cleaned_respondents(labeled_path: str) -> list:
    """读取对应 cleaned 文件中的 respondents 列表。"""
    cleaned_path = cleaned_path_for(labeled_path)
    if not os.path.exists(cleaned_path):
        return []
    try:
        with open(cleaned_path, encoding="utf-8") as f:
            doc = json.load(f)
        return doc.get("respondents", []) or []
    except Exception as e:
        print(f"  读取 cleaned 文件失败 {cleaned_path}: {e}")
        return []


def merge_project(project_name, project_dir):
    """合并单个项目下的所有文件。"""
    files = collect_json_files(project_dir)
    all_segments = []

    # key: (labeled_rel_path, original_speaker_id)
    respondent_registry = {}

    for fp in files:
        rel_path = os.path.relpath(fp, SRC_DIR)
        try:
            with open(fp, encoding="utf-8") as f:
                doc = json.load(f)
        except Exception as e:
            print(f"  读取失败 {fp}: {e}")
            continue

        # 从对应 cleaned 文件读取受访者元信息
        cleaned_respondents = load_cleaned_respondents(fp)
        for r in cleaned_respondents:
            orig_sid = r.get("speaker_id")
            if not orig_sid:
                continue
            key = (rel_path, orig_sid)
            if key not in respondent_registry:
                respondent_registry[key] = {
                    "rel_path": rel_path,
                    "original_speaker_id": orig_sid,
                    "respondent_data": r,
                    "first_segment_index": None,
                }

        for seg in doc.get("segments", []):
            # 保留原始文件名信息
            seg["_source_json"] = os.path.basename(fp)
            seg["_source_rel"] = rel_path
            all_segments.append(seg)

    # 按原始文件、segment_index 排序，保持相对顺序
    all_segments.sort(key=lambda s: (s.get("_source_json", ""), s.get("segment_index", 0)))

    # 重新编号受访者：按首次出现顺序
    seen_keys = set()
    ordered_keys = []
    for seg in all_segments:
        rel_path = seg.get("_source_rel")
        orig = seg.get("speaker_id")
        if not orig or not rel_path:
            continue
        key = (rel_path, orig)
        if key not in seen_keys:
            seen_keys.add(key)
            ordered_keys.append(key)
            if key in respondent_registry and respondent_registry[key]["first_segment_index"] is None:
                respondent_registry[key]["first_segment_index"] = seg.get("segment_index")

    # 补充 cleaned 中有、但 segments 里未出现的受访者
    for key in respondent_registry:
        if key not in seen_keys:
            ordered_keys.append(key)

    key_to_new_id = {}
    respondents = []
    for counter, key in enumerate(ordered_keys, start=1):
        new_id = f"P{counter:03d}"
        key_to_new_id[key] = new_id
        reg = respondent_registry.get(key, {})
        rdata = reg.get("respondent_data", {}) if isinstance(reg, dict) else {}
        merged_r = dict(rdata)
        merged_r["id"] = new_id
        merged_r["original_speaker_id"] = key[1]
        merged_r["source_labeled_file"] = key[0]
        respondents.append(merged_r)

    # 更新 segment 中的 speaker_id 和 annotation.source.speaker_id
    for seg in all_segments:
        rel_path = seg.get("_source_rel")
        orig = seg.get("speaker_id")
        if orig and rel_path:
            key = (rel_path, orig)
            new_id = key_to_new_id.get(key)
            if new_id:
                seg["speaker_id"] = new_id
                if "annotation" in seg and isinstance(seg["annotation"], dict):
                    source = seg["annotation"].get("source")
                    if not isinstance(source, dict):
                        source = {}
                        seg["annotation"]["source"] = source
                    source["speaker_id"] = new_id
                    source["original_speaker_id"] = orig
                    source["source_labeled_file"] = rel_path

    return {
        "project": project_name,
        "respondents": respondents,
        "segments": all_segments,
        "meta": {
            "source_files": [os.path.basename(fp) for fp in files],
            "file_count": len(files),
            "segment_count": len(all_segments),
            "respondent_count": len(respondents),
            "merged_at": datetime.now(timezone.utc).isoformat(),
        },
    }


def main():
    projects = find_project_dirs()
    print(f"发现 {len(projects)} 个项目")

    os.makedirs(OUT_DIR, exist_ok=True)

    for name, path in projects:
        print(f"合并项目: {name}")
        merged = merge_project(name, path)
        out_path = os.path.join(OUT_DIR, f"{name}.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(
            f"  → {out_path} | "
            f"文件 {merged['meta']['file_count']} | "
            f"受访者 {merged['meta']['respondent_count']} | "
            f"片段 {merged['meta']['segment_count']}"
        )

    print(f"\n全部完成。输出目录: {OUT_DIR}")


if __name__ == "__main__":
    main()
