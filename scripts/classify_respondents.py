#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 respondents 分类到 5 个群体画像（C1-C5）

基于 Segment Embedding 中 M1_motivation 标注，按 respondent 聚合后分配画像。
一个 respondent 可以属于多个画像。

流程：
  1. 从新 Profile 和 Segment Embedding 中提取 respondent 数据
  2. 基于 M1_motivation 标注分类到 C1-C5
  3. 将新 respondents 导入数据库
  4. 更新 respondents.persona_ids
  5. 更新 personas.sample_count 和 evidence_ids

用法:
  python3 scripts/classify_respondents.py --dry-run     # 只分析不执行
  python3 scripts/classify_respondents.py               # 执行分类和数据库更新
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_values

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

PROFILE_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_profile"
EMBED_DIR = PROJECT_ROOT / "data" / "embed" / "profiles"
MERGED_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_merged"

# 数据库连接
DATABASE_URL = os.environ.get("DATABASE_URL", "postgres://dev:dev@localhost:5432/webtutor")

# M1_motivation -> 画像 cluster_id 映射
M1_TO_PERSONA = {
    # C1: 竞技成长型 — 策略掌控, 能力成长, 竞技证明
    "strategy_mastery": "C1",
    "ability_growth": "C1",
    "competitive_proof": "C1",
    "achievement": "C1",
    "achievement_satisfaction": "C1",
    "dominance": "C1",
    "fair_competition": "C1",
    # C2: 社交归属型 — 社交归属, 团队协作
    "social_belonging": "C2",
    "team_cooperation": "C2",
    # C3: 低压解压型 — 放松逃避
    "relaxation_escape": "C3",
    "enjoyment": "C3",
    "low_barrier": "C3",
    "monetization_fair": "C3",
    # C4: 战斗刺激型 — 射击爽感
    "stimulation": "C4",
    # C5: 沉浸探索型 — 探索收集, 叙事沉浸
    "exploration_collection": "C5",
    "narrative_immersion": "C5",
    "sensory_aesthetics": "C5",
    "immersion": "C5",
    "expression_creation": "C5",
}

# cluster_id -> persona DB id
CLUSTER_TO_DB_ID = {"C1": 1, "C2": 2, "C3": 3, "C4": 4, "C5": 5}

# 分类阈值：某个画像的 M1 标注比例 >= 该值则分配
THRESHOLD = 0.15


def load_profile_mapping():
    """从 Profile 文件建立多种维度到 respondent_id 的映射。

    返回:
        {
            "by_source_display": {(source_file, display_name): respondent_id},
            "by_source_demo_name": {(source_file, demographics.name): respondent_id},
            "by_source_rid": {(source_file, respondent_id): respondent_id},
        }
    """
    by_source_display = {}
    by_source_demo_name = {}
    by_source_rid = {}

    for pf_file in sorted(PROFILE_DIR.glob("*_profiles.json")):
        with open(pf_file, "r", encoding="utf-8") as f:
            profiles = json.load(f)
        for p in profiles:
            rid = p["respondent_id"]
            meta = p.get("metadata", {})
            display_name = meta.get("display_name", "")
            demo_name = meta.get("demographics", {}).get("name", "")
            source_files = meta.get("source_files", [])

            for sf in source_files:
                if display_name and isinstance(display_name, str):
                    by_source_display[(sf, display_name)] = rid
                if demo_name and isinstance(demo_name, str) and demo_name != display_name:
                    by_source_demo_name[(sf, demo_name)] = rid
                by_source_rid["__sf__" + sf] = rid  # 用于 source_file 级别回退

            # 也添加 respondent_id 直接映射
            by_source_rid[rid] = rid

    return {
        "by_source_display": by_source_display,
        "by_source_demo_name": by_source_demo_name,
        "by_source_rid": by_source_rid,
    }


def classify_respondents():
    """基于 Segment Embedding 的 M1_motivation 标注分类 respondents。"""
    respondent_personas = defaultdict(Counter)  # respondent_id -> Counter(cluster_id)
    respondent_projects = {}  # respondent_id -> project_name

    for proj_dir in sorted(os.listdir(EMBED_DIR)):
        json_path = EMBED_DIR / proj_dir / "segment_embeddings.json"
        if not json_path.exists():
            continue
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        for u in data["units"]:
            rid = u["respondent_id"]
            respondent_projects[rid] = proj_dir
            ice = u.get("iceberg", {})
            for val in ice.get("M1_motivation", []):
                cluster = M1_TO_PERSONA.get(val)
                if cluster:
                    respondent_personas[rid][cluster] += 1

    # 分配
    result = {}
    for rid, persona_counts in respondent_personas.items():
        total = sum(persona_counts.values())
        if total == 0:
            result[rid] = []
            continue
        assigned = [c for c, _cnt in persona_counts.most_common() if _cnt / total >= THRESHOLD]
        result[rid] = assigned

    return result, respondent_projects


