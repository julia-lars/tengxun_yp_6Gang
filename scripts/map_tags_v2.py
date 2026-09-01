#!/usr/bin/env python3
"""
Profile → 2.0 标签映射转换脚本

从 Profile 六大维度 + Segment Annotation framework 标签，映射到 2.0 前台 TagSpec。
输出为 JSON 格式，可直接写入数据库 personas.tag_spec 字段。

Usage:
    python3 scripts/map_tags_v2.py                          # 映射所有 profile
    python3 scripts/map_tags_v2.py --dry-run                # 显示统计
    python3 scripts/map_tags_v2.py --file "搜打撤"           # 单文件
    python3 scripts/map_tags_v2.py --output tags_output.json # 指定输出
"""

import json
import os
import sys
import re
import argparse
from collections import Counter, defaultdict
from pathlib import Path

# ---- Config ----
PROFILE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "群体画像v2.0_profile")
LABELED_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "群体画像v2.0_labeled")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "群体画像v2.0_tags")

# ============================================================
# 标签值域定义（与 packages/shared/src/tags.ts 对齐）
# ============================================================

# 游戏诉求 12 个值域
NEEDS_VALUES = [
    "ability_growth",        # 能力成长
    "competitive_proof",     # 竞技证明
    "dominance",             # 支配优越
    "team_cooperation",      # 团队协作
    "social_belonging",      # 社交归属
    "stimulation",           # 射击爽感
    "relaxation_escape",     # 放松逃避
    "strategy_mastery",      # 策略掌控
    "exploration_collection",# 探索收集
    "narrative_immersion",   # 叙事沉浸
    "sensory_aesthetics",    # 视听审美
    "expression_creation",   # 表达创造
]

# 游戏能力等级
ABILITY_LEVELS = ["novice", "beginner", "intermediate", "advanced", "expert_competitive"]

# 游戏风格 5 轴
STYLE_AXES = {
    "combat": ["passive", "balanced", "aggressive"],
    "decision": ["strategic", "contextual", "instinctive"],
    "victory": ["team", "balanced", "individual"],
    "growth": ["progression", "mixed", "skill"],
    "social": ["friends", "flexible", "solo"],
}

# 平台偏好
PLATFORM_VALUES = ["pc", "console", "mobile", "multi_platform", "cloud_other"]

# 模式偏好
MODE_STRUCTURES = ["pve_only", "pve_main", "balanced", "pvp_main", "pvp_only", "context_dependent"]

# 技巧分类映射
SKILL_CATEGORIES = {
    "枪法": ["aim", "枪法", "瞄准", "压枪", "跟枪", "预瞄", "headshot", "爆头", "拉枪", "微调", "tracking", "flick",
             "shooting", "gunplay", "marksmanship", "quick_aim", "aim-headshots", "fps_talent", "shooter_mechanics"],
    "身法": ["movement", "身法", "走位", "移动", "闪身", "急停", "快速反应", "mobility", "strafe", "dodge",
             "advanced_controls", "combo_execution", "reaction_time", "hand_speed"],
    "信息获取": ["sound", "听声", "辨位", "信息", "awareness", "地图意识", "观察", "sound_localization",
                "information_collection", "game-sense", "map-awareness"],
    "战场策略": ["strategy", "策略", "战术", "路线", "决策", "投掷物", "位置", "地图", "tactical", "route",
                 "positioning", "game_knowledge", "tactical_awareness", "strategy_knowledge", "map_knowledge",
                 "counter_measures", "economic_optimization", "economic_understanding", "economy_management",
                 "wave_management", "farming-efficiency"],
    "品类知识": ["knowledge", "知识", "理解", "机制", "版本", "meta", "game_knowledge", "game_mechanics",
                 "game-knowledge", "game_knowledge_lane_assignment", "game_knowledge_meta", "mod_development",
                 "mid_game_understanding"],
}

# framework.needs 非标准值 → 标准值映射
NEEDS_CLEANUP_MAP = {
    "achievement": "competitive_proof",
    "achievement_satisfaction": "competitive_proof",
    "achievement_collection": "exploration_collection",
    "enjoyment": "stimulation",
    "immersion": "narrative_immersion",
    # 以下不映射到诉求，归入其他维度
    "fair_competition": None,   # → M2 期待
    "low_barrier": None,        # → M2 期待
    "monetization_fair": None,  # → 扩展维度
}

# framework.ability.level 非标准值映射
ABILITY_CLEANUP_MAP = {
    "expert": "expert_competitive",
}

# framework.platform 非标准值 → 标准值映射
PLATFORM_CLEANUP_MAP = {
    "playstation": "console",
    "xbox": "console",
    "nintendo": "console",
    "switch": "console",
    "steam_deck": "console",
    "handheld": "cloud_other",
    "arcade": "cloud_other",
    "ps3": "console",
    "ps4": "console",
    "ps5": "console",
    "xbox_one": "console",
    "xbox_series": "console",
    "ds": "console",
    "3ds": "console",
    "game_boy": "console",
    "wii": "console",
    "wii_u": "console",
    "mac": "pc",
    "laptop": "pc",
    "desktop": "pc",
    "pc": "pc",
    "phone": "mobile",
    "手机": "mobile",
    "iphone": "mobile",
    "android": "mobile",
    "tablet": "mobile",
    "ipad": "mobile",
    "multi_platform": "multi_platform",
    "oculus": "cloud_other",
    "vr": "cloud_other",
}

# framework.mode.structure 非标准值映射
MODE_CLEANUP_MAP = {
    "pure_pve": "pve_only",
    "pure_pvp": "pvp_only",
    "contextual": "context_dependent",
}

# 二级模式 submodes → 标准值映射
SUBMODE_CLEANUP_MAP = {
    "team_deathmatch": "团队竞技", "tdm": "团队竞技",
    "bomb_defuse": "爆破/拆弹", "search_destroy": "爆破/拆弹", "search_and_destroy": "爆破/拆弹",
    "battle_royale": "BR/战术竞技", "br": "BR/战术竞技", "大逃杀": "BR/战术竞技", "吃鸡": "BR/战术竞技",
    "extraction": "搜打撤", "looter_shooter": "搜打撤", "塔科夫": "搜打撤", "撤离": "搜打撤", "暗区": "搜打撤",
    "large_scale": "大战场", "conquest": "大战场", "大规模": "大战场",
    "coop_pve": "合作PVE", "pve_coop": "合作PVE", "合作": "合作PVE", "副本": "合作PVE",
    "story_pve": "剧情PVE", "campaign": "剧情PVE", "剧情": "剧情PVE", "战役": "剧情PVE", "叙事": "剧情PVE",
    "boss_hunt": "Boss/刷装", "looter": "Boss/刷装", "刷Boss": "Boss/刷装", "打宝": "Boss/刷装", "刷装备": "Boss/刷装",
    "party_mode": "娱乐模式", "arcade": "娱乐模式", "大乱斗": "娱乐模式", "休闲": "娱乐模式", "小游戏": "娱乐模式",
    "open_world": "开放世界", "sandbox": "开放世界", "大世界": "开放世界", "自由探索": "开放世界",
    "ranked": "排位竞技", "competitive": "排位竞技", "排位": "排位竞技",
    "deathmatch": "死斗", "ffa": "死斗",
    "arena": "竞技场", "竞技场": "竞技场",
    "domination": "占点", "control": "占点", "hardpoint": "占点", "占点": "占点",
    "capture_flag": "夺旗", "ctf": "夺旗", "夺旗": "夺旗",
    "payload": "推车", "escort": "推车", "推车": "推车",
    "survival": "生存", "生存": "生存",
    "racing": "竞速", "竞速": "竞速",
    "fishing": "钓鱼/生活", "生活": "钓鱼/生活", "钓鱼": "钓鱼/生活",
    "creative": "建造/UGC", "建造": "建造/UGC", "ugc": "建造/UGC", "沙盒": "建造/UGC",
}

# 生活阶段标准化映射
LIFE_STAGE_CLEANUP_MAP = {
    "student": "学生", "college_student": "学生", "college": "学生", "high_school": "学生",
    "adolescent": "学生", "adolescence": "学生", "teenager": "学生", "childhood": "学生",
    "working": "稳定职场", "young_adult": "初入职场", "college_graduate": "初入职场",
    "adult": "稳定职场", "unemployed": "其他",
}


# ============================================================
# 语义匹配引擎
# ============================================================

def match_keywords(text, keyword_groups, default=None):
    """
    根据关键词组匹配文本到标签值。
    keyword_groups: {label_value: [keywords]}
    返回匹配到的 label_value 列表，按匹配度排序。
    """
    if not text:
        return []
    text_lower = text.lower()
    scores = {}
    for label, keywords in keyword_groups.items():
        score = 0
        for kw in keywords:
            if kw.lower() in text_lower:
                score += 1
        if score > 0:
            scores[label] = score
    return sorted(scores.keys(), key=lambda k: -scores[k])


# 诉求关键词（从 Profile statement 语义匹配）
NEEDS_KEYWORDS = {
    "ability_growth": ["提升技术", "变强", "练习", "成长", "进步", "学习", "钻研", "弥补短板", "提升能力",
                       "提升自身能力", "学习攻略", "像大神一样", "投入大量时间练习", "技术提升"],
    "competitive_proof": ["证明自己", "段位", "排名", "比别人强", "竞技", "胜负", "击败", "碾压", "排位",
                          "竞技证明", "虚荣心", "证明能力", "证明实力", "提高段位", "追求高段位", "上分",
                          "成就", "达到全区", "排行榜"],
    "dominance": ["支配", "碾压", "统治", "优越", "压制", "猎杀", "掠夺", "支配感", "击杀敌人"],
    "team_cooperation": ["团队配合", "协作", "合作", "配合取胜", "集体", "共同完成", "团队合作",
                         "团队协作", "配合", "团队游戏", "队友配合"],
    "social_belonging": ["朋友一起", "社交", "归属", "圈子", "开黑", "关系", "认识人", "不孤单",
                         "社交归属", "朋友", "熟人", "社交工具", "社交属性", "被孤立", "维持关系",
                         "结识", "固定队", "联机", "一起玩"],
    "stimulation": ["爽快", "刺激", "爽感", "打击感", "枪感", "击杀反馈", "爽", "释放", "爽快感",
                    "快乐", "开心", "快感", "兴奋", "激烈", "过瘾", "痛快", "high", "肾上腺素"],
    "relaxation_escape": ["放松", "解压", "逃避", "消磨时间", "休闲", "轻松", "不累", "压力",
                          "放松解压", "逃避现实", "休闲娱乐", "简单游戏", "养生", "佛系", "不追求",
                          "娱乐", "消遣", "打发时间", "休息"],
    "strategy_mastery": ["策略", "战术", "布局", "分析", "斗智", "预判", "资源", "判断", "掌控",
                         "策略博弈", "策略型", "策略深度", "脑力", "思考", "智取", "运营", "经营"],
    "exploration_collection": ["探索", "发现", "收集", "收藏", "仓库", "新鲜", "好奇", "尝试", "经营",
                               "探索收集", "新游戏", "新内容", "新鲜感", "尝试新", "发现新", "探索欲",
                               "好奇心", "收集控", "收集癖", "全收集", "图鉴", "成就系统"],
    "narrative_immersion": ["剧情", "世界观", "角色", "故事", "沉浸", "代入", "氛围", "临场", "世界",
                            "叙事", "沉浸式", "剧情驱动", "角色扮演", "故事性", "代入感", "世界观设定",
                            "背景故事", "lore", "环境叙事", "氛围感"],
    "sensory_aesthetics": ["画面", "画风", "音效", "动作", "美术", "好看", "风格", "视觉", "特效",
                           "视听", "审美", "像素", "二次元", "画质", "音乐", "BGM", "声效", "建模",
                           "动画", "皮囊", "外观"],
    "expression_creation": ["自定义", "建造", "外观", "UGC", "创作", "表达", "个性", "装扮", "捏脸",
                            "创造", "DIY", "个性化", "皮肤", "时装", "换装", "家园", "装修", "设计"],
}


