#!/usr/bin/env python3
"""英文 respondents 用 segments 提取关键信息，生成中文 profile"""
import json, os, re

BASE = os.path.expanduser("~/projects/tengxun_yp_6Gang/data/sheets_processed")

RESP_FILES = [
    "respondents_漫威争锋中美用户洞察研究.json",
    "respondents_美国HD端射击市场用户细分研究.json",
    "respondents_美国HD端用户生态与决策链路研究.json",
]

# 英文关键词 → 中文画像描述
PLATFORM_MAP = {
    "pc": "PC",
    "computer": "PC",
    "laptop": "PC",
    "console": "主机",
    "xbox": "Xbox",
    "playstation": "PlayStation",
    "ps5": "PS5",
    "ps4": "PS4",
    "switch": "Switch",
    "nintendo": "任天堂",
    "mobile": "手机",
    "phone": "手机",
    "ipad": "iPad",
    "tablet": "平板",
    "steam deck": "Steam Deck",
    "handheld": "掌机",
}

PLAY_STYLE = {
    "competitive": "竞技排位",
    "ranked": "排位",
    "casual": "休闲",
    "relax": "放松",
    "chill": "放松",
    "fun": "娱乐",
    "friends": "社交组队",
    "squad": "组队",
    "team": "团队",
    "solo": "单人",
    "alone": "单人",
    "aggressive": "主动进攻",
    "defensive": "防守",
    "tactical": "战术策略",
    "strategic": "策略",
    "fast": "快节奏",
    "slow": "慢节奏",
    "hardcore": "硬核",
    "grind": "肝",
    "daily": "日常",
    "weekend": "周末",
    "night": "夜间",
    "hours": "长时间",
    "quick": "快速",
    "short": "短时",
}

GAME_GENRE = {
    "shooter": "射击",
    "fps": "第一人称射击",
    "tps": "第三人称射击",
    "battle royale": "大逃杀",
    "extraction": "搜打撤",
    "tactical shooter": "战术射击",
    "hero shooter": "英雄射击",
    "arena shooter": "竞技场射击",
    "looter shooter": "刷宝射击",
    "moba": "MOBA",
    "rpg": "RPG",
    "mmo": "MMO",
    "survival": "生存",
    "horror": "恐怖",
    "action": "动作",
    "adventure": "冒险",
    "strategy": "策略",
    "sports": "体育",
    "racing": "竞速",
    "fighting": "格斗",
    "puzzle": "解谜",
    "sandbox": "沙盒",
    "open world": "开放世界",
    "co-op": "合作",
    "coop": "合作",
    "single player": "单机",
    "multiplayer": "多人",
    "pvp": "PVP",
    "pve": "PVE",
}

