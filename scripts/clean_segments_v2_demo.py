#!/usr/bin/env python3
"""
按《数据清洗规范》v2.1-demo 批量清洗群体画像 v2.0 文件。

输入：data/群体画像v2.0_data/<项目>/<文件>.json（全部文件）
输出：
  - data/群体画像v2.0_cleaned/<项目>/<文件>_cleaned.json（v2.1-demo 清洗结果文件）
    格式：respondents 在前，segments 在后，不输出 original_text，含 summary
  - data/群体画像v2.0_cleaned/manifest.json（汇总统计）
"""

import json
import os
import re
import sys
import argparse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _load_dotenv():
    """加载项目根目录 .env 文件到环境变量。"""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


_load_dotenv()

# ---------------------------------------------------------------------------
# 路径配置（可通过 CLI 参数覆盖）
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_IN_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_data"
_DEFAULT_OUT_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_cleaned"

# 运行时设置（在 main() 中通过 argparse 更新）
IN_DIR = _DEFAULT_IN_DIR
OUT_DIR = _DEFAULT_OUT_DIR
TARGET_FILE = None


def _safe_rel(path: Path, base: Path = PROJECT_ROOT) -> str:
    """Return path relative to base, or absolute path if not under base."""
    try:
        return str(path.resolve().relative_to(base.resolve()))
    except ValueError:
        return str(path)

# ---------------------------------------------------------------------------
# 附录 A：游戏名标准化映射（常见称呼 -> 中文标准名）
# ---------------------------------------------------------------------------
GAME_NAME_MAP: dict[str, str] = {
    "瓦": "无畏契约",
    "瓦罗兰特": "无畏契约",
    "Valorant": "无畏契约",
    "瓦洛兰特": "无畏契约",
    "APEX": "Apex英雄",
    "Apex": "Apex英雄",
    "吃鸡": "绝地求生",
    "PUBG": "绝地求生",
    "CSGO": "CS",
    "CS:GO": "CS",
    "CS2": "CS",
    "彩六": "彩虹六号",
    "彩6": "彩虹六号",
    "R6": "彩虹六号",
    "Rainbow Six": "彩虹六号",
    "COD": "使命召唤",
    "Call of Duty": "使命召唤",
    "OW": "守望先锋",
    "守望": "守望先锋",
    "Overwatch": "守望先锋",
    "CF": "穿越火线",
    "穿越火线": "穿越火线",
    "塔科夫": "逃离塔科夫",
    "逃离塔科夫": "逃离塔科夫",
    "EFT": "逃离塔科夫",
    "暗区突围": "暗区突围",
    "三角洲": "三角洲行动",
    "三角洲行动": "三角洲行动",
    "战地": "战地",
    "Battlefield": "战地",
    "命运2": "命运2",
    "Destiny 2": "命运2",
    "枪神纪": "枪神纪",
    "绝地潜兵": "绝地潜兵",
    "Helldivers": "绝地潜兵",
    "地狱老司机": "绝地潜兵",
    "堡垒之夜": "堡垒之夜",
    "Fortnite": "堡垒之夜",
    "英雄联盟": "英雄联盟",
    "LOL": "英雄联盟",
    "League of Legends": "英雄联盟",
    "DOTA": "DOTA2",
    "DOTA2": "DOTA2",
    "王者荣耀": "王者荣耀",
    "永劫无间": "永劫无间",
    "星际战甲": "星际战甲",
    "Warframe": "星际战甲",
    "全境封锁": "全境封锁",
    "漫威争锋": "漫威争锋",
    "漫威争峰": "漫威争锋",
    "Marvel Rivals": "漫威争锋",
    "解限机": "解限机",
    "黑神话": "黑神话：悟空",
    "艾尔登法环": "艾尔登法环",
    "Elden Ring": "艾尔登法环",
    "只狼": "只狼",
    "黑暗之魂": "黑暗之魂",
    "怪物猎人": "怪物猎人",
    "鬼泣": "鬼泣",
    "GTA": "GTA",
    "无主之地": "无主之地",
    "Borderlands": "无主之地",
    "生化危机": "生化危机",
    "Resident Evil": "生化危机",
    "DOOM": "毁灭战士",
    "毁灭战士": "毁灭战士",
    "泰坦陨落": "泰坦陨落",
    "Titanfall": "泰坦陨落",
    "喷射战士": "喷射战士",
    "Splatoon": "喷射战士",
    "战争机器": "战争机器",
    "Gears of War": "战争机器",
    "猎杀对决": "猎杀对决",
    "Hunt: Showdown": "猎杀对决",
    "Minecraft": "我的世界",
    "我的世界": "我的世界",
    "Roblox": "Roblox",
    "方舟": "方舟",
    "ARK": "方舟",
    "The Finals": "The Finals",
    "Rust": "Rust",
    "DayZ": "DayZ",
    "暗黑破坏神": "暗黑破坏神",
    "Diablo": "暗黑破坏神",
    "流放之路": "流放之路",
    "POE": "流放之路",
    "Path of Exile": "流放之路",
    "最终幻想14": "最终幻想14",
    "FF14": "最终幻想14",
    "魔兽世界": "魔兽世界",
    "WOW": "魔兽世界",
    "剑网3": "剑网3",
    "天涯明月刀": "天涯明月刀",
    "逆水寒": "逆水寒",
    "DNF": "DNF",
    "原神": "原神",
    "崩坏": "崩坏",
    "星穹铁道": "星穹铁道",
    "绝区零": "绝区零",
    "鸣潮": "鸣潮",
    "卡拉彼丘": "卡拉彼丘",
    "尘白禁区": "尘白禁区",
    "枪火游侠": "枪火游侠",
    "Paladins": "枪火游侠",
    "死锁": "死锁",
    "Deadlock": "死锁",
    "星球大战": "星球大战",
    "Star Wars": "星球大战",
    "战锤": "战锤",
    "Warhammer": "战锤",
    "人间地狱": "人间地狱",
    "Hell Let Loose": "人间地狱",
    "Squad": "战术小队",
    "战术小队": "战术小队",
    "Arma": "武装突袭",
    "武装突袭": "武装突袭",
    "叛乱": "叛乱",
    "Insurgency": "叛乱",
    "坦克世界": "坦克世界",
    "战争雷霆": "战争雷霆",
    "300英雄": "300英雄",
    "分手厨房": "分手厨房",
    "Overcooked": "分手厨房",
    "链在一起": "链在一起",
    "Chain Together": "链在一起",
    "真·三国无双": "真·三国无双",
    "三国无双": "真·三国无双",
    "Game Boy": "Game Boy",
    "GNS2": "GNS2",
    "盾": "盾",
    # 补充 Deadlock 数据中出现的游戏名变体
    "咸鱼之王": "咸鱼之王",
    "逆战": "逆战",
    "永劫无间": "永劫无间",
    "神之浩劫": "神之浩劫",
    "虚幻争霸": "虚幻争霸",
    "LOL英雄联盟": "英雄联盟",
    "瓦罗兰特/无畏契约": "无畏契约",
    "OW守望先锋": "守望先锋",
    "APEX英雄": "Apex英雄",
}

