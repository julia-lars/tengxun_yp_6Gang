#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将新 merged 数据 + Segment Embedding 向量导入 source_segments 表。

流程：
  1. 遍历 14 个 merged 文件，提取 segment
  2. 关联 Segment Embedding 向量（按 segment_id 匹配）
  3. 关联 respondents.persona_ids（按 respondent_id 匹配）
  4. 按 source_file 增量 upsert（不删除已有数据，仅更新/插入当前项目）

用法:
  python3 scripts/import_source_segments.py --dry-run
  python3 scripts/import_source_segments.py
  python3 scripts/import_source_segments.py --source-file "漫威争锋中美用户洞察研究"  # 只导入单个项目
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import psycopg2
from psycopg2.extras import execute_values

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

MERGED_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_merged"
EMBED_DIR = PROJECT_ROOT / "data" / "embed" / "segments"
PROFILE_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_profile"

DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://dev:dev@localhost:5432/webtutor")


def get_db_connection():
    m = re.match(r"postgres://(.+):(.+)@(.+):(\d+)/(.+)", DATABASE_URL)
    if not m:
        raise ValueError(f"无法解析 DATABASE_URL: {DATABASE_URL}")
    user, password, host, port, dbname = m.groups()
    return psycopg2.connect(
        host=host, port=int(port), dbname=dbname, user=user, password=password
    )


def load_merged_segments():
    """加载所有 merged 文件中的有效 segment（is_player_evidence=true）。

    Returns:
        [(project_name, segment_dict), ...]
    """
    segments = []
    skipped = 0
    for mf in sorted(MERGED_DIR.glob("*.json")):
        if mf.name.startswith("."):
            continue
        project_name = mf.stem  # 文件名去掉 .json 作为项目名
        with open(mf, "r", encoding="utf-8") as f:
            data = json.load(f)
        for seg in data.get("segments", []):
            validity = seg.get("annotation", {}).get("validity", {})
            if not validity.get("is_player_evidence", True):
                skipped += 1
                continue
            segments.append((project_name, seg))
    return segments, skipped


def load_embedding_vectors():
    """加载 Segment Embedding 向量和 metadata。

    embed_segments.py 输出格式：
      data/embed/segments/segment_embeddings.json  — 所有项目的 metadata（不含向量）
      data/embed/segments/segment_embeddings.npy   — 向量数组（对齐 units 顺序）

    Returns:
        {segment_id: {"vector": [...], "respondent_id": "...", "embedding_version": "..."}}
    """
    embed_map = {}
    json_path = EMBED_DIR / "segment_embeddings.json"
    npy_path = EMBED_DIR / "segment_embeddings.npy"

    if not json_path.exists() or not npy_path.exists():
        print(f"   ⚠️ Embedding 文件不存在: {json_path} / {npy_path}")
        return embed_map

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    vectors = np.load(npy_path)

    for i, unit in enumerate(data.get("units", [])):
        sid = unit.get("segment_id", "")
        if sid:
            embed_map[sid] = {
                "vector": vectors[i].tolist(),
                "respondent_id": unit.get("respondent_id", ""),
                "embedding_version": unit.get("embedding_version", "v3.0"),
            }

    return embed_map


def load_profile_display_name_map():
    """从 Profile 文件加载 respondent_id -> display_name 映射。

    Profile 结构: respondent_id (P001) -> metadata.display_name (G1-ZSC)
    """
    rid_to_display = {}
    for pf in sorted(PROFILE_DIR.glob("*_profiles.json")):
        with open(pf, "r", encoding="utf-8") as f:
            profiles = json.load(f)
        for p in profiles:
            rid = p["respondent_id"]
            display_name = p.get("metadata", {}).get("display_name", "")
            if display_name and isinstance(display_name, str):
                rid_to_display[rid] = display_name
    return rid_to_display