GAME_NAMES = {
    "call of duty": "使命召唤",
    "cod": "COD",
    "overwatch": "守望先锋",
    "apex": "Apex",
    "apex legends": "Apex",
    "valorant": "瓦",
    "csgo": "CSGO",
    "cs2": "CS2",
    "counter strike": "CS",
    "pubg": "PUBG",
    "fortnite": "堡垒之夜",
    "tarkov": "塔科夫",
    "escape from tarkov": "塔科夫",
    "rainbow six": "彩虹六号",
    "siege": "彩虹六号",
    "r6": "彩虹六号",
    "destiny": "命运",
    "destiny 2": "命运2",
    "battlefield": "战地",
    "bf": "战地",
    "halo": "光环",
    "warframe": "星际战甲",
    "helldivers": "绝地潜兵",
    "the finals": "The Finals",
    "rust": "Rust",
    "dayz": "DayZ",
    "gta": "GTA",
    "gta 5": "GTA5",
    "gta v": "GTA5",
    "red dead": "荒野大镖客",
    "rdr2": "荒野大镖客2",
    "elder scrolls": "上古卷轴",
    "skyrim": "上古卷轴",
    "fallout": "辐射",
    "doom": "毁灭战士",
    "borderlands": "无主之地",
    "far cry": "孤岛惊魂",
    "assassin": "刺客信条",
    "witcher": "巫师",
    "cyberpunk": "赛博朋克",
    "minecraft": "我的世界",
    "roblox": "Roblox",
    "elden ring": "艾尔登法环",
    "dark souls": "黑暗之魂",
    "bloodborne": "血源",
    "sekiro": "只狼",
    "resident evil": "生化危机",
    "dead space": "死亡空间",
    "silent hill": "寂静岭",
    "outlast": "逃生",
    "amnesia": "失忆症",
    "left 4 dead": "求生之路",
    "l4d": "求生之路",
    "back 4 blood": "喋血复仇",
    "dying light": "消逝的光芒",
    "dead island": "死亡岛",
    "metro": "地铁",
    "stalker": "潜行者",
    "bioshock": "生化奇兵",
    "prey": "掠食",
    "dishonored": "羞辱",
    "titanfall": "泰坦陨落",
    "splatoon": "喷射战士",
    "gears of war": "战争机器",
    "hunt": "猎杀对决",
    "hunt showdown": "猎杀对决",
    "marvel rivals": "漫威争锋",
    "marvel": "漫威",
    "delta force": "三角洲行动",
    "warzone": "战区",
    "dmz": "DMZ",
    "zombie": "僵尸模式",
    "deadlock": "死锁",
    "spectre divide": "Spectre Divide",
    "fragpunk": "FragPunk",
    "the cycle": "The Cycle",
    "marauders": "星际海盗",
    "arena breakout": "暗区突围",
    "war thunder": "战争雷霆",
    "world of tanks": "坦克世界",
    "enlisted": "从军",
    "hell let loose": "人间地狱",
    "squad": "战术小队",
    "arma": "武装突袭",
    "insurgency": "叛乱",
    "rising storm": "风起云涌",
    "league of legends": "英雄联盟",
    "lol": "LOL",
    "dota": "DOTA",
    "dota 2": "DOTA2",
    "smite": "神之浩劫",
    "wow": "魔兽世界",
    "world of warcraft": "魔兽世界",
    "final fantasy": "最终幻想",
    "ffxiv": "FF14",
    "ff14": "FF14",
    "eso": "上古卷轴OL",
    "guild wars": "激战",
    "black desert": "黑色沙漠",
    "lost ark": "失落的方舟",
    "new world": "新世界",
    "diablo": "暗黑破坏神",
    "path of exile": "流放之路",
    "poe": "流放之路",
    "grim dawn": "恐怖黎明",
    "last epoch": "最后纪元",
    "warframe": "星际战甲",
    "destiny": "命运",
    "the division": "全境封锁",
    "ghost recon": "幽灵行动",
    "mass effect": "质量效应",
    "dragon age": "龙腾世纪",
    "star wars": "星球大战",
    "warhammer": "战锤",
    "vermintide": "战锤末世鼠疫",
    "darktide": "暗潮",
    "space marine": "星际战士",
    "helldivers": "绝地潜兵",
    "deep rock": "深岩银河",
    "payday": "收获日",
    "killing floor": "杀戮空间",
    "warframe": "星际战甲",
    "monster hunter": "怪物猎人",
    "dauntless": "无畏",
    "god eater": "噬神者",
    "toukiden": "讨鬼传",
    "nioh": "仁王",
    "wo long": "卧龙",
    "stranger of paradise": "天堂的陌生人",
    "lies of p": "匹诺曹的谎言",
    "steelrising": "钢铁崛起",
    "thymesia": "记忆边境",
    "mortal shell": "致命躯壳",
    "ashen": "灰烬",
    "surge": "迸发",
    "lords of the fallen": "堕落之主",
    "remnant": "遗迹",
    "returnal": "死亡回归",
    "control": "控制",
    "alan wake": "心灵杀手",
    "quantum break": "量子破碎",
    "max payne": "马克思佩恩",
    "hitman": "杀手",
    "splinter cell": "细胞分裂",
    "metal gear": "合金装备",
    "deus ex": "杀出重围",
    "thief": "神偷",
    "dishonored": "羞辱",
    "deathloop": "死亡循环",
    "ghostwire": "幽灵线",
    "evil within": "恶灵附身",
    "hi fi rush": "完美音浪",
    "psychonauts": "脑航员",
    "ratchet": "瑞奇与叮当",
    "jak": "杰克",
    "sly": "狡狐大冒险",
    "crash": "古惑狼",
    "spyro": "小龙斯派罗",
    "banjo": "班卓熊",
    "conker": "坏松鼠",
    "oddworld": "奇异世界",
    "earthworm": "蚯蚓战士",
    "toejam": "外星双傻",
    "bomberman": "炸弹人",
    "pacman": "吃豆人",
    "tetris": "俄罗斯方块",
    "pong": "乓",
    "galaga": "小蜜蜂",
    "centipede": "蜈蚣",
    "asteroids": "小行星",
    "missile command": "导弹指令",
    "tempest": "暴风雨",
    "defender": "保卫者",
    "joust": "骑士对决",
    "robotron": "机器人大战",
    "smash tv": "暴烈刑警",
    "gauntlet": "圣铠传说",
    "rampage": "狂暴大破坏",
    "mortal kombat": "真人快打",
    "street fighter": "街头霸王",
    "tekken": "铁拳",
    "soul calibur": "灵魂能力",
    "dead or alive": "死或生",
    "virtua fighter": "VR战士",
    "king of fighters": "拳皇",
    "guilty gear": "罪恶装备",
    "blazblue": "苍翼默示录",
    "melty blood": "月姬格斗",
    "under night": "夜下降生",
    "dragon ball": "龙珠",
    "naruto": "火影忍者",
    "one piece": "海贼王",
    "bleach": "死神",
    "jojo": "JOJO",
    "persona": "女神异闻录",
    "shin megami": "真女神转生",
    "final fantasy": "最终幻想",
    "dragon quest": "勇者斗恶龙",
    "kingdom hearts": "王国之心",
    "chrono": "时空之轮",
    "xenogears": "异度装甲",
    "xenoblade": "异度之刃",
    "tales of": "传说系列",
    "star ocean": "星之海洋",
    "valkyrie": "北欧女神",
    "mana": "圣剑传说",
    "saga": "沙加",
    "front mission": "前线任务",
    "ogre battle": "皇家骑士团",
    "tactics ogre": "皇家骑士团",
    "ff tactics": "最终幻想战略版",
    "disgaea": "魔界战记",
    "fire emblem": "火焰纹章",
    "advance wars": "高级战争",
    "shining force": "光明力量",
    "langrisser": "梦幻模拟战",
    "super robot": "超级机器人大战",
    "sd gundam": "SD高达",
    "macross": "超时空要塞",
    "zone of the enders": "终极地带",
    "armored core": "装甲核心",
    "daemon x machina": "机甲战魔",
    "mechwarrior": "机甲战士",
    "battletech": "战斗科技",
    "hawken": "霍肯",
    "titanfall": "泰坦陨落",
    "anthem": "圣歌",
    "iron man": "钢铁侠",
    "transformers": "变形金刚",
    "pacific rim": "环太平洋",
    "evangelion": "新世纪福音战士",
    "gundam": "高达",
    "code geass": "反叛的鲁路修",
    "full metal": "钢之炼金术师",
    "attack on titan": "进击的巨人",
    "sword art": "刀剑神域",
    "fate": "Fate",
    "demon slayer": "鬼灭之刃",
    "jujutsu": "咒术回战",
    "chainsaw": "电锯人",
    "spy x family": "间谍过家家",
    "one punch": "一拳超人",
    "mob psycho": "灵能百分百",
    "my hero": "我的英雄学院",
    "black clover": "黑色五叶草",
    "fairy tail": "妖精的尾巴",
    "seven deadly": "七大罪",
    "nanatsu": "七大罪",
    "tokyo ghoul": "东京喰种",
    "parasyte": "寄生兽",
    "ajin": "亚人",
    "terra formars": "火星异种",
    "knights of sidonia": "希德尼娅的骑士",
    "blame": "特工次世代",
    "biomega": "生化禁区",
    "gantz": "杀戮都市",
    "inuyashiki": "犬屋敷",
    "akira": "阿基拉",
    "ghost in the shell": "攻壳机动队",
    "cowboy bebop": "星际牛仔",
    "samurai champloo": "混沌武士",
    "space dandy": "太空丹迪",
    "afro samurai": "爆炸头武士",
    "michiko": "道子与哈金",
    "gangsta": "黑街",
    "black lagoon": "黑礁",
    "jormungand": "军火女王",
    "phantom": "幻灵镇魂曲",
    "noir": "黑街二人组",
    "madlax": "异域天使",
    "el cazador": "魔女猎人",
    "gunslinger girl": "枪姬",
    "psycho pass": "心理测量者",
    "ghost hunt": "奇幻贵公子",
    "shiki": "尸鬼",
    "another": "替身",
    "higurashi": "寒蝉鸣泣之时",
    "umineko": "海猫鸣泣之时",
    "corpse party": "尸体派对",
    "fatal frame": "零",
    "siren": "死魂曲",
    "forbidden siren": "死魂曲",
    "clock tower": "钟楼",
    "haunting ground": "狂城丽影",
    "rule of rose": "蔷薇守则",
    "kuon": "九怨",
    "echo night": "回声之夜",
    "shadow tower": "影之塔",
    "king's field": "国王密令",
    "evergrace": "永恒之戒",
    "lost kingdoms": "失落的王国",
    "otogi": "御伽",
    "ninja blade": "忍者之刃",
    "metal wolf": "钢铁之狼",
    "chromehounds": "合金猎犬",
    "enchanted arms": "赋法战争",
    "infinite undiscovery": "无尽的未知",
    "last remnant": "最后的神迹",
    "resonance of fate": "永恒终焉",
    "nier": "尼尔",
    "drakengard": "龙背上的骑兵",
    "automata": "尼尔自动人形",
    "replicant": "尼尔人工生命",
    "bayonetta": "猎天使魔女",
    "vanquish": "绝对征服",
    "madworld": "疯狂世界",
    "anarchy reigns": "极度混乱",
    "wonderful 101": "神奇101",
    "astral chain": "异界锁链",
    "scalebound": "龙鳞化身",
    "recore": "核心重铸",
    "sunset overdrive": "日落过载",
    "crackdown": "除暴战警",
    "state of decay": "腐烂国度",
    "sea of thieves": "盗贼之海",
    "grounded": "禁闭求生",
    "pentiment": "隐迹渐现",
    "hi fi rush": "完美音浪",
    "redfall": "红霞岛",
    "starfield": "星空",
    "indiana jones": "夺宝奇兵",
    "avowed": "宣誓",
    "fable": "神鬼寓言",
    "perfect dark": "完美黑暗",
    "everwild": "永恒荒野",
    "contraband": "违禁品",
    "outer worlds": "天外世界",
    "wasteland": "废土",
    "pillars": "永恒之柱",
    "tyranny": "暴君",
    "torment": "折磨",
    "planescape": "异域镇魂曲",
    "icewind": "冰风谷",
    "neverwinter": "无冬之夜",
    "baldur": "博德之门",
    "icewind dale": "冰风谷",
    "sword coast": "剑湾",
    "forgotten realms": "被遗忘的国度",
    "dragonlance": "龙枪",
    "ravenloft": "鸦阁城堡",
    "darksun": "浩劫残阳",
    "spelljammer": "魔法船",
    "planescape": "异度风景",
    "greyhawk": "灰鹰",
    "mystara": "密斯塔拉",
    "birthright": "天赋神权",
    "council of wyrms": "龙之议会",
    "jakandor": "贾坎多",
    "ghostwalk": "幽灵行者",
    "eberron": "艾伯伦",
    "dragonmech": "机甲龙世纪",
    "iron kingdoms": "钢铁王国",
    "midnight": "午夜",
    "dawnforge": "黎明锻造",
    "morningstar": "晨星",
    "arcana": "奥秘",
    "exalted": "高颂",
    "legend of the five rings": "五轮传奇",
    "7th sea": "第七海",
    "deadlands": "死地",
    "savage worlds": "蛮荒世界",
    "earthdawn": "地球黎明",
    "shadowrun": "暗影狂奔",
    "cyberpunk": "赛博朋克",
    "vampire": "吸血鬼",
    "werewolf": "狼人",
    "mage": "法师",
    "changeling": "换生灵",
    "wraith": "死灵",
    "hunter": "猎人",
    "demon": "恶魔",
    "mummy": "木乃伊",
    "beast": "野兽",
    "deviant": "异类",
    "promethean": "魔像",
    "geist": "缚灵",
    "sin-eater": "噬罪者",
    "oracle": "先知",
    "blue book": "蓝皮书",
    "god machine": "神机",
    "contagion": "瘟疫",
    "dark eras": "黑暗时代",
    "mirrors": "镜中人",
    "hurt locker": "伤痛之柜",
}