def classify_needs_from_statement(statement):
    """从 Profile statement 分类出诉求标签。"""
    return match_keywords(statement, NEEDS_KEYWORDS)


# 风格关键词
STYLE_KEYWORDS = {
    "combat": {
        "passive": ["苟活", "避战", "保守", "谨慎", "不喜欢刚枪", "躲", "苟", "蹲", "龟", "伏击", "偷袭",
                    "不主动", "苟且", "保命", "生存优先", "避战保命"],
        "aggressive": ["刚枪", "主动", "求战", "进攻", "喜欢打架", "激进", "猛", "莽", "冲锋", "突击",
                       "进攻型", "好战", "嗜血", "见人就打", "主动出击", "喜欢对战"],
    },
    "decision": {
        "strategic": ["思考", "策略", "规划", "分析", "谨慎", "谋定后动", "深思熟虑", "计划", "盘算",
                      "战术思考", "策略性", "理性", "冷静", "仔细"],
        "instinctive": ["本能", "反应", "直觉", "快速", "肌肉记忆", "下意识", "条件反射", "不假思索",
                        "手比脑快", "即兴", "随性", "冲动"],
    },
    "victory": {
        "team": ["团队", "配合", "协作取胜", "集体", "队伍", "团队胜利", "一起赢", "共同胜利",
                 "团队大于个人", "配合取胜"],
        "individual": ["个人", "单挑", "靠自己", "个人能力", "carry", "单杀", "solo", "一己之力",
                       "个人英雄", "独当一面", "个人秀", "靠自己赢"],
    },
    "growth": {
        "progression": ["养成", "数值", "练级", "升级", "装备提升", "收集成长", "肝", "刷", "积累",
                        "成长曲线", "数值成长", "养成系", "RPG成长"],
        "skill": ["操作", "技巧", "技术", "对抗", "练习", "磨练", "操作提升", "技术成长", "硬核",
                  "技巧型", "操作型", "技术流", "手法"],
    },
    "social": {
        "friends": ["朋友", "熟人", "固定队", "开黑", "认识的人", "同学", "同事", "亲友", "兄弟",
                    "熟人局", "朋友局", "兄弟开黑", "固定队友"],
        "solo": ["单人", "独狼", "自己玩", "陌生人", "野排", "单排", "路人", "独行", "一个人",
                 "单机", "solo", "孤狼", "不组队", "不喜欢组队"],
    },
}


def classify_style_from_statement(statement):
    """从 Profile statement 分类出风格标签。"""
    result = {}
    for axis, values in STYLE_KEYWORDS.items():
        for value, keywords in values.items():
            for kw in keywords:
                if kw in statement:
                    result[axis] = value
                    break
    return result


# 平台关键词（从 Profile statement 语义匹配）
PLATFORM_KEYWORDS = {
    "pc": ["pc", "电脑", "端游", "台式", "笔记本", "steam", "战网", "epic", "wegame", "桌面",
           "PC端", "PC平台", "PC上", "鼠标键盘", "键鼠", "PC游戏", "在PC", "用PC", "电脑玩",
           "PC更", "PC在", "PC的", "PC上玩", "主要用电脑", "习惯PC", "PC玩家"],
    "console": ["主机", "ps4", "ps5", "ps2", "ps3", "xbox", "switch", "任天堂", "console",
                "playstation", "PlayStation", "手柄", "ns", "wii", "ds", "3ds", "steam deck",
                "掌机", "PS5", "PS4", "Xbox", "Nintendo", "Wii", "主机平台", "主机游戏",
                "主机玩家", "喜欢主机", "主机端", "主机上", "主机更", "用主机", "在主机",
                "PS2", "Wii U", "主机玩"],
    "mobile": ["手机", "手游", "mobile", "平板", "ipad", "iphone", "android", "碎片",
               "手机端", "手机上", "手机游戏", "手机更", "手机操作", "触屏", "移动端",
               "手游版", "手游操作", "在手机", "用手机", "手机上玩", "偏好手游",
               "手游玩家", "手游更", "手机更适合", "手机方便"],
    "cloud_other": ["云游戏", "云", "串流", "geforce now", "vr", "oculus", "quest", "街机", "arcade"],
}

# 平台偏好判定关键词（区分"使用"和"偏好"）
PLATFORM_PREFERENCE_POSITIVE = {
    "pc": ["偏好PC", "主要用电脑", "PC端", "电脑玩", "习惯PC", "端游", "PC更", "PC在",
           "PC的", "首选PC", "竞技游戏首选PC", "偏好PC平台", "主要在PC", "PC玩家",
           "PC上玩竞技", "PC上玩", "用PC玩", "PC平台"],
    "console": ["偏好主机", "主机游戏", "主机玩家", "喜欢主机", "主机端", "主机更", "习惯主机",
                "个人更喜欢主机", "偏好主机", "主要在主机", "主机上玩", "主机平台",
                "主机玩", "用主机玩"],
    "mobile": ["偏好手游", "主要玩手机", "手机方便", "手游玩家", "喜欢手机", "超爱在手机上",
               "偏好手机", "手游更", "手机更适合", "首选手机", "在手机上玩", "手机玩",
               "手机上玩", "用手机玩"],
    "multi_platform": ["多平台", "跨平台", "都玩", "不挑平台", "PC和手机都", "PC和主机都",
                       "主机和手机都", "多端", "跨端", "双平台", "同时玩", "多平台玩家"],
}

# 平台偏好否定关键词（不喜欢某平台）
PLATFORM_PREFERENCE_NEGATIVE = {
    "pc": ["讨厌PC", "不习惯PC", "PC麻烦", "不玩PC", "放弃PC", "PC是另一个世界", "不喜欢PC"],
    "console": ["不玩主机", "没有主机", "不喜欢主机"],
    "mobile": ["讨厌手机", "不玩手机", "不喜欢手机", "对手游不感兴趣", "放弃手机游戏",
               "对手机游戏不感兴趣", "不习惯手机", "认为手机触屏", "讨厌手机游戏"],
}


def classify_platform_from_statement(statement):
    """从 Profile statement 分类出平台偏好。"""
    scores = {}
    stmt_lower = statement.lower()

    # 先检查正面偏好
    for plat, keywords in PLATFORM_PREFERENCE_POSITIVE.items():
        for kw in keywords:
            if kw.lower() in stmt_lower:
                scores[plat] = scores.get(plat, 0) + 2  # 正面偏好权重更高

    # 如果没有正面偏好，再用通用关键词
    if not scores:
        for plat, keywords in PLATFORM_KEYWORDS.items():
            for kw in keywords:
                if kw.lower() in stmt_lower:
                    scores[plat] = scores.get(plat, 0) + 1

    # 否定关键词降低权重
    for plat, keywords in PLATFORM_PREFERENCE_NEGATIVE.items():
        for kw in keywords:
            if kw.lower() in stmt_lower:
                scores[plat] = scores.get(plat, 0) - 3

    # 过滤掉负分
    scores = {k: v for k, v in scores.items() if v > 0}
    return sorted(scores.keys(), key=lambda k: -scores[k])


# 模式关键词（从 Profile statement 语义匹配）
MODE_KEYWORDS = {
    "pve_only": ["只玩PVE", "纯PVE", "不玩PVP", "从不PVP", "只打怪", "纯单机", "纯剧情",
                 "只玩pve", "pve only", "完全不玩PVP", "从未玩过PVP"],
    "pve_main": ["PVE为主", "主要PVE", "偏PVE", "喜欢PVE", "多玩PVE", "PVE更多", "主打PVE",
                 "pve为主", "PVE为主", "偏好PVE", "PVE玩家", "更偏好PVE", "偏好PVE模式",
                 "PVE比PVP", "PVE更", "更放松", "PVE也有竞争性"],
    "pvp_only": ["只玩PVP", "纯PVP", "不玩PVE", "从不PVE", "纯竞技", "纯对战",
                 "只玩pvp", "pvp only", "完全不玩PVE", "从未玩过PVE"],
    "pvp_main": ["PVP为主", "主要PVP", "偏PVP", "喜欢PVP", "多玩PVP", "PVP更多", "主打PVP",
                 "竞技为主", "pvp为主", "偏好PVP", "PVP玩家", "更偏好PVP", "主要偏好PVP",
                 "偏好PVP模式", "PVP为主", "PVP模式", "PVP更具", "PVP的竞技性",
                 "偏好PVPvE", "PVPVE", "PVPvE", "喜欢与真人", "更喜欢与真人"],
    "balanced": ["PVP/PVE均衡", "都玩", "均衡", "PVP和PVE都", "PVE和PVP都", "平衡", "兼顾",
                 "两者都", "PVE和PVP", "PVP和PVE", "不偏向", "都喜欢", "均衡玩家",
                 "PVP和PVE结合", "两者结合", "平衡模式", "也能接受PVE", "也能接受PVP",
                 "PVP和PVE的平衡", "都不排斥"],
    "context_dependent": ["看情况", "随场景", "看心情", "不一定", "有时", "分情况", "视情况",
                          "取决于", "看队友", "看朋友", "看时间", "单人时", "和朋友时",
                          "工作后更偏好", "单人游戏时", "多人时"],
}


def classify_mode_from_statement(statement):
    """从 Profile statement 分类出模式偏好。"""
    scores = {}
    stmt_lower = statement.lower()
    for mode, keywords in MODE_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in stmt_lower:
                scores[mode] = scores.get(mode, 0) + 1
    return sorted(scores.keys(), key=lambda k: -scores[k])