def get_db_connection():
    """解析 DATABASE_URL 并建立连接。"""
    import re
    m = re.match(r"postgres://(.+):(.+)@(.+):(\d+)/(.+)", DATABASE_URL)
    if not m:
        raise ValueError(f"无法解析 DATABASE_URL: {DATABASE_URL}")
    user, password, host, port, dbname = m.groups()
    return psycopg2.connect(
        host=host, port=int(port), dbname=dbname, user=user, password=password
    )


def import_new_respondents(conn, profile_mapping, respondent_projects, classification):
    """将 Profile 中新的 respondents 导入数据库。"""
    cur = conn.cursor()
    cur.execute("SELECT source_file, speaker_id, id FROM respondents")
    existing = {(row[0], row[1]): row[2] for row in cur.fetchall()}

    by_source_display = profile_mapping["by_source_display"]

    # 收集需要导入的 respondents
    to_insert = []
    rid_to_meta = {}
    for (sf, dn), rid in by_source_display.items():
        if rid not in rid_to_meta:
            rid_to_meta[rid] = []
        rid_to_meta[rid].append((sf, dn))

    for rid, project in respondent_projects.items():
        metas = rid_to_meta.get(rid, [])
        for sf, dn in metas:
            key = (sf, dn)
            if key not in existing:
                to_insert.append((sf, dn, project))

    if not to_insert:
        print("   所有 respondents 已存在数据库中，无需导入")
        return existing

    print(f"   导入 {len(to_insert)} 个新 respondents ...")

    rows = [(sf, dn, dn, "unknown", json.dumps({}), None) for sf, dn, _project in to_insert]
    execute_values(
        cur,
        """INSERT INTO respondents (source_file, speaker_id, display_name, group_code, background, persona_ids)
           VALUES %s
           ON CONFLICT (source_file, speaker_id) DO NOTHING""",
        rows,
        template="(%s, %s, %s, %s, %s, %s::integer[])",
    )
    conn.commit()

    cur.execute("SELECT source_file, speaker_id, id FROM respondents")
    existing = {(row[0], row[1]): row[2] for row in cur.fetchall()}
    return existing


def update_persona_ids(conn, profile_mapping, db_respondents, classification):
    """更新数据库中 respondents.persona_ids。

    使用多策略匹配：
    1. (source_file, display_name) 精确匹配
    2. (source_file, demographics.name) 匹配
    3. source_file 级别回退：同一 source_file 下按顺序分配
    """
    cur = conn.cursor()

    by_source_display = profile_mapping["by_source_display"]
    by_source_demo_name = profile_mapping["by_source_demo_name"]

    # 获取 DB 中所有 respondents 按 source_file 分组
    db_by_source = defaultdict(list)  # source_file -> [(db_id, speaker_id, display_name)]
    for (sf, sid), db_id in db_respondents.items():
        db_by_source[sf].append((db_id, sid, sid))  # speaker_id 作为 display_name

    # 策略 1 + 2: 精确匹配
    db_to_profile = {}
    unmatched_db = []  # 未匹配的 DB respondents

    for sf, db_list in db_by_source.items():
        for db_id, sid, dn in db_list:
            # 策略 1: display_name 匹配
            key = (sf, sid)
            if key in by_source_display:
                db_to_profile[db_id] = by_source_display[key]
                continue
            # 策略 2: demographics.name 匹配
            if key in by_source_demo_name:
                db_to_profile[db_id] = by_source_demo_name[key]
                continue
            unmatched_db.append((db_id, sf, sid))

    print(f"   策略1+2 匹配: {len(db_to_profile)} 个")
    print(f"   未匹配: {len(unmatched_db)} 个")

    # 策略 3: source_file 级别回退匹配
    if unmatched_db:
        # 收集 Segment Embedding 中每个 source_file 的 respondent 分类
        # 从 classification 中获取每个 source_file 的 respondent 列表
        # 需要从 embed 数据中获取 source_file -> respondent_id 映射
        sf_to_rids = defaultdict(list)
        for proj_dir in sorted(EMBED_DIR.iterdir()):
            if not proj_dir.is_dir():
                continue
            json_path = proj_dir / "segment_embeddings.json"
            if not json_path.exists():
                continue
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for u in data["units"]:
                sf = u.get("source_file", "")
                rid = u.get("respondent_id", "")
                if sf and rid:
                    if rid not in sf_to_rids[sf]:
                        sf_to_rids[sf].append(rid)

        # 对每个 source_file，按顺序匹配
        sf_rids_used = defaultdict(int)  # 已使用的 respondent 索引
        sf_fallback_count = 0

        for db_id, sf, sid in unmatched_db:
            rids = sf_to_rids.get(sf, [])
            if not rids:
                continue
            idx = sf_rids_used[sf]
            if idx < len(rids):
                db_to_profile[db_id] = rids[idx]
                sf_rids_used[sf] += 1
                sf_fallback_count += 1

        print(f"   策略3 回退匹配: {sf_fallback_count} 个")

    # 准备批量更新
    still_unmatched = 0
    for db_id, profile_rid in db_to_profile.items():
        clusters = classification.get(profile_rid, [])
        persona_ids = [CLUSTER_TO_DB_ID[c] for c in clusters]
        cur.execute(
            "UPDATE respondents SET persona_ids = %s WHERE id = %s",
            (persona_ids, db_id),
        )
        if persona_ids:
            still_unmatched += 1

    conn.commit()
    print(f"   已更新 {cur.rowcount} 条记录（最后一条）")

    # 统计最终结果
    cur.execute("SELECT count(*) FROM respondents WHERE persona_ids IS NULL")
    null_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM respondents WHERE persona_ids = '{}'")
    empty_count = cur.fetchone()[0]
    print(f"   最终 NULL: {null_count}, 空数组: {empty_count}")


