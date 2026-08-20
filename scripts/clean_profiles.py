#!/usr/bin/env python3
"""深度清洗 respondents profile：全中文 + 去口语词"""
import json
import os
import re

BASE = os.path.expanduser("~/projects/tengxun_yp_6Gang/data/群体画像")

FILES = [
    "respondents_漫威争锋中美用户洞察研究.json",
    "respondents_美国HD端射击市场用户细分研究.json",
    "respondents_美国HD端用户生态与决策链路研究.json",
]

# 英文→中文
EN_MAP = {
    "game boy": "Game Boy",
    "playstation": "PlayStation",
    "xbox": "Xbox",
    "nintendo": "任天堂",
    "steam": "Steam",
    "switch": "Switch",
    "pc": "PC",
    "fps": "FPS",
    "pvp": "PVP",
    "pve": "PVE",
    "mmo": "MMO",
    "mmorpg": "MMORPG",
    "moba": "MOBA",
    "br": "大逃杀",
    "rpg": "RPG",
    "csgo": "CSGO",
    "cs": "CS",
    "cod": "COD",
    "pubg": "PUBG",
    "apex": "Apex",
    "valorant": "瓦",
    "overwatch": "守望先锋",
    "tarkov": "塔科夫",
    "fortnite": "堡垒之夜",
    "rust": "Rust",
    "dayz": "DayZ",
    "halo": "光环",
    "warframe": "星际战甲",
    "helldivers": "绝地潜兵",
    "destiny": "命运",
    "battlefield": "战地",
    "rainbow six": "彩虹六号",
    "titanfall": "泰坦陨落",
    "splatoon": "喷射战士",
    "deadlock": "死锁",
    "minecraft": "我的世界",
    "roblox": "Roblox",
    "gta": "GTA",
    "dota": "DOTA",
    "lol": "LOL",
    "wow": "魔兽世界",
    "ff14": "FF14",
    "dnf": "DNF",
    "ps5": "PS5",
    "ps4": "PS4",
    "ipad": "iPad",
    "iphone": "iPhone",
    "android": "安卓",
    "ios": "iOS",
    "cpu": "CPU",
    "gpu": "显卡",
    "ram": "内存",
    "fps": "帧率",
    "ping": "延迟",
    "elo": "ELO",
    "kd": "KD",
    "ttk": "TTK",
    "hud": "HUD",
    "ui": "UI",
    "p2w": "氪金变强",
    "dlc": "DLC",
    "mod": "MOD",
    "ugc": "UGC",
    "pve": "PVE",
    "pvp": "PVP",
    "npc": "NPC",
    "boss": "Boss",
    "buff": "Buff",
    "nerf": "削弱",
    "meta": "Meta",
    "rank": "段位",
    "solo": "单排",
    "duo": "双排",
    "squad": "组队",
    "clan": "公会",
    "guild": "公会",
    "raid": "团本",
    "quest": "任务",
    "loot": "掉落",
    "gear": "装备",
    "skin": "皮肤",
    "battle pass": "战令",
    "season pass": "战令",
    "loot box": "开箱",
    "gacha": "抽卡",
    "grind": "肝",
    "noob": "新手",
    "pro": "高手",
    "carry": "带飞",
    "feed": "送人头",
    "afk": "挂机",
    "gg": "GG",
    "ez": "EZ",
    "op": "太强",
    "imba": "不平衡",
    "cheater": "外挂",
    "hacker": "外挂",
    "bug": "Bug",
    "glitch": "Bug",
    "lag": "卡顿",
    "crash": "崩溃",
    "toxic": "不良",
    "flame": "喷人",
    "troll": "捣乱",
    "smurf": "炸鱼",
    "boost": "代练",
    "account": "账号",
    "server": "服务器",
    "patch": "补丁",
    "update": "更新",
    "dlc": "DLC",
    "expansion": "资料片",
    "sequel": "续作",
    "prequel": "前传",
    "remake": "重制",
    "remaster": "复刻",
    "indie": "独立游戏",
    "aaa": "3A",
    "early access": "抢先体验",
    "beta": "测试",
    "alpha": "内测",
    "demo": "试玩",
    "full release": "正式版",
    "free to play": "免费",
    "pay to play": "付费",
    "subscription": "订阅",
    "microtransaction": "微交易",
    "cosmetic": "外观",
    "pay to win": "氪金变强",
    "single player": "单机",
    "multiplayer": "多人",
    "co-op": "合作",
    "coop": "合作",
    "competitive": "竞技",
    "casual": "休闲",
    "ranked": "排位",
    "unranked": "匹配",
    "quick play": "快速",
    "custom game": "自定义",
    "private match": "私房",
    "training": "训练",
    "tutorial": "教程",
    "sandbox": "沙盒",
    "open world": "开放世界",
    "linear": "线性",
    "procedural": "随机生成",
    "roguelike": "Roguelike",
    "roguelite": "Roguelite",
    "soulslike": "魂类",
    "metroidvania": "类银河城",
    "survival": "生存",
    "horror": "恐怖",
    "stealth": "潜行",
    "action": "动作",
    "adventure": "冒险",
    "strategy": "策略",
    "simulation": "模拟",
    "sports": "体育",
    "racing": "竞速",
    "fighting": "格斗",
    "puzzle": "解谜",
    "platformer": "平台跳跃",
    "shooter": "射击",
    "rpg": "RPG",
    "jrpg": "JRPG",
    "arpg": "ARPG",
    "crpg": "CRPG",
    "tps": "TPS",
    "rts": "RTS",
    "tbs": "回合制",
    "tcg": "卡牌",
    "ccg": "卡牌",
    "visual novel": "视觉小说",
    "walking sim": "步行模拟",
    "idle": "放置",
    "clicker": "点击",
    "gacha": "抽卡",
    "hero shooter": "英雄射击",
    "tactical shooter": "战术射击",
    "battle royale": "大逃杀",
    "extraction shooter": "搜打撤",
    "looter shooter": "刷宝射击",
    "arena shooter": "竞技场射击",
    "milsim": "军事模拟",
}