# 能力等级关键词
ABILITY_LEVEL_KEYWORDS = {
    "novice": ["新手", "完全不会", "刚接触", "零基础", "没玩过", "菜鸟", "小白", "完全不懂"],
    "beginner": ["入门", "初级", "不太会", "技术一般", "菜", "不厉害", "水平一般", "操作一般",
                 "技术不好", "不太行", "普通玩家", "普通水平"],
    "intermediate": ["进阶", "中等", "还行", "还可以", "够用", "中上", "中游", "有一定水平",
                     "不算差", "还可以的", "技术中等", "一般水平"],
    "advanced": ["高手", "厉害", "强", "高水平", "大神", "顶尖", "技术好", "操作好", "高分段",
                 "高段位", "前%", "全区前", "全国前", "顶级", "名列前茅", "出众"],
    "expert_competitive": ["职业", "电竞", "赛事", "比赛", "战队列", "半职业", "职业选手", "pro",
                           "冠军", "锦标赛", "联赛", "青训", "教练"],
}

# metadata.gaming_background.skill_level → 能力等级映射（IMUR问卷数据）
SKILL_LEVEL_METADATA_MAP = {
    "顶尖水平，最高段位或排行榜": "expert_competitive",
    "水平较高，大多处于高段位": "advanced",
    "水平中等偏上，大多处于中高段位": "intermediate",
    "水平一般，大多处于中低段位": "beginner",
    "刚入门，还在熟悉基本操作": "novice",
    # 以下无法确定，用 Profile statement 兜底
    "这款游戏不分段位，或不适合这样比较": None,
    "说不清": None,
}

# 游戏名 → 平台推断（从 current_games 推断）
GAME_PLATFORM_MAP = {
    # === PC 端游戏 ===
    "无畏契约": "pc", "瓦罗兰特": "pc",
    "穿越火线": "pc", "反恐精英": "pc", "cs": "pc",
    "apex英雄": "pc", "apex": "pc",
    "守望先锋": "pc",
    "绝地求生": "pc", "pubg": "pc",
    "战地": "pc",
    "彩虹六号": "pc", "r6": "pc",
    "永劫无间": "pc",
    "英雄联盟": "pc", "lol": "pc",
    "dota": "pc", "刀塔": "pc",
    "三角洲行动": "pc",
    "暗区突围：无限": "pc",
    "逃离塔科夫": "pc",
    "最终对决": "pc", "死锁": "pc", "deadlock": "pc",
    "堡垒之夜": "pc",
    "the finals": "pc",
    "使命召唤": "pc", "cod": "pc",
    "光环": "pc", "halo": "pc",
    "战舰世界": "pc", "坦克世界": "pc",
    "逆战": "pc", "枪神纪": "pc", "风暴战区": "pc",
    "生死狙击": "pc",
    "全境封锁": "pc", "命运": "pc", "warframe": "pc", "星际战甲": "pc",
    "gta": "pc", "侠盗猎车手": "pc",
    "求生之路": "pc",
    "漫威争锋": "pc",
    "枪火游侠": "pc",
    "战争雷霆": "pc",
    "武装突袭": "pc",
    "叛乱": "pc",
    "收获日": "pc",
    "地铁": "pc",
    "孤岛惊魂": "pc",
    "毁灭战士": "pc",
    "无主之地": "pc",
    "泰坦陨落": "pc",
    "辐射": "pc",
    "生化危机": "pc",
    "消逝的光芒": "pc",
    "杀戮空间": "pc",
    "喋血复仇": "pc",
    "严阵以待": "pc",
    "零之契约": "pc",
    "猎杀对决": "pc",
    "人间地狱": "pc",
    "战术小队": "pc",
    "rust": "pc",
    "dayz": "pc",
    "scum": "pc",
    "方舟": "pc",
    "腐蚀": "pc",
    "七日杀": "pc",
    "英灵神殿": "pc",
    "森林": "pc",
    "深海迷航": "pc",
    "绿色地狱": "pc",
    "幻兽帕鲁": "pc",
    "雾锁王国": "pc",
    "夜族崛起": "pc",
    "v rising": "pc",
    "怪物猎人": "pc",
    "艾尔登法环": "pc",
    "黑暗之魂": "pc",
    "只狼": "pc",
    "仁王": "pc",
    "对马岛": "pc",
    "赛博朋克": "pc",
    "巫师": "pc",
    "上古卷轴": "pc",
    "辐射": "pc",
    "博德之门": "pc",
    "神界": "pc",
    "龙腾世纪": "pc",
    "质量效应": "pc",
    "暗黑破坏神": "pc",
    "流放之路": "pc",
    "恐怖黎明": "pc",
    "火炬之光": "pc",
    "我的世界": "pc",
    "minecraft": "pc",
    "泰拉瑞亚": "pc",
    "星露谷物语": "pc",
    "饥荒": "pc",
    "缺氧": "pc",
    "环世界": "pc",
    "rimworld": "pc",
    "戴森球": "pc",
    "异星工厂": "pc",
    "幸福工厂": "pc",
    "僵尸毁灭工程": "pc",
    "kenshi": "pc",
    "骑马与砍杀": "pc",
    "全面战争": "pc",
    "文明": "pc",
    "群星": "pc",
    "钢铁雄心": "pc",
    "欧陆风云": "pc",
    "十字军之王": "pc",
    "城市天际线": "pc",
    "模拟人生": "pc",
    "足球经理": "pc",
    "魔兽世界": "pc",
    "wow": "pc",
    "最终幻想14": "pc",
    "ff14": "pc",
    "激战": "pc",
    "上古卷轴ol": "pc",
    "黑色沙漠": "pc",
    "失落方舟": "pc",
    "新世界": "pc",
    "王权与自由": "pc",
    "阿尔比恩": "pc",
    "eve": "pc",
    "星际公民": "pc",
    "逃离塔科夫": "pc",
    "猎杀对决": "pc",
    "dayz": "pc",
    "人间地狱": "pc",
    "叛乱沙暴": "pc",
    "严阵以待": "pc",
    "零之契约": "pc",
    "战术小队": "pc",
    "arma": "pc",
    "武装突袭": "pc",
    "战雷": "pc",
    "战舰世界": "pc",
    "坦克世界": "pc",
    "战争雷霆": "pc",
    "从军": "pc",
    "hell let loose": "pc",
    "post scriptum": "pc",
    "squad": "pc",
    "ready or not": "pc",
    "ground branch": "pc",
    "six days": "pc",
    "zero hour": "pc",
    "gtfo": "pc",
    "深岩银河": "pc",
    "payday": "pc",
    "收获日": "pc",
    "杀戮空间": "pc",
    "喋血复仇": "pc",
    "求生之路": "pc",
    "僵尸部队": "pc",
    "wwz": "pc",
    "back 4 blood": "pc",
    "killing floor": "pc",
    "vermintide": "pc",
    "darktide": "pc",
    "helldivers": "pc",
    "地狱潜者": "pc",
    "绝地潜兵": "pc",
    "命运2": "pc",
    "warframe": "pc",
    "星际战甲": "pc",
    "全境封锁": "pc",
    "无主之地": "pc",
    "遗迹": "pc",
    "先驱者": "pc",
    "圣歌": "pc",
    "第一后裔": "pc",
    "星际战甲": "pc",
    "萤火突击": "pc",
    "王牌战士": "pc",
    "香肠派对": "pc",
    # === 补充未覆盖游戏 ===
    "arc raiders": "pc",
    "军团要塞": "pc", "team fortress": "pc",
    "斯普拉遁": "console", "喷射战士": "console",
    "行星边际": "pc",
    "终结者": "pc",
    "泰坦陨落": "pc",
    "重返德军总部": "pc",
    "卡拉比丘": "pc", "卡拉彼丘": "pc",
    "全民枪战": "mobile",
    "战区手游": "mobile",
    "火线精英": "pc",
    "黎明觉醒": "mobile",
    "七日世界": "pc",
    "destiny": "pc",
    "fps": "pc",  # 泛指FPS游戏
    # === 手游 ===
    "和平精英": "mobile",
    "王者荣耀": "mobile",
    "使命召唤手游": "mobile",
    "荒野行动": "mobile",
    "穿越火线：枪战王者": "mobile",
    "cfm": "mobile",
    "暗区突围": "mobile",  # 手游版
    "apex英雄手游": "mobile",
    "高能英雄": "mobile",
    "萤火突击": "mobile",
    "香肠派对": "mobile",
    "pubg mobile": "mobile",
    "free fire": "mobile",
    "堡垒之夜手游": "mobile",
    "明日之后": "mobile",
    "崩坏": "mobile",
    "原神": "mobile",
    "星穹铁道": "mobile",
    "绝区零": "mobile",
    "鸣潮": "mobile",
    "幻塔": "mobile",
    "碧蓝航线": "mobile",
    "少女前线": "mobile",
    "明日方舟": "mobile",
    "fgo": "mobile",
    "阴阳师": "mobile",
    "第五人格": "mobile",
    "荒野乱斗": "mobile",
    "皇室战争": "mobile",
    "部落冲突": "mobile",
    "金铲铲": "mobile",
    "云顶之弈": "mobile",
    "蛋仔派对": "mobile",
    "元梦之星": "mobile",
    "永劫无间手游": "mobile",
    "逆水寒": "mobile",
    "天涯明月刀": "mobile",
    "一梦江湖": "mobile",
    "倩女幽魂": "mobile",
    "梦幻西游": "mobile",
    "大话西游": "mobile",
    "问道": "mobile",
    "诛仙": "mobile",
    "完美世界": "mobile",
    "天龙八部": "mobile",
    "剑侠情缘": "mobile",
    "新笑傲江湖": "mobile",
    "烟雨江湖": "mobile",
    "最强蜗牛": "mobile",
    "一念逍遥": "mobile",
    "三国志": "mobile",
    "率土之滨": "mobile",
    "三国杀": "mobile",
    "欢乐斗地主": "mobile",
    "麻将": "mobile",
    "捕鱼": "mobile",
    "消消乐": "mobile",
    "贪吃蛇": "mobile",
    "球球大作战": "mobile",
    "贪玩蓝月": "mobile",
    "传奇": "mobile",
    "复古传奇": "mobile",
    # === 主机/掌机 ===
    "splatoon": "console",
    "喷射战士": "console",
    "塞尔达": "console",
    "马里奥": "console",
    "动物森友会": "console",
    "宝可梦": "console",
    "pokemon": "console",
    "异度之刃": "console",
    "火焰纹章": "console",
    "星之卡比": "console",
    "银河战士": "console",
    "皮克敏": "console",
    "任天堂": "console",
    "战神": "console",
    "god of war": "console",
    "蜘蛛侠": "console",
    "最后生还者": "console",
    "神秘海域": "console",
    "地平线": "console",
    "对马岛之魂": "console",
    "血缘诅咒": "console",
    "恶魔之魂": "console",
    "死亡搁浅": "console",
    "days gone": "console",
    "瑞奇与叮当": "console",
    "returnal": "console",
    "gt赛车": "console",
    "gt7": "console",
    "最终幻想16": "console",
    "ff16": "console",
    "最终幻想7": "console",
    "ff7": "console",
    "王国之心": "console",
    "勇者斗恶龙": "console",
    "女神异闻录": "console",
    "persona": "console",
    "如龙": "console",
    "审判之眼": "console",
    "仁王": "console",
    "卧龙": "console",
    "浪人": "console",
    "恶魔城": "console",
    "寂静岭": "console",
    "合金装备": "console",
    "鬼泣": "console",
    "生化危机": "console",
    "怪物猎人": "console",
    "街头霸王": "console",
    "铁拳": "console",
    "灵魂能力": "console",
    "死或生": "console",
    "罪恶装备": "console",
    "碧蓝幻想": "console",
    "granblue": "console",
    "relink": "console",
    "尼尔": "console",
    "nier": "console",
    "星之海洋": "console",
    "传说系列": "console",
    "tales": "console",
    "轨迹": "console",
    "伊苏": "console",
    "英雄传说": "console",
    "真女神转生": "console",
    "smt": "console",
    "p5": "console",
    "p4": "console",
    "p3": "console",
    "splatoon": "console",
    "arms": "console",
    "猎天使魔女": "console",
    "bayonetta": "console",
    "异界锁链": "console",
    "astral chain": "console",
    "神奇101": "console",
    "大乱斗": "console",
    "smash": "console",
    "马车": "console",
    "马里奥赛车": "console",
    "马造": "console",
    "马趴": "console",
    "健身环": "console",
    "labo": "console",
    "1-2-switch": "console",
    "arms": "console",
    "森喜刚": "console",
    "瓦里奥": "console",
    "耀西": "console",
    "路易吉": "console",
    "纸片马里奥": "console",
    "马里奥rpg": "console",
    "千年之门": "console",
    "折纸国王": "console",
    "幻影异闻录": "console",
    "东京迷城": "console",
    "秋叶原": "console",
    "弹丸论破": "console",
    "逆转裁判": "console",
    "雷顿": "console",
    "幽灵诡计": "console",
    "极限脱出": "console",
    "ai梦境": "console",
    "世界树迷宫": "console",
    "风来的西林": "console",
    "不可思议迷宫": "console",
    "牧场物语": "console",
    "符文工房": "console",
    "天穗之咲稻姬": "console",
    "蜡笔小新": "console",
    "哆啦a梦": "console",
    "太鼓达人": "console",
    "节奏天国": "console",
    "应援团": "console",
    "瓦里奥制造": "console",
    "脑锻炼": "console",
    "nintendogs": "console",
    "任天狗": "console",
    "朋友聚会": "console",
    "tomodachi": "console",
    "miitopia": "console",
    "绘图方块": "console",
    "picross": "console",
    "推拉": "console",
    "boxboy": "console",
    "good job": "console",
    "搬家": "console",
    "担架": "console",
    "跳绳": "console",
    "拳击": "console",
    "健身拳击": "console",
    "zumba": "console",
    "舞力全开": "console",
    "just dance": "console",
    "太鼓": "console",
    "初音": "console",
    "歌姬计划": "console",
    "djmax": "console",
    "deemo": "console",
    "cytus": "console",
    "voez": "console",
    "arcaea": "console",
    "lanota": "console",
    "phigros": "console",
    "muse dash": "console",
    "喵斯": "console",
    "同步音律": "console",
    "节奏大师": "mobile",
    "vrchat": "cloud_other",
    "beatsaber": "cloud_other",
    "half-life alyx": "cloud_other",
    "半条命alyx": "cloud_other",
    "boneworks": "cloud_other",
    "blade and sorcery": "cloud_other",
    "剑与魔法": "cloud_other",
    "pavlov": "cloud_other",
    "contractors": "cloud_other",
    "onward": "cloud_other",
    "population one": "cloud_other",
    "among us vr": "cloud_other",
    "vr": "cloud_other",
    "oculus": "cloud_other",
    "meta quest": "cloud_other",
    "steam vr": "cloud_other",
}

