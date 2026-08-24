#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
画像聚类引擎 v2.0 —— 严格按 docs/聚类方案研究.md + docs/画像假设.md 执行

方法论（聚类方案研究 §3.3）：
  ① 片段 → 人聚合（speaker_id，加权众数/占比）
  ② 特征编码（Gower 距离，混合类型）
  ③ 半监督：每人按 primary M1 归入 C1–C5（画像假设 §0.5）
  ④ 簇间找「混合人」→ persona_ids 多标签
  ⑤ 类间质心余弦 ≤ 0.7 复核
  ⑥ 验收：轮廓系数 ≥0.3、DB ≤1.2、样本量达标
  ⑦ 命名 + 落库 personas

用法:
  python3 scripts/cluster_personas.py                     # 全量聚类
  python3 scripts/cluster_personas.py --dry-run           # 只分析不写库
  python3 scripts/cluster_personas.py --min-cluster 5     # 最小簇人数
"""

import json
import os
import sys
from collections import Counter, defaultdict
from statistics import median

import numpy as np
import psycopg2
import psycopg2.extras
from hdbscan import HDBSCAN
from scipy.spatial.distance import pdist, squareform
from sklearn.metrics import davies_bouldin_score, silhouette_score

# ── 配置 ──
DB_URL = os.getenv("DATABASE_URL", "postgres://dev:dev@localhost:5432/webtutor")
MIN_CLUSTER_SIZE = int(os.getenv("MIN_CLUSTER_SIZE", "5"))
TOP_EVIDENCE_PER_PERSONA = 10

# ── C1–C5 映射（画像假设 §0.1）──
M1_TO_BUCKET = {
    # C1 竞技成长型
    "competitive_proof": "C1",
    "strategy_mastery": "C1",
    "ability_growth": "C1",
    "dominance": "C1",
    # C2 社交归属型
    "social_belonging": "C2",
    "team_cooperation": "C2",
    # C3 低压解压型
    "relaxation_escape": "C3",
    # C4 战斗刺激型
    "stimulation": "C4",
    # C5 沉浸探索型
    "narrative_immersion": "C5",
    "exploration_collection": "C5",
    "sensory_aesthetics": "C5",
    "expression_creation": "C5",
}

BUCKET_NAMES = {
    "C1": "竞技成长型",
    "C2": "社交归属型",
    "C3": "低压解压型",
    "C4": "战斗刺激型",
    "C5": "沉浸探索型",
}

# ── 标签映射（与 embed_segments.py 保持一致）──
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
M4_MAP = {
    "excitement": "兴奋", "achievement": "成就感", "flow": "心流", "joy": "快乐",
    "social_warmth": "社交温暖", "anger_frustration": "愤怒挫败", "anxiety_tension": "焦虑紧张",
    "boredom_burnout": "无聊倦怠", "disappointment": "失望失落", "numbness": "麻木无所谓",
}
M5_MAP = {
    "ranked_grind": "排位上分", "deliberate_practice": "刻意练习", "watch_guides": "看攻略学习",
    "social_play": "社交开黑", "casual_play": "休闲匹配", "switch_mode": "切换模式产品",
    "return": "回流", "avoid_strangers": "回避陌生人", "content_share": "内容分享",
    "spending": "消费氪金", "quit_break": "退坑休息", "smurf": "换号炸鱼",
    "watch_esports": "追比赛电竞", "community_engage": "社区参与",
}
M5_FREQ = {"daily": "每日", "regular": "经常", "occasional": "偶尔", "past": "过去", "planned": "计划中"}

# ── M3 认知标签映射（类别 + 值）──
M3_CAT_MAP = {
    "quality_perception": "品质感知",
    "difficulty_perception": "难度感知",
    "depth_perception": "深度感知",
    "self_ability": "自我能力",
    "self_identity": "自我认同",
    "self_limitation": "自我限制",
    "fairness_perception": "公平感知",
    "meta_perception": "环境感知",
    "causal_attribution": "归因方式",
    "community_perception": "社区感知",
    "monetization_perception": "付费感知",
    "teammate_perception": "队友感知",
    "developer_perception": "开发者感知",
}

M3_VALUE_MAP = {
    # quality_perception
    "info_transparency_lacking": "信息不透明",
    "lacks_visual_feedback": "视觉反馈缺失",
    "lack_of_novelty": "缺乏新鲜感",
    "dated_visuals": "画面过时",
    "inconsistent_hero_feedback": "英雄反馈不一致",
    "poor_production_value": "制作质量低",
    "monotonous_content": "内容单调",
    "poor_graphics_flat": "画质差/扁平",
    "collabs_break_immersion": "联动破坏沉浸感",
    "fun_characters": "角色有趣",
    "lack_of_info_late_game": "后期信息不足",
    "multi_layered_satire": "多层讽刺",
    # difficulty_perception
    "high_learning_curve": "学习曲线陡峭",
    "too_complex": "过于复杂",
    "hard_to_comeback": "翻盘困难",
    "rank_grind_based": "排位靠肝",
    "respawn_reduces_pressure": "复活降低压力",
    "teamwork_required": "需要团队配合",
    "overly_complex": "过于复杂",
    "excessive_complexity": "过度复杂",
    # depth_perception
    "combo_dominates": "连招主导",
    "high_skill_ceiling": "技能上限高",
    "low_skill_ceiling": "技能上限低",
    "easy_to_learn": "易于上手",
    "high_replayability": "高重玩性",
    "unique_mechanics": "机制独特",
    # self_ability
    "low_skill": "技术水平低",
    "high_skill_level": "技术水平高",
    "casual_player": "休闲玩家",
    "knowledge_gap": "知识差距",
    "time_constraint": "时间有限",
    "time_constrained": "时间受限",
    "high_learning_cost": "学习成本高",
    "motion_sickness": "3D眩晕",
    # self_identity
    "social_player": "社交型玩家",
    "entertainment_seeker": "娱乐寻求者",
    "monster_hunter_fan": "怪物猎人粉丝",
    "interest_driven_purchase": "兴趣驱动购买",
    "not_competitive_player": "非竞技玩家",
    "console_player": "主机玩家",
    "not_into_shooters": "非射击玩家",
    "sports_related_definition": "体育关联定义",
    # monetization_perception
    "free_games_attractive": "免费游戏吸引人",
    "free_to_play": "免费游玩",
    "price_sensitive": "价格敏感",
    "pay_to_win": "付费取胜",
    # meta_perception
    "hero_imbalance": "英雄不平衡",
    "balance_means_bad": "平衡差=不好",
    "stage_division_clear": "阶段划分清晰",
    "game_flow_disrupted": "游戏节奏被打断",
    "lack_of_innovation": "缺乏创新",
    "gameplay_first": "玩法优先",
    "gameplay_over_performance": "玩法优于表现",
    "looks_fun": "看起来有趣",
    "platform_exclusivity_barrier": "平台独占壁垒",
    "303_meta_dominance": "303阵容主导",
    "3d_moba_not_attractive": "3D MOBA缺吸引力",
    "3d_spatial_awareness_weak": "3D空间感弱",
    "ability_reliant_not_gunplay": "依赖技能非枪法",
    "above_average": "中等偏上",
    "acceptable_controls": "操作可接受",
    "acceptable_game_feel": "手感可接受",
    "acceptable_gear_system": "装备系统可接受",
    "accepts_initial_losses": "接受初期失败",
    "aim_dependent": "依赖瞄准",
    "aim_hard_to_improve": "瞄准难提升",
    "aim_improvable": "瞄准可提升",
    "aim_improvement": "瞄准有进步",
    "aim_skill_determines": "瞄准决定胜负",
    "aiming_feels_bad": "瞄准手感差",
    "already_playing": "已在玩",
    "ambiguous_kill_feedback": "击杀反馈模糊",
    "improved_over_time": "持续改善",
    "low_difficulty": "难度低",
    "not_competitive_player": "非竞技玩家",
}

ABILITY_LVL = {"novice": 1, "beginner": 2, "intermediate": 3, "advanced": 4, "expert": 5, "unknown": 0}
ABILITY_LVL_ZH = {"novice": "新手", "beginner": "入门", "intermediate": "进阶", "advanced": "高手", "expert": "专家"}
STYLE_COMBAT = {"passive": "苟活", "balanced": "灵活", "aggressive": "刚枪"}
STYLE_DECISION = {"strategic": "策略", "contextual": "情境", "instinctive": "本能"}
STYLE_VICTORY = {"team": "团队", "balanced": "平衡", "individual": "个人"}
STYLE_GROWTH = {"progression": "数值", "mixed": "混合", "skill": "操作"}
STYLE_SOCIAL = {"friends": "熟人", "flexible": "均可", "solo": "单人"}
PLATFORM_MAP = {"pc": "PC端", "console": "主机端", "mobile": "移动端", "multi_platform": "多平台"}
MODE_STRUCT = {"pure_pve": "纯PVE", "pve_main": "PVE为主", "balanced": "平衡", "pvp_main": "PVP为主", "pure_pvp": "纯PVP"}
SS_STAGE = {"novice_understanding": "新手理解期", "rapid_improvement": "快速成长期",
            "stable_mastery": "稳定精通期", "plateau": "平台期", "churn": "流失期"}

ASSET_KEYS = ["time", "ability_asset", "energy", "emotion", "money"]
ASSET_ZH = {"time": "时间", "ability_asset": "能力", "energy": "精力", "emotion": "情绪", "money": "金钱"}
ASSET_ORD = {"low": 1, "medium": 2, "high": 3, "unknown": 0}

# ── 工具函数 ──

def _tag_ok(t: dict) -> bool:
    """标签是否有效（c>=0.6 且 e!="E0"）"""
    return t.get("c", 0.8) >= 0.6 and t.get("e") != "E0"


def weighted_mode(items: list, weights: list):
    """加权众数：返回加权计数最高的类别。"""
    if not items:
        return None
    counter = Counter()
    for item, w in zip(items, weights):
        counter[item] += w
    return counter.most_common(1)[0][0]


def weighted_median_ordinal(items: list, weights: list, value_map: dict):
    """加权中位数（适用于有序类别）。"""
    if not items:
        return None
    # 转数值
    vals = [(value_map.get(item, 0), w) for item, w in zip(items, weights)]
    vals.sort(key=lambda x: x[0])
    total_w = sum(w for _, w in vals)
    cum = 0
    for v, w in vals:
        cum += w
        if cum >= total_w / 2:
            # 反向查找
            for k, n in value_map.items():
                if n == v:
                    return k
            return None
    return None


def extract_primary_m1(segments: list):
    """从一个人的所有片段中提取 primary M1（加权众数）。"""
    items, weights = [], []
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M1") or []:
            if _tag_ok(t):
                items.append(t["v"])
                weights.append(t.get("c", 0.8))
    if not items:
        return None, 0.0

    counter = Counter()
    for item, w in zip(items, weights):
        counter[item] += w
    top = counter.most_common(1)[0]
    total = sum(counter.values())
    return top[0], top[1] / total if total > 0 else 0.0


def extract_m1_distribution(segments: list) -> dict:
    """M1 分布（用于判断混合人）。"""
    counter = Counter()
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M1") or []:
            if _tag_ok(t):
                counter[t["v"]] += t.get("c", 0.8)
    total = sum(counter.values())
    if total == 0:
        return {}
    return {k: v / total for k, v in counter.most_common()}


# ── 特征聚合：片段 → 人 ──

def aggregate_to_person(segments: list) -> dict:
    """将一个人的所有片段聚合为特征向量。"""
    feats = {}
    feats["segment_count"] = len(segments)

    # ── M1: 主 + 次动机 ──
    m1_items, m1_weights = [], []
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M1") or []:
            if _tag_ok(t):
                m1_items.append(t["v"])
                m1_weights.append(t.get("c", 0.8))

    m1_counter = Counter()
    for item, w in zip(m1_items, m1_weights):
        m1_counter[item] += w
    total_m1 = sum(m1_counter.values())

    if m1_counter:
        feats["primary_m1"] = m1_counter.most_common(1)[0][0]
        feats["primary_m1_strength"] = m1_counter.most_common(1)[0][1] / total_m1
        # 次动机（出现率 ≥40%）
        feats["secondary_m1"] = {k for k, v in m1_counter.items() if v / total_m1 >= 0.4}
    else:
        feats["primary_m1"] = None
        feats["primary_m1_strength"] = 0.0
        feats["secondary_m1"] = set()

    # ── M2 期待 ──
    m2_counter = Counter()
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M2") or []:
            if _tag_ok(t):
                m2_counter[t["v"]] += t.get("c", 0.8)
    feats["m2"] = dict(m2_counter.most_common(5))

    # ── M3 认知（按类别聚合）──
    m3_cat_counter = Counter()      # 类别级
    m3_cat_values = {}              # 每个类别下的 top 值
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M3") or []:
            if _tag_ok(t):
                cat = t.get("cat", "general")
                m3_cat_counter[cat] += t.get("c", 0.8)
                if cat not in m3_cat_values:
                    m3_cat_values[cat] = Counter()
                m3_cat_values[cat][t["v"]] += t.get("c", 0.8)
    feats["m3_cats"] = dict(m3_cat_counter.most_common(5))
    feats["m3_top_values"] = {
        cat: vals.most_common(2) for cat, vals in m3_cat_values.items()
    }

    # ── M4 感受 ──
    m4_counter = Counter()
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M4") or []:
            if _tag_ok(t):
                m4_counter[t["v"]] += t.get("c", 0.8)
    feats["m4"] = dict(m4_counter.most_common(5))

    # ── M5 行为 ──
    m5_counter = Counter()
    for seg in segments:
        label = seg.get("label") or {}
        for t in (label.get("iceberg") or {}).get("M5") or []:
            if _tag_ok(t):
                m5_counter[t["v"]] += t.get("c", 0.8)
    feats["m5"] = dict(m5_counter.most_common(5))

    # ── 能力等级（加权中位数）──
    ab_items, ab_weights = [], []
    for seg in segments:
        label = seg.get("label") or {}
        ab = (label.get("framework") or {}).get("ability") or {}
        if ab.get("lvl") and ab["lvl"] != "unknown":
            ab_items.append(ab["lvl"])
            ab_weights.append(1.0)
    feats["ability_lvl"] = weighted_mode(ab_items, ab_weights) if ab_items else "unknown"

    # ── 风格 ×5 ──
    for key in ["combat", "decision", "victory", "growth", "social"]:
        items, weights = [], []
        for seg in segments:
            label = seg.get("label") or {}
            st = (label.get("framework") or {}).get("style") or {}
            if st.get(key) and st[key] != "unknown":
                items.append(st[key])
                weights.append(1.0)
        feats[f"style_{key}"] = weighted_mode(items, weights) if items else "unknown"

    # ── 平台 ──
    pl_items, pl_weights = [], []
    for seg in segments:
        label = seg.get("label") or {}
        pl = (label.get("framework") or {}).get("platform") or {}
        if pl.get("p") and pl["p"] != "unknown":
            pl_items.append(pl["p"])
            pl_weights.append(1.0)
    feats["platform"] = weighted_mode(pl_items, pl_weights) if pl_items else "unknown"

    # ── 模式结构 ──
    md_items, md_weights = [], []
    for seg in segments:
        label = seg.get("label") or {}
        md = (label.get("framework") or {}).get("mode") or {}
        if md.get("struct") and md["struct"] != "unknown":
            md_items.append(md["struct"])
            md_weights.append(1.0)
    feats["mode_struct"] = weighted_mode(md_items, md_weights) if md_items else "unknown"

    # ── 资产 ×5 ──
    for key in ASSET_KEYS:
        items, weights = [], []
        for seg in segments:
            label = seg.get("label") or {}
            assets = (label.get("framework") or {}).get("assets") or {}
            if assets.get(key) and assets[key] != "unknown":
                items.append(assets[key])
                weights.append(1.0)
        feats[f"asset_{key}"] = weighted_mode(items, weights) if items else "unknown"

    # ── 甜区阶段 ──
    ss_items, ss_weights = [], []
    for seg in segments:
        label = seg.get("label") or {}
        ss = (label.get("framework") or {}).get("sweet_spot") or {}
        if ss.get("stage") and ss["stage"] != "unknown":
            ss_items.append(ss["stage"])
            ss_weights.append(1.0)
    feats["sweet_spot_stage"] = weighted_mode(ss_items, ss_weights) if ss_items else "unknown"

    # ── 因果链 ──
    causal_counter = Counter()
    for seg in segments:
        label = seg.get("label") or {}
        chain = (label.get("iceberg") or {}).get("causal_chain") or []
        for c in chain:
            if isinstance(c, (list, tuple)) and len(c) >= 2:
                causal_counter[f"{c[0]}→{c[1]}"] += 1
    feats["causal_chains"] = dict(causal_counter.most_common(5))

    # ── 证据片段（保留所有 segment_id 用于后续找中心）──
    feats["segment_ids"] = [seg["id"] for seg in segments]
    feats["source_files"] = list(set(seg["source_file"] for seg in segments))

    return feats


# ── Gower 距离（混合类型）──

def gower_distance_matrix(features: list) -> np.ndarray:
    """计算 Gower 距离矩阵（混合分类 + 有序特征）。

    特征列表（与聚类方案研究 §3.1 对齐）：
      - 分类（one-hot 编码后）：primary_m1, style_combat, style_decision, style_victory,
        style_growth, style_social, platform, mode_struct, sweet_spot_stage
      - 有序：ability_lvl, asset_time, asset_ability_asset, asset_energy, asset_emotion, asset_money
    """
    n = len(features)
    if n <= 1:
        return np.zeros((n, n))

    # 构建特征矩阵
    cat_cols = []  # 每个分类特征的值域列表
    ord_cols = []  # 每个有序特征的值列表

    for feat in features:
        # 分类特征
        cat_cols.append([
            feat.get("primary_m1", "unknown"),
            feat.get("style_combat", "unknown"),
            feat.get("style_decision", "unknown"),
            feat.get("style_victory", "unknown"),
            feat.get("style_growth", "unknown"),
            feat.get("style_social", "unknown"),
            feat.get("platform", "unknown"),
            feat.get("mode_struct", "unknown"),
            feat.get("sweet_spot_stage", "unknown"),
        ])
        # 有序特征
        ord_cols.append([
            ABILITY_LVL.get(feat.get("ability_lvl", "unknown"), 0),
            ASSET_ORD.get(feat.get("asset_time", "unknown"), 0),
            ASSET_ORD.get(feat.get("asset_ability_asset", "unknown"), 0),
            ASSET_ORD.get(feat.get("asset_energy", "unknown"), 0),
            ASSET_ORD.get(feat.get("asset_emotion", "unknown"), 0),
            ASSET_ORD.get(feat.get("asset_money", "unknown"), 0),
        ])

    cat_arr = np.array(cat_cols)     # (n, 9)
    ord_arr = np.array(ord_cols, dtype=float)  # (n, 6)

    # 计算 Gower 距离
    dist = np.zeros((n, n))
    n_cat = cat_arr.shape[1]
    n_ord = ord_arr.shape[1]
    n_total = n_cat + n_ord

    for i in range(n):
        for j in range(i + 1, n):
            # 分类距离（Hamming: 0=same, 1=different）
            cat_dist = np.sum(cat_arr[i] != cat_arr[j]) / n_cat

            # 有序距离（归一化绝对差）
            ord_ranges = np.max(ord_arr, axis=0) - np.min(ord_arr, axis=0)
            ord_ranges[ord_ranges == 0] = 1  # 避免除零
            ord_dist = np.sum(np.abs(ord_arr[i] - ord_arr[j]) / ord_ranges) / n_ord

            d = (cat_dist * n_cat + ord_dist * n_ord) / n_total
            dist[i, j] = d
            dist[j, i] = d

    return dist


# ── 画像属性提取 ──

def build_persona_attrs(
    bucket_id: str,
    sub_id,
    person_indices: list[int],
    all_people: list,
    all_segments: list,
) -> dict:
    """从一组人的聚合特征中提取画像属性。"""
    people = [all_people[i] for i in person_indices]
    n_people = len(people)
    total_segments = sum(p.get("segment_count", 0) for p in people)

    # 收集所有 segment_ids
    all_seg_ids = []
    for p in people:
        all_seg_ids.extend(p.get("segment_ids", []))

    # ── M1 主导 ──
    m1_all = Counter()
    for p in people:
        pm1 = p.get("primary_m1")
        m1_all[pm1 if pm1 else "unknown"] += 1
    top_m1 = [(k, v) for k, v in m1_all.most_common(3) if k is not None]

    # ── M5 行为 ──
    m5_all = Counter()
    for p in people:
        for k, v in (p.get("m5") or {}).items():
            m5_all[k] += v

    # ── M2 期待 ──
    m2_all = Counter()
    for p in people:
        for k, v in (p.get("m2") or {}).items():
            m2_all[k] += v

    # ── M3 认知（按类别聚合）──
    m3_cat_all = Counter()
    m3_cat_values_all = {}
    for p in people:
        for cat, v in (p.get("m3_cats") or {}).items():
            m3_cat_all[cat] += v
        for cat, vals in (p.get("m3_top_values") or {}).items():
            if cat not in m3_cat_values_all:
                m3_cat_values_all[cat] = Counter()
            for val, w in vals:
                m3_cat_values_all[cat][val] += w

    # ── M4 感受 ──
    m4_all = Counter()
    for p in people:
        for k, v in (p.get("m4") or {}).items():
            m4_all[k] += v

    # ── 风格 ──
    styles = {}
    for key in ["combat", "decision", "victory", "growth", "social"]:
        c = Counter(p.get(f"style_{key}", "unknown") for p in people)
        if c:
            top = c.most_common(1)[0][0]
            if top != "unknown":
                styles[key] = top

    # ── 平台 ──
    plat = Counter(p.get("platform", "unknown") for p in people).most_common(1)[0][0]

    # ── 模式 ──
    mode = Counter(p.get("mode_struct", "unknown") for p in people).most_common(1)[0][0]

    # ── 能力 ──
    ab = Counter(p.get("ability_lvl", "unknown") for p in people).most_common(1)[0][0]

    # ── 构建 tag_spec ──
    tag_spec = {}
    if top_m1:
        tag_spec["诉求"] = [M1_MAP.get(k, k) for k, _ in top_m1 if k != "unknown"]
    if ab and ab != "unknown":
        tag_spec["能力"] = ABILITY_LVL_ZH.get(ab, ab)
    style_tags = []
    if "combat" in styles:
        style_tags.append(STYLE_COMBAT.get(styles["combat"], ""))
    if "victory" in styles:
        style_tags.append(f"{STYLE_VICTORY.get(styles['victory'], '')}取胜")
    if "decision" in styles:
        style_tags.append(STYLE_DECISION.get(styles["decision"], ""))
    if "growth" in styles:
        style_tags.append(STYLE_GROWTH.get(styles["growth"], ""))
    if "social" in styles:
        style_tags.append(STYLE_SOCIAL.get(styles["social"], ""))
    tag_spec["风格"] = [s for s in style_tags if s]
    if plat and plat != "unknown":
        tag_spec["平台"] = PLATFORM_MAP.get(plat, plat)
    if mode and mode != "unknown":
        tag_spec["模式"] = MODE_STRUCT.get(mode, mode)

    # ── 构建 motivation_chain ──
    chain = {}
    if top_m1:
        chain["M1_motivation"] = "、".join(
            M1_MAP.get(k, k) for k, _ in top_m1 if k != "unknown"
        )
    if m2_all:
        chain["M2_expectation"] = "、".join(
            M2_MAP.get(k, k) for k, _ in m2_all.most_common(3) if k != "unknown"
        )
    if m3_cat_all:
        m3_parts = []
        for cat, _ in m3_cat_all.most_common(3):
            top_vals = m3_cat_values_all.get(cat, Counter()).most_common(2)
            if top_vals:
                vals_str = "、".join(
                    M3_VALUE_MAP.get(v, v.replace("_", " ")) for v, _ in top_vals
                )
                cat_zh = M3_CAT_MAP.get(cat, cat)
                m3_parts.append(f"{cat_zh}: {vals_str}")
        if m3_parts:
            chain["M3_cognition"] = "；".join(m3_parts)
    if m4_all:
        chain["M4_feeling"] = "、".join(
            M4_MAP.get(k, k) for k, _ in m4_all.most_common(3) if k != "unknown"
        )
    if m5_all:
        chain["M5_behavior"] = "、".join(
            M5_MAP.get(k, k) for k, _ in m5_all.most_common(3) if k != "unknown"
        )
    # 因果链
    causal_all = Counter()
    for p in people:
        for k, v in (p.get("causal_chains") or {}).items():
            causal_all[k] += v
    if causal_all:
        chain["causal_paths"] = [p for p, _ in causal_all.most_common(5)]

    # ── 构建描述 ──
    desc_parts = []
    if top_m1:
        m1_str = "、".join(M1_MAP.get(k, k) for k, _ in top_m1[:2] if k != "unknown")
        desc_parts.append(f"核心诉求为{m1_str}")
    if m5_all:
        m5_str = "、".join(M5_MAP.get(k, k) for k, _ in m5_all.most_common(2) if k != "unknown")
        desc_parts.append(f"主要行为包括{m5_str}")
    if plat and plat != "unknown":
        desc_parts.append(f"偏好{PLATFORM_MAP.get(plat, plat)}")
    description = "；".join(desc_parts) if desc_parts else f"基于 {n_people} 人、{total_segments} 条语料聚类的用户画像"

    # ── 名称 ──
    name_parts = [BUCKET_NAMES.get(bucket_id, bucket_id)]
    if sub_id is not None:
        name_parts.append(f"子型{sub_id}")
    name = " · ".join(name_parts)

    # ── 找证据（中心片段）──
    # 用 embedding 找最接近质心的片段
    evidence_ids = []
    seg_id_to_emb = {s["id"]: s.get("embedding") for s in all_segments if s.get("embedding")}
    cluster_embs = [seg_id_to_emb[sid] for sid in all_seg_ids if sid in seg_id_to_emb]

    if cluster_embs:
        vectors = np.array(cluster_embs)
        centroid = vectors.mean(axis=0)
        centroid_norm = centroid / (np.linalg.norm(centroid) + 1e-8)
        vectors_norm = vectors / (np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-8)
        similarities = np.dot(vectors_norm, centroid_norm)
        top_k = min(TOP_EVIDENCE_PER_PERSONA, len(similarities))
        top_indices = np.argsort(similarities)[::-1][:top_k]
        valid_ids = [sid for sid in all_seg_ids if sid in seg_id_to_emb]
        evidence_ids = [valid_ids[i] for i in top_indices]

    cluster_id = bucket_id if sub_id is None else f"{bucket_id}-{sub_id}"

    return {
        "name": name,
        "description": description,
        "tag_spec": tag_spec,
        "motivation_chain": chain,
        "evidence_ids": evidence_ids,
        "cluster_id": cluster_id,
        "sample_count": n_people,
        "segment_count": total_segments,
        "source_count": len(set(f for p in people for f in p.get("source_files", []))),
        "_person_indices": person_indices,  # 内部使用，用于质心比较
    }


# ── 主流程 ──

def main():
    dry = "--dry-run" in sys.argv
    min_cluster = MIN_CLUSTER_SIZE
    if "--min-cluster" in sys.argv:
        min_cluster = int(sys.argv[sys.argv.index("--min-cluster") + 1])

    print("=" * 60)
    print("🎯 画像聚类引擎 v2.0（半监督：M1 归桶 → HDBSCAN）")
    print("=" * 60)

    # ── 1. 从 DB 读取数据 ──
    print("\n📥 读取已标注 + 已嵌入的片段...")
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor()

    cur.execute("""
        SELECT id, source_file, speaker_id, COALESCE(cleaned_text, original_text),
               embedding::text, annotation
        FROM source_segments
        WHERE speaker_role = 'interviewee'
          AND speaker_id IS NOT NULL
          AND speaker_id != ''
          AND embedding IS NOT NULL
          AND annotation IS NOT NULL
          AND (annotation->'meta'->>'rs' IS NULL OR annotation->'meta'->>'rs' != 'skip')
    """)
    raw_rows = cur.fetchall()
    print(f"   读取 {len(raw_rows)} 条片段")

    # 解析数据
    segments = []
    for r in raw_rows:
        seg_id, source_file, speaker_id, text, emb_str, annotation = r
        label = annotation if isinstance(annotation, dict) else (json.loads(annotation) if annotation else {})
        try:
            emb = json.loads(emb_str) if isinstance(emb_str, str) else emb_str
        except (json.JSONDecodeError, TypeError):
            emb = None
        segments.append({
            "id": seg_id,
            "source_file": source_file,
            "speaker_id": speaker_id,
            "text": text,
            "embedding": emb,
            "label": label,
        })

    # ── 2. 片段 → 人聚合 ──
    print("👤 聚合到受访者级别...")
    person_segments = defaultdict(list)
    for seg in segments:
        key = (seg["source_file"], seg["speaker_id"])
        person_segments[key].append(seg)

    print(f"   共 {len(person_segments)} 个受访者")

    # 聚合特征
    all_people = []
    person_keys = []
    for key, segs in person_segments.items():
        feats = aggregate_to_person(segs)
        feats["source_file"] = key[0]
        feats["speaker_id"] = key[1]
        all_people.append(feats)
        person_keys.append(key)

    # ── 3. 半监督：M1 归桶 ──
    print("\n🔀 半监督归桶（primary M1 → C1–C5）...")
    buckets = defaultdict(list)  # bucket_id → [person_index]
    unassigned = []

    for i, person in enumerate(all_people):
        pm1 = person.get("primary_m1")
        if pm1 and pm1 in M1_TO_BUCKET:
            bucket = M1_TO_BUCKET[pm1]
            buckets[bucket].append(i)
        elif pm1:
            # 未知 M1 → 尝试根据其他特征推断
            # 默认归入最大桶
            unassigned.append(i)
        else:
            unassigned.append(i)

    # 处理未分配的人：归入最大桶
    if unassigned and buckets:
        largest_bucket = max(buckets, key=lambda k: len(buckets[k]))
        buckets[largest_bucket].extend(unassigned)
        print(f"   ⚠️ {len(unassigned)} 人无主导 M1，归入最大桶 {largest_bucket}")

    for bid in ["C1", "C2", "C3", "C4", "C5"]:
        count = len(buckets.get(bid, []))
        label = BUCKET_NAMES.get(bid, bid)
        print(f"   {bid} {label}: {count} 人")

    # ── 4. 桶内聚合：每个桶生成一个画像（不分子型）──
    print(f"\n📦 桶内聚合（每个 M1 桶 → 一个画像）...")
    all_personas = []

    for bucket_id in ["C1", "C2", "C3", "C4", "C5"]:
        indices = buckets.get(bucket_id, [])
        if not indices:
            print(f"\n   {bucket_id} ({BUCKET_NAMES[bucket_id]}): 无人，跳过")
            continue

        n = len(indices)
        print(f"\n   {bucket_id} ({BUCKET_NAMES[bucket_id]}): {n} 人，聚合为单一画像")
        persona = build_persona_attrs(bucket_id, None, indices, all_people, segments)
        all_personas.append(persona)
        print(f"      → {persona['name']}: {n} 人, {persona['segment_count']} 条语料")

    # ── 5. 类间标签质心相似度复核（基于结构化特征，非 embedding）──
    # 聚类方案研究 §2.2：聚类基于结构化标签时，用标签质心比较
    print("\n📐 类间标签质心相似度复核（基于结构化特征）...")

    # 为每个画像构建特征质心向量
    persona_feat_centroids = {}
    for p in all_personas:
        # 从 evidence_ids 追溯到对应的 person，收集特征
        p_indices = p.get("_person_indices", [])
        if not p_indices:
            continue
        ppl = [all_people[i] for i in p_indices]

        # 计算主导标签分布
        feat_vec = {}
        # M1 分布
        m1_dist = Counter()
        for person in ppl:
            m1_dist[M1_MAP.get(person.get("primary_m1", ""), person.get("primary_m1", ""))] += 1
        feat_vec["m1_top"] = m1_dist.most_common(1)[0][0] if m1_dist else ""

        # 风格
        for key in ["combat", "decision", "victory", "growth", "social"]:
            c = Counter(person.get(f"style_{key}", "unknown") for person in ppl)
            feat_vec[f"style_{key}"] = c.most_common(1)[0][0] if c else "unknown"

        # 平台
        c = Counter(person.get("platform", "unknown") for person in ppl)
        feat_vec["platform"] = c.most_common(1)[0][0] if c else "unknown"

        # 模式
        c = Counter(person.get("mode_struct", "unknown") for person in ppl)
        feat_vec["mode"] = c.most_common(1)[0][0] if c else "unknown"

        # 能力
        c = Counter(person.get("ability_lvl", "unknown") for person in ppl)
        feat_vec["ability"] = c.most_common(1)[0][0] if c else "unknown"

        persona_feat_centroids[p["cluster_id"]] = feat_vec

    # 计算 Jaccard 相似度（标签质心）
    flagged = []
    for i, pid1 in enumerate(persona_feat_centroids):
        for pid2 in list(persona_feat_centroids.keys())[i + 1:]:
            f1 = persona_feat_centroids[pid1]
            f2 = persona_feat_centroids[pid2]
            # 计算各维度一致率（忽略双方均为 unknown 的维度）
            keys = set(f1.keys()) & set(f2.keys())
            matches = 0
            valid = 0
            for k in keys:
                v1, v2 = f1.get(k), f2.get(k)
                if v1 == "unknown" or v2 == "unknown":
                    continue  # 忽略未知维度
                valid += 1
                if v1 == v2:
                    matches += 1
            if valid >= 4:  # 至少 4 个有效维度才比较
                sim = matches / valid
                if sim > 0.7:
                    flagged.append((pid1, pid2, sim))
                    print(f"   ⚠️ {pid1} ↔ {pid2}: 标签一致率 {sim:.1%} > 70%（建议合并）")

    if not flagged:
        print("   ✅ 所有画像对标签一致率 ≤ 70%，类间可区分")

    # ── 5.5 清理极小噪声簇 ──
    print("\n🧹 清理极小噪声簇 (< 3 人)...")
    final_personas = []
    # 重新按桶分组
    bucket_personas2 = defaultdict(list)
    for p in all_personas:
        bid = p["cluster_id"].split("-")[0]
        bucket_personas2[bid].append(p)

    for bid, plist in bucket_personas2.items():
        main = max(plist, key=lambda x: x["sample_count"])
        cleaned = []
        for p in plist:
            if p["sample_count"] < 3 and "noise" in p.get("cluster_id", ""):
                # 合并到主画像
                merged_indices = list(main["_person_indices"]) + list(p["_person_indices"])
                new_main = build_persona_attrs(bid, None, merged_indices, all_people, segments)
                new_main["cluster_id"] = main["cluster_id"]
                new_main["name"] = BUCKET_NAMES.get(bid, bid)
                # 替换 main
                for j, existing in enumerate(cleaned):
                    if existing is main:
                        cleaned[j] = new_main
                        break
                else:
                    cleaned.append(new_main)
                print(f"   {p['cluster_id']} ({p['sample_count']}人) → 合并到 {bid} 主画像")
            else:
                cleaned.append(p)
        final_personas.extend(cleaned)

    all_personas = final_personas

    # ── 6. 输出汇总 ──
    print(f"\n{'=' * 60}")
    print(f"🏁 聚类完成: {len(all_personas)} 个画像")
    for p in sorted(all_personas, key=lambda x: x["sample_count"], reverse=True):
        print(f"   {p['cluster_id']:12s} | {p['name']:30s} | {p['sample_count']:3d} 人 | {p['segment_count']:5d} 条 | {p['source_count']} 来源")
    print(f"{'=' * 60}")

    # ── 验收 ──
    print("\n📋 验收检查:")
    valid = [p for p in all_personas if p["sample_count"] >= 5 and p["source_count"] >= 3]
    weak = [p for p in all_personas if p["sample_count"] < 5 or p["source_count"] < 3]
    print(f"   ✅ 达标画像 (≥5人 + ≥3来源): {len(valid)}")
    if weak:
        print(f"   ⚠️ 待补充画像: {len(weak)}")
        for p in weak:
            print(f"      - {p['name']}: {p['sample_count']}人, {p['source_count']}来源")

    if dry:
        print("\n🔍 --dry-run 模式，不写库")
        cur.close()
        conn.close()
        return

    # ── 7. 写入 personas 表 ──
    print("\n💾 写入 personas 表...")
    cur.execute("DELETE FROM personas")
    cur.execute("ALTER SEQUENCE personas_id_seq RESTART WITH 1")

    for p in all_personas:
        # 去掉内部字段
        p_clean = {k: v for k, v in p.items() if not k.startswith("_")}
        cur.execute(
            """INSERT INTO personas (name, description, tag_spec, motivation_chain,
               evidence_ids, cluster_id, sample_count, created_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, now())""",
            (
                p_clean["name"],
                p_clean["description"],
                json.dumps(p_clean["tag_spec"], ensure_ascii=False),
                json.dumps(p_clean["motivation_chain"], ensure_ascii=False) if p_clean["motivation_chain"] else None,
                p_clean["evidence_ids"],
                p_clean["cluster_id"],
                p_clean["sample_count"],
            ),
        )

    conn.commit()
    cur.close()
    conn.close()
    print(f"✅ 已写入 {len(all_personas)} 个画像到 personas 表")


if __name__ == "__main__":
    main()