def clean(text: str) -> str:
    t = text

    # 去掉【画像】前缀
    t = re.sub(r'^【画像】\s*', '', t)

    # 去掉自我介绍套话（保留游戏相关内容）
    t = re.sub(r'大家好[,，]?\s*我(的)?(名字)?(叫|是)\s*.{2,30}(?=[,，。])', '', t)
    t = re.sub(r'大家好[,，]?\s*', '', t)
    t = re.sub(r'我(今年)?\d{1,3}岁[,，]?\s*', '', t)
    t = re.sub(r'我的兴趣(爱好)?(就)?是[:：]?\s*', '', t)

    # 去掉纯口语填充词
    t = re.sub(r'(?<![，。、\w])那个[,，]?\s*', '', t)
    t = re.sub(r'(?<![，。、\w])就是[,，]?\s*', '', t)
    t = re.sub(r'怎么说呢[,，]?\s*', '', t)
    t = re.sub(r'然后[,，]?\s*', '', t)
    t = re.sub(r'反正[,，]?\s*', '', t)
    t = re.sub(r'说白了[,，]?\s*', '', t)
    t = re.sub(r'说实话[,，]?\s*', '', t)
    t = re.sub(r'讲道理[,，]?\s*', '', t)
    t = re.sub(r'基本上[,，]?\s*', '', t)
    t = re.sub(r'差不多[,，]?\s*', '', t)
    t = re.sub(r'算是[,，]?\s*', '', t)
    t = re.sub(r'怎么说[,，]?\s*', '', t)
    t = re.sub(r'而且[,，]?\s*', '', t)
    t = re.sub(r'所以[,，]?\s*', '', t)
    t = re.sub(r'因为[,，]?\s*', '', t)
    t = re.sub(r'但是[,，]?\s*', '', t)
    t = re.sub(r'不过[,，]?\s*', '', t)
    t = re.sub(r'其实[,，]?\s*', '', t)
    t = re.sub(r'确实[,，]?\s*', '', t)
    t = re.sub(r'当然[,，]?\s*', '', t)
    t = re.sub(r'可能[,，]?\s*', '', t)
    t = re.sub(r'应该[,，]?\s*', '', t)
    t = re.sub(r'大概[,，]?\s*', '', t)
    t = re.sub(r'感觉[,，]?\s*', '', t)
    t = re.sub(r'觉得[,，]?\s*', '', t)

    # 去掉句末语气词
    t = re.sub(r'[啊嗯哦呃嘛呗啦哈呀呢吧]', '', t)

    # 英文→中文（保留缩写）
    for en, cn in sorted(EN_MAP.items(), key=lambda x: -len(x[0])):
        t = re.sub(rf'\b{re.escape(en)}\b', cn, t, flags=re.IGNORECASE)

    # 清理标点
    t = re.sub(r'[,，]{2,}', '，', t)
    t = re.sub(r'[。]{2,}', '。', t)
    t = re.sub(r'\s{2,}', '', t)
    t = re.sub(r'^[,，。！？\s]+', '', t)
    t = re.sub(r'[,，。！？\s]+$', '', t)
    t = re.sub(r'（当时细糠）', '', t)
    t = re.sub(r'[（(][^)）]{0,10}[)）]', '', t)  # 去掉括号注释
    t = re.sub(r'[,，]$', '', t)
    t = t.strip()

    if t and not t.endswith('。'):
        t += '。'

    return t


