#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix cleaned v2.0 files:
1. Remove pure acknowledgement / flow / irrelevant intro segments that were kept due to extraction issues.
2. Fill empty respondent profile / gaming_background fields from self-introduction segments.
"""
import json
import re
import os
import glob
import argparse
from collections import defaultdict

CLEAN_BASE = "data/群体画像v2.0_cleaned"
RAW_BASE = "data/群体画像v2.0_data"
MANIFEST = os.path.join(CLEAN_BASE, "manifest.json")

EN_NOISE_WORDS = {
    "cool", "yeah", "yep", "nope", "yes", "no", "okay", "ok", "sure", "right",
    "gotcha", "perfect", "fantastic", "great", "nice", "thanks", "sorry", "fine",
    "alright", "absolutely", "exactly", "definitely", "totally", "indeed", "correct",
    "fair", "true", "maybe", "perhaps", "probably", "hello", "hi", "hey", "wow",
    "what", "why", "when", "where", "how", "who", "mhmm", "mmm", "hm", "uhhuh",
    "yay",
}

EN_FLOW_PATTERNS = [
    "i'll start", "go ahead", "dial-up", "dial up", "excuse me", "thank you",
    "you're welcome", "you look great", "that's funny", "that's great", "oh cool",
    "oh yeah", "yeah yeah", "no no", "there you go", "that's it", "no sleep",
    "all right", "happy early birthday", "happy birthday", "probably not",
    "cool all right", "good shirt", "sure cool", "oh okay", "okay okay",
    "good evening", "good night", "good bye", "bye-bye", "bye", "see you",
    "you look", "nice shirt", "great shirt", "thanks for", "thank you for",
    "great game", "good game", "cool game", "nice game", "fun game",
]

ZH_NOISE_PATTERNS = {
    "对", "是的", "嗯", "嗯嗯", "好的", "好", "可以", "行", "没问题", "没有",
    "不知道", "不行", "不能", "不会", "不", "哦", "啊", "呃", "唉", "哎",
    "哟", "嘿", "哈", "谢谢", "多谢", "不客气", "辛苦了", "拜拜", "再见",
    "对谢谢", "对的对的", "对对", "好的好的", "嗯好的", "对的", "是的是的",
    "嗯嗯嗯", "对的", "是", "太棒了", "很棒", "不错", "挺好的", "真的吗",
    "真的假的", "这样啊", "好吧", "可以可以", "对对对", "是是是", "嗯嗯",
}

ZH_FLOW_PATTERNS = [
    "衬衫不错", "你看起来", "你看上去", "你最近怎么样", "好久不见", "大家好",
    "你们好", "很高兴认识", "很高兴见到", "幸会", "欢迎", "感谢你来",
    "感谢你们来", "感谢",
]

GAME_KEYWORDS = [
    "游戏", "玩", "打", "枪", "英雄", "角色", "段位", "排位", "匹配", "队友",
    "组队", "联机", "线上", "单人", "剧情", "通关", "过关", "关卡", "地图", "模式",
    "武器", "技能", "皮肤", "充钱", "氪", "抽卡", "公会", "clan", "pvp", "pve",
    "fps", "moba", "rpg", "竞技", "射击", "策略", "塔科夫", "暗区", "萤火", "绝地",
    "潜兵", "死锁", "deadlock", "apex", "valorant", "瓦", "守望", "先锋", "使命",
    "召唤", "cod", "战地", "给他爱", "gta", "马里奥", "马力欧", "宝可梦", "pokemon",
    "塞尔达", "zelda", "最终幻想", "final fantasy", "荒野大镖客", "red dead", "巫师",
    "witcher", "赛博朋克", "cyberpunk", "星空", "starfield", "异度", "xenoblade",
    "深岩", "deep rock", "暗黑", "darksiders", "博德", "baldur", "mario", "kart",
    "索尼克", "sonic", "任天堂", "nintendo", "playstation", "ps", "xbox", "switch",
    "主机", "电脑", "手机", "掌机", "战区", "warzone", "GTAV", "GTA5",
    "彩虹六号", "r6", "siege", "怪物猎人", "monster hunter", "命运", "destiny",
    "我的世界", "minecraft", "roblox", "艾尔登法环", "elden ring", "黑神话",
    "只狼", "黑暗之魂", "darksoul", "鬼泣", "devil may cry", "生化危机", "resident evil",
    "毁灭战士", "doom", "泰坦陨落", "titanfall", "喷射战士", "splatoon", "战争机器",
    "gears of war", "猎杀对决", "hunt showdown", "方舟", "ark", "the finals",
    "rust", "dayz", "暗黑破坏神", "diablo", "流放之路", "path of exile", "魔兽世界",
    "world of warcraft", "wow", "原神", "genshin", "崩坏", "honkai", "星穹铁道",
    "starrail", "绝区零", "zenless", "鸣潮", "wuthering", "卡拉彼丘", "尘白禁区",
    "枪火游侠", "paladins", "星球大战", "star wars", "战锤", "warhammer", "人间地狱",
    "hell let loose", "战术小队", "squad", "武装突袭", "arma", "叛乱", "insurgency",
    "坦克世界", "world of tanks", "战争雷霆", "war thunder", "300英雄", "分手厨房",
    "overcooked", "链在一起", "chained together", "无主之地", "borderlands",
    "模拟人生", "sims", "文明", "civilization", "全面战争", "total war",
    "上古卷轴", "elder scrolls", "skyrim", "辐射", "fallout", "光环", "halo", "战地",
    "battlefield", "使命召唤", "call of duty", "守望先锋", "overwatch",
    "无畏契约", "valorant", "瓦罗兰特", "绝地求生", "pubg", "cs", "csgo", "cs2",
    "穿越火线", "cf", "逃离塔科夫", "三角洲行动", "三角洲", "堡垒之夜", "fortnite",
    "英雄联盟", "lol", "dota", "王者荣耀", "永劫无间", "星际战甲", "warframe",
    "全境封锁", "division", "漫威争锋", "marvel rivals", "解限机", "黑神话：悟空",
    "怪物猎人", "鬼泣", "GTA", "生化危机", "DOOM", "泰坦陨落", "喷射战士",
    "战争机器", "猎杀对决", "Minecraft", "Roblox", "The Finals", "Rust", "DayZ",
    "暗黑破坏神", "流放之路", "最终幻想14", "ff14", "魔兽世界", "剑网3",
    "天涯明月刀", "逆水寒", "DNF", "原神", "崩坏", "星穹铁道", "绝区零", "鸣潮",
    "卡拉彼丘", "尘白禁区", "枪火游侠", "死锁", "星球大战", "战锤", "人间地狱",
    "Squad", "Arma", "叛乱", "坦克世界", "战争雷霆", "300英雄", "分手厨房",
    "链在一起", "给他爱",
]

INTRO_KEYWORDS = [
    "介绍", "introduce", "background", "gaming experience", "tell me about",
    "游戏经历", "自我介绍", "自我", "背景", "经历", "最近玩什么", "what you're playing",
    "what kind of games", "playing lately", "introduction", "welcome", "欢迎",
    "你好", "hi", "hello", "hey", "感谢你来", "thanks for coming", "tell us",
    "简单介绍", "简单自我", "自我说明",
]

GAME_NAME_MAP = {
    "瓦": "无畏契约", "valorant": "无畏契约", "瓦罗兰特": "无畏契约",
    "apex": "Apex英雄", "apex英雄": "Apex英雄",
    "吃鸡": "绝地求生", "pubg": "绝地求生", "绝地求生": "绝地求生",
    "csgo": "CS", "cs:go": "CS", "cs2": "CS", "cs": "CS",
    "彩六": "彩虹六号", "r6": "彩虹六号", "彩虹六号": "彩虹六号", "rainbow six": "彩虹六号",
    "cod": "使命召唤", "使命召唤": "使命召唤", "call of duty": "使命召唤",
    "ow": "守望先锋", "守望": "守望先锋", "守望先锋": "守望先锋", "overwatch": "守望先锋",
    "cf": "穿越火线", "穿越火线": "穿越火线",
    "塔科夫": "逃离塔科夫", "逃离塔科夫": "逃离塔科夫", "escape from tarkov": "逃离塔科夫",
    "暗区突围": "暗区突围", "暗区": "暗区突围",
    "三角洲行动": "三角洲行动", "三角洲": "三角洲行动",
    "战地": "战地", "battlefield": "战地",
    "命运2": "命运2", "命运": "命运2", "destiny 2": "命运2", "destiny": "命运2",
    "枪神纪": "枪神纪",
    "绝地潜兵": "绝地潜兵", "helldivers": "绝地潜兵",
    "堡垒之夜": "堡垒之夜", "fortnite": "堡垒之夜",
    "英雄联盟": "英雄联盟", "lol": "英雄联盟", "league of legends": "英雄联盟",
    "dota": "DOTA2", "dota2": "DOTA2", "DOTA": "DOTA2",
    "王者荣耀": "王者荣耀",
    "永劫无间": "永劫无间",
    "星际战甲": "星际战甲", "warframe": "星际战甲",
    "全境封锁": "全境封锁", "the division": "全境封锁",
    "漫威争锋": "漫威争锋", "marvel rivals": "漫威争锋",
    "解限机": "解限机",
    "黑神话": "黑神话：悟空", "黑神话：悟空": "黑神话：悟空",
    "艾尔登法环": "艾尔登法环", "elden ring": "艾尔登法环",
    "只狼": "只狼",
    "黑暗之魂": "黑暗之魂", "darksouls": "黑暗之魂", "dark souls": "黑暗之魂",
    "鬼泣": "鬼泣", "devil may cry": "鬼泣",
    "GTA": "GTA", "gtav": "GTA", "gta5": "GTA", "gta v": "GTA", "gta 5": "GTA",
    "给他爱": "GTA",
    "无主之地": "无主之地", "borderlands": "无主之地",
    "生化危机": "生化危机", "resident evil": "生化危机",
    "DOOM": "毁灭战士", "毁灭战士": "毁灭战士", "doom": "毁灭战士",
    "泰坦陨落": "泰坦陨落", "titanfall": "泰坦陨落",
    "喷射战士": "喷射战士", "splatoon": "喷射战士",
    "战争机器": "战争机器", "gears of war": "战争机器",
    "猎杀对决": "猎杀对决", "hunt showdown": "猎杀对决",
    "我的世界": "我的世界", "minecraft": "我的世界",
    "Roblox": "Roblox", "roblox": "Roblox",
    "方舟": "方舟", "ark": "方舟",
    "The Finals": "The Finals", "the finals": "The Finals",
    "Rust": "Rust", "rust": "Rust",
    "DayZ": "DayZ", "dayz": "DayZ",
    "暗黑破坏神": "暗黑破坏神", "diablo": "暗黑破坏神", "暗黑": "暗黑破坏神",
    "流放之路": "流放之路", "path of exile": "流放之路", "poe": "流放之路",
    "最终幻想": "最终幻想", "final fantasy": "最终幻想", "ff14": "最终幻想14",
    "魔兽世界": "魔兽世界", "world of warcraft": "魔兽世界", "wow": "魔兽世界",
    "剑网3": "剑网3",
    "天涯明月刀": "天涯明月刀",
    "逆水寒": "逆水寒",
    "DNF": "DNF", "dnf": "DNF",
    "原神": "原神", "genshin": "原神", "genshin impact": "原神",
    "崩坏": "崩坏", "honkai": "崩坏",
    "星穹铁道": "星穹铁道", "starrail": "星穹铁道", "honkai star rail": "星穹铁道",
    "绝区零": "绝区零", "zenless": "绝区零", "zenless zone zero": "绝区零",
    "鸣潮": "鸣潮", "wuthering": "鸣潮", "wuthering waves": "鸣潮",
    "卡拉彼丘": "卡拉彼丘",
    "尘白禁区": "尘白禁区",
    "枪火游侠": "枪火游侠", "paladins": "枪火游侠",
    "死锁": "死锁", "deadlock": "死锁",
    "星球大战": "星球大战", "star wars": "星球大战",
    "战锤": "战锤", "warhammer": "战锤",
    "人间地狱": "人间地狱", "hell let loose": "人间地狱",
    "战术小队": "战术小队", "squad": "战术小队",
    "武装突袭": "武装突袭", "arma": "武装突袭",
    "叛乱": "叛乱", "insurgency": "叛乱",
    "坦克世界": "坦克世界", "world of tanks": "坦克世界",
    "战争雷霆": "战争雷霆", "war thunder": "战争雷霆",
    "300英雄": "300英雄",
    "分手厨房": "分手厨房", "overcooked": "分手厨房",
    "链在一起": "链在一起", "chained together": "链在一起",
    "荒野大镖客": "荒野大镖客", "red dead": "荒野大镖客", "red dead redemption": "荒野大镖客",
    "巫师": "巫师", "the witcher": "巫师",
    "赛博朋克": "赛博朋克", "cyberpunk": "赛博朋克",
    "星空": "星空", "starfield": "星空",
    "异度": "异度神剑", "xenoblade": "异度神剑",
    "深岩": "深岩银河", "deep rock": "深岩银河", "deep rock galactic": "深岩银河",
    "暗黑血统": "暗黑血统", "darksiders": "暗黑血统",
    "博德": "博德之门", "baldur": "博德之门", "baldur's gate": "博德之门",
    "马力欧": "马力欧", "mario": "马力欧",
    "马里奥": "马力欧",
    "卡丁车": "马力欧卡丁车", "kart": "马力欧卡丁车", "mario kart": "马力欧卡丁车",
    "宝可梦": "宝可梦", "pokemon": "宝可梦", "pokémon": "宝可梦",
    "塞尔达": "塞尔达传说", "zelda": "塞尔达传说",
    "索尼克": "索尼克", "sonic": "索尼克",
    "战区": "使命召唤：战区", "warzone": "使命召唤：战区",
    "使命召唤：战区": "使命召唤：战区",
    "蜘蛛侠": "漫威蜘蛛侠", "spider-man": "漫威蜘蛛侠", "spiderman": "漫威蜘蛛侠",
    "最后生还者": "最后生还者", "the last of us": "最后生还者",
    "对马岛之魂": "对马岛之魂", "ghost of tsushima": "对马岛之魂",
    "战神": "战神", "god of war": "战神",
    "光环": "光环", "halo": "光环",
    "模拟人生": "模拟人生", "the sims": "模拟人生",
    "文明": "文明", "civilization": "文明",
    "全面战争": "全面战争", "total war": "全面战争",
    "上古卷轴": "上古卷轴", "elder scrolls": "上古卷轴", "skyrim": "上古卷轴5",
    "辐射": "辐射", "fallout": "辐射",
}
GAME_NAME_ALIASES = sorted(GAME_NAME_MAP.keys(), key=len, reverse=True)

PLATFORM_MAP = {
    "pc": "PC", "电脑": "PC",
    "主机": "主机", "console": "主机",
    "playstation": "主机", "ps5": "PS5", "ps4": "PS4", "ps3": "PS3", "ps2": "PS2",
    "xbox": "Xbox", "switch": "Switch", "nintendo": "Switch",
    "手机": "手机", "mobile": "手机", "掌机": "掌机", "handheld": "掌机",
}
PLATFORM_ALIASES = sorted(PLATFORM_MAP.keys(), key=len, reverse=True)

GENRE_MAP = {
    "fps": "FPS", "第一人称射击": "FPS", "射击": "FPS",
    "moba": "MOBA", "多人在线战术竞技": "MOBA",
    "rpg": "RPG", "角色扮演": "RPG", "jrpg": "JRPG", "动作角色扮演": "ARPG",
    "大逃杀": "大逃杀", "battle royale": "大逃杀",
    "搜打撤": "搜打撤", "extraction shooter": "搜打撤",
    "英雄射击": "英雄射击", "hero shooter": "英雄射击",
    "战术射击": "战术射击", "tactical shooter": "战术射击",
    "竞技": "竞技", "competitive": "竞技",
    "休闲": "休闲", "casual": "休闲",
    "单机": "单机", "single player": "单机",
    "多人": "多人", "multiplayer": "多人",
    "合作": "合作", "co-op": "合作", "coop": "合作",
    "开放世界": "开放世界", "open world": "开放世界",
    "生存": "生存", "survival": "生存",
    "恐怖": "恐怖", "horror": "恐怖",
    "策略": "策略", "strategy": "策略",
}
GENRE_ALIASES = sorted(GENRE_MAP.keys(), key=len, reverse=True)


def has_game_keyword(text):
    if not text:
        return False
    t = text.lower()
    return any(k in t for k in GAME_KEYWORDS)


def is_noise_or_flow(text):
    if not text:
        return None
    ct = text.strip()
    if not ct:
        return None
    # English all-noise tokens
    t = re.sub(r"[^\w\s']", " ", ct.lower())
    words = [w for w in t.split() if w]
    if words and all(w in EN_NOISE_WORDS for w in words):
        return "removed_noise"
    ct_lower = ct.lower()
    for ph in EN_FLOW_PATTERNS:
        if ph in ct_lower:
            return "removed_flow"
    # Chinese noise
    ct_nopunct = ct.strip("，,。.!！?？\s")
    if ct_nopunct in ZH_NOISE_PATTERNS or re.match(r"^[对是嗯好行可可以没不啊哦呃唉哎哟嘿哈]+[，,。.!！?？]*$", ct_nopunct):
        return "removed_noise"
    for ph in ZH_FLOW_PATTERNS:
        if ph in ct:
            return "removed_flow"
    return None


def is_intro_pq(pq):
    if not pq:
        return False
    p = pq.lower()
    return any(k.lower() in p for k in INTRO_KEYWORDS)


def looks_like_bad_display_name(s):
    s = s.strip()
    if len(s) > 20:
        return True
    if re.search(r"\b(it|this|that|is|was|reminded|me|of|and|the|a|an)\b", s.lower()):
        return True
    return False


def extract_age(text):
    m = re.search(r"(?:^|[^\w])i(?:'m| am)\s+(\d+)\b", text.lower())
    if m:
        return int(m.group(1))
    m = re.search(r"soon to be\s+(\d+)", text.lower())
    if m:
        return int(m.group(1))
    m = re.search(r"\b(\d+)\s*years?\s*old\b", text.lower())
    if m:
        return int(m.group(1))
    m = re.search(r"今年\s*(\d+)\s*岁", text)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*岁", text)
    if m:
        return int(m.group(1))
    m = re.search(r"马上\s*(\d+)\s*了", text)
    if m:
        return int(m.group(1))
    return None


NAME_BLACKLIST = {"Yeah", "Yes", "No", "Sure", "Right", "Cool", "Great", "Good",
                  "Okay", "Hello", "Hi", "Hey", "Thanks", "Thank", "What", "Why",
                  "When", "Where", "How", "Who"}


def extract_name(text):
    m = re.search(r"(?:^|\s)(?:hi,|hey,|hello,)?\s*I(?:'m| am)\s+([A-Z][A-Za-z0-9.\-]+(?:\s+[A-Z][A-Za-z0-9.\-]+)?)(?:[.,]|\s+(?:and|I\s|I'm|I'am|I\s+am|live|work|drove|come|play|from|years|year|soon)\b|$)", text)
    if m:
        name = m.group(1).strip(".,")
        if name not in NAME_BLACKLIST:
            return name
    m = re.search(r"My name(?: is|'s)\s+([A-Z][A-Za-z0-9.\-]+(?:\s+[A-Z][A-Za-z0-9.\-]+)?)(?:[.,]|\s+|$)", text)
    if m:
        name = m.group(1).strip(".,")
        if name not in NAME_BLACKLIST:
            return name
    m = re.search(r"我叫\s*([^，。,.\s]{2,20}?)(?:，|。|,|\.|\s+|$)", text)
    if m:
        return m.group(1).strip()
    m = re.search(r"我是\s*([^，。,.\s]{2,20}?)(?:，|。|,|\.|\s+|$)", text)
    if m:
        name = m.group(1).strip()
        if not re.search(r"学生|上班|自由|职业|一个|玩家|这里", name):
            return name
    return None


def extract_location(text):
    for pat in [r"I(?:'m)?\s+come?ing\s+from\s+([A-Z][A-Za-z\s]+?)(?:[.,]|\s+(?:and|I|to|for|with)\b|$)",
                r"I\s+drove\s+(?:here\s+)?from\s+([A-Z][A-Za-z\s]+?)(?:[.,]|\s+(?:and|I|to|for|with)\b|$)",
                r"I\s+live\s+in\s+([A-Z][A-Za-z\s]+?)(?:[.,]|\s+(?:and|I|to|for|with)\b|$)"]:
        m = re.search(pat, text)
        if m:
            loc = m.group(1).strip()
            loc = re.split(r"\s+(?:and|I|to|for|with)\b", loc)[0]
            return loc
    m = re.search(r"(?:住|来自|从)\s*在?\s*([^，。,.]{2,20}?)(?:[，。,.]|\s+|$)", text)
    if m:
        return m.group(1).strip()
    return None


def extract_games(text):
    found = set()
    for alias in GAME_NAME_ALIASES:
        if re.search(r'[一-龥]', alias):
            if alias in text:
                found.add(GAME_NAME_MAP[alias])
        else:
            if re.search(r'\b' + re.escape(alias) + r'\b', text, re.I):
                found.add(GAME_NAME_MAP[alias])
    return sorted(list(found))


def extract_platforms(text):
    found = set()
    for alias in PLATFORM_ALIASES:
        if re.search(r'[一-龥]', alias):
            if alias in text:
                found.add(PLATFORM_MAP[alias])
        else:
            if re.search(r'\b' + re.escape(alias) + r'\b', text, re.I):
                found.add(PLATFORM_MAP[alias])
    return sorted(list(found))


def extract_genres(text):
    found = set()
    for alias in GENRE_ALIASES:
        if re.search(r'[一-龥]', alias):
            if alias in text:
                found.add(GENRE_MAP[alias])
        else:
            if re.search(r'\b' + re.escape(alias) + r'\b', text, re.I):
                found.add(GENRE_MAP[alias])
    return sorted(list(found))


def extract_experience_years(text):
    m = re.search(r"玩了\s*(\d+)\s*年", text)
    if m:
        return int(m.group(1))
    m = re.search(r"been playing\s+(?:for\s+)?(\d+)\s*years?", text, re.I)
    if m:
        return int(m.group(1))
    return None


def is_empty_val(val):
    if val is None:
        return True
    if isinstance(val, str) and val.strip() == "":
        return True
    if isinstance(val, list) and len(val) == 0:
        return True
    if isinstance(val, dict) and len(val) == 0:
        return True
    return False


def merge_extracted(r, extracted):
    p = r.setdefault("profile", {})
    gb = r.setdefault("gaming_background", {})
    if is_empty_val(p.get("name")) and extracted.get("name"):
        p["name"] = extracted["name"]
    if is_empty_val(p.get("age")) and extracted.get("age"):
        p["age"] = extracted["age"]
    if is_empty_val(p.get("location")) and extracted.get("location"):
        p["location"] = extracted["location"]
    if is_empty_val(gb.get("current_games")) and extracted.get("current_games"):
        gb["current_games"] = extracted["current_games"]
    if is_empty_val(gb.get("platform")) and extracted.get("platform"):
        gb["platform"] = extracted["platform"]
    if is_empty_val(gb.get("genre_experience")) and extracted.get("genre_experience"):
        gb["genre_experience"] = extracted["genre_experience"]
    if is_empty_val(gb.get("experience_years")) and extracted.get("experience_years"):
        gb["experience_years"] = extracted["experience_years"]
    if extracted.get("intro_raw"):
        p["self_intro_raw"] = extracted["intro_raw"]
        gb["gaming_self_intro_raw"] = extracted["intro_raw"]
    if looks_like_bad_display_name(r.get("display_name", "")) and p.get("name"):
        r["display_name"] = p["name"]


def process_file(clean_path, raw_path, dry_run=False):
    with open(clean_path, "r", encoding="utf-8") as f:
        clean = json.load(f)
    if not os.path.exists(raw_path):
        return None, f"raw not found: {raw_path}"
    with open(raw_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    raw_segs_by_idx = {s["segment_index"]: s for s in raw.get("segments", [])}
    speaker_segments = defaultdict(list)
    for seg in clean.get("segments", []):
        m = re.match(r"^(.+)_(\d+)$", seg.get("segment_id", ""))
        if m:
            speaker_segments[m.group(1)].append((int(m.group(2)), seg))

    intro_indices = set()
    for spk, items in speaker_segments.items():
        items.sort(key=lambda x: x[0])
        for idx, seg in items[:12]:
            intro_indices.add(idx)
        for idx, seg in items:
            raw_seg = raw_segs_by_idx.get(idx)
            pq = raw_seg.get("preceding_question", "") if raw_seg else seg.get("preceding_question", "")
            if is_intro_pq(pq):
                intro_indices.add(idx)

    removed_counts = defaultdict(int)
    removed_examples = []
    for seg in clean.get("segments", []):
        if seg.get("cleaning_status") != "kept":
            continue
        m = re.match(r"^(.+)_(\d+)$", seg.get("segment_id", ""))
        idx = int(m.group(2)) if m else None
        raw_seg = raw_segs_by_idx.get(idx) if idx else None
        original_text = raw_seg.get("original_text", "") if raw_seg else ""
        cleaned_text = seg.get("cleaned_text", "") or ""

        status = is_noise_or_flow(cleaned_text)
        if not status and is_noise_or_flow(original_text):
            status = is_noise_or_flow(original_text)
        if not status and idx in intro_indices:
            if not has_game_keyword(cleaned_text) and not has_game_keyword(original_text):
                status = "removed_irrelevant"
        if status:
            removed_counts[status] += 1
            if len(removed_examples) < 10:
                removed_examples.append((seg["segment_id"], status, cleaned_text, original_text[:60]))
            if not dry_run:
                seg["cleaning_status"] = status
                seg["cleaned_text"] = None
                seg["char_count"] = 0

    respondent_extracts = defaultdict(lambda: {
        "name": None, "age": None, "location": None,
        "current_games": set(), "platform": set(), "genre_experience": set(),
        "experience_years": None, "intro_raw_parts": []
    })

    for seg in clean.get("segments", []):
        m = re.match(r"^(.+)_(\d+)$", seg.get("segment_id", ""))
        if not m:
            continue
        spk = m.group(1)
        idx = int(m.group(2))
        raw_seg = raw_segs_by_idx.get(idx)
        if not raw_seg:
            continue
        original_text = raw_seg.get("original_text", "")
        pq = raw_seg.get("preceding_question", "")
        if idx not in intro_indices and not is_intro_pq(pq):
            continue
        ex = respondent_extracts[spk]
        name = extract_name(original_text)
        if name:
            ex["name"] = name
        age = extract_age(original_text)
        if age:
            ex["age"] = age
        loc = extract_location(original_text)
        if loc:
            ex["location"] = loc
        ex["current_games"].update(extract_games(original_text))
        ex["platform"].update(extract_platforms(original_text))
        ex["genre_experience"].update(extract_genres(original_text))
        ey = extract_experience_years(original_text)
        if ey:
            ex["experience_years"] = ey
        ex["intro_raw_parts"].append(original_text)

    updated_respondents = 0
    resp_examples = []
    for r in clean.get("respondents", []):
        spk = r["speaker_id"]
        ex = respondent_extracts.get(spk)
        if not ex:
            continue
        extracted = {
            "name": ex["name"],
            "age": ex["age"],
            "location": ex["location"],
            "current_games": sorted(ex["current_games"]),
            "platform": sorted(ex["platform"]),
            "genre_experience": sorted(ex["genre_experience"]),
            "experience_years": ex["experience_years"],
            "intro_raw": " ".join(ex["intro_raw_parts"]) if ex["intro_raw_parts"] else None,
        }
        before = json.dumps(r, ensure_ascii=False, sort_keys=True)
        merge_extracted(r, extracted)
        after = json.dumps(r, ensure_ascii=False, sort_keys=True)
        if before != after:
            updated_respondents += 1
            if len(resp_examples) < 5:
                resp_examples.append((spk, r.get("profile", {}), r.get("gaming_background", {})))

    if not dry_run:
        kept = sum(1 for s in clean.get("segments", []) if s.get("cleaning_status") == "kept")
        clean["segment_count"] = kept
        with open(clean_path, "w", encoding="utf-8") as f:
            json.dump(clean, f, ensure_ascii=False, indent=2)

    return {
        "file": clean_path,
        "removed_counts": dict(removed_counts),
        "removed_examples": removed_examples,
        "updated_respondents": updated_respondents,
        "respondent_examples": resp_examples,
    }, None


def update_manifest(manifest_path, dry_run=False):
    if not os.path.exists(manifest_path):
        return
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    total = {"kept": 0, "needs_review": 0, "removed_noise": 0, "removed_flow": 0,
             "removed_duplicate": 0, "removed_irrelevant": 0}
    for entry in manifest.get("files", []):
        cp = entry.get("file_outputs", {}).get("cleaned_path")
        if not cp:
            continue
        full = os.path.join("/Users/jessicajyan/tengxun_yp_6Gang", cp)
        if not os.path.exists(full):
            continue
        with open(full, "r", encoding="utf-8") as f:
            data = json.load(f)
        dist = defaultdict(int)
        for s in data.get("segments", []):
            dist[s.get("cleaning_status", "kept")] += 1
        entry["total_segments"] = sum(dist.values())
        entry["valid_for_annotation"] = dist.get("kept", 0) + dist.get("needs_review", 0)
        sd = entry.setdefault("status_distribution", {})
        for k in total:
            sd[k] = dist.get(k, 0)
            total[k] += sd[k]
    manifest["output"]["valid_total"] = total["kept"]
    manifest["output"]["removed_total"] = sum(v for k, v in total.items() if k != "kept")
    manifest["output"]["needs_review_total"] = total["needs_review"]
    manifest["status_distribution"] = total
    if not dry_run:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--file", help="process single cleaned file path")
    args = parser.parse_args()

    if args.file:
        clean_files = [args.file]
    else:
        clean_files = sorted(glob.glob(os.path.join(CLEAN_BASE, "**/*_cleaned.json"), recursive=True))

    reports = []
    for clean_path in clean_files:
        rel = os.path.relpath(clean_path, CLEAN_BASE)
        raw_rel = rel.replace("_cleaned.json", ".json")
        raw_path = os.path.join(RAW_BASE, raw_rel)
        report, err = process_file(clean_path, raw_path, dry_run=args.dry_run)
        if err:
            print(f"SKIP {clean_path}: {err}")
            continue
        if report and (report["removed_counts"] or report["updated_respondents"]):
            reports.append(report)

    if args.file:
        if reports:
            print(json.dumps(reports[0], ensure_ascii=False, indent=2))
    else:
        print(f"\nProcessed {len(clean_files)} files; {len(reports)} files had changes.")
        for r in reports:
            print(f"\n{r['file']}")
            print("  removed:", r["removed_counts"])
            print("  updated respondents:", r["updated_respondents"])
            for ex in r["removed_examples"][:5]:
                print("    -", ex[0], ex[1], repr(ex[2]), "| og:", repr(ex[3]))
            for spk, prof, gb in r["respondent_examples"][:3]:
                print("    respondent", spk, "->", prof, gb)

    update_manifest(MANIFEST, dry_run=args.dry_run)
    if args.dry_run:
        print("\n[DRY-RUN] no files modified")
    else:
        print("\nManifest updated")


if __name__ == "__main__":
    main()