# 为所有标准名添加自映射
for _std_name in set(GAME_NAME_MAP.values()):
    GAME_NAME_MAP.setdefault(_std_name, _std_name)

# 游戏名匹配顺序：长名称优先
GAME_NAME_KEYS = sorted(GAME_NAME_MAP.keys(), key=len, reverse=True)

# ---------------------------------------------------------------------------
# 附录 B：英译中术语映射
# ---------------------------------------------------------------------------
TERM_MAP: dict[str, str] = {
    "FPS": "FPS",
    "PVP": "PVP",
    "PVE": "PVE",
    "MMO": "MMO",
    "MOBA": "MOBA",
    "RPG": "RPG",
    "battle royale": "大逃杀",
    "extraction shooter": "搜打撤",
    "hero shooter": "英雄射击",
    "tactical shooter": "战术射击",
    "PC": "PC",
    "console": "主机",
    "mobile": "手机",
    "single player": "单机",
    "multiplayer": "多人",
    "co-op": "合作",
    "competitive": "竞技",
    "casual": "休闲",
    "ranked": "排位",
    "solo": "单排",
    "duo": "双排",
    "squad": "组队",
    "clan": "公会",
    "guild": "公会",
    "P2W": "氪金变强",
    "pay to win": "氪金变强",
    "free to play": "免费",
    "battle pass": "战令",
    "loot box": "开箱",
    "gacha": "抽卡",
    "grind": "肝",
    "noob": "新手",
    "pro": "高手",
    "carry": "带飞",
    "cheater": "外挂",
    "hacker": "外挂",
    "bug": "Bug",
    "glitch": "Bug",
    "lag": "卡顿",
    "smurf": "炸鱼",
    "boost": "代练",
    "patch": "补丁",
    "update": "更新",
    "DLC": "DLC",
    "MOD": "MOD",
    "UGC": "UGC",
    "NPC": "NPC",
    "meta": "Meta",
    "nerf": "削弱",
    "buff": "Buff",
    "skin": "皮肤",
    "gear": "装备",
    "loot": "掉落",
    "raid": "团本",
    "quest": "任务",
    "open world": "开放世界",
    "survival": "生存",
    "horror": "恐怖",
    "stealth": "潜行",
    "shooter": "射击",
    "gunplay": "枪感",
    "aiming": "瞄准",
    "recoil": "后坐力",
    "headshot": "爆头",
    "rank": "段位",
    "matchmaking": "匹配",
}

TERM_KEYS = sorted(TERM_MAP.keys(), key=len, reverse=True)

# ---------------------------------------------------------------------------
# 正则定义
# ---------------------------------------------------------------------------
NOISE_RE = re.compile(
    r"^[对是嗯好行可可以]+[，,。.]?$|"
    r"^[没不][有会是知道清楚懂行能]+[，,。.]?$|"
    r"^[啊哦嗯呃唉哎哟嘿]$",
    re.UNICODE,
)

EN_NOISE_RE = re.compile(
    r"^(Cool|Yeah|Yep|Yup|Nope|Yes|No|Okay|Ok|Sure|Right|Gotcha|Perfect|Fantastic|Great|Nice|"
    r"Thanks|Thank you|Sorry|Fine|Alright|All right|Absolutely|Exactly|Definitely|Totally|"
    r"Indeed|Correct|Fair|True|Maybe|Perhaps|Probably|Hello|Hi|Hey|Wow|What|Why|When|Where|"
    r"How|Who|Mmm|Mhmm|Hm|Huh)$",
    re.IGNORECASE,
)

FLOW_RE = re.compile(
    r"^(I'll start\.?|I will start\.?|Go ahead\.?|Dial-up\.?|Sorry\.?|Excuse me\.?|"
    r"You look great.*|That's funny\.?|That's great\.?|Oh, cool\.?|Oh, yeah\.?|"
    r"Yeah, yeah\.?|No, no\.?|There you go\.?|That's it\.?|No sleep\.?|All right\.?|"
    r"Is it the new DLC\?|Happy early birthday\.?|Thank you\.?|Probably not\.?|"
    r"Cool\. All right\.?|Ok\.?|Okay\.?|好的|好的好的|可以|可以可以|嗯嗯|对对|是是)$",
    re.IGNORECASE,
)

# 开头可删除的无语义填充词（§5.3）
FILLER_RE = re.compile(r"^(那个|怎么说呢|[嗯啊哦])+[，,。.]?\s*", re.UNICODE)

# 连续标点
MULTI_PUNCT_RE = re.compile(r"([，,。．！？；：""''（）()])\1+")
MULTI_SPACE_RE = re.compile(r" {2,}")

