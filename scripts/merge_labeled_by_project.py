#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按项目文件夹合并标注结果，并重新编号受访者。

用法:
  python3 merge_labeled_by_project.py                           # 全量模式（默认）
  python3 merge_labeled_by_project.py --mode append --project "美国HD端射击市场用户细分研究"  # 增量追加
  python3 merge_labeled_by_project.py --mode append --project "美国HD端射击市场用户细分研究" --dry-run  # 预览

输入:
  data/群体画像v2.0_labeled/<项目名>/<文件>.json
  data/群体画像v2.0_cleaned/<项目名>/<文件>_cleaned.json（读取受访者元信息）

输出:
  data/群体画像v2.0_merged/<项目名>.json
  结构: {project, respondents, segments, meta}
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.environ.get("PIPELINE_LABELED_DIR", os.path.join(BASE_DIR, "data", "群体画像v2.0_labeled"))
CLEANED_DIR = os.environ.get("PIPELINE_CLEANED_DIR", os.path.join(BASE_DIR, "data", "群体画像v2.0_cleaned"))
OUT_DIR = os.environ.get("PIPELINE_MERGED_DIR", os.path.join(BASE_DIR, "data", "群体画像v2.0_merged"))
BACKUP_DIR = os.path.join(OUT_DIR, ".backup")


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
    """合并单个项目下的所有文件（全量模式）。"""
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


# ============================================================
# 增量追加模式 (--mode append)
# ============================================================

def _make_segment_key(seg):
    """生成 segment 去重键：基于 (source_file, speaker_id, cleaned_text) 的前200字符。"""
    source_file = seg.get("source_file", "")
    speaker_id = seg.get("speaker_id", "")
    text = (seg.get("cleaned_text") or seg.get("original_text") or "")[:200]
    return (source_file, speaker_id, text)


def _make_respondent_key(r):
    """生成 respondent 去重键：基于 (source_file, speaker_id)。"""
    source_file = r.get("source_file", "")
    speaker_id = r.get("speaker_id", "")
    return (source_file, speaker_id)


def _extract_max_respondent_id(respondents):
    """从现有 respondents 中提取最大 Pxxx 编号。"""
    max_id = 0
    for r in respondents:
        rid = r.get("id", "")
        m = __import__("re").match(r"^P(\d{3})$", rid)
        if m:
            max_id = max(max_id, int(m.group(1)))
    return max_id


