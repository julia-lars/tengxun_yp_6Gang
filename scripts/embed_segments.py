#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按 docs/Embedding规范.md 对 source_segments 生成 embedding 并写回 PG。

用法:
  python3 scripts/embed_segments.py                # 处理所有 embedding_version IS NULL 的片段
  python3 scripts/embed_segments.py --limit 200    # 只处理前 200 条（测试）
  python3 scripts/embed_segments.py --dry-run      # 只统计分档，不编码不写库

分档（Embedding规范 §3.2）:
  A 完整嵌入  meta.rs == "auto_pass"   -> 标签描述 + 原声 + 语境
  B 仅原声    meta.rs == "review" 或无标签  -> 仅原声
  C 不嵌入    meta.rs == "skip" 或 len(原文)<10 -> embedding = NULL

标签阈值（§3.3）: 单个标签 c>=0.6 且 e!="E0" 才进入标签描述节。
"""
import json
import os
import sys

import psycopg2
import psycopg2.extras
from sentence_transformers import SentenceTransformer

# ── 配置 ──
DB_URL = os.getenv("DATABASE_URL", "postgres://dev:dev@localhost:5432/webtutor")
# bge-m3 通过 ModelScope 下载后的本地路径（--local_dir 指定，与文档 §2 一致）
MODEL_PATH = os.getenv("EMBED_MODEL_PATH", os.path.expanduser("~/models/bge-m3"))
EMBED_VERSION = "bge-m3@v1"
BATCH_SIZE = 32

# ── 英文 key -> 中文 映射表（与 Embedding规范 §4 对齐）──

M1_MAP = {
    "competitive_proof": "竞技证明", "ability_growth": "能力成长", "dominance": "支配优越",
    "team_cooperation": "团队协作", "social_belonging": "社交归属", "stimulation": "射击爽感",
    "relaxation_escape": "放松逃避", "strategy_mastery": "策略掌控",
    "exploration_collection": "探索收集", "narrative_immersion": "叙事沉浸",
    "sensory_aesthetics": "视听审美", "expression_creation": "表达创造",
}

M2_MAP = {
    "fair_competition": "公平竞技", "skill_determines": "技术决定", "rich_content": "丰富内容",
    "social_convenience": "社交便利", "low_barrier": "低门槛", "immersive_experience": "沉浸体验",
    "positive_community": "正向社区", "continuous_challenge": "持续挑战", "respect_time": "尊重时间",
    "monetization_fair": "付费公平", "teammate_communication": "队友沟通",
    "teammate_competence": "队友能力匹配", "teammate_stability": "队友情绪稳定",
}

M3_CAT_MAP = {
    "fairness_perception": "公平性", "difficulty_perception": "难度", "depth_perception": "深度",
    "quality_perception": "品质", "monetization_perception": "商业化", "meta_perception": "版本环境",
    "self_ability": "自我能力", "self_identity": "自我身份", "self_limitation": "自我限制",
    "teammate_perception": "对队友", "opponent_perception": "对对手", "developer_perception": "对厂商",
    "community_perception": "对社区", "causal_attribution": "因果归因",
}

M4_MAP = {
    "excitement": "兴奋", "achievement": "成就感", "flow": "心流", "joy": "快乐",
    "social_warmth": "社交温暖", "anger_frustration": "愤怒挫败", "anxiety_tension": "焦虑紧张",
    "boredom_burnout": "无聊倦怠", "disappointment": "失望失落", "numbness": "麻木无所谓",
}
M4_VAL = {"pos": "积极", "neg": "消极", "neu": "中性"}
M4_INT = {"low": "低", "medium": "中", "high": "高"}
M4_TRG = {
    "win_loss": "胜负", "growth": "成长", "team": "队友", "matchmaking": "匹配",
    "monetization": "付费", "cheat": "外挂", "performance": "表现", "content": "内容", "social": "社交",
}

M5_MAP = {
    "ranked_grind": "排位上分", "deliberate_practice": "刻意练习", "watch_guides": "看攻略学习",
    "social_play": "社交开黑", "casual_play": "休闲匹配", "switch_mode": "切换模式产品",
    "return": "回流", "avoid_strangers": "回避陌生人", "content_share": "内容分享",
    "spending": "消费氪金", "quit_break": "退坑休息", "smurf": "换号炸鱼",
    "watch_esports": "追比赛电竞", "community_engage": "社区参与",
}
M5_FREQ = {"daily": "每日", "regular": "经常", "occasional": "偶尔", "past": "过去", "planned": "计划中"}

ABILITY_LVL = {
    "novice": "新手", "beginner": "入门", "intermediate": "进阶", "advanced": "高手",
    "expert": "专家", "unknown": "未知",
}
SKILL_MAP = {
    "aim-flick": "拉枪", "aim-micro": "微调", "aim-recoil": "压枪", "aim-tracking": "跟枪",
    "aim-prefire": "预瞄", "move-basic": "基础身法", "move-peek": "闪身", "move-stop": "急停",
    "move-react": "快速反应", "info-sound": "听声辨位", "info-spot": "复杂场景识敌",
    "info-state": "状态资源收集", "tactics-predict": "敌情预测", "tactics-utility": "投掷物技能",
    "tactics-route": "路线规划", "tactics-retreat": "战撤决策", "tactics-position": "有利位置",
    "tactics-map": "地图记忆", "know-rules": "规则目标", "know-mechanic": "核心机制",
    "know-meta": "角色武器版本理解",
}
COG_MAP = {
    "reasoning": "推理", "procedural_motor": "程序化动作", "game_knowledge": "游戏知识",
    "visual_spatial": "视觉空间", "auditory_processing": "听觉处理", "motor_control": "运动控制",
    "processing_speed": "加工速度", "reaction_speed": "反应速度", "psychomotor_speed": "心理运动速度",
    "short_term_memory": "短时记忆", "long_term_memory": "长时记忆",
}

STYLE_COMBAT = {"passive": "苟活", "balanced": "灵活", "aggressive": "刚枪"}
STYLE_DECISION = {"strategic": "策略", "contextual": "情境", "instinctive": "本能"}
STYLE_VICTORY = {"team": "团队", "balanced": "平衡", "individual": "个人"}
STYLE_GROWTH = {"progression": "数值", "mixed": "混合", "skill": "操作"}
STYLE_SOCIAL = {"friends": "熟人", "flexible": "均可", "solo": "单人"}

PLATFORM_MAP = {
    "pc": "PC", "console": "主机", "mobile": "移动", "multi_platform": "多平台",
    "cloud_other": "云及其他", "unknown": "未知",
}
MODE_STRUCT = {
    "pure_pve": "纯PVE", "pve_main": "PVE为主", "balanced": "平衡", "pvp_main": "PVP为主",
    "pure_pvp": "纯PVP", "contextual": "视情境",
}
MODE_SUB_N = {
    "team_deathmatch": "团队死斗", "bomb_defusal": "爆破拆弹", "battle_royale": "大逃杀",
    "extraction": "撤离", "large_scale": "大战场", "coop_pve": "合作PVE", "story_pve": "剧情PVE",
    "boss_loot": "BOSS掉落", "party_mode": "派对模式", "open_world": "开放世界",
}
MODE_SUB_A = {
    "liked": "喜欢", "accepted": "接受", "neutral": "中立", "disliked": "不喜欢",
    "rejected": "拒绝", "not_experienced": "未体验",
}
SS_STAGE = {
    "novice_understanding": "新手理解期", "rapid_improvement": "快速成长期",
    "stable_mastery": "稳定精通期", "plateau": "平台期", "churn": "流失期", "unknown": "未知",
}
SS_FLOW = {
    "clear_goals": "清晰目标", "immediate_feedback": "即时反馈", "skill_challenge_balance": "技能挑战平衡",
    "sense_of_control": "掌控感", "focus": "专注", "action_awareness_merge": "行动意识融合",
    "selflessness": "忘我", "time_distortion": "时间失真", "autotelic": "自驱动",
}
ASSET_LABELS = [("time", "时间"), ("ability_asset", "能力"), ("energy", "精力"),
                ("emotion", "情绪"), ("money", "金钱")]

# product_tags 仅纳入枚举类短标签；migration_trigger/churn_reason 等「原文」字段已在原声节覆盖
PRODUCT_KEYS = ["city_tier", "life_stage", "device", "setting", "art_style", "perspective",
                "ttk", "match_length", "social_structure", "spending_level", "payment_method",
                "spending_motive", "fairness_boundary", "info_channel", "content_type", "trust_source"]
PRODUCT_KEY_ZH = {
    "city_tier": "城市", "life_stage": "人生阶段", "device": "设备", "setting": "题材",
    "art_style": "画风", "perspective": "视角", "ttk": "TTK", "match_length": "对局时长",
    "social_structure": "社交结构", "spending_level": "付费水平", "payment_method": "付费方式",
    "spending_motive": "付费动机", "fairness_boundary": "付费边界", "info_channel": "信息渠道",
    "content_type": "内容类型", "trust_source": "信任来源",
}


# ── 工具 ──

def _tag_ok(t: dict) -> bool:
    """单个标签是否进入标签描述节（§3.3）：c>=0.6 且 e!="E0"。"""
    c = t.get("c", 0.8)
    e = t.get("e")
    return c >= 0.6 and e != "E0"


def _is_unknown(v) -> bool:
    """unknown/未知/空值不进入嵌入文本（§3.3）。"""
    return v is None or v == "" or v in ("unknown", "未知")


def _map(name, m):
    return m.get(name, name)


def _chain_name(s):
    if not s:
        return ""
    if isinstance(s, str) and ":" in s:
        layer, key = s.split(":", 1)
        m = {"M1": M1_MAP, "M2": M2_MAP, "M4": M4_MAP, "M5": M5_MAP}.get(layer)
        return m.get(key, key) if m else key
    return str(s)


def classify_tier(seg: dict, label: dict) -> str:
    """A/B/C 分档（§3.2）。"""
    rs = (label or {}).get("meta", {}).get("rs")
    text = (seg.get("cleaned_text") or seg.get("original_text") or "").strip()
    if rs == "skip" or len(text) < 10:
        return "C"
    if rs == "auto_pass":
        return "A"
    return "B"


def build_embed_text(seg: dict, label: dict, tier: str) -> str:
    text = (seg.get("cleaned_text") or seg.get("original_text") or "").strip()
    if tier == "C":
        return ""
    if tier == "B":
        return f"原声：{text}" if text else ""

    ib = (label or {}).get("iceberg") or {}
    fw = (label or {}).get("framework") or {}
    pt = (label or {}).get("product_tags") or {}
    sections = []

    # 诉求 M1（primary 优先）
    m1 = ib.get("M1") or []
    valid = [t for t in m1 if _tag_ok(t)]
    if valid:
        valid = sorted(valid, key=lambda t: 0 if t.get("primary") else 1)
        sections.append("诉求：" + "、".join(_map(t.get("v", ""), M1_MAP) for t in valid))

    # 期待 M2
    m2 = ib.get("M2") or []
    valid = [_map(t.get("v", ""), M2_MAP) for t in m2 if _tag_ok(t)]
    if valid:
        sections.append("期待：" + "、".join(valid))

    # 认知 M3
    m3 = ib.get("M3") or []
    parts = [f"{_map(t.get('cat', ''), M3_CAT_MAP)}（{t.get('v', '')}）" for t in m3 if _tag_ok(t)]
    if parts:
        sections.append("认知：" + "；".join(parts))

    # 感受 M4
    m4 = ib.get("M4") or []
    parts = []
    for t in m4:
        if not _tag_ok(t):
            continue
        subs = []
        if t.get("val"):
            subs.append(_map(t["val"], M4_VAL))
        if t.get("int"):
            subs.append(_map(t["int"], M4_INT))
        if t.get("trg"):
            subs.append(_map(t["trg"], M4_TRG))
        parts.append(f"{_map(t.get('v', ''), M4_MAP)}（{'/'.join(subs)}）")
    if parts:
        sections.append("感受：" + "；".join(parts))

    # 行为 M5
    m5 = ib.get("M5") or []
    parts = []
    for t in m5:
        if not _tag_ok(t):
            continue
        name = _map(t.get("v", ""), M5_MAP)
        parts.append(f"{name}（{_map(t['freq'], M5_FREQ)}）" if t.get("freq") else name)
    if parts:
        sections.append("行为：" + "；".join(parts))

    # 因果链
    chain = ib.get("causal_chain") or []
    parts = [f"{_chain_name(c[0])}→{_chain_name(c[1])}"
             for c in chain if isinstance(c, (list, tuple)) and len(c) >= 2]
    if parts:
        sections.append("因果：" + "；".join(parts))

    # 能力
    ab = fw.get("ability") or {}
    if ab:
        bits = []
        if ab.get("lvl") and not _is_unknown(ab["lvl"]):
            bits.append(f"等级{_map(ab['lvl'], ABILITY_LVL)}")
        if ab.get("str"):
            bits.append("强项" + "、".join(_map(x, SKILL_MAP) for x in ab["str"]))
        if ab.get("wk"):
            bits.append("短板" + "、".join(_map(x, SKILL_MAP) for x in ab["wk"]))
        if ab.get("cog_str"):
            bits.append("认知强" + "、".join(_map(x, COG_MAP) for x in ab["cog_str"]))
        if ab.get("cog_wk"):
            bits.append("认知弱" + "、".join(_map(x, COG_MAP) for x in ab["cog_wk"]))
        if bits:
            sections.append("能力：" + "；".join(bits))

    # 风格
    st = fw.get("style") or {}
    bits = []
    for key, submap, label in (
        ("combat", STYLE_COMBAT, "战斗"), ("decision", STYLE_DECISION, "决策"),
        ("victory", STYLE_VICTORY, "求胜"), ("growth", STYLE_GROWTH, "成长"),
        ("social", STYLE_SOCIAL, "社交"),
    ):
        if st.get(key) and not _is_unknown(st[key]):
            bits.append(f"{label}{_map(st[key], submap)}")
    if bits:
        sections.append("风格：" + "，".join(bits))

    # 平台
    pl = fw.get("platform") or {}
    if pl and pl.get("p") and not _is_unknown(pl["p"]):
        name = _map(pl["p"], PLATFORM_MAP)
        if pl.get("s"):
            name += f"，{_map(pl['s'], PLATFORM_MAP)}"
        sections.append("平台：" + name)

    # 模式
    md = fw.get("mode") or {}
    if md:
        parts = []
        if md.get("struct") and not _is_unknown(md["struct"]):
            parts.append(_map(md["struct"], MODE_STRUCT))
        subs = md.get("sub") or []
        subparts = []
        for s in subs:
            if isinstance(s, dict) and s.get("n") and not _is_unknown(s["n"]):
                n = _map(s["n"], MODE_SUB_N)
                a = _map(s["a"], MODE_SUB_A) if s.get("a") else None
                subparts.append(f"{n}（{a}）" if a else n)
        if subparts:
            parts.append("、".join(subparts))
        if parts:
            sections.append("模式：" + "；".join(parts))

    # 资产
    assets = fw.get("assets") or {}
    bits = [f"{label}{assets[key]}" for key, label in ASSET_LABELS
            if assets.get(key) and not _is_unknown(assets[key])]
    if bits:
        sections.append("资产：" + " ".join(bits))

    # 甜区
    ss = fw.get("sweet_spot") or {}
    if ss:
        bits = []
        if ss.get("stage") and not _is_unknown(ss["stage"]):
            bits.append(_map(ss["stage"], SS_STAGE))
        flow = ss.get("flow") or []
        if flow:
            bits.append("心流" + "、".join(_map(x, SS_FLOW) for x in flow))
        if ss.get("peak") and not _is_unknown(ss["peak"]):
            bits.append(f"峰值{ss['peak']}")
        if bits:
            sections.append("甜区：" + "；".join(bits))

    # 产品标签（仅枚举类短标签，值域本身已是中文 §4.11；原文类字段已在原声节覆盖）
    if pt:
        vals = []
        for k in PRODUCT_KEYS:
            v = pt.get(k)
            if not _is_unknown(v):
                vals.append(f"{PRODUCT_KEY_ZH.get(k, k)}:{v}")
        if vals:
            sections.append("产品标签：" + "，".join(vals))

    # 原声
    if text:
        sections.append("原声：" + text)

    # 语境
    pq = (seg.get("preceding_question") or "").strip()
    role = seg.get("speaker_role") or "interviewee"
    if pq and role == "interviewee":
        sections.append("语境：上文提问：" + pq)

    return "\n".join(sections)


def main():
    dry = "--dry-run" in sys.argv
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    print(f"📥 加载模型: {MODEL_PATH}")
    model = SentenceTransformer(MODEL_PATH)
    dim = model.get_sentence_embedding_dimension()
    print(f"   向量维度: {dim}")

    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    # 未处理 = embedding_version IS NULL（首次全部，重跑只补漏）
    cur.execute(
        """SELECT id, source_file, speaker_id, speaker_role, preceding_question,
                  original_text, cleaned_text, annotation
           FROM source_segments
           WHERE embedding_version IS NULL
           ORDER BY id"""
    )
    rows = cur.fetchall()
    if limit:
        rows = rows[:limit]
    print(f"📊 待处理 {len(rows)} 条\n")

    if dry:
        tiers = {"A": 0, "B": 0, "C": 0}
        for r in rows:
            seg = {
                "source_file": r[1], "speaker_id": r[2], "speaker_role": r[3],
                "preceding_question": r[4], "original_text": r[5], "cleaned_text": r[6],
            }
            label = r[7] if isinstance(r[7], dict) else (json.loads(r[7]) if r[7] else None)
            tiers[classify_tier(seg, label)] += 1
        print(f"   分档: A={tiers['A']} B={tiers['B']} C={tiers['C']}")
        conn.close()
        return

    done_a = done_b = done_c = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i: i + BATCH_SIZE]
        texts = []
        metas = []
        for r in batch:
            seg = {
                "source_file": r[1], "speaker_id": r[2], "speaker_role": r[3],
                "preceding_question": r[4], "original_text": r[5], "cleaned_text": r[6],
            }
            label = r[7] if isinstance(r[7], dict) else (json.loads(r[7]) if r[7] else None)
            tier = classify_tier(seg, label)
            text = build_embed_text(seg, label, tier)
            texts.append(text)
            metas.append((r[0], tier, text))

        # 仅对非空文本编码
        idx = [k for k, (_, _, t) in enumerate(metas) if t]
        vecs = [None] * len(metas)
        if idx:
            enc = model.encode([texts[k] for k in idx], normalize_embeddings=True, batch_size=BATCH_SIZE)
            for k, v in zip(idx, enc):
                vecs[k] = v.tolist()

        for (seg_id, tier, _), vec in zip(metas, vecs):
            if tier == "C":
                cur.execute(
                    "UPDATE source_segments SET embedding_version=%s, embedded_at=now() WHERE id=%s",
                    (EMBED_VERSION, seg_id),
                )
                done_c += 1
            else:
                cur.execute(
                    "UPDATE source_segments SET embedding=%s::vector, embedding_version=%s, embedded_at=now() WHERE id=%s",
                    (json.dumps(vec), EMBED_VERSION, seg_id),
                )
                if tier == "A":
                    done_a += 1
                else:
                    done_b += 1

        conn.commit()
        done = min(i + BATCH_SIZE, len(rows))
        print(f"\r⏳ [{done}/{len(rows)}] A={done_a} B={done_b} C={done_c}", end="", flush=True)

    cur.close()
    conn.close()
    print("\n")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✅ Embedding 完成")
    print(f"   A 完整嵌入: {done_a} 条")
    print(f"   B 仅原声:   {done_b} 条")
    print(f"   C 不嵌入:   {done_c} 条（embedding=NULL，已标记 embedding_version）")
    print(f"   模型/版本:   {EMBED_VERSION}")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")


if __name__ == "__main__":
    main()