# 游戏名 → 模式推断（PVP/PVE）
GAME_MODE_MAP = {
    # === PVP 为主 ===
    "无畏契约": "pvp_main", "瓦罗兰特": "pvp_main",
    "cs": "pvp_main", "csgo": "pvp_main", "cs2": "pvp_main",
    "反恐精英": "pvp_main",
    "穿越火线": "pvp_main",
    "守望先锋": "pvp_main",
    "apex英雄": "pvp_main", "apex": "pvp_main",
    "绝地求生": "pvp_main", "pubg": "pvp_main",
    "英雄联盟": "pvp_main", "lol": "pvp_main",
    "dota": "pvp_main", "刀塔": "pvp_main",
    "堡垒之夜": "pvp_main",
    "彩虹六号": "pvp_main", "r6": "pvp_main",
    "永劫无间": "pvp_main",
    "the finals": "pvp_main", "最终对决": "pvp_main",
    "王者荣耀": "pvp_main",
    "荒野行动": "pvp_main",
    "和平精英": "pvp_main",
    "逆战": "pvp_main",
    "枪神纪": "pvp_main",
    "风暴战区": "pvp_main",
    "生死狙击": "pvp_main",
    "战争雷霆": "pvp_main",
    "坦克世界": "pvp_main",
    "战舰世界": "pvp_main",
    "街霸": "pvp_main", "铁拳": "pvp_main", "拳皇": "pvp_main",
    "任天堂大乱斗": "pvp_main", "大乱斗": "pvp_main",
    "漫威争锋": "pvp_main",
    "枪火游侠": "pvp_main",
    "香肠派对": "pvp_main",
    "荒野乱斗": "pvp_main",
    "皇室战争": "pvp_main",
    "部落冲突": "pvp_main",
    "金铲铲": "pvp_main",
    "云顶之弈": "pvp_main",
    "第五人格": "pvp_main",
    "三国杀": "pvp_main",
    "黎明杀机": "pvp_main",
    "dead by daylight": "pvp_main",
    "猎杀对决": "pvp_main",
    "逃离塔科夫": "pvp_main",
    "rust": "pvp_main",
    "dayz": "pvp_main",
    "scum": "pvp_main",
    "人间地狱": "pvp_main",
    "战术小队": "pvp_main",
    "叛乱沙暴": "pvp_main",
    "squad": "pvp_main",
    "hell let loose": "pvp_main",
    "严阵以待": "pvp_main",
    "零之契约": "pvp_main",
    "从军": "pvp_main",
    "麻雀": "pvp_main",
    "斗地主": "pvp_main",
    "消消乐": "pvp_main",
    "球球大作战": "pvp_main",
    "贪吃蛇": "pvp_main",
    "蛋仔派对": "pvp_main",
    "元梦之星": "pvp_main",
    # === PVE 为主 ===
    "warframe": "pve_main", "星际战甲": "pve_main",
    "命运2": "pve_main", "命运": "pve_main",
    "无主之地": "pve_main",
    "遗迹": "pve_main",
    "gtfo": "pve_main",
    "深岩银河": "pve_main",
    "求生之路": "pve_main",
    "喋血复仇": "pve_main",
    "back 4 blood": "pve_main",
    "killing floor": "pve_main", "杀戮空间": "pve_main",
    "僵尸部队": "pve_main",
    "wwz": "pve_main",
    "地狱潜者": "pve_main", "绝地潜兵": "pve_main",
    "helldivers": "pve_main",
    "黑暗之魂": "pve_main",
    "艾尔登法环": "pve_main",
    "只狼": "pve_main",
    "血缘诅咒": "pve_main",
    "仁王": "pve_main",
    "卧龙": "pve_main",
    "怪物猎人": "pve_main",
    "塞尔达": "pve_main",
    "马里奥": "pve_main",
    "星之卡比": "pve_main",
    "银河战士": "pve_main",
    "恶魔城": "pve_main",
    "生化危机": "pve_main",
    "最后生还者": "pve_main",
    "神秘海域": "pve_main",
    "古墓丽影": "pve_main",
    "战神": "pve_main",
    "蜘蛛侠": "pve_main",
    "地平线": "pve_main",
    "对马岛": "pve_main",
    "赛博朋克": "pve_main",
    "巫师": "pve_main",
    "上古卷轴": "pve_main",
    "辐射": "pve_main",
    "博德之门": "pve_main",
    "神界": "pve_main",
    "暗黑破坏神": "pve_main",
    "流放之路": "pve_main",
    "火炬之光": "pve_main",
    "我的世界": "pve_main",
    "minecraft": "pve_main",
    "泰拉瑞亚": "pve_main",
    "星露谷物语": "pve_main",
    "饥荒": "pve_main",
    "方舟": "pve_main",
    "幻兽帕鲁": "pve_main",
    "雾锁王国": "pve_main",
    "v rising": "pve_main",
    "文明": "pve_main",
    "群星": "pve_main",
    "城市天际线": "pve_main",
    "模拟人生": "pve_main",
    "房产达人": "pve_main",
    "微软飞行模拟": "pve_main",
    "gta": "pve_main", "侠盗猎车手": "pve_main",
    "看门狗": "pve_main",
    "孤岛惊魂": "pve_main",
    "刺客信条": "pve_main",
    "如龙": "pve_main",
    "审判之眼": "pve_main",
    "幽灵行动": "pve_main",
    "全境封锁": "pve_main",
    "细胞分裂": "pve_main",
    "合金装备": "pve_main",
    "鬼泣": "pve_main",
    "尼尔": "pve_main",
    "nier": "pve_main",
    "女神异闻录": "pve_main",
    "persona": "pve_main",
    "最终幻想": "pve_main",
    "勇者斗恶龙": "pve_main",
    "传说系列": "pve_main",
    "tales": "pve_main",
    "轨迹": "pve_main",
    "伊苏": "pve_main",
    "逆转裁判": "pve_main",
    "弹丸论破": "pve_main",
    "幽灵诡计": "pve_main",
    "魔兽世界": "pve_main",
    "wow": "pve_main",
    "ff14": "pve_main",
    "最终幻想14": "pve_main",
    "激战": "pve_main",
    "上古卷轴ol": "pve_main",
    "黑色沙漠": "pve_main",
    "失落方舟": "pve_main",
    "明日之后": "pve_main",
    "原神": "pve_main",
    "星穹铁道": "pve_main",
    "绝区零": "pve_main",
    "鸣潮": "pve_main",
    "幻塔": "pve_main",
    "明日方舟": "pve_main",
    "fgo": "pve_main",
    "阴阳师": "pve_main",
    "碧蓝航线": "pve_main",
    "少女前线": "pve_main",
    "崩坏": "pve_main",
    "恋与制作人": "pve_main",
    "光与夜之恋": "pve_main",
    "未定事件簿": "pve_main",
    "代号鸢": "pve_main",
    "花亦山": "pve_main",
    "食物语": "pve_main",
    "忘川风华录": "pve_main",
    "墨魂": "pve_main",
    "掌门太忙": "pve_main",
    "遇见逆水寒": "pve_main",
    "时空中的绘旅人": "pve_main",
    "黑猫奇闻社": "pve_main",
    "璀璨星途": "pve_main",
    "绝对演绎": "pve_main",
    "以闪亮之名": "pve_main",
    "闪耀暖暖": "pve_main",
    "奇迹暖暖": "pve_main",
    "云裳羽衣": "pve_main",
    "螺旋圆舞曲": "pve_main",
    "箱庭": "pve_main",
    "筑梦": "pve_main",
    "江南百景图": "pve_main",
    "桃源深处": "pve_main",
    "解忧小村落": "pve_main",
    "老农种树": "pve_main",
    "悠长假期": "pve_main",
    "小森生活": "pve_main",
    "奶牛镇": "pve_main",
    "波西亚时光": "pve_main",
    "沙石镇时光": "pve_main",
    "潜水员戴夫": "pve_main",
    "灵魂旅人": "pve_main",
    "spiritfarer": "pve_main",
    "cozy grove": "pve_main",
    "unpacking": "pve_main",
    "a little to the left": "pve_main",
    "stray": "pve_main",
    "stray": "pve_main",
    "动物森友会": "pve_main",
    "宝可梦": "pve_main",
    "pokemon": "pve_main",
    "牧场物语": "pve_main",
    "符文工房": "pve_main",
    "天穗之咲稻姬": "pve_main",
    "死亡搁浅": "pve_main",
    "days gone": "pve_main",
    "消逝的光芒": "pve_main",
    "地铁": "pve_main",
    "原子之心": "pve_main",
    "prey": "pve_main",
    "耻辱": "pve_main",
    "dishonored": "pve_main",
    "死亡循环": "pve_main",
    "deathloop": "pve_main",
    "幽灵线东京": "pve_main",
    "hifi rush": "pve_main",
    "完美音浪": "pve_main",
    "禁闭求生": "pve_main",
    "grounded": "pve_main",
    "盗贼之海": "pve_main",
    "sea of thieves": "pve_main",
    "腐烂国度": "pve_main",
    "state of decay": "pve_main",
    "脑航员": "pve_main",
    "psychonauts": "pve_main",
    "意航员": "pve_main",
    "奥日": "pve_main",
    "ori": "pve_main",
    "空洞骑士": "pve_main",
    "hollow knight": "pve_main",
    "死亡细胞": "pve_main",
    "dead cells": "pve_main",
    "哈迪斯": "pve_main",
    "hades": "pve_main",
    "以撒": "pve_main",
    "isaac": "pve_main",
    "挺进地牢": "pve_main",
    "enter the gungeon": "pve_main",
    "雨中冒险": "pve_main",
    "risk of rain": "pve_main",
    "吸血鬼幸存者": "pve_main",
    "brotato": "pve_main",
    "土豆兄弟": "pve_main",
    "暖雪": "pve_main",
    "霓虹深渊": "pve_main",
    "小骨": "pve_main",
    "skul": "pve_main",
    "莫塔之子": "pve_main",
    "children of morta": "pve_main",
    "传说法师": "pve_main",
    "wizard of legend": "pve_main",
    "失落城堡": "pve_main",
    "元气骑士": "pve_main",
    "比特小队": "pve_main",
    "战魂铭人": "pve_main",
    "重生细胞": "pve_main",
    "恶果之地": "pve_main",
    "枪火重生": "pve_main",
    "gunfire reborn": "pve_main",
    "雨中冒险2": "pve_main",
    "ror2": "pve_main",
    "夜勤人": "pve_main",
    "moonlighter": "pve_main",
    "守墓人": "pve_main",
    "graveyard keeper": "pve_main",
    "旅者": "pve_main",
    "八方旅人": "pve_main",
    "octopath": "pve_main",
    "三角战略": "pve_main",
    "triangle strategy": "pve_main",
    "皇家骑士团": "pve_main",
    "tactics ogre": "pve_main",
    "火焰纹章": "pve_main",
    "高级战争": "pve_main",
    "战场女武神": "pve_main",
    "valkyria": "pve_main",
    "xcom": "pve_main",
    "幽浮": "pve_main",
    "凤凰点": "pve_main",
    "突变元年": "pve_main",
    "废土": "pve_main",
    "wasteland": "pve_main",
    "荒野兵器": "pve_main",
    "影之心": "pve_main",
    "龙战士": "pve_main",
    "幻想水浒传": "pve_main",
    "格兰蒂亚": "pve_main",
    "露娜": "pve_main",
    "天外魔境": "pve_main",
    "光明力量": "pve_main",
    "梦幻模拟战": "pve_main",
    "langrisser": "pve_main",
    "炎龙骑士团": "pve_main",
    "天地劫": "pve_main",
    "轩辕剑": "pve_main",
    "仙剑": "pve_main",
    "古剑奇谭": "pve_main",
    "幻想三国志": "pve_main",
    "风色幻想": "pve_main",
    "圣女之歌": "pve_main",
    "守护者之剑": "pve_main",
    "堕落天使": "pve_main",
    "西风": "pve_main",
    "阿猫阿狗": "pve_main",
    "大富翁": "pve_main",
    "富甲天下": "pve_main",
    "三国群英传": "pve_main",
    "三国志": "pve_main",
    "信长": "pve_main",
    "太阁": "pve_main",
    "项刘记": "pve_main",
    "成吉思汗": "pve_main",
    "苍狼": "pve_main",
    "水浒传": "pve_main",
    "封神演义": "pve_main",
    "西游记": "pve_main",
    "金庸群侠传": "pve_main",
    "武林群侠传": "pve_main",
    "侠客风云传": "pve_main",
    "河洛群侠传": "pve_main",
    "天命奇御": "pve_main",
    "逸剑风云决": "pve_main",
    "大侠立志传": "pve_main",
    "绝世好武功": "pve_main",
    "下一站江湖": "pve_main",
    "部落与弯刀": "pve_main",
    "鬼谷八荒": "pve_main",
    "太吾绘卷": "pve_main",
    "觅长生": "pve_main",
    "修仙模拟器": "pve_main",
    "了不起的修仙": "pve_main",
    "蜀山": "pve_main",
    "大衍江湖": "pve_main",
    "混搭修仙": "pve_main",
    "道天": "pve_main",
    "宗门": "pve_main",
    "修仙家族": "pve_main",
    "轮回修仙": "pve_main",
    "山门": "pve_main",
    "弈剑": "pve_main",
    "江湖": "pve_main",
    "烟雨": "pve_main",
    "我的侠客": "pve_main",
    "汉家江湖": "pve_main",
    "濡沫江湖": "pve_main",
    "暴走英雄": "pve_main",
    "放置江湖": "pve_main",
    "挂机": "pve_main",
    "一念逍遥": "pve_main",
    "修仙": "pve_main",
    # === PVPvE 混合 ===
    "三角洲行动": "balanced",
    "使命召唤": "balanced", "cod": "balanced",
    "战地": "balanced",
    "deadlock": "balanced", "死锁": "balanced",
    "暗区突围": "balanced",
    "逃离塔科夫": "balanced",
    "halo": "balanced", "光环": "balanced",
    "全境封锁": "balanced",
    "命运": "balanced", "destiny": "balanced",
    "先驱者": "pve_main",
    "圣歌": "pve_main",
    "第一后裔": "pve_main",
    "星际战甲": "pve_main",
    "warframe": "pve_main",
    "萤火突击": "balanced",
    "王牌战士": "pvp_main",
    "香肠派对": "pvp_main",
    # === 补充未覆盖游戏 ===
    "arc raiders": "pve_main",
    "军团要塞": "pvp_main", "team fortress": "pvp_main",
    "斯普拉遁": "pvp_main", "喷射战士": "pvp_main",
    "行星边际": "pvp_main",
    "终结者": "pvp_main",
    "泰坦陨落": "pvp_main",
    "重返德军总部": "pve_main",
    "卡拉比丘": "pvp_main", "卡拉彼丘": "pvp_main",
    "全民枪战": "pvp_main",
    "战区手游": "pvp_main",
    "火线精英": "pvp_main",
    "黎明觉醒": "pve_main",
    "七日世界": "pve_main",
    "destiny": "balanced",
    "fps": "pvp_main",
    "gta": "balanced", "侠盗猎车手": "balanced",
    "rust": "pvp_main",
    "dayz": "pvp_main",
    "方舟": "balanced",
    "幻兽帕鲁": "pve_main",
    "英灵神殿": "pve_main",
    "森林": "pve_main",
    "绿色地狱": "pve_main",
    "七日杀": "pve_main",
    "scum": "pvp_main",
    "人间地狱": "pvp_main",
    "战术小队": "pvp_main",
    "叛乱沙暴": "pvp_main",
    "squad": "pvp_main",
    "hell let loose": "pvp_main",
    "严阵以待": "pvp_main",
    "零之契约": "pvp_main",
    "从军": "pvp_main",
    "vrchat": "pve_main",
    "beatsaber": "pve_main",
    "half-life alyx": "pve_main",
    "boneworks": "pve_main",
    "blade and sorcery": "pve_main",
    "pavlov": "pvp_main",
    "contractors": "pvp_main",
    "onward": "pvp_main",
    "population one": "pvp_main",
    "among us vr": "pvp_main",
}