def append_merge(project_name, project_dir, dry_run=False):
    """
    增量追加模式：将新标注数据合并到已有 merged 文件中。

    逻辑：
    1. 读取已有 merged 文件
    2. 读取新 labeled 数据
    3. 按 (source_file, speaker_id) 保留已有 respondent 编号
    4. 新 respondent 从 max(Pxxx)+1 开始
    5. 按 segment 去重键合并，跳过重复
    6. 备份旧文件后写回
    """
    merged_path = os.path.join(OUT_DIR, f"{project_name}.json")

    # 1. 读取已有 merged 文件
    existing = None
    if os.path.exists(merged_path):
        with open(merged_path, encoding="utf-8") as f:
            existing = json.load(f)
        print(f"  读取已有数据: {len(existing.get('segments', []))} segments, "
              f"{len(existing.get('respondents', []))} respondents")
    else:
        print(f"  项目 '{project_name}' 尚无 merged 文件，将创建新文件")
        existing = {"project": project_name, "respondents": [], "segments": [],
                    "meta": {"source_files": [], "file_count": 0, "segment_count": 0,
                             "respondent_count": 0, "merged_at": None}}

    # 2. 建立已有 segment 去重索引
    existing_keys = set()
    for seg in existing.get("segments", []):
        existing_keys.add(_make_segment_key(seg))

    # 3. 建立已有 respondent 索引: (source_file, speaker_id) → respondent
    existing_respondent_map = {}
    for r in existing.get("respondents", []):
        key = _make_respondent_key(r)
        existing_respondent_map[key] = r

    # 4. 读取新 labeled 数据
    files = collect_json_files(project_dir)
    if not files:
        print(f"  项目目录下无标注文件，跳过")
        return {"status": "skipped", "reason": "no_new_files"}

    new_segments = []
    new_respondent_registry = {}  # key: (rel_path, original_speaker_id)

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
            if key not in new_respondent_registry:
                new_respondent_registry[key] = {
                    "rel_path": rel_path,
                    "original_speaker_id": orig_sid,
                    "respondent_data": r,
                }

        for seg in doc.get("segments", []):
            seg["_source_json"] = os.path.basename(fp)
            seg["_source_rel"] = rel_path
            new_segments.append(seg)

    # 5. 去重: 过滤掉与已有 segment 重复的新 segment
    deduped_segments = []
    skipped_dup = 0
    for seg in new_segments:
        key = _make_segment_key(seg)
        if key in existing_keys:
            skipped_dup += 1
            continue
        existing_keys.add(key)
        deduped_segments.append(seg)

    # 6. 处理新 respondent: 检查是否与已有 respondent 重复
    next_id = _extract_max_respondent_id(existing.get("respondents", [])) + 1
    new_respondents = []
    key_to_new_id = {}  # (rel_path, original_speaker_id) → Pxxx

    for key, reg in sorted(new_respondent_registry.items()):
        rel_path, orig_sid = key
        rdata = reg.get("respondent_data", {})

        # 检查是否与已有 respondent 匹配
        resp_key = _make_respondent_key(rdata)
        if resp_key in existing_respondent_map:
            # 复用已有 ID
            existing_r = existing_respondent_map[resp_key]
            key_to_new_id[key] = existing_r.get("id", f"P{next_id:03d}")
            continue

        # 新 respondent
        new_id = f"P{next_id:03d}"
        next_id += 1
        key_to_new_id[key] = new_id

        merged_r = dict(rdata)
        merged_r["id"] = new_id
        merged_r["original_speaker_id"] = orig_sid
        merged_r["source_labeled_file"] = rel_path
        new_respondents.append(merged_r)

    # 7. 更新新 segment 中的 speaker_id
    for seg in deduped_segments:
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

    # 8. 汇总统计
    stats = {
        "existing_segments": len(existing.get("segments", [])),
        "existing_respondents": len(existing.get("respondents", [])),
        "new_segments_total": len(new_segments),
        "new_segments_added": len(deduped_segments),
        "new_segments_skipped_dup": skipped_dup,
        "new_respondents_added": len(new_respondents),
        "new_respondents_reused": len(new_respondent_registry) - len(new_respondents),
    }

    if dry_run:
        print(f"\n  [DRY-RUN] 合并预览:")
        print(f"    已有 segments: {stats['existing_segments']}")
        print(f"    已有 respondents: {stats['existing_respondents']}")
        print(f"    新 segments 总数: {stats['new_segments_total']}")
        print(f"    将新增 segments: {stats['new_segments_added']}")
        print(f"    跳过重复: {stats['new_segments_skipped_dup']}")
        print(f"    将新增 respondents: {stats['new_respondents_added']}")
        print(f"    复用已有 respondents: {stats['new_respondents_reused']}")
        return {"status": "dry_run", "stats": stats}

    # 9. 备份旧文件
    if os.path.exists(merged_path):
        os.makedirs(BACKUP_DIR, exist_ok=True)
        ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        backup_path = os.path.join(BACKUP_DIR, f"{project_name}_{ts}.json")
        shutil.copy2(merged_path, backup_path)
        print(f"  已备份: {backup_path}")

    # 10. 合并并写回
    merged = {
        "project": project_name,
        "respondents": existing.get("respondents", []) + new_respondents,
        "segments": existing.get("segments", []) + deduped_segments,
        "meta": {
            "source_files": sorted(set(
                existing.get("meta", {}).get("source_files", []) +
                [os.path.basename(fp) for fp in files]
            )),
            "file_count": len(existing.get("meta", {}).get("source_files", [])) + len(files),
            "segment_count": len(existing.get("segments", [])) + len(deduped_segments),
            "respondent_count": len(existing.get("respondents", [])) + len(new_respondents),
            "merged_at": datetime.now(timezone.utc).isoformat(),
            "merge_mode": "append",
            "stats": stats,
        },
    }

    os.makedirs(os.path.dirname(merged_path), exist_ok=True)
    with open(merged_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    print(f"  → 合并完成: {stats['existing_segments']} + {stats['new_segments_added']} = "
          f"{len(merged['segments'])} segments, "
          f"{stats['existing_respondents']} + {stats['new_respondents_added']} = "
          f"{len(merged['respondents'])} respondents")
    print(f"    跳过重复: {stats['new_segments_skipped_dup']}")

    return {"status": "done", "stats": stats}


def main():
    parser = argparse.ArgumentParser(description="合并标注结果")
    parser.add_argument("--mode", choices=["full", "append"], default="full",
                        help="合并模式: full=全量重建, append=增量追加 (默认: full)")
    parser.add_argument("--project", type=str, default=None,
                        help="append 模式下的目标项目名（必需）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只打印合并计划，不实际执行")
    args = parser.parse_args()

    if args.mode == "append":
        if not args.project:
            print("错误: --mode append 需要指定 --project", file=sys.stderr)
            sys.exit(1)

        project_dir = os.path.join(SRC_DIR, args.project)
        if not os.path.isdir(project_dir):
            print(f"错误: 项目目录不存在: {project_dir}", file=sys.stderr)
            sys.exit(1)

        print(f"增量追加模式: {args.project}")
        result = append_merge(args.project, project_dir, dry_run=args.dry_run)
        if result["status"] == "dry_run":
            print("\n[Dry-run 完成，未实际修改文件]")
        elif result["status"] == "skipped":
            print(f"\n跳过: {result.get('reason', '')}")
        else:
            print(f"\n增量合并完成。输出目录: {OUT_DIR}")
        return

    # 全量模式（默认）
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