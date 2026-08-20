#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 data/annotated/segments_*.json（v2.0 标注结果）加载到 source_segments + respondents 表。

用法:
  python3 scripts/load_segments.py               # 灌库（source_segments 已有数据时跳过）
  python3 scripts/load_segments.py --force       # 清空 source_segments/respondents 后重灌
  python3 scripts/load_segments.py --dry-run     # 只统计，不写库

映射:
  label        -> source_segments.annotation (jsonb，v2.0 冰山+框架标注)
  (source_file, speaker_id) -> respondents（去重，display_name=speaker_id）
"""
import glob
import json
import os
import sys

import psycopg2
import psycopg2.extras

DB_URL = os.getenv("DATABASE_URL", "postgres://dev:dev@localhost:5432/webtutor")
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANNOTATED_DIR = os.path.join(BASE_DIR, "data", "annotated")

SPEAKER_ROLE_SET = {"interviewee", "moderator"}


def sheet_from_source_file(source_file: str) -> str:
    if "漫威" in source_file:
        return "中美用户洞察"
    if "用户细分" in source_file:
        return "用户细分研究"
    if "生态与决策" in source_file:
        return "用户生态与决策链路"
    if "行为" in source_file or "乐趣" in source_file:
        return "玩家行为乐趣整理"
    if "经验认知" in source_file:
        return "经验认知乐趣对比"
    return "未知"


def load_rows():
    files = sorted(glob.glob(os.path.join(ANNOTATED_DIR, "segments_*.json")))
    rows = []
    for f in files:
        data = json.load(open(f, encoding="utf-8"))
        rows.extend(data)
    return rows, files


def main():
    force = "--force" in sys.argv
    dry = "--dry-run" in sys.argv

    rows, files = load_rows()
    print(f"📥 共 {len(rows)} 条片段（来自 {len(files)} 个文件）")

    rs_count = {}
    for r in rows:
        rs = (r.get("label") or {}).get("meta", {}).get("rs", "review")
        rs_count[rs] = rs_count.get(rs, 0) + 1
    print(f"   meta.rs 分布: {rs_count}")

    respondents = {}
    for r in rows:
        respondents[(r.get("source_file"), r.get("speaker_id"))] = True
    print(f"   去重后受访者: {len(respondents)} 人")

    if dry:
        return

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("SELECT count(*) FROM source_segments")
    existing = cur.fetchone()[0]
    if existing and not force:
        print(f"⚠️  source_segments 已有 {existing} 条，跳过（用 --force 清空重灌）")
        conn.close()
        return
    if force:
        cur.execute("TRUNCATE source_segments, respondents RESTART IDENTITY CASCADE")
        print("🧹 已清空 source_segments / respondents")

    # 1) 受访者去重
    resp_rows = {}
    for r in rows:
        key = (r.get("source_file"), r.get("speaker_id"))
        if key in resp_rows:
            continue
        resp_rows[key] = {
            "source_file": r.get("source_file"),
            "speaker_id": r.get("speaker_id"),
            "display_name": r.get("speaker_id"),
            "group_code": sheet_from_source_file(r.get("source_file") or ""),
        }

    for resp in resp_rows.values():
        cur.execute(
            """INSERT INTO respondents (source_file, speaker_id, display_name, group_code)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (source_file, speaker_id) DO NOTHING""",
            (resp["source_file"], resp["speaker_id"], resp["display_name"], resp["group_code"]),
        )

    # 2) 片段
    inserted = 0
    for r in rows:
        speaker_role = r.get("speaker_role") or "interviewee"
        if speaker_role not in SPEAKER_ROLE_SET:
            speaker_role = "interviewee"
        char_count = r.get("char_count")
        if char_count is None:
            char_count = len(r.get("original_text") or "")
        annotation = r.get("label")
        cur.execute(
            """INSERT INTO source_segments
               (source_file, segment_index, speaker_id, speaker_role, preceding_question,
                original_text, cleaned_text, char_count, annotation)
               VALUES (%s, %s, %s, %s::speaker_role, %s, %s, %s, %s, %s)""",
            (
                r.get("source_file"),
                r.get("segment_index") or 0,
                r.get("speaker_id"),
                speaker_role,
                r.get("preceding_question"),
                r.get("original_text"),
                r.get("cleaned_text"),
                char_count,
                psycopg2.extras.Json(annotation) if annotation else None,
            ),
        )
        inserted += 1

    conn.commit()
    cur.close()
    conn.close()
    print(f"✅ 已写入 source_segments {inserted} 条，respondents {len(resp_rows)} 人")


if __name__ == "__main__":
    main()