def extract_games(text: str) -> list[str]:
    GAMES = [
        "漫威争锋", "漫威争峰", "守望先锋", "CS", "CSGO", "CS2", "Valorant", "瓦洛兰特",
        "Apex", "塔科夫", "逃离塔科夫", "暗区突围", "三角洲行动", "三角洲",
        "使命召唤", "COD", "战地", "彩虹六号", "彩六", "R6",
        "命运2", "命运", "枪神纪", "绝地潜兵", "穿越火线", "CF",
        "堡垒之夜", "绝地求生", "PUBG", "The Finals", "Rust", "DayZ",
        "英雄联盟", "LOL", "DOTA", "王者荣耀", "OW",
        "链在一起", "分手厨房", "永劫无间", "星际战甲", "全境封锁",
        "黑神话", "艾尔登法环", "只狼", "黑暗之魂", "怪物猎人", "鬼泣",
        "GTA", "无主之地", "生化危机", "地铁", "DOOM", "毁灭战士",
        "泰坦陨落", "喷射战士", "战争机器", "猎杀对决",
        "Roblox", "Minecraft", "我的世界", "方舟",
        "枪火游侠", "永劫", "死锁", "星球大战", "战锤",
        "人间地狱", "Squad", "战术小队", "Arma", "武装突袭",
        "叛乱", "坦克世界", "战争雷霆",
        "卡拉彼丘", "尘白禁区", "原神", "崩坏", "星穹铁道", "绝区零", "鸣潮",
        "暗黑破坏神", "Diablo", "流放之路", "POE", "最终幻想", "FF14",
        "魔兽世界", "WOW", "剑网3", "天涯明月刀", "逆水寒", "DNF",
        "地狱老司机", "Helldivers", "暗黑", "Diablo",
        "英雄射击", "搜打撤", "大逃杀", "大战场",
        "手机", "PC", "主机", "Switch", "PS5", "PS4", "Xbox",
        "Steam Deck", "ROG Ally", "iPad",
    ]
    found = set()
    for game in GAMES:
        if game.lower() in text.lower():
            found.add(game)
    return sorted(found)


def clean_en(text: str) -> str:
    """清洗英文 profile"""
    t = text
    t = re.sub(r'^【画像】\s*', '', t)
    # 去掉口语套话
    t = re.sub(r'\b(Yeah|Yep|Yay|Cool|Nice|Great|Perfect|Alright|Okay|OK|Right|Fine|Sure|Fair enough|Good|Oh|Ah|Um|Uh|Hmm|Huh|Wow|Damn|Shit|Fuck)\b[,!.]?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'\b(you know|like|I mean|kind of|sort of|basically|literally|actually|honestly|pretty much|stuff like that|and stuff|or whatever|or something|and all that|you guys|guys|man|dude|bro)\b\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(Hi|Hello|Hey|My name is|I am|I\'m)\s+[A-Z][a-z]*[.,]?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'I\'m \d+ years? old[.,]?\s*', '', t, flags=re.IGNORECASE)
    t = re.sub(r'[.!]{2,}', '.', t)
    t = re.sub(r'^[,;:.\s]+', '', t)
    t = re.sub(r'[,;:.\s]+$', '', t)
    t = t.strip()
    if t and not t.endswith('.') and not t.endswith('?') and not t.endswith('!'):
        t += '.'
    return t


def is_english(text: str) -> bool:
    """判断文本是否主要为英文"""
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    total = len(text) or 1
    return ascii_chars / total > 0.5


for fname in FILES:
    in_path = os.path.join(BASE, fname)
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for r in data:
        bg = r.get("background", {})
        raw = bg.get("profile", "") or ""

        if is_english(raw):
            cleaned = clean_en(raw)
        else:
            cleaned = clean(raw)

        if cleaned and not cleaned.startswith("【画像】"):
            cleaned = f"【画像】{cleaned}"

        bg["profile"] = cleaned

        games = extract_games(cleaned)
        if games:
            bg["game_experience_summary"] = "、".join(games[:10])

        r["background"] = bg

    with open(in_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 抽样
    print(f"\n📂 {fname}: {len(data)} 个")
    en_count = sum(1 for r in data if is_english(r["background"]["profile"]))
    print(f"  英文: {en_count} 个, 中文: {len(data)-en_count} 个")
    for r in data[:2]:
        p = r["background"]["profile"]
        print(f"  {r['speaker_id']}: {p[:120]}...")

print(f"\n✅ 完成")