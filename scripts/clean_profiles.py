#!/usr/bin/env python3
"""清洗 respondents 的 profile 字段：去口语化，保留核心画像信息"""
import json
import os
import re

BASE = os.path.expanduser("~/projects/tengxun_yp_6Gang/data/sheets_processed")

FILES = [
    "respondents_漫威争锋中美用户洞察研究.json",
    "respondents_美国HD端射击市场用户细分研究.json",
    "respondents_美国HD端用户生态与决策链路研究.json",
]

# 英文→中文翻译表
EN_TO_CN = {
    "call of duty": "使命召唤",
    "cod": "使命召唤",
    "overwatch": "守望先锋",
    "apex": "Apex",
    "valorant": "Valorant",
    "csgo": "CSGO",
    "cs": "CS",
    "pubg": "绝地求生",
    "fortnite": "堡垒之夜",
    "tarkov": "塔科夫",
    "eft": "逃离塔科夫",
    "rainbow six": "彩虹六号",
    "siege": "围攻",
    "destiny": "命运",
    "battlefield": "战地",
    "halo": "光环",
    "warframe": "星际战甲",
    "helldivers": "绝地潜兵",
    "the finals": "The Finals",
    "rust": "Rust",
    "dayz": "DayZ",
    "rpg": "RPG",
    "fps": "FPS",
    "pvp": "PVP",
    "pve": "PVE",
    "mmo": "MMO",
    "mmorpg": "MMORPG",
    "moba": "MOBA",
    "br": "大逃杀",
    "battle royale": "大逃杀",
    "pc": "PC",
    "xbox": "Xbox",
    "playstation": "PlayStation",
    "ps5": "PS5",
    "ps4": "PS4",
    "switch": "Switch",
    "nintendo": "任天堂",
    "steam": "Steam",
    "game boy": "Game Boy",
    "xbox series": "Xbox Series",
    "steam deck": "Steam Deck",
    "rog ally": "ROG Ally",
}