# ---------------------------------------------------------------------------
# §4.7 游戏相关性过滤 — 关键词
# ---------------------------------------------------------------------------
# 游戏相关关键词（命中任一即保留）
GAME_KEYWORDS_RE = re.compile(
    r"游戏|玩|枪|射击|英雄|技能|大招|段位|排位|匹配|队友|对手|地图|模式|"
    r"玩法|平衡|更新|版本|皮肤|装备|操作|手感|打击感|音效|画面|"
    r"MOBA|FPS|PVP|PVE|大逃杀|搜打撤|战术竞技|英雄射击|"
    r"上分|冲分|竞技|天梯|赛季|白金|钻石|大师|王者|青铜|白银|黄金|"
    r"补丁|削弱|加强|重做|新英雄|开黑|组队|单排|双排|"
    r"难度|上手|正反补|补刀|对线|打野|团战|经济|节奏|机制|动作|滑铲|近战|格挡|"
    r"压制|单局|时长|阶段|体验|感觉|MOBA味|FPS|"
    r"无畏契约|Apex|守望先锋|漫威争锋|使命召唤|战地|命运|死锁|三角洲|"
    r"CS|彩虹六号|穿越火线|逃离塔科夫|暗区突围|英雄联盟|DOTA|王者荣耀|"
    r"永劫无间|绝地求生|堡垒之夜|枪火游侠|神之浩劫|虚幻争霸|逆战|"
    r"咸鱼之王|云顶|摸金|大战场|僵尸猎场",
    re.IGNORECASE,
)

# 明显与游戏无关的生活/工作/社交内容关键词
IRRELEVANT_KEYWORDS_RE = re.compile(
    r"^(?:我昨天去|今天天气|最近在赶|期末考试|你最近怎么样|好久不见|"
    r"确实是这样|我同意你的|我觉得你说的|"
    r"我特别喜欢打篮球|我喜欢踢足球|我喜欢游泳|我喜欢跑步)",
)

# 模糊/不完整表达（用于 needs_review 判定）
VAGUE_PATTERNS = re.compile(
    r"^(?:就是那个|还行吧|不知道|不好说|看情况|差不多|可能吧|应该吧|"
    r"就那样|没感觉|没什么|不清楚)\s*[，,。.]?$"
)


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def classify_language(text: str) -> str:
    """判定文本语言：'zh' | 'en' | 'mixed'"""
    chinese_chars = sum(1 for c in text if "一" <= c <= "鿿")
    english_chars = sum(1 for c in text if c.isalpha() and ord(c) < 128)
    total = max(chinese_chars + english_chars, 1)
    if chinese_chars / total > 0.5:
        return "zh"
    elif english_chars / total > 0.5:
        return "en"
    else:
        return "mixed"


def normalize_game_names(text: str) -> str:
    """将文本中的游戏名统一为中文标准名（最长匹配 + 一次性替换）。"""
    matches = []
    for key in GAME_NAME_KEYS:
        std = GAME_NAME_MAP[key]
        if re.search(r"[a-zA-Z]", key):
            pat = re.compile(r"(?<![A-Za-z0-9])" + re.escape(key) + r"(?![A-Za-z0-9])", re.IGNORECASE)
            for m in pat.finditer(text):
                matches.append((m.start(), m.end(), std))
        else:
            key_lower = key.lower()
            lower_text = text.lower()
            start = 0
            while True:
                idx = lower_text.find(key_lower, start)
                if idx == -1:
                    break
                matches.append((idx, idx + len(key), std))
                start = idx + 1

    if not matches:
        return text

    matches.sort(key=lambda x: (x[0], -x[1]))
    filtered = []
    last_end = -1
    for start, end, std in matches:
        if start >= last_end:
            filtered.append((start, end, std))
            last_end = end

    result = []
    pos = 0
    for start, end, replacement in filtered:
        result.append(text[pos:start])
        result.append(replacement)
        pos = end
    result.append(text[pos:])
    return "".join(result)


def standardize_text(text: str) -> str:
    """Segment 文本轻度标准化（§5）。"""
    t = text.strip()
    t = MULTI_SPACE_RE.sub(" ", t)
    t = MULTI_PUNCT_RE.sub(r"\1", t)
    t = FILLER_RE.sub("", t)
    return t.strip()


def is_noise(text: str) -> bool:
    """确定性噪声判定（§4.5）。"""
    t = text.strip()
    if NOISE_RE.match(t):
        return True
    if EN_NOISE_RE.match(t):
        return True
    if re.fullmatch(r"[\s，,。．！？；：""''（）\(\)\.\-–—]+", t):
        return True
    return False


def is_flow(text: str) -> bool:
    """纯流程对话判定（§4.6）。"""
    return bool(FLOW_RE.match(text.strip()))


def is_game_irrelevant(original: str, cleaned: str, pq: Optional[str]) -> bool:
    """
    游戏相关性过滤（§4.7）。
    判定是否与游戏行为、体验、偏好、动机、决策无关。
    采用关键词 + 语义规则两级判定。

    §4.7.4：若 preceding_question 明确关于游戏，且回答是对该问题的直接应答（即使简短），保留。
    """
    text = cleaned if cleaned else original
    stripped = text.strip()

    # 先检查 PQ 是否有游戏上下文
    pq_has_game = bool(pq and GAME_KEYWORDS_RE.search(pq))

    # 若 PQ 明确关于游戏，直接回答即使简短也保留
    if pq_has_game:
        return False

    # 关键词命中 → 保留
    if GAME_KEYWORDS_RE.search(text):
        return False

    # 明显无关内容模式 → 删除
    if IRRELEVANT_KEYWORDS_RE.match(stripped):
        return True

    # 无 PQ 上下文、无游戏关键词、且极短（≤4 字）→ 可能无关
    if len(stripped) <= 4:
        return True

    return False