def load_respondent_persona_map(conn, rid_to_display):
    """从数据库加载 (source_file, speaker_id) -> persona_ids 映射。

    映射链：
      merged speaker_id (P001) → Profile display_name (G1-ZSC) → DB speaker_id (G1-ZSC) → persona_ids

    同时建立 (source_file, merged_speaker_id) 的匹配，因为 DB 中同一个 source_file
    下可能有多个 speaker_id。
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT source_file, speaker_id, persona_ids FROM respondents WHERE persona_ids IS NOT NULL AND array_length(persona_ids, 1) > 0"
    )

    # 收集 DB 中有 persona_ids 的 respondents
    db_rows = [(sf, sid, pids) for sf, sid, pids in cur.fetchall()]

    # 策略 1: 通过 display_name 匹配 DB speaker_id（不限定 source_file）
    db_sid_to_pids = {}
    for sf, sid, pids in db_rows:
        if sid and sid not in db_sid_to_pids:
            db_sid_to_pids[sid] = (sf, pids)

    # 策略 2: (source_file, display_name) 精确匹配
    db_sf_sid_to_pids = {}
    for sf, sid, pids in db_rows:
        if sid:
            db_sf_sid_to_pids[(sf, sid)] = pids

    # 构建最终映射: merged_speaker_id -> persona_ids
    mapping = {}
    for rid, display_name in rid_to_display.items():
        # 策略 1: 直接用 display_name 匹配 DB speaker_id
        if display_name in db_sid_to_pids:
            sf, pids = db_sid_to_pids[display_name]
            mapping[rid] = (sf, pids)
            continue

        # 策略 2: 用 merged speaker_id 直接匹配 DB speaker_id
        if rid in db_sid_to_pids:
            sf, pids = db_sid_to_pids[rid]
            mapping[rid] = (sf, pids)

    return mapping


def parse_segment_index(segment_id):
    """从 segment_id 解析 segment_index。P006_1 → 1"""
    parts = segment_id.rsplit("_", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return int(parts[1])
    return 0


def build_db_rows(segments, embed_map, persona_map):
    """构建要写入数据库的行。"""
    rows = []
    matched_embed = 0
    matched_persona = 0

    for project_name, seg in segments:
        sid = seg["segment_id"]
        sf = seg.get("source_file", "")
        speaker_id = seg.get("speaker_id", "")

        # 从 embed_map 查找向量
        # embed 中的 segment_id 格式: "Deadlock竞品研究_P006_1"
        # merged 中的 segment_id 格式: "P006_1"，项目名是 merged 文件名
        # 注意：embed 中项目名去掉了空格和特殊字符（与 embed_segments.py 一致）
        proj_slug = re.sub(r'[^a-zA-Z0-9一-鿿]', '', project_name)[:20]
        embed_key = f"{proj_slug}_{sid}"
        embed_info = embed_map.get(embed_key)
        if embed_info:
            matched_embed += 1

        # 从 persona_map 查找 persona_ids
        # 映射链: merged speaker_id (P001) → Profile display_name → DB speaker_id → persona_ids
        persona_ids = None
        if speaker_id in persona_map:
            mapping_sf, pids = persona_map[speaker_id]
            if pids and len(pids) > 0:
                persona_ids = pids
                matched_persona += 1

        # 构建 annotation
        annotation = seg.get("annotation")
        if annotation and isinstance(annotation, dict) and len(annotation) == 0:
            annotation = None

        # 构建 row
        vector = embed_info["vector"] if embed_info else None
        embedding_version = embed_info["embedding_version"] if embed_info else None

        row = (
            sf,                                    # source_file
            parse_segment_index(sid),              # segment_index
            speaker_id,                            # speaker_id
            "interviewee",                         # speaker_role
            seg.get("preceding_question"),         # preceding_question
            seg.get("cleaned_text", ""),           # original_text（merged 无 original_text，用 cleaned_text）
            seg.get("cleaned_text", ""),           # cleaned_text
            seg.get("char_count"),                 # char_count
            json.dumps(annotation) if annotation else None,  # annotation
            vector,                                # embedding
            embedding_version,                     # embedding_version
            persona_ids,                           # persona_ids
        )
        rows.append(row)

    return rows, matched_embed, matched_persona


def main():
    parser = argparse.ArgumentParser(description="导入新 source_segments 数据")
    parser.add_argument("--dry-run", action="store_true", help="只分析不执行")
    parser.add_argument("--force", action="store_true", help="清空全部数据后重新导入")
    parser.add_argument(
        "--source-file",
        type=str,
        default=None,
        help="只导入指定 source_file 的项目（增量更新单个项目）",
    )
    args = parser.parse_args()

    # ── Step 1: 加载数据 ──
    print("=" * 60)
    print("📥 Step 1: 加载数据")

    segments, skipped_invalid = load_merged_segments()
    print(f"   Merged segments (有效): {len(segments)}")
    print(f"   跳过 (is_player_evidence=false): {skipped_invalid}")

    embed_map = load_embedding_vectors()
    print(f"   Embedding vectors: {len(embed_map)}")

    # ── Step 2: 加载 persona 映射 ──
    print(f"\n📥 Step 2: 加载 persona 映射")
    rid_to_display = load_profile_display_name_map()
    print(f"   Profile 映射: {len(rid_to_display)} 条")
    conn = get_db_connection()
    try:
        persona_map = load_respondent_persona_map(conn, rid_to_display)
        print(f"   Persona 映射: {len(persona_map)} 条")

        # ── Step 3: 构建 DB rows ──
        print(f"\n🔧 Step 3: 构建数据行")
        rows, matched_embed, matched_persona = build_db_rows(
            segments, embed_map, persona_map
        )
        print(f"   总行数: {len(rows)}")
        print(f"   有 embedding: {matched_embed}")
        print(f"   有 persona_ids: {matched_persona}")

        if args.dry_run:
            print(f"\n🔍 Dry-run 模式，不写入数据库")
            return

        # ── Step 4: 写入数据库 ──
        cur = conn.cursor()

        # --force: 清空全部数据
        if args.force:
            print(f"\n🗑️  --force: 清空全部 source_segments ...")
            cur.execute("DELETE FROM source_segments")
            print(f"   已删除 {cur.rowcount} 条")

        # 如果指定了 --source-file，先删除该 source_file 的旧数据再插入
        if args.source_file:
            print(f"\n🗑️  删除 source_file='{args.source_file}' 的旧数据 ...")
            cur.execute(
                "DELETE FROM source_segments WHERE source_file = %s",
                (args.source_file,),
            )
            print(f"   已删除 {cur.rowcount} 条")

        print(f"\n💾 写入 {len(rows)} 条 segments ...")

        # 批量插入（每批 500 条）
        batch_size = 500
        total_inserted = 0
        for i in range(0, len(rows), batch_size):
            batch = rows[i : i + batch_size]
            execute_values(
                cur,
                """INSERT INTO source_segments
                   (source_file, segment_index, speaker_id, speaker_role,
                    preceding_question, original_text, cleaned_text, char_count,
                    annotation, embedding, embedding_version, persona_ids)
                   VALUES %s""",
                batch,
                template="(%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::vector, %s, %s::integer[])",
            )
            total_inserted += len(batch)
            if (i // batch_size) % 10 == 0:
                print(f"   ... {total_inserted}/{len(rows)}")

        conn.commit()
        print(f"   ✅ 完成: {total_inserted} 条")

        # ── Step 5: 验证 ──
        print(f"\n✅ Step 5: 验证")
        cur.execute("SELECT count(*) FROM source_segments")
        count = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM source_segments WHERE embedding IS NOT NULL")
        embed_count = cur.fetchone()[0]
        cur.execute(
            "SELECT count(*) FROM source_segments WHERE persona_ids IS NOT NULL"
        )
        persona_count = cur.fetchone()[0]

        print(f"   总 segments: {count}")
        print(f"   有 embedding: {embed_count}")
        print(f"   有 persona_ids: {persona_count}")

        # 重建 HNSW 索引（如果有的话）
        print(f"\n   重建 HNSW 索引 ...")
        try:
            cur.execute("DROP INDEX IF EXISTS ss_embedding_hnsw_idx")
            cur.execute(
                """CREATE INDEX ss_embedding_hnsw_idx
                   ON source_segments
                   USING hnsw (embedding vector_cosine_ops)"""
            )
            print(f"   ✅ HNSW 索引已重建")
        except Exception as e:
            print(f"   ⚠️  HNSW 索引重建失败: {e}")

        conn.commit()

    finally:
        conn.close()

    print("\n" + "=" * 60)
    print("✅ 导入完成")


if __name__ == "__main__":
    main()