# ============================================================
# 标签标准化函数
# ============================================================

def clean_need_value(value):
    """标准化诉求标签值。"""
    if value in NEEDS_VALUES:
        return value
    if value in NEEDS_CLEANUP_MAP:
        return NEEDS_CLEANUP_MAP[value]
    return None


def clean_ability_level(value):
    """标准化能力等级。"""
    if value in ABILITY_LEVELS:
        return value
    if value in ABILITY_CLEANUP_MAP:
        return ABILITY_CLEANUP_MAP[value]
    if value == "unknown":
        return None
    return None


def clean_platform_value(value):
    """标准化平台标签值。"""
    if value in PLATFORM_VALUES:
        return value
    if value in PLATFORM_CLEANUP_MAP:
        return PLATFORM_CLEANUP_MAP[value]
    if value == "unknown":
        return None
    return None


def clean_mode_structure(value):
    """标准化模式结构。"""
    if value in MODE_STRUCTURES:
        return value
    if value in MODE_CLEANUP_MAP:
        return MODE_CLEANUP_MAP[value]
    if value == "unknown":
        return None
    return None


def clean_submode(value):
    """标准化二级模式。"""
    if value in SUBMODE_CLEANUP_MAP:
        return SUBMODE_CLEANUP_MAP[value]
    # 中文直接匹配
    for std_val in set(SUBMODE_CLEANUP_MAP.values()):
        if value == std_val:
            return value
    return value  # 保留原值，未知的也保留


def classify_skill(skill_name):
    """将技巧名分类到5个技巧大类。"""
    skill_lower = skill_name.lower().replace("-", "").replace("_", "")
    for category, keywords in SKILL_CATEGORIES.items():
        for kw in keywords:
            if kw.lower().replace("-", "").replace("_", "") in skill_lower:
                return category
    return None


# ============================================================
# 核心映射函数
# ============================================================