def update_personas_table(conn, classification, respondent_projects):
    """更新 personas 表的 sample_count 和 evidence_ids。"""
    cur = conn.cursor()

    # 统计每个画像的 respondent 数
    persona_respondent_count = Counter()
    persona_respondents = defaultdict(list)  # cluster_id -> [respondent_id]

    for rid, clusters in classification.items():
        for c in clusters:
            persona_respondent_count[c] += 1
            persona_respondents[c].append(rid)

    print(f"\n   更新 personas 表:")
    for cluster_id in ["C1", "C2", "C3", "C4", "C5"]:
        db_id = CLUSTER_TO_DB_ID[cluster_id]
        count = persona_respondent_count.get(cluster_id, 0)
        rids = persona_respondents.get(cluster_id, [])

        cur.execute(
            "UPDATE personas SET sample_count = %s WHERE id = %s",
            (count, db_id),
        )
        print(f"     {cluster_id} (id={db_id}): sample_count={count}, {len(rids)} respondents")

    conn.commit()


def main():
    parser = argparse.ArgumentParser(description="将 respondents 分类到 5 个群体画像")
    parser.add_argument("--dry-run", action="store_true", help="只分析不更新数据库")
    parser.add_argument("--skip-import", action="store_true", help="跳过导入新 respondents")
    args = parser.parse_args()

    # ── Step 1: 分类 ──
    print("=" * 60)
    print("📊 Step 1: 基于 M1_motivation 标注分类 respondents")
    classification, respondent_projects = classify_respondents()

    # 统计
    total = len(classification)
    single = sum(1 for r in classification.values() if len(r) == 1)
    multi = sum(1 for r in classification.values() if len(r) > 1)
    none_assigned = sum(1 for r in classification.values() if len(r) == 0)

    print(f"   总 respondent: {total}")
    print(f"   单一画像: {single}")
    print(f"   多个画像: {multi}")
    print(f"   无分类: {none_assigned}")

    persona_counts = Counter()
    for clusters in classification.values():
        for c in clusters:
            persona_counts[c] += 1

    print(f"\n   各画像 respondent 分配数:")
    for c in ["C1", "C2", "C3", "C4", "C5"]:
        print(f"     {c} (竞技成长型/社交归属型/低压解压型/战斗刺激型/沉浸探索型): {persona_counts[c]}")

    # 按项目统计
    proj_stats = defaultdict(lambda: defaultdict(int))
    for rid, clusters in classification.items():
        proj = respondent_projects.get(rid, "未知")
        for c in clusters:
            proj_stats[proj][c] += 1
        proj_stats[proj]["total"] += 1

    print(f"\n   按项目分布:")
    for proj in sorted(proj_stats.keys()):
        stats = proj_stats[proj]
        parts = [f"{proj}: total={stats['total']}"]
        parts.append(", ".join(f"{c}={stats[c]}" for c in ["C1", "C2", "C3", "C4", "C5"]))
        print(f"     {', '.join(parts)}")

    if args.dry_run:
        print(f"\n🔍 Dry-run 模式，不更新数据库")
        return

    # ── Step 2: 更新数据库 ──
    print(f"\n💾 Step 2: 更新数据库")

    # 加载 Profile 映射
    print("   加载 Profile 映射 ...")
    profile_mapping = load_profile_mapping()
    print(f"   映射条目: display_name={len(profile_mapping['by_source_display'])}, demo_name={len(profile_mapping['by_source_demo_name'])}")

    conn = get_db_connection()
    try:
        # 导入新 respondents
        if not args.skip_import:
            print(f"\n   导入新 respondents ...")
            db_respondents = import_new_respondents(
                conn, profile_mapping, respondent_projects, classification
            )
        else:
            cur = conn.cursor()
            cur.execute("SELECT source_file, speaker_id, id FROM respondents")
            db_respondents = {(row[0], row[1]): row[2] for row in cur.fetchall()}

        # 更新 persona_ids
        print(f"\n   更新 respondents.persona_ids ...")
        update_persona_ids(conn, profile_mapping, db_respondents, classification)

        # 更新 personas 表
        update_personas_table(conn, classification, respondent_projects)

        print(f"\n✅ 数据库更新完成")

    finally:
        conn.close()


if __name__ == "__main__":
    main()