def get_game_names(text: str) -> list[str]:
    found = []
    for en, cn in sorted(GAME_NAMES.items(), key=lambda x: -len(x[0])):
        if re.search(rf'\b{re.escape(en)}\b', text, re.IGNORECASE):
            if cn not in found:
                found.append(cn)
    return found[:8]


def get_platforms(text: str) -> list[str]:
    found = set()
    for en, cn in PLATFORM_MAP.items():
        if re.search(rf'\b{re.escape(en)}\b', text, re.IGNORECASE):
            found.add(cn)
    return list(found)[:3]


def get_play_styles(text: str) -> list[str]:
    found = set()
    for en, cn in PLAY_STYLE.items():
        if re.search(rf'\b{re.escape(en)}\b', text, re.IGNORECASE):
            found.add(cn)
    return list(found)[:4]


def get_genres(text: str) -> list[str]:
    found = set()
    for en, cn in sorted(GAME_GENRE.items(), key=lambda x: -len(x[0])):
        if re.search(rf'\b{re.escape(en)}\b', text, re.IGNORECASE):
            found.add(cn)
    return list(found)[:3]


def build_cn_profile(segments: list, speaker_id: str) -> str:
    """从 segments 提取信息构建中文 profile"""
    texts = []
    for seg in segments:
        if seg.get("speaker_id") == speaker_id:
            txt = seg.get("original_text", "").strip()
            if len(txt) > 10:
                texts.append(txt)

    if not texts:
        return ""

    combined = " ".join(texts)

    games = get_game_names(combined)
    platforms = get_platforms(combined)
    styles = get_play_styles(combined)
    genres = get_genres(combined)

    parts = []
    if games:
        parts.append(f"主要游玩{games[0]}")
        if len(games) > 1:
            parts.append(f"也会玩{'、'.join(games[1:5])}")
    if platforms:
        parts.append(f"偏好{'、'.join(platforms)}平台")
    if genres:
        parts.append(f"喜欢{'、'.join(genres)}类型")
    if styles:
        parts.append(f"游戏风格偏{'、'.join(styles)}")

    if not parts:
        # 没有提取到结构化信息，用原文前100字
        summary = texts[0][:100]
        return f"【画像】{summary}。"

    return f"【画像】{'，'.join(parts)}。"


def is_english(text: str) -> bool:
    ascii_chars = sum(1 for c in text if ord(c) < 128)
    return ascii_chars / max(len(text), 1) > 0.5


for fname in RESP_FILES:
    seg_fname = fname.replace("respondents_", "segments_")
    in_path = os.path.join(BASE, fname)
    seg_path = os.path.join(BASE, seg_fname)

    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = []
    if os.path.exists(seg_path):
        with open(seg_path, "r", encoding="utf-8") as f:
            segments = json.load(f)

    for r in data:
        bg = r.get("background", {})
        profile = bg.get("profile", "") or ""

        if is_english(profile) or (profile.startswith("【画像】") and is_english(profile[4:])):
            sid = r.get("speaker_id", "")
            new_p = build_cn_profile(segments, sid)
            if new_p:
                bg["profile"] = new_p

    with open(in_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    en_count = sum(1 for r in data if is_english(r["background"]["profile"]))
    print(f"📂 {fname}: {len(data)} 个, 英文剩余: {en_count}")
    for r in data[:3]:
        print(f"  {r['speaker_id']}: {r['background']['profile'][:120]}")

print("\n✅ 完成")