def map_needs(framework_needs, profile_motivations, profile_metadata=None):
    """
    映射游戏诉求。
    优先级: framework.needs.primary > Profile motivations > 所有trait扩展匹配 > metadata兜底推断
    返回: { primary: str|null, secondary: str[], confidence: float }
    """
    primary = None
    secondary = []
    confidence = 0.0

    # P0: framework.needs.primary
    if framework_needs and framework_needs.get("primary"):
        raw_primary = max(set(framework_needs["primary"]), key=framework_needs["primary"].count)
        cleaned = clean_need_value(raw_primary)
        if cleaned:
            primary = cleaned
            confidence = 0.95

    # framework.needs.secondary
    if framework_needs and framework_needs.get("secondary"):
        seen = {primary} if primary else set()
        for raw in framework_needs["secondary"]:
            cleaned = clean_need_value(raw)
            if cleaned and cleaned not in seen:
                secondary.append(cleaned)
                seen.add(cleaned)
                if len(secondary) >= 2:
                    break

    # P1: Profile motivations
    if not primary or len(secondary) < 2:
        for trait in profile_motivations:
            stmt = trait.get("statement", "")
            tags = classify_needs_from_statement(stmt)
            for tag in tags:
                if not primary:
                    primary = tag
                    if confidence < 0.85:
                        confidence = 0.85
                elif tag not in secondary and tag != primary:
                    secondary.append(tag)
                    if confidence < 0.80:
                        confidence = 0.80
                if primary and len(secondary) >= 2:
                    break
            if primary and len(secondary) >= 2:
                break

    # P2: 扩展到其他 trait_type 做语义匹配（need, preference, perception 等）
    if not primary or len(secondary) < 2:
        if profile_metadata and isinstance(profile_metadata, dict):
            prof = profile_metadata.get("profile", profile_metadata)
            if isinstance(prof, dict):
                all_traits = []
                for dim in ["motivations_needs", "preferences", "perceptions_beliefs", "behaviors"]:
                    dim_traits = prof.get(dim, [])
                    if isinstance(dim_traits, list):
                        all_traits.extend([t for t in dim_traits if isinstance(t, dict)])
                for trait in all_traits:
                    stmt = trait.get("statement", "")
                    if not stmt:
                        continue
                    if trait.get("trait_type") == "motivation" and trait in profile_motivations:
                        continue
                    tags = classify_needs_from_statement(stmt)
                    seen = {primary} if primary else set()
                    seen.update(secondary)
                    for tag in tags:
                        if tag not in seen:
                            if not primary:
                                primary = tag
                                if confidence < 0.75:
                                    confidence = 0.75
                            elif len(secondary) < 2:
                                secondary.append(tag)
                                seen.add(tag)
                            if primary and len(secondary) >= 2:
                                break
                    if primary and len(secondary) >= 2:
                        break

    # P3: 从 metadata 兜底推断（仅在 P1+P2 完全没有匹配到任何诉求时使用）
    if not primary and not secondary:
        if profile_metadata and isinstance(profile_metadata, dict):
            gb = profile_metadata.get("gaming_background", {})
            if isinstance(gb, dict):
                hours = gb.get("peak_weekly_hours", "")
                duration = gb.get("experience_duration", "")
                games = gb.get("current_games", [])
                skill = gb.get("skill_level", "")

                # 高投入 + 高段位 → 竞技证明
                if "21小时及以上" in str(hours) and "9年以上" in str(duration):
                    if "顶尖" in str(skill) or "水平较高" in str(skill):
                        primary = "competitive_proof"
                        confidence = 0.45
                    else:
                        primary = "ability_growth"
                        confidence = 0.40

                # 低投入 → 放松逃避
                elif "不足7小时" in str(hours) or "不足3小时" in str(hours):
                    primary = "relaxation_escape"
                    confidence = 0.40

                # 从游戏名辅助推断（仅作为secondary，不覆盖已确定的primary）
                if games and isinstance(games, list):
                    # 强社交游戏（有明确社交属性的）
                    strong_social_games = ["王者荣耀", "蛋仔派对", "元梦之星", "among us"]
                    coop_games = ["求生之路", "喋血复仇", "深岩银河", "地狱潜者", "payday",
                                 "收获日", "gtfo", "绝地潜兵", "helldivers", "back 4 blood"]
                    has_strong_social = any(any(sg.lower() in g.lower() for sg in strong_social_games) for g in games)
                    has_coop = any(any(cg.lower() in g.lower() for cg in coop_games) for g in games)

                    if has_strong_social and not primary:
                        primary = "social_belonging"
                        confidence = 0.40
                    if has_coop and "team_cooperation" not in secondary:
                        secondary.append("team_cooperation")

    # 如果没有找到任何诉求
    if not primary:
        return {"primary": None, "secondary": [], "confidence": 0.0}

    return {"primary": primary, "secondary": secondary[:3], "confidence": confidence}


def map_ability(framework_ability, profile_capability, profile_experience, profile_metadata):
    """
    映射游戏能力。
    优先级: framework.ability.level > metadata.skill_level > Profile statement
    返回: { level: str|null, strengths: str[], weaknesses: str[], confidence: float }
    """
    level = None
    strengths = []
    weaknesses = []
    confidence = 0.0

    # P0: framework.ability.level
    if framework_ability and framework_ability.get("levels"):
        levels = [clean_ability_level(l) for l in framework_ability["levels"]]
        levels = [l for l in levels if l]
        if levels:
            level = max(set(levels), key=levels.count)
            confidence = 0.95

    # framework.ability.strengths/weaknesses → 5大类
    if framework_ability:
        for raw_s in framework_ability.get("strengths", []):
            cat = classify_skill(raw_s)
            if cat and cat not in strengths:
                strengths.append(cat)
        for raw_w in framework_ability.get("weaknesses", []):
            cat = classify_skill(raw_w)
            if cat and cat not in weaknesses:
                weaknesses.append(cat)

    # P1: metadata.gaming_background.skill_level (IMUR问卷数据)
    if not level:
        gb = profile_metadata.get("gaming_background", {})
        if isinstance(gb, dict):
            raw_skill = gb.get("skill_level", "")
            if raw_skill in SKILL_LEVEL_METADATA_MAP:
                mapped = SKILL_LEVEL_METADATA_MAP[raw_skill]
                if mapped:
                    level = mapped
                    confidence = 0.80  # 问卷自评，可信度较高

    # P2: Profile capability statements
    if not level:
        for trait in profile_capability:
            stmt = trait.get("statement", "")
            for lvl, keywords in ABILITY_LEVEL_KEYWORDS.items():
                for kw in keywords:
                    if kw in stmt:
                        level = lvl
                        confidence = 0.75
                        break
                if level:
                    break
            if level:
                break

    # 从 capability statement 提取技巧
    for trait in profile_capability:
        stmt = trait.get("statement", "")
        for cat, keywords in SKILL_CATEGORIES.items():
            for kw in keywords:
                if kw.lower() in stmt.lower():
                    # 判断是强项还是短板
                    is_weakness = any(w in stmt for w in ["短板", "弱", "不行", "差", "不足", "欠缺", "不会", "不擅长"])
                    if is_weakness:
                        if cat not in weaknesses:
                            weaknesses.append(cat)
                    else:
                        if cat not in strengths:
                            strengths.append(cat)
                    break

    if not level:
        level = None

    return {
        "level": level,
        "strengths": strengths[:3],
        "weaknesses": weaknesses[:3],
        "confidence": confidence,
    }


def map_style(framework_style, profile_preferences, profile_behaviors):
    """
    映射游戏风格（5轴）。
    返回: { combat, decision, victory, growth, social, confidence }
    """
    style = {axis: "balanced" for axis in STYLE_AXES}  # 默认中间态
    style["confidence"] = 0.0
    axis_confidence = {}

    # P0: framework.style 直接标注
    if framework_style:
        for axis, values in framework_style.items():
            if axis in STYLE_AXES and values:
                valid_values = [v for v in values if v in STYLE_AXES[axis]]
                if valid_values:
                    style[axis] = max(set(valid_values), key=valid_values.count)
                    axis_confidence[axis] = 0.95

    # P1: Profile statement 语义匹配
    all_statements = []
    for trait in profile_preferences:
        all_statements.append(trait.get("statement", ""))
    for trait in profile_behaviors:
        all_statements.append(trait.get("statement", ""))

    for stmt in all_statements:
        if not stmt:
            continue
        result = classify_style_from_statement(stmt)
        for axis, value in result.items():
            if axis not in axis_confidence:  # 不覆盖 framework 的结果
                style[axis] = value
                axis_confidence[axis] = 0.80

    # 计算总体置信度
    if axis_confidence:
        style["confidence"] = sum(axis_confidence.values()) / len(axis_confidence)
    else:
        style["confidence"] = 0.3  # 全部默认值

    return style


def map_platform(framework_platform, profile_preferences, profile_context, profile_perceptions, profile_metadata):
    """
    映射平台偏好。
    优先级: framework.platform > metadata.platform > 游戏名推断 > Profile statement > 时长/经历辅助
    返回: { primary: str|null, secondary: str|null, confidence: float }
    """
    primary = None
    secondary = None
    confidence = 0.0

    # P0: framework.platform
    if framework_platform and framework_platform.get("primary"):
        raw_primary = max(set(framework_platform["primary"]),
                          key=framework_platform["primary"].count)
        cleaned = clean_platform_value(raw_primary)
        if cleaned:
            primary = cleaned
            confidence = 0.95

    if framework_platform and framework_platform.get("secondary"):
        raw_secondary = max(set(framework_platform["secondary"]),
                            key=framework_platform["secondary"].count)
        cleaned = clean_platform_value(raw_secondary)
        if cleaned and cleaned != primary:
            secondary = cleaned

    # P1: metadata.gaming_background.platform 直接使用
    if not primary:
        gb = profile_metadata.get("gaming_background", {})
        if isinstance(gb, dict):
            raw_platforms = gb.get("platform", [])
            if raw_platforms and isinstance(raw_platforms, list):
                platform_strs = [str(p) for p in raw_platforms]
                # 尝试从 platform 字段直接归类
                plat_scores = Counter()
                for ps in platform_strs:
                    ps_lower = ps.lower().strip()
                    if any(kw in ps_lower for kw in ["pc", "steam", "电脑", "台式", "笔记本", "mac", "laptop", "desktop", "epic", "战网", "wegame"]):
                        plat_scores["pc"] += 1
                    elif any(kw in ps_lower for kw in ["ps", "playstation", "xbox", "switch", "nintendo", "wii", "ds", "3ds", "game boy", "主机", "掌机", "steam deck"]):
                        plat_scores["console"] += 1
                    elif any(kw in ps_lower for kw in ["手机", "mobile", "phone", "iphone", "android", "平板", "ipad", "tablet", "模拟器"]):
                        plat_scores["mobile"] += 1
                    elif any(kw in ps_lower for kw in ["vr", "oculus", "quest", "meta quest", "云游戏", "串流", "rog ally"]):
                        plat_scores["cloud_other"] += 1
                if plat_scores:
                    sorted_plats = plat_scores.most_common()
                    primary = sorted_plats[0][0]
                    if len(sorted_plats) > 1:
                        secondary = sorted_plats[1][0]
                    confidence = 0.85  # metadata直接标注，可信度高

    # P2: 从 current_games 推断平台
    if not primary:
        gb = profile_metadata.get("gaming_background", {})
        if isinstance(gb, dict):
            games = gb.get("current_games", [])
            if games and isinstance(games, list):
                plat_counter = Counter()
                for game in games:
                    game_clean = game.strip().lower()
                    for key, plat in GAME_PLATFORM_MAP.items():
                        if key.lower() in game_clean:
                            plat_counter[plat] += 1
                            break
                if plat_counter:
                    sorted_plats = plat_counter.most_common()
                    primary = sorted_plats[0][0]
                    if len(sorted_plats) > 1:
                        secondary = sorted_plats[1][0]
                    confidence = 0.70  # 从游戏名推断

    # P3: Profile platform_preference + gameplay_preference
    if not primary:
        for trait in profile_preferences:
            if trait.get("trait_type") in ("platform_preference", "gameplay_preference"):
                stmt = trait.get("statement", "")
                plats = classify_platform_from_statement(stmt)
                if plats:
                    primary = plats[0]
                    if len(plats) > 1:
                        secondary = plats[1]
                    confidence = 0.80
                    break

    # P4: Profile usage_context + all context traits
    if not primary:
        for trait in profile_context:
            stmt = trait.get("statement", "")
            plats = classify_platform_from_statement(stmt)
            if plats:
                primary = plats[0]
                if len(plats) > 1 and not secondary:
                    secondary = plats[1]
                if confidence < 0.70:
                    confidence = 0.70
                break

    # P5: Profile perceptions_beliefs
    if not primary:
        for trait in profile_perceptions:
            stmt = trait.get("statement", "")
            plats = classify_platform_from_statement(stmt)
            if plats:
                primary = plats[0]
                if len(plats) > 1 and not secondary:
                    secondary = plats[1]
                if confidence < 0.65:
                    confidence = 0.65
                break

    # P6: 从 metadata 的时长和经历做辅助推断
    if not primary:
        gb = profile_metadata.get("gaming_background", {})
        if isinstance(gb, dict):
            hours = gb.get("peak_weekly_hours", "")
            duration = gb.get("experience_duration", "")
            # 高时长 + 长经历 → 更可能是PC玩家
            if "21小时及以上" in str(hours) and "9年以上" in str(duration):
                primary = "pc"
                confidence = 0.50
            # 低时长 → 更可能是手机玩家
            elif "不足7小时" in str(hours) or "不足3小时" in str(hours):
                primary = "mobile"
                confidence = 0.45

    return {"primary": primary, "secondary": secondary, "confidence": confidence}


def infer_platform_from_games(games_list):
    """从游戏列表推断平台（供外部使用）。"""
    plat_counter = Counter()
    for game in games_list:
        game_clean = game.strip().lower()
        for key, plat in GAME_PLATFORM_MAP.items():
            if key.lower() in game_clean:
                plat_counter[plat] += 1
                break
    if not plat_counter:
        return None
    return plat_counter.most_common(1)[0][0]


def infer_mode_from_games(games_list):
    """从游戏列表推断PVP/PVE模式偏好。"""
    mode_counter = Counter()
    for game in games_list:
        game_clean = game.strip().lower()
        for key, mode in GAME_MODE_MAP.items():
            if key.lower() in game_clean:
                mode_counter[mode] += 1
                break
    if not mode_counter:
        return None
    # 如果同时有PVP和PVE游戏，根据比例判断
    sorted_modes = mode_counter.most_common()
    top = sorted_modes[0][0]
    total = sum(mode_counter.values())
    top_count = sorted_modes[0][1]
    # 如果某类游戏占比超过70%，按该类判断；否则为balanced
    if top_count / total >= 0.7:
        return top
    return "balanced"


def map_mode(framework_mode, profile_preferences, profile_behaviors, profile_perceptions, profile_metadata):
    """
    映射模式偏好。
    优先级: framework.mode > 游戏名推断 > Profile statement
    返回: { structure: str|null, submodes: dict, confidence: float }
    """
    structure = None
    submodes = {}
    confidence = 0.0

    # P0: framework.mode.structure
    if framework_mode and framework_mode.get("structure"):
        raw_structure = max(set(framework_mode["structure"]),
                            key=framework_mode["structure"].count)
        cleaned = clean_mode_structure(raw_structure)
        if cleaned:
            structure = cleaned
            confidence = 0.95

    # framework.mode.submodes
    if framework_mode and framework_mode.get("submodes"):
        for raw in framework_mode["submodes"]:
            cleaned = clean_submode(raw)
            if cleaned and cleaned not in submodes:
                submodes[cleaned] = "like"

    # P1: 从 current_games 推断模式
    if not structure:
        gb = profile_metadata.get("gaming_background", {})
        if isinstance(gb, dict):
            games = gb.get("current_games", [])
            if games and isinstance(games, list):
                inferred = infer_mode_from_games(games)
                if inferred:
                    structure = inferred
                    confidence = 0.65

    # P2: Profile mode_preference + gameplay_preference
    if not structure:
        for trait in profile_preferences:
            if trait.get("trait_type") in ("mode_preference", "gameplay_preference"):
                stmt = trait.get("statement", "")
                modes = classify_mode_from_statement(stmt)
                if modes:
                    structure = modes[0]
                    confidence = 0.80
                    break

    # P3: Profile play_behavior
    if not structure:
        for trait in profile_behaviors:
            if trait.get("trait_type") in ("play_behavior", "current_behavior", "choice_behavior"):
                stmt = trait.get("statement", "")
                modes = classify_mode_from_statement(stmt)
                if modes:
                    structure = modes[0]
                    confidence = 0.70
                    break

    # P4: Profile perceptions_beliefs
    if not structure:
        for trait in profile_perceptions:
            stmt = trait.get("statement", "")
            modes = classify_mode_from_statement(stmt)
            if modes:
                structure = modes[0]
                confidence = 0.65
                break

    return {"structure": structure, "submodes": submodes, "confidence": confidence}


def map_iceberg(iceberg_groups):
    """
    聚合冰山心智链 M1-M5。
    返回: { M1: [...], M2: [...], M3: [...], M4: [...], M5: [...] }
    """
    iceberg = {"M1": [], "M2": [], "M3": [], "M4": [], "M5": []}

    m_map = {
        "M1_motivation": "M1",
        "M2_expectation": "M2",
        "M3_perception": "M3",
        "M4_feeling": "M4",
        "M5_behavior": "M5",
    }

    for group_key, group_data in (iceberg_groups or {}).items():
        for m_prefix, m_key in m_map.items():
            if group_key.startswith(m_prefix + ":"):
                iceberg[m_key].append({
                    "value": group_key.split(":", 1)[1],
                    "count": group_data.get("count", 1),
                    "quotes": group_data.get("quotes", [])[:3],
                })
                break

    # 按频次排序
    for key in iceberg:
        iceberg[key].sort(key=lambda x: -x["count"])

    return iceberg


def map_extended(framework_agg, product_tags_agg):
    """
    映射扩展研究维度。
    """
    extended = {}

    # 客观属性
    if product_tags_agg:
        extended["city_tier"] = product_tags_agg.get("city_tier", [None])[0]
        life_stage = product_tags_agg.get("life_stage", [None])[0]
        if life_stage and life_stage in LIFE_STAGE_CLEANUP_MAP:
            life_stage = LIFE_STAGE_CLEANUP_MAP[life_stage]
        extended["life_stage"] = life_stage
        extended["spending_level"] = product_tags_agg.get("spending_level", [None])[0]

    # 游戏资产
    if framework_agg and framework_agg.get("assets"):
        extended["assets"] = {}
        for ak in ["time", "ability_asset", "energy", "emotion", "money"]:
            vals = framework_agg["assets"].get(ak, [])
            if vals:
                extended["assets"][ak] = max(set(vals), key=vals.count)
            else:
                extended["assets"][ak] = "未知"

    return extended


# ============================================================
# 主转换函数
# ============================================================

def profile_to_tag_spec(profile, evidence_summary=None):
    """
    将单个 Profile JSON 转换为 2.0 TagSpec。

    输入: Profile JSON (来自 generate_profiles.py 的输出)
    输出: TagSpec dict (与 packages/shared/src/tag-spec.ts 的 tagSpecSchema 对齐)
    """
    prof = profile.get("profile", {})
    if not isinstance(prof, dict):
        prof = {}
    evidence = evidence_summary or profile.get("_evidence_summary", {})
    if not isinstance(evidence, dict):
        evidence = {}

    # 从 evidence_summary 中提取 framework 聚合数据
    framework_agg = evidence.get("framework_agg", {}) if isinstance(evidence, dict) else {}
    iceberg_groups = evidence.get("iceberg_groups", {}) if isinstance(evidence, dict) else {}
    product_tags_agg = evidence.get("product_tags_agg", {}) if isinstance(evidence, dict) else {}

    # 提取 Profile 各维度 (安全转换)
    def safe_list(val):
        if isinstance(val, list):
            return [x for x in val if isinstance(x, dict)]
        return []

    motivations = safe_list(prof.get("motivations_needs", []))
    capability = safe_list(prof.get("experience_capability", []))
    experience = [t for t in capability if t.get("trait_type") == "experience"]
    cap_traits = [t for t in capability if t.get("trait_type") == "capability"]
    preferences = safe_list(prof.get("preferences", []))
    behaviors = safe_list(prof.get("behaviors", []))
    context = safe_list(prof.get("context", []))
    perceptions = safe_list(prof.get("perceptions_beliefs", []))
    p_metadata = profile.get("metadata", {})
    if not isinstance(p_metadata, dict):
        p_metadata = {}

    # 映射 5 个主维度
    needs = map_needs(
        framework_agg.get("needs"),
        [t for t in motivations if t.get("trait_type") == "motivation"],
        prof,  # 传入完整 profile 用于扩展匹配
    )

    ability = map_ability(
        framework_agg.get("ability"),
        cap_traits,
        experience,
        p_metadata,
    )

    style = map_style(
        framework_agg.get("style"),
        preferences,
        behaviors,
    )

    platform = map_platform(
        framework_agg.get("platform"),
        preferences,
        context,
        perceptions,
        p_metadata,
    )

    mode = map_mode(
        framework_agg.get("mode"),
        preferences,
        behaviors,
        perceptions,
        p_metadata,
    )

    # 冰山心智链
    iceberg = map_iceberg(iceberg_groups)

    # 扩展维度
    extended = map_extended(framework_agg, product_tags_agg)

    # 构建 TagSpec
    tag_spec = {
        "version": 2,
        "needs": [],
        "ability": {
            "level": ability["level"],
            "strengths": ability["strengths"],
            "weaknesses": ability["weaknesses"],
        },
        "style": {
            "combat": style["combat"],
            "decision": style["decision"],
            "victory": style["victory"],
            "growth": style["growth"],
            "social": style["social"],
        },
        "platform": {
            "primary": platform["primary"],
            "secondary": platform["secondary"],
        },
        "mode": {
            "structure": mode["structure"],
            "submodes": mode["submodes"],
        },
    }

    # 填充 needs（首要 + 次要）
    if needs["primary"]:
        tag_spec["needs"].append(needs["primary"])
    for s in needs["secondary"]:
        if s not in tag_spec["needs"]:
            tag_spec["needs"].append(s)

    # 构建完整输出
    result = {
        "respondent_id": profile.get("respondent_id", ""),
        "display_name": profile.get("metadata", {}).get("display_name", ""),
        "_project_name": profile.get("_project_name", ""),
        "tag_spec": tag_spec,
        "iceberg": iceberg,
        "extended": extended,
        "confidence": {
            "needs": needs["confidence"],
            "ability": ability["confidence"],
            "style": style["confidence"],
            "platform": platform["confidence"],
            "mode": mode["confidence"],
        },
        "source": {
            "profile_version": profile.get("profile_version", ""),
            "source_segments_count": profile.get("source_segments_count", 0),
        },
    }

    return result


def tag_spec_to_frontend_format(tag_spec):
    """
    将 TagSpec 转换为前端标签选择器所需的格式。
    与 packages/shared/src/tag-spec.ts 的 normalizeTagSpec 对齐。
    """
    # 格式 1: 用于 AI 对话的 prompt
    needs_labels = {
        "ability_growth": "能力成长",
        "competitive_proof": "竞技证明",
        "dominance": "支配优越",
        "team_cooperation": "团队协作",
        "social_belonging": "社交归属",
        "stimulation": "射击爽感",
        "relaxation_escape": "放松逃避",
        "strategy_mastery": "策略掌控",
        "exploration_collection": "探索收集",
        "narrative_immersion": "叙事沉浸",
        "sensory_aesthetics": "视听审美",
        "expression_creation": "表达创造",
    }

    ts = tag_spec["tag_spec"]

    # 转换为前端用的扁平格式
    frontend = {
        "诉求": [needs_labels.get(n, n) for n in ts["needs"]],
        "能力": _level_to_chinese(ts["ability"]["level"]),
        "风格": _style_to_chinese_list(ts["style"]),
        "平台": ts["platform"]["primary"],
        "模式": _mode_to_chinese(ts["mode"]["structure"]),
    }

    return frontend


def _level_to_chinese(level):
    mapping = {
        "novice": "新手",
        "beginner": "入门",
        "intermediate": "进阶",
        "advanced": "高手",
        "expert_competitive": "专家/竞技级",
    }
    return mapping.get(level, "未知")


def _mode_to_chinese(mode):
    mapping = {
        "pve_only": "纯PVE",
        "pve_main": "PVE为主",
        "balanced": "PVP/PVE均衡",
        "pvp_main": "PVP为主",
        "pvp_only": "纯PVP",
        "context_dependent": "随场景变化",
    }
    return mapping.get(mode, "未知")


def _style_to_chinese_list(style):
    mapping = {
        "combat": {"passive": "苟活避战", "balanced": "灵活平衡", "aggressive": "主动求战/刚枪"},
        "decision": {"strategic": "仔细思考/策略", "contextual": "情境切换", "instinctive": "本能快速反应"},
        "victory": {"team": "团队协作取胜", "balanced": "团队个人平衡", "individual": "个人能力取胜"},
        "growth": {"progression": "数值养成", "mixed": "混合", "skill": "操作技巧对抗"},
        "social": {"friends": "熟人开黑", "flexible": "均可", "solo": "陌生人/单人"},
    }
    result = []
    for axis, axis_map in mapping.items():
        val = style.get(axis, "balanced")
        result.append(axis_map.get(val, val))
    return result


# ============================================================
# 批量处理函数
# ============================================================

def load_all_profiles(profile_dir):
    """加载所有 profile 文件。"""
    profiles = []
    for fname in sorted(os.listdir(profile_dir)):
        if not fname.endswith("_profiles.json"):
            continue
        fpath = os.path.join(profile_dir, fname)
        try:
            with open(fpath, "r") as f:
                data = json.load(f)
            project_name = fname.replace("_profiles.json", "")
            for p in data:
                p["_project_name"] = project_name
                profiles.append(p)
        except Exception as e:
            print(f"  ⚠️ Error loading {fname}: {e}")
    return profiles


def map_all_profiles(profiles, dry_run=False):
    """批量映射所有 profile。"""
    results = []
    stats = {
        "total": len(profiles),
        "needs_mapped": 0,
        "ability_mapped": 0,
        "style_mapped": 0,
        "platform_mapped": 0,
        "mode_mapped": 0,
        "needs_primary_dist": Counter(),
        "ability_level_dist": Counter(),
        "platform_dist": Counter(),
        "mode_dist": Counter(),
    }

    for i, profile in enumerate(profiles):
        if i % 50 == 0:
            print(f"  Processing {i}/{len(profiles)}...")

        result = profile_to_tag_spec(profile)
        ts = result["tag_spec"]

        # 统计
        if ts["needs"]:
            stats["needs_mapped"] += 1
            stats["needs_primary_dist"][ts["needs"][0]] += 1
        if ts["ability"]["level"]:
            stats["ability_mapped"] += 1
            stats["ability_level_dist"][ts["ability"]["level"]] += 1
        if ts["platform"]["primary"]:
            stats["platform_mapped"] += 1
            stats["platform_dist"][ts["platform"]["primary"]] += 1
        if ts["mode"]["structure"]:
            stats["mode_mapped"] += 1
            stats["mode_dist"][ts["mode"]["structure"]] += 1

        # 判断风格是否非默认（至少2个轴非 balanced）
        non_default = sum(1 for v in ts["style"].values() if v != "balanced" and v is not None)
        if non_default >= 2:
            stats["style_mapped"] += 1

        results.append(result)

    return results, stats


def save_results(results, output_dir):
    """保存映射结果。"""
    os.makedirs(output_dir, exist_ok=True)

    # 按项目分组保存
    by_project = defaultdict(list)
    for r in results:
        project = r.get("_project_name", "unknown")
        by_project[project].append(r)

    for project, items in by_project.items():
        fname = f"{project}_tags.json"
        fpath = os.path.join(output_dir, fname)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, indent=2)
        print(f"  ✅ Saved {len(items)} tags to {fname}")

    # 保存汇总
    summary_path = os.path.join(output_dir, "all_tags.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"  ✅ Saved {len(results)} tags to all_tags.json")


def print_stats(stats):
    """打印统计信息。"""
    total = stats["total"]
    print(f"\n{'=' * 60}")
    print(f"📊 映射统计 (共 {total} 个 Profile)")
    print(f"{'=' * 60}")

    print(f"\n  诉求映射率: {stats['needs_mapped']}/{total} ({stats['needs_mapped']/total*100:.1f}%)")
    if stats["needs_primary_dist"]:
        print("  首要诉求分布:")
        for val, cnt in stats["needs_primary_dist"].most_common(10):
            print(f"    {val}: {cnt} ({cnt/total*100:.1f}%)")

    print(f"\n  能力映射率: {stats['ability_mapped']}/{total} ({stats['ability_mapped']/total*100:.1f}%)")
    if stats["ability_level_dist"]:
        print("  能力等级分布:")
        for val, cnt in stats["ability_level_dist"].most_common():
            print(f"    {val}: {cnt} ({cnt/total*100:.1f}%)")

    print(f"\n  风格映射率: {stats['style_mapped']}/{total} ({stats['style_mapped']/total*100:.1f}%)")

    print(f"\n  平台映射率: {stats['platform_mapped']}/{total} ({stats['platform_mapped']/total*100:.1f}%)")
    if stats["platform_dist"]:
        print("  平台分布:")
        for val, cnt in stats["platform_dist"].most_common():
            print(f"    {val}: {cnt} ({cnt/total*100:.1f}%)")

    print(f"\n  模式映射率: {stats['mode_mapped']}/{total} ({stats['mode_mapped']/total*100:.1f}%)")
    if stats["mode_dist"]:
        print("  模式分布:")
        for val, cnt in stats["mode_dist"].most_common():
            print(f"    {val}: {cnt} ({cnt/total*100:.1f}%)")


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Profile → 2.0 TagSpec 映射转换")
    parser.add_argument("--dry-run", action="store_true", help="仅显示统计，不保存")
    parser.add_argument("--file", type=str, help="仅处理指定项目（部分名称匹配）")
    parser.add_argument("--output", type=str, default="", help="输出目录（默认 data/群体画像v2.0_tags）")
    parser.add_argument("--sample", type=int, default=0, help="仅处理前 N 个 profile 用于测试")
    args = parser.parse_args()

    output_dir = args.output or OUTPUT_DIR

    print("=" * 60)
    print("Profile → 2.0 TagSpec 映射转换")
    print(f"输入: {PROFILE_DIR}")
    print(f"输出: {output_dir}")
    print("=" * 60)

    # 加载 profiles
    print("\n📂 加载 Profile 文件...")
    profiles = load_all_profiles(PROFILE_DIR)

    if args.file:
        profiles = [p for p in profiles if args.file in p.get("_project_name", "")]
        if not profiles:
            print(f"❌ 没有匹配 '{args.file}' 的项目")
            sys.exit(1)

    if args.sample > 0:
        profiles = profiles[:args.sample]

    print(f"   共加载 {len(profiles)} 个 Profile")

    # 映射
    print("\n🔄 开始映射...")
    results, stats = map_all_profiles(profiles, dry_run=args.dry_run)

    # 打印统计
    print_stats(stats)

    # 保存
    if not args.dry_run:
        print(f"\n💾 保存结果到 {output_dir}...")
        save_results(results, output_dir)
        print("\n✅ 映射完成！")
    else:
        print("\n✅ Dry run 完成（未保存文件）")

    # 打印几个示例
    if results:
        print(f"\n{'=' * 60}")
        print("📝 示例输出（前 3 个）:")
        print(f"{'=' * 60}")
        for r in results[:3]:
            print(f"\n  [{r['respondent_id']}] {r['display_name']}")
            ts = r["tag_spec"]
            print(f"    诉求: {ts['needs']}")
            print(f"    能力: {ts['ability']['level']} (强项: {ts['ability']['strengths']}, 短板: {ts['ability']['weaknesses']})")
            print(f"    风格: 战斗={ts['style']['combat']}, 决策={ts['style']['decision']}, 取胜={ts['style']['victory']}, 成长={ts['style']['growth']}, 社交={ts['style']['social']}")
            print(f"    平台: {ts['platform']['primary']} (次: {ts['platform']['secondary']})")
            print(f"    模式: {ts['mode']['structure']} (子模式: {list(ts['mode']['submodes'].keys())[:5]})")
            print(f"    置信度: {r['confidence']}")
            print(f"    冰山M1: {len(r['iceberg']['M1'])} 条, M2: {len(r['iceberg']['M2'])} 条")


if __name__ == "__main__":
    main()