def rule_translate_en(text: str) -> str:
    """英文 Segment 的规则兜底翻译。"""
    t = text
    for key in TERM_KEYS:
        pat = re.compile(r"\b" + re.escape(key) + r"\b", re.IGNORECASE)
        t = pat.sub(TERM_MAP[key], t)
    t = normalize_game_names(t)
    t = re.sub(r"\b(um|uh|hmm|like,|you know,|I mean,|so,|well,)\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t


def translate_with_llm(texts: list[str]) -> list[str]:
    """英文/混合 Segment 中文化（demo 阶段使用规则兜底）。"""
    if not texts:
        return []
    return [rule_translate_en(t) for t in texts]


def normalize_and_translate(text: str, lang: str) -> str:
    """根据语言做标准化或中文化。"""
    t = standardize_text(text)
    if lang == "zh":
        t = normalize_game_names(t)
        return t
    elif lang in ("en", "mixed"):
        return rule_translate_en(t)
    return t


# ---------------------------------------------------------------------------
# 去重（§7）
# ---------------------------------------------------------------------------
def trigrams(text: str) -> set[str]:
    chars = list(text)
    if len(chars) < 3:
        return set()
    return {"".join(chars[i : i + 3]) for i in range(len(chars) - 2)}


def trigram_jaccard(a: str, b: str) -> float:
    ga, gb = trigrams(a), trigrams(b)
    if not ga or not gb:
        return 0.0
    inter = ga & gb
    union = ga | gb
    return len(inter) / len(union)


def is_superset(longer: str, shorter: str) -> bool:
    """信息超集保护：shorter 是否是 longer 的连续子串。"""
    return shorter in longer and len(longer) > len(shorter)


def dedupe(segments: list[dict]) -> None:
    """在 cleaned_text 上做去重，原地修改 cleaning_status。"""
    groups: dict[tuple[str, str | None], list[dict]] = defaultdict(list)
    for seg in segments:
        key = (seg.get("speaker_id") or "", seg.get("preceding_question"))
        groups[key].append(seg)

    for group in groups.values():
        # 第一层：完全重复
        seen: dict[str, dict] = {}
        for seg in group:
            if seg.get("cleaning_status") != "kept":
                continue
            ct = seg.get("cleaned_text") or ""
            if not ct:
                continue
            if ct in seen:
                seg["cleaning_status"] = "removed_duplicate"
                seg["cleaned_text"] = None
                seg["char_count"] = 0
            else:
                seen[ct] = seg

        # 第二层：近乎逐字复制（trigram Jaccard > 0.9）
        kept = [s for s in group if s.get("cleaning_status") == "kept"]
        kept.sort(key=lambda s: len(s.get("cleaned_text") or ""), reverse=True)
        for i in range(len(kept)):
            a = kept[i]
            if a.get("cleaning_status") != "kept":
                continue
            a_text = a.get("cleaned_text") or ""
            if len(a_text) < 15:
                continue
            for j in range(i + 1, len(kept)):
                b = kept[j]
                if b.get("cleaning_status") != "kept":
                    continue
                b_text = b.get("cleaned_text") or ""
                if len(b_text) < 15:
                    continue
                if is_superset(a_text, b_text) or is_superset(b_text, a_text):
                    continue
                sim = trigram_jaccard(a_text, b_text)
                if sim > 0.9:
                    b["cleaning_status"] = "removed_duplicate"
                    b["cleaned_text"] = None
                    b["char_count"] = 0


# ---------------------------------------------------------------------------
# needs_review 判定（§4.8）
# ---------------------------------------------------------------------------
def needs_review_heuristic(cleaned: str, original: str, pq: Optional[str]) -> bool:
    """简单启发式判定是否需要人工复核。"""
    if VAGUE_PATTERNS.match(cleaned):
        return True
    if re.match(r"^(?:那个|这个|他|它|他们|它们)\s*[，,。.]?$", cleaned):
        return True
    return False


# ---------------------------------------------------------------------------
# 自我介绍提取（§8）
# ---------------------------------------------------------------------------
SELF_INTRO_PQ_KEYWORDS = re.compile(
    r"介绍|游戏经历|背景|玩过哪些|introduce|background|gaming experience|"
    r"tell me about|about yourself|yourself|生活状态",
    re.IGNORECASE,
)


def is_self_intro_segment(seg: dict) -> bool:
    """识别自我介绍 Segment（§8.2）。"""
    pq = (seg.get("preceding_question") or "").lower()
    text = seg.get("original_text") or ""
    has_pq_keyword = bool(SELF_INTRO_PQ_KEYWORDS.search(pq))
    has_content_signal = bool(
        re.search(r"我叫|我是|今年|岁|职业|工作|玩|游戏|from|live in|years old|name is|I'm|I am", text)
    )
    return has_pq_keyword and has_content_signal


def extract_profile(text: str) -> dict[str, Any]:
    """从自我介绍文本提取 Profile 字段。"""
    profile: dict[str, Any] = {}
    m = re.search(r"我叫\s*([^，,。\s]{2,20})", text)
    if m:
        profile["name"] = m.group(1).strip()
    else:
        m = re.search(r"My name is\s+([A-Za-z\s]{2,30})[.,]?", text, re.IGNORECASE)
        if m:
            profile["name"] = m.group(1).strip()
    m = re.search(r"今年\s*(\d{1,3})\s*岁", text)
    if m:
        profile["age"] = int(m.group(1))
    else:
        m = re.search(r"I'm\s+(\d{1,3})\s+years? old", text, re.IGNORECASE)
        if m:
            profile["age"] = int(m.group(1))
    m = re.search(r"(男|女|男性|女性|male|female)", text, re.IGNORECASE)
    if m:
        g = m.group(1).lower()
        profile["gender"] = "男" if g in ("男", "男性", "male") else "女"
    m = re.search(r"(?:我是|做|从事|工作)[^，,。]*?([一-龥]{2,10}(?:员|师|工|家|经理|运营|开发|设计|学生|待业))", text)
    if m:
        profile["occupation"] = m.group(1).strip()
    else:
        m = re.search(r"I(?:'m a| work as| am a)\s+([A-Za-z\s]{2,30})[.,]?", text, re.IGNORECASE)
        if m:
            profile["occupation"] = m.group(1).strip()
    edu_pattern = r"(?:学历|教育|毕业|读|是)\s*[：:]?\s*(小学|初中|高中|中专|大专|本科|硕士|博士|研究生|college|bachelor|master|phd)"
    m = re.search(edu_pattern, text, re.IGNORECASE)
    if not m:
        m = re.search(r"^(小学|初中|高中|中专|大专|本科|硕士|博士|研究生|college|bachelor|master|phd)毕业", text, re.IGNORECASE)
    if m:
        edu = m.group(1)
        edu_map = {"college": "本科", "bachelor": "本科", "master": "硕士", "phd": "博士"}
        profile["education"] = edu_map.get(edu.lower(), edu)
    m = re.search(r"(?:在|住在|来自)\s*([一-龥]{2,10}(?:市|县|区|州))", text)
    if m:
        profile["location"] = m.group(1).strip()
    else:
        m = re.search(r"(?:from|live in)\s+([A-Za-z\s]{2,20})[.,]?", text, re.IGNORECASE)
        if m:
            profile["location"] = m.group(1).strip()
    return profile


def extract_gaming_background(text: str) -> dict[str, Any]:
    """从自我介绍文本提取 Gaming Background 字段。"""
    gb: dict[str, Any] = {}
    games = set()
    for key in GAME_NAME_KEYS:
        key_lower = key.lower()
        idx = text.lower().find(key_lower)
        if idx != -1:
            games.add(GAME_NAME_MAP[key])
    if games:
        gb["current_games"] = sorted(games)
    platforms = []
    platform_map = {
        "PC": "PC", "电脑": "PC", "主机": "主机", "console": "主机",
        "PS5": "PS5", "PS4": "PS4", "Xbox": "Xbox", "Switch": "Switch",
        "手机": "手机", "mobile": "手机", "iPad": "iPad", "Steam": "Steam",
    }
    for k, v in platform_map.items():
        if k in text and v not in platforms:
            platforms.append(v)
    if platforms:
        gb["platform"] = platforms
    m = re.search(r"玩了\s*(\d{1,3})\s*年", text)
    if m:
        gb["experience_years"] = int(m.group(1))
    else:
        m = re.search(r"been playing for\s+(\d{1,3})\s+years", text, re.IGNORECASE)
        if m:
            gb["experience_years"] = int(m.group(1))
    m = re.search(r"每天\s*(\d{1,2})\s*小时", text)
    if m:
        gb["daily_play_hours"] = int(m.group(1))
    m = re.search(r"每周\s*(\d{1,2})\s*小时", text)
    if m:
        gb["weekly_play_hours"] = int(m.group(1))
    genres = []
    genre_map = {
        "FPS": "FPS", "MOBA": "MOBA", "大逃杀": "大逃杀", "搜打撤": "搜打撤",
        "MMO": "MMO", "RPG": "RPG", "战术竞技": "战术竞技", "英雄射击": "英雄射击",
    }
    for k, v in genre_map.items():
        if k in text and v not in genres:
            genres.append(v)
    if genres:
        gb["genre_experience"] = genres
    return gb


def merge_value(existing: Any, new_val: Any, source: str = "self_intro") -> Any:
    """字段级合并（§8.6）。"""
    def is_empty(v: Any) -> bool:
        return v is None or v == "" or v == []

    if is_empty(existing):
        return new_val
    if is_empty(new_val):
        return existing
    if existing == new_val:
        return existing
    current = existing if not isinstance(existing, dict) else existing.get("value")
    return {
        "value": new_val,
        "source": source,
        "conflict": True,
        "conflict_values": [{"value": current, "source": "external"}],
    }


def merge_into_respondents(respondents: list[dict], extractions: dict[str, dict]) -> None:
    """将自我介绍提取结果合并到 respondents。"""
    by_id = {r["speaker_id"]: r for r in respondents}
    for speaker_id, extracted in extractions.items():
        if speaker_id not in by_id:
            continue
        r = by_id[speaker_id]
        profile = r.setdefault("profile", {})
        gb = r.setdefault("gaming_background", {})

        prof_ext = extracted.get("profile", {})
        for key, val in prof_ext.items():
            profile[key] = merge_value(profile.get(key), val)

        gb_ext = extracted.get("gaming_background", {})
        for key, val in gb_ext.items():
            if key == "current_games":
                existing = gb.get(key, [])
                if not isinstance(existing, list):
                    existing = []
                normalized_existing = {normalize_game_names(g) for g in existing}
                normalized_new = {normalize_game_names(g) for g in val}
                merged = sorted(normalized_existing | normalized_new)
                gb[key] = merged
            else:
                gb[key] = merge_value(gb.get(key), val)

        if extracted.get("self_intro_raw"):
            profile["self_intro_raw"] = extracted["self_intro_raw"]
        if extracted.get("gaming_self_intro_raw"):
            gb["gaming_self_intro_raw"] = extracted["gaming_self_intro_raw"]


# ---------------------------------------------------------------------------
# 档案清洗（§9）
# ---------------------------------------------------------------------------
_PROFILE_TIME_CONTEXT_RE = re.compile(r"开始|接触|玩|时候|小学.*电脑|初中.*开始|高中.*开始")
_PROFILE_ID_PATTERN_RE = re.compile(r"^(?:P\d+|G\d+-\w+|[A-Z]{1,2}\d+|[A-Za-z0-9]{2,6})$")


def _looks_like_respondent_id(value: str, respondent: dict) -> bool:
    value = value.strip()
    if not value:
        return False
    for key in ("speaker_id", "display_name"):
        id_val = respondent.get(key)
        if id_val and value == str(id_val).strip():
            return True
    profile = respondent.get("profile", {})
    name = profile.get("name")
    if name and value == str(name).strip():
        return True
    if _PROFILE_ID_PATTERN_RE.match(value):
        return True
    return False


def _validate_education(value: Any, age: Optional[int]) -> Any:
    if isinstance(value, dict):
        inner = value.get("value")
        new_inner = _validate_education(inner, age)
        if new_inner != inner:
            value = dict(value)
            value["value"] = new_inner
        return value
    if value is None or value == "":
        return value
    s = str(value).strip()
    if _PROFILE_TIME_CONTEXT_RE.search(s):
        return None
    if s in ("小学", "初中") and (age is None or age >= 18):
        return None
    return value


def _validate_occupation(value: Any, respondent: dict) -> Any:
    if isinstance(value, dict):
        inner = value.get("value")
        new_inner = _validate_occupation(inner, respondent)
        if new_inner != inner:
            value = dict(value)
            value["value"] = new_inner
        return value
    if value is None or value == "":
        return value
    s = str(value).strip()
    if _looks_like_respondent_id(s, respondent):
        return None
    if _PROFILE_TIME_CONTEXT_RE.search(s):
        return None
    return value


def clean_respondent_profile(respondent: dict) -> None:
    """清洗单个 respondent 的 profile / gaming_background 文本字段（§9）。"""
    profile = respondent.get("profile", {})
    if isinstance(profile, dict):
        age = profile.get("age")
        if age is not None:
            try:
                age = int(age)
            except (ValueError, TypeError):
                age = None
        profile["education"] = _validate_education(profile.get("education"), age)
        profile["occupation"] = _validate_occupation(profile.get("occupation"), respondent)

    gb = respondent.get("gaming_background", {})
    if isinstance(gb, dict):
        for key in ("current_games", "genre_experience"):
            vals = gb.get(key, [])
            if isinstance(vals, list):
                gb[key] = sorted({normalize_game_names(v) for v in vals})

        # §9.2 扩展：game_hours / weekly_hours 的字典键也需要游戏名标准化
        for key in ("game_hours", "weekly_hours"):
            orig = gb.get(key)
            if not isinstance(orig, dict):
                continue
            normalized: dict[str, Any] = {}
            for k, v in orig.items():
                new_k = normalize_game_names(k)
                if new_k not in normalized:
                    normalized[new_k] = v
                    continue
                existing = normalized[new_k]
                # 同一游戏出现多个原始键名时，数值型时长累加，其他保留第一个非空值
                if isinstance(existing, (int, float)) and isinstance(v, (int, float)):
                    normalized[new_k] = existing + v
                elif existing is None or existing == "":
                    normalized[new_k] = v
            gb[key] = normalized


def clean_all_respondents(respondents: list[dict]) -> None:
    for r in respondents:
        clean_respondent_profile(r)


# ---------------------------------------------------------------------------
# 文件输出（§10 — v2.1-demo 格式）
# ---------------------------------------------------------------------------
def translate_pq_for_output(pq: Optional[str]) -> Optional[str]:
    """将 preceding_question 翻译为中文并轻度标准化（文件输出用）。"""
    if not pq:
        return pq
    pq = standardize_text(pq)
    pq = normalize_game_names(pq)
    lang = classify_language(pq)
    if lang in ("en", "mixed"):
        pq = rule_translate_en(pq)
    return pq


def _make_output_segment(seg: dict, source_file: str) -> dict:
    """构造 v2.1-demo 文件输出用的 Segment 格式（不含 original_text）。"""
    return {
        "segment_id": f"{seg.get('speaker_id')}_{seg.get('segment_index')}",
        "source_file": source_file,
        "speaker_id": seg.get("speaker_id"),
        "preceding_question": translate_pq_for_output(seg.get("preceding_question")),
        "cleaned_text": seg.get("cleaned_text"),
        "cleaning_status": seg.get("cleaning_status"),
        "char_count": seg.get("char_count"),
    }


def _safe_filename(source_file: str) -> str:
    """从 source_file 路径提取纯文件名（不含扩展名）。"""
    basename = source_file.replace("\\", "/").split("/")[-1]
    # 去掉扩展名
    for ext in (".docx", ".xlsx", ".json", ".csv"):
        if basename.endswith(ext):
            basename = basename[: -len(ext)]
            break
    return basename


def write_cleaned_output(
    out_dir: Path,
    source_file: str,
    segments: list[dict],
    respondents: list[dict],
    seg_stats: dict[str, int],
) -> dict[str, Any]:
    """
    生成 v2.1-demo 单一清洗结果文件。
    放在与源文件相同的项目子目录下，格式：respondents 在前，segments 在后，
    不输出 original_text，含 summary。
    """
    # 提取项目子目录路径
    parts = source_file.replace("\\", "/").split("/")
    if len(parts) > 1:
        sub_dir = out_dir.joinpath(*parts[:-1])
    else:
        sub_dir = out_dir

    sub_dir.mkdir(parents=True, exist_ok=True)
    base_name = _safe_filename(source_file)
    cleaned_path = sub_dir / f"{base_name}_cleaned.json"

    output_segments: list[dict] = []
    for seg in segments:
        status = seg.get("cleaning_status")
        if status in ("kept", "needs_review"):
            output_segments.append(_make_output_segment(seg, source_file))

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if not output_segments:
        print(f"   ⚠️ 无有效内容，跳过文件输出")
        return {"cleaned_path": None, "cleaned_count": 0, "review_count": 0}

    # 构建 v2.1-demo 输出格式
    cleaned_count = sum(1 for s in output_segments if s["cleaning_status"] == "kept")
    review_count = sum(1 for s in output_segments if s["cleaning_status"] == "needs_review")

    output = {
        "source_file": source_file,
        "cleaned_at": timestamp,
        "pipeline_version": "2.1-demo",
        "respondents": respondents,
        "segment_count": len(output_segments),
        "segments": output_segments,
        "summary": {
            "total_segments": seg_stats.get("total_segments", 0),
            "kept": seg_stats.get("kept", 0),
            "needs_review": seg_stats.get("needs_review", 0),
            "removed_noise": seg_stats.get("removed_noise", 0),
            "removed_flow": seg_stats.get("removed_flow", 0),
            "removed_duplicate": seg_stats.get("removed_duplicate", 0),
            "removed_irrelevant": seg_stats.get("removed_irrelevant", 0),
        },
    }

    with open(cleaned_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    return {
        "cleaned_path": _safe_rel(cleaned_path),
        "cleaned_count": cleaned_count,
        "review_count": review_count,
    }


# ---------------------------------------------------------------------------
# 主清洗流程
# ---------------------------------------------------------------------------
def clean_segments(segments: list[dict]) -> dict[str, Any]:
    """清洗 Segment 列表，返回统计信息。"""
    stats = defaultdict(int)
    stats["total_segments"] = len(segments)

    # 收集需要 LLM 翻译的英文/混合文本
    en_segments = [(i, s) for i, s in enumerate(segments) if classify_language(s["original_text"]) in ("en", "mixed")]
    en_texts = [s["original_text"] for _, s in en_segments]
    translated = translate_with_llm(en_texts)
    en_translation_map = {idx: translated[pos] for pos, (idx, _) in enumerate(en_segments)}

    for i, seg in enumerate(segments):
        original = seg["original_text"]
        lang = classify_language(original)
        pq = seg.get("preceding_question")

        # ① 有效性判定：确定性噪声
        if is_noise(original):
            seg["cleaning_status"] = "removed_noise"
            seg["cleaned_text"] = None
            seg["char_count"] = 0
            stats["removed_noise"] += 1
            continue

        # ② 有效性判定：纯流程对话
        if is_flow(original):
            seg["cleaning_status"] = "removed_flow"
            seg["cleaned_text"] = None
            seg["char_count"] = 0
            stats["removed_flow"] += 1
            continue

        # ③ 标准化 + 中文化
        if lang in ("en", "mixed") and i in en_translation_map:
            cleaned = standardize_text(en_translation_map[i])
            cleaned = normalize_game_names(cleaned)
        else:
            cleaned = normalize_and_translate(original, lang)

        if not cleaned:
            seg["cleaning_status"] = "removed_noise"
            seg["cleaned_text"] = None
            seg["char_count"] = 0
            stats["removed_noise"] += 1
            continue

        # ④ 游戏相关性过滤（§4.7）
        if is_game_irrelevant(original, cleaned, pq):
            seg["cleaning_status"] = "removed_irrelevant"
            seg["cleaned_text"] = None
            seg["char_count"] = 0
            stats["removed_irrelevant"] += 1
            continue

        # ⑤ 判断是否需要人工复核（§4.8）
        if needs_review_heuristic(cleaned, original, pq):
            seg["cleaning_status"] = "needs_review"
            seg["cleaned_text"] = cleaned
            seg["char_count"] = len(cleaned)
            stats["needs_review"] += 1
            continue

        # ⑥ 有效内容统一标记为 kept（v2.1-demo 不区分 kept_short）
        seg["cleaned_text"] = cleaned
        seg["char_count"] = len(cleaned)
        seg["cleaning_status"] = "kept"
        stats["kept"] += 1

    # ⑦ 去重（在 cleaned_text 上）
    dedupe(segments)
    for seg in segments:
        if seg.get("cleaning_status") == "removed_duplicate":
            stats["removed_duplicate"] += 1
            stats["kept"] = max(0, stats["kept"] - 1)

    return dict(stats)


def clean_file(in_path: Path, out_path: Path) -> dict[str, Any]:
    """清洗单个文件。"""
    print(f"\n📂 输入: {_safe_rel(in_path)}")

    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = data.get("segments", [])
    respondents = data.get("respondents", [])

    # Segment 清洗
    seg_stats = clean_segments(segments)

    # 自我介绍提取（§8）
    intro_extractions: dict[str, dict] = defaultdict(
        lambda: {"profile": {}, "gaming_background": {}, "self_intro_raw": "", "gaming_self_intro_raw": ""}
    )
    for seg in segments:
        if seg.get("cleaning_status") != "kept":
            continue
        if is_self_intro_segment(seg):
            sid = seg.get("speaker_id")
            if not sid:
                continue
            original = seg.get("original_text", "")
            prof = extract_profile(original)
            gb = extract_gaming_background(original)
            existing = intro_extractions[sid]
            if existing["self_intro_raw"]:
                existing["self_intro_raw"] += "\n" + original
            else:
                existing["self_intro_raw"] = original
            for k, v in prof.items():
                if k not in existing["profile"]:
                    existing["profile"][k] = v
            for k, v in gb.items():
                if k not in existing["gaming_background"]:
                    existing["gaming_background"][k] = v
                elif k == "current_games":
                    existing["gaming_background"][k] = sorted(set(existing["gaming_background"][k]) | set(v))
            if existing["gaming_self_intro_raw"]:
                existing["gaming_self_intro_raw"] += "\n" + original
            else:
                existing["gaming_self_intro_raw"] = original

    merge_into_respondents(respondents, dict(intro_extractions))

    # 清洗 respondents（§9）
    clean_all_respondents(respondents)

    # 更新 meta
    meta = data.setdefault("meta", {})
    source_file = meta.get("source_file") or in_path.name
    meta["cleaning_version"] = "v2.1-demo"
    meta["cleaning_date"] = "2026-08-26"
    full_dist = {
        "total_segments": len(segments),
        "kept": seg_stats.get("kept", 0),
        "removed_noise": seg_stats.get("removed_noise", 0),
        "removed_flow": seg_stats.get("removed_flow", 0),
        "removed_duplicate": seg_stats.get("removed_duplicate", 0),
        "removed_irrelevant": seg_stats.get("removed_irrelevant", 0),
        "needs_review": seg_stats.get("needs_review", 0),
    }
    meta["cleaning_status_distribution"] = full_dist
    meta["valid_for_annotation"] = full_dist["kept"]

    # 写出完整审计文件（数据库/追溯用途）
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 生成 v2.1-demo 清洗结果文件
    file_outputs = write_cleaned_output(OUT_DIR, source_file, segments, respondents, full_dist)

    print(f"✅ 审计输出: {_safe_rel(out_path)}")
    print(f"   Segment 状态分布: {seg_stats}")
    print(f"   进入标注数 (kept): {full_dist['kept']}")
    if file_outputs['cleaned_path']:
        print(f"   v2.1-demo 清洗结果: {file_outputs['cleaned_path']}")
        print(f"     有效(kept): {file_outputs['cleaned_count']}, 待复核(needs_review): {file_outputs['review_count']}")

    return {
        "input_file": _safe_rel(in_path),
        "output_file": _safe_rel(out_path),
        "source_file": source_file,
        "total_segments": len(segments),
        "status_distribution": full_dist,
        "valid_for_annotation": meta["valid_for_annotation"],
        "file_outputs": file_outputs,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="数据清洗 v2.1-demo")
    parser.add_argument("--input-dir", type=str, default=str(_DEFAULT_IN_DIR),
                        help=f"输入目录 (默认: {_DEFAULT_IN_DIR})")
    parser.add_argument("--output-dir", type=str, default=str(_DEFAULT_OUT_DIR),
                        help=f"输出目录 (默认: {_DEFAULT_OUT_DIR})")
    parser.add_argument("--target-file", type=str, default=None,
                        help="只处理指定文件（相对 IN_DIR 的路径）")
    args = parser.parse_args()

    global IN_DIR, OUT_DIR, TARGET_FILE
    IN_DIR = Path(args.input_dir)
    OUT_DIR = Path(args.output_dir)
    TARGET_FILE = args.target_file

    # 收集所有待处理文件
    if TARGET_FILE:
        in_path = IN_DIR / TARGET_FILE
        if not in_path.exists():
            print(f"❌ 输入文件不存在: {in_path}")
            return 1
        input_files = [in_path]
    else:
        input_files = sorted(IN_DIR.rglob("*.json"))
        if not input_files:
            print(f"❌ 未找到 JSON 文件: {IN_DIR}")
            return 1

    print(f"🔍 找到 {len(input_files)} 个文件待处理\n")

    all_reports = []
    grand_total_segments = 0
    grand_kept = 0
    grand_needs_review = 0
    grand_removed_noise = 0
    grand_removed_flow = 0
    grand_removed_duplicate = 0
    grand_removed_irrelevant = 0
    files_with_output = 0
    errors = 0

    for in_path in input_files:
        try:
            # 审计文件路径
            rel_path = in_path.relative_to(IN_DIR)
            out_path = OUT_DIR / rel_path

            report = clean_file(in_path, out_path)
            all_reports.append(report)

            status_dist = report["status_distribution"]
            grand_total_segments += report["total_segments"]
            grand_kept += status_dist["kept"]
            grand_needs_review += status_dist.get("needs_review", 0)
            grand_removed_noise += status_dist["removed_noise"]
            grand_removed_flow += status_dist["removed_flow"]
            grand_removed_duplicate += status_dist["removed_duplicate"]
            grand_removed_irrelevant += status_dist.get("removed_irrelevant", 0)
            if report["file_outputs"]["cleaned_path"]:
                files_with_output += 1
        except Exception as e:
            print(f"❌ 处理失败: {_safe_rel(in_path)} — {e}")
            errors += 1

    # 生成汇总 manifest.json
    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)

    total_removed = grand_removed_noise + grand_removed_flow + grand_removed_duplicate + grand_removed_irrelevant
    manifest = {
        "pipeline": "segment_cleaning",
        "version": "2.1-demo",
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "input": {
            "total_segments": grand_total_segments,
            "source_files": len(input_files),
            "source_files_processed": len(input_files) - errors,
            "source_files_with_output": files_with_output,
        },
        "status_distribution": {
            "kept": grand_kept,
            "needs_review": grand_needs_review,
            "removed_noise": grand_removed_noise,
            "removed_flow": grand_removed_flow,
            "removed_duplicate": grand_removed_duplicate,
            "removed_irrelevant": grand_removed_irrelevant,
        },
        "output": {
            "valid_total": grand_kept,
            "valid_rate": f"{grand_kept / grand_total_segments * 100:.1f}%" if grand_total_segments else "0.0%",
            "removed_total": total_removed,
            "removed_rate": f"{total_removed / grand_total_segments * 100:.1f}%" if grand_total_segments else "0.0%",
            "needs_review_total": grand_needs_review,
            "needs_review_rate": f"{grand_needs_review / grand_total_segments * 100:.1f}%" if grand_total_segments else "0.0%",
        },
        "files": all_reports,
    }
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    # 打印汇总
    print(f"\n{'='*60}")
    print(f"📊 批量清洗完成")
    print(f"{'='*60}")
    print(f"  处理文件数: {len(input_files)} (成功: {len(input_files)-errors}, 失败: {errors})")
    print(f"  生成清洗结果: {files_with_output} 个文件")
    print(f"  总 Segment 数: {grand_total_segments}")
    print(f"  kept: {grand_kept} ({grand_kept/grand_total_segments*100:.1f}%)")
    print(f"  needs_review: {grand_needs_review} ({grand_needs_review/grand_total_segments*100:.1f}%)")
    print(f"  removed_noise: {grand_removed_noise} ({grand_removed_noise/grand_total_segments*100:.1f}%)")
    print(f"  removed_flow: {grand_removed_flow} ({grand_removed_flow/grand_total_segments*100:.1f}%)")
    print(f"  removed_duplicate: {grand_removed_duplicate} ({grand_removed_duplicate/grand_total_segments*100:.1f}%)")
    print(f"  removed_irrelevant: {grand_removed_irrelevant} ({grand_removed_irrelevant/grand_total_segments*100:.1f}%)")
    print(f"  ✅ 有效保留率: {grand_kept/grand_total_segments*100:.1f}%")
    print(f"  📄 manifest.json: {_safe_rel(manifest_path)}")
    print(f"{'='*60}")

    return 0 if errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())