def clean_profile(text: str) -> str:
    """清洗 profile 文本"""
    t = text

    # 去掉【画像】前缀（后面会重新加）
    t = re.sub(r'^【画像】', '', t)

    # 去掉自我介绍套话
    t = re.sub(r'大家好[,，]?\s*我(的)?(名字)?(叫|是)\s*.{0,30}(?=[，。,\.\s])', '', t)
    t = re.sub(r'我(的)?(名字)?(叫|是)\s*.{0,20}(?=[，。,\.\s])', '', t)
    t = re.sub(r'我(今年)?\d{1,3}岁[,，]?\s*', '', t)
    t = re.sub(r'我的兴趣爱好(就)?是[:：]?\s*', '', t)
    t = re.sub(r'我的兴趣(爱好)?[:：]?\s*', '', t)
    t = re.sub(r'大家好[,，]?\s*', '', t)
    t = re.sub(r'^[,，\s]+', '', t)

    # 去掉口语填充词
    t = re.sub(r'那个[,，]?\s*', '', t)
    t = re.sub(r'就是[,，]?\s*', '', t)
    t = re.sub(r'怎么说呢[,，]?\s*', '', t)
    t = re.sub(r'然后[,，]?\s*', '', t)
    t = re.sub(r'反正[,，]?\s*', '', t)
    t = re.sub(r'怎么说[,，]?\s*', '', t)
    t = re.sub(r'说白了[,，]?\s*', '', t)
    t = re.sub(r'说实话[,，]?\s*', '', t)
    t = re.sub(r'讲道理[,，]?\s*', '', t)
    t = re.sub(r'大概[,，]?\s*', '', t)
    t = re.sub(r'应该[,，]?\s*', '', t)
    t = re.sub(r'可能[,，]?\s*', '', t)
    t = re.sub(r'其实[,，]?\s*', '', t)
    t = re.sub(r'确实[,，]?\s*', '', t)
    t = re.sub(r'基本上[,，]?\s*', '', t)
    t = re.sub(r'差不多[,，]?\s*', '', t)
    t = re.sub(r'算是[,，]?\s*', '', t)
    t = re.sub(r'感觉[,，]?\s*', '', t)
    t = re.sub(r'觉得[,，]?\s*', '', t)
    t = re.sub(r'比较[,，]?\s*', '', t)
    t = re.sub(r'还挺?[,，]?\s*', '', t)
    t = re.sub(r'而且[,，]?\s*', '', t)
    t = re.sub(r'所以[,，]?\s*', '', t)
    t = re.sub(r'因为[,，]?\s*', '', t)
    t = re.sub(r'但是[,，]?\s*', '', t)
    t = re.sub(r'不过[,，]?\s*', '', t)
    t = re.sub(r'嗯[,，]?\s*', '', t)
    t = re.sub(r'啊[,，]?\s*', '', t)
    t = re.sub(r'哦[,，]?\s*', '', t)
    t = re.sub(r'呃[,，]?\s*', '', t)
    t = re.sub(r'嘛[,，]?\s*', '', t)
    t = re.sub(r'吧[,，]?\s*', '', t)
    t = re.sub(r'呗[,，]?\s*', '', t)
    t = re.sub(r'啦[,，]?\s*', '', t)
    t = re.sub(r'了[,，]?\s*', '', t)
    t = re.sub(r'嘛[,，]?\s*', '', t)
    t = re.sub(r'哈[,，]?\s*', '', t)
    t = re.sub(r'就[,，]?\s*', '', t)

    # 英文→中文
    for en, cn in EN_TO_CN.items():
        t = re.sub(rf'\b{en}\b', cn, t, flags=re.IGNORECASE)

    # 清理多余标点和空格
    t = re.sub(r'[,，]{2,}', '，', t)
    t = re.sub(r'[。！？]{2,}', '。', t)
    t = re.sub(r'\s{2,}', ' ', t)
    t = re.sub(r'^[,，。！？\s]+', '', t)
    t = re.sub(r'[,，。！？\s]+$', '', t)
    t = re.sub(r'[,，]$', '', t)
    t = t.strip()

    # 确保以句号结尾
    if t and not t.endswith('。'):
        t += '。'

    return t


def extract_games(text: str) -> list[str]:
    """从文本中提取游戏名"""
    GAME_NAMES = [
        "漫威争锋", "漫威争峰", "守望先锋", "CS", "CSGO", "CS2", "Valorant",
        "Apex", "APEX", "塔科夫", "逃离塔科夫", "暗区突围", "三角洲",
        "使命召唤", "COD", "战地", "彩虹六号", "彩六", "R6",
        "命运2", "命运", "枪神纪", "绝地潜兵", "穿越火线", "CF",
        "堡垒之夜", "绝地求生", "PUBG", "The Finals", "Rust", "DayZ",
        "英雄联盟", "LOL", "DOTA", "王者荣耀", "OW", "瓦洛兰特",
        "链在一起", "分手厨房", "永劫无间", "星际战甲", "全境封锁",
        "黑神话", "艾尔登法环", "只狼", "黑暗之魂", "怪物猎人", "鬼泣",
        "GTA", "无主之地", "生化危机", "地铁", "DOOM", "毁灭战士",
        "Titanfall", "泰坦陨落", "Splatoon", "喷射战士", "战争机器",
        "Hunt", "猎杀对决", "Roblox", "Minecraft", "我的世界",
        "方舟", "Paladins", "枪火游侠", "Naraka", "永劫",
        "Deadlock", "死锁", "星球大战", "战锤", "人间地狱", "Squad",
        "战术小队", "Arma", "武装突袭", "叛乱", "坦克世界", "战争雷霆",
        "卡拉彼丘", "尘白禁区", "原神", "崩坏", "星穹铁道", "绝区零", "鸣潮",
        "暗黑破坏神", "Diablo", "流放之路", "POE", "最终幻想", "FF14",
        "魔兽世界", "WOW", "剑网3", "天涯明月刀", "逆水寒", "DNF",
        "炉石传说", "Hearthstone", "影之诗", "游戏王", "万智牌",
        "文明", "Civ", "帝国时代", "星际争霸", "Starcraft",
        "宝可梦", "Pokemon", "塞尔达", "Zelda", "马里奥", "Mario",
        "魂", "Souls", "老头环", "环", "仁王", "Nioh", "血源",
        "对马岛", "Ghost of Tsushima", "蜘蛛侠", "Spider-Man",
        "战神", "God of War", "地平线", "Horizon", "最后生还者",
        "TLOU", "死亡搁浅", "Death Stranding", "赛博朋克", "Cyberpunk",
        "巫师", "Witcher", "上古卷轴", "Skyrim", "辐射", "Fallout",
        "博德之门", "Baldur", "神界原罪", "Divinity", "龙腾世纪",
        "Dragon Age", "质量效应", "Mass Effect", "刺客信条",
        "Assassin", "看门狗", "Watch Dogs", "孤岛惊魂", "Far Cry",
        "幽灵行动", "Ghost Recon", "全境", "Division", "彩虹六号",
        "舞力全开", "Just Dance", "健身环", "Ring Fit",
        "动物森友会", "动物之森", "星露谷", "Stardew", "牧场物语",
        "泰拉瑞亚", "Terraria", "饥荒", "Don't Starve", "环世界", "Rimworld",
        "异星工厂", "Factorio", "戴森球", "Dyson Sphere",
        "哈迪斯", "Hades", "死亡细胞", "Dead Cells", "空洞骑士",
        "Hollow Knight", "奥日", "Ori", "蔚蓝", "Celeste",
        "茶杯头", "Cuphead", "以撒", "Isaac", "挺进地牢", "Gungeon",
        "杀戮尖塔", "Slay the Spire", "怪物火车", "Monster Train",
        "小丑牌", "Balatro", "吸血鬼幸存者", "Vampire Survivors",
        "潜水员戴夫", "Dave the Diver", "Stray", "迷失",
        "双人成行", "It Takes Two", "毛线小精灵", "Unravel",
        "胡闹厨房", "Overcooked", "人类一败涂地", "Human Fall Flat",
        "Among Us", "太空狼人杀", "鹅作剧", "Untitled Goose",
        "糖豆人", "Fall Guys", "猛兽派对", "Party Animals",
        "幻兽帕鲁", "Palworld", "雾锁王国", "Enshrouded",
        "夜族崛起", "V Rising", "英灵神殿", "Valheim",
        "森林", "The Forest", "森林之子", "Sons of the Forest",
        "绿色地狱", "Green Hell", "深海迷航", "Subnautica",
        "无人深空", "No Man's Sky", "星际公民", "Star Citizen",
        "精英危险", "Elite Dangerous", "EVE",
    ]
    found = set()
    for game in GAME_NAMES:
        if game.lower() in text.lower():
            found.add(game)
    return sorted(found)


def transform(in_path: str, out_path: str):
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for resp in data:
        bg = resp.get("background", {})
        profile_raw = bg.get("profile", "") or ""

        # 清洗
        cleaned = clean_profile(profile_raw)

        # 重新加【画像】前缀
        if cleaned and not cleaned.startswith("【画像】"):
            cleaned = f"【画像】{cleaned}"

        bg["profile"] = cleaned

        # 更新 game_experience_summary
        games = extract_games(cleaned)
        if games:
            bg["game_experience_summary"] = "、".join(games[:10])

        resp["background"] = bg

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  {os.path.basename(in_path)}: {len(data)} 个")


for fname in FILES:
    in_path = os.path.join(BASE, fname)
    transform(in_path, in_path)

print(f"\n✅ profile 已清洗为中文画像格式")