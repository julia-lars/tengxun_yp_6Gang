#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KOL 语义切分语料导入脚本。

将 data/kol/*_segmented.json（LLM 语义切分的小段）导入 kol_segments 表，
替换该 KOL 旧的语料行（500 字启发式切块）。不触碰 kol_profiles 画像。

用法:
  python3 scripts/reimport_kol_segments.py                # 处理全部 KOL
  python3 scripts/reimport_kol_segments.py --kol 鬼王陆行  # 只处理指定 KOL

导入后运行 embedding 回填:
  python3 scripts/embed_kol.py                            # 为 embedding IS NULL 的行生成向量 + ad_label
"""

import argparse
import json
import os
import sys

import psycopg2

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "kol")

# 与 seed-kol.ts / embed_kol.py 的 KOL 命名保持一致
KOLS = [
    {"file": "冷面叶星星IKGN_segmented.json", "name": "冷面叶星星IKGN"},
    {"file": "鬼王陆行_segmented.json", "name": "鬼王陆行"},
]


def get_db_url() -> str:
    url = os.getenv("DATABASE_URL", "")
    if url:
        return url
    env_file = os.path.join(BASE_DIR, ".env")
    with open(env_file, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError("未找到 DATABASE_URL（检查 .env）")


def main() -> None:
    parser = argparse.ArgumentParser(description="导入 KOL 语义切分语料到 kol_segments")
    parser.add_argument("--kol", type=str, default="", help="只处理指定 KOL")
    args = parser.parse_args()

    kols = [k for k in KOLS if not args.kol or k["name"] == args.kol]
    if not kols:
        print(f"❌ 未找到 KOL: {args.kol}")
        sys.exit(1)

    conn = psycopg2.connect(get_db_url())
    # 每个 KOL 一个事务：删旧插新原子完成，失败自动回滚
    conn.autocommit = False
    cur = conn.cursor()

    for kol in kols:
        name = kol["name"]
        filepath = os.path.join(DATA_DIR, kol["file"])
        if not os.path.exists(filepath):
            print(f"⚠️ 跳过 {name}: 缺少 {filepath}")
            continue

        with open(filepath, encoding="utf-8") as f:
            data = json.load(f)

        # 按名字找 profile（画像不动，只换语料行）
        cur.execute("SELECT id FROM kol_profiles WHERE name = %s", (name,))
        row = cur.fetchone()
        if row is None:
            print(f"⚠️ 跳过 {name}: kol_profiles 中不存在该 KOL")
            continue
        kol_id = row[0]

        # 统计待插入片段
        records = []  # (bvid, title, original_text, source_url)
        for video in data.get("videos", []):
            bvid = video.get("bvid", "")
            title = video.get("title", "") or ""
            source_url = f"https://www.bilibili.com/video/{bvid}"
            for seg in video.get("segments", []):
                seg = (seg or "").strip()
                if not seg:
                    continue
                records.append((bvid, title, seg, source_url))

        if not records:
            print(f"⚠️ 跳过 {name}: 无有效片段")
            continue

        cur.execute("SELECT count(*) FROM kol_segments WHERE kol_id = %s", (kol_id,))
        old_count = cur.fetchone()[0]

        print(f"\n📂 {name} (kol_id={kol_id}): 旧语料 {old_count} 行 → 新语义段落 {len(records)} 行")

        try:
            cur.execute("DELETE FROM kol_segments WHERE kol_id = %s", (kol_id,))
            cur.executemany(
                "INSERT INTO kol_segments (kol_id, bvid, title, original_text, source_url)"
                " VALUES (%s, %s, %s, %s, %s)",
                [(kol_id, b, t, o, u) for b, t, o, u in records],
            )
            conn.commit()
            print(f"  ✅ 已替换 {len(records)} 行（embedding 为空，待 embed_kol.py 回填）")
        except Exception as e:
            conn.rollback()
            print(f"  ❌ 事务回滚，{name} 语料保持原状: {e}")
            raise

    cur.close()
    conn.close()
    print("\n完成。下一步运行: python3 scripts/embed_kol.py")


if __name__ == "__main__":
    main()
