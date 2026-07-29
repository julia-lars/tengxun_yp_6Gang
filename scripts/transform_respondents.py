#!/usr/bin/env python3
"""将 sheets_processed 的 respondents 格式对齐 sheets_data 规范"""
import json
import os
import re

BASE = os.path.expanduser("~/projects/tengxun_yp_6Gang/data/sheets_processed")

FILES = [
    "respondents_漫威争锋中美用户洞察研究.json",
    "respondents_美国HD端射击市场用户细分研究.json",
    "respondents_美国HD端用户生态与决策链路研究.json",
]

# 提取游戏名
GAME_NAMES = [
    "漫威争锋", "漫威争峰", "守望先锋", "Overwatch", "CS", "CSGO", "CS2", "Valorant",
    "Apex", "APEX", "塔科夫", "逃离塔科夫", "暗区突围", "三角洲", "Delta Force",
    "使命召唤", "Call of Duty", "COD", "战地", "Battlefield", "彩虹六号", "彩六",
    "命运2", "Destiny", "枪神纪", "绝地潜兵", "Helldivers", "穿越火线", "CF",
    "Fortnite", "堡垒之夜", "PUBG", "绝地求生", "The Finals", "Rust", "DayZ",
    "英雄联盟", "LOL", "DOTA", "王者荣耀", "漫威", "Marvel", "OW",
    "瓦", "瓦洛兰特", "地狱老司机", "R6", "Siege", "Halo", "光环",
    "链在一起", "分手厨房", "Dota", "DOTA2", "LOL", "CODM", "WZ",
    "逆战", "永劫无间", "Warframe", "星际战甲", "全境封锁", "The Division",
    "彩虹六号围攻", "暗区", "逃离", "CODM", "荒野行动", "和平精英", "刺激战场",
    "Free Fire", "Mobile Legends", "MLBB", "GTA", "GTA5", "GTAV",
    "无主之地", "Borderlands", "生化危机", "Resident Evil", "地铁", "Metro",
    "DOOM", "毁灭战士", "Titanfall", "泰坦陨落", "Splatoon", "喷射战士",
    "战争机器", "Gears of War", "Hunt", "猎杀对决", "Escape from Tarkov",
    "Roblox", "Minecraft", "我的世界", "方舟", "ARK", "Rust", "DayZ",
    "Paladins", "枪火游侠", "Super People", "超击突破", "Naraka", "永劫",
    "Marauders", "星际海盗", "Cycle", "边境", "Spectre Divide", "FragPunk",
    "Concord", "星鸣特攻", "Deadlock", "死锁", "星球大战", "Star Wars",
    "战锤", "Warhammer", "War Robots", "战争机器人", "Crossout", "创世战车",
    "Enlisted", "从军", "Hell Let Loose", "人间地狱", "Squad", "战术小队",
    "Arma", "武装突袭", "Insurgency", "叛乱", "Rising Storm", "风起云涌",
    "World of Tanks", "坦克世界", "War Thunder", "战争雷霆",
    "卡拉彼丘", "尘白禁区", "原神", "崩坏", "星穹铁道", "绝区零", "鸣潮",
    "黑神话", "悟空", "艾尔登法环", "Elden Ring", "只狼", "Sekiro",
    "黑暗之魂", "Dark Souls", "血源", "Bloodborne", "仁王", "Nioh",
    "怪物猎人", "Monster Hunter", "鬼泣", "Devil May Cry", "猎天使魔女",
    "DNF", "地下城", "FF14", "最终幻想", "WOW", "魔兽世界", "剑网3",
    "天涯明月刀", "逆水寒", "梦幻西游", "问道", "传奇", "LOL", "DOTA2",
    "手机", "PC", "主机", "Switch", "PS5", "PS4", "Xbox", "Xbox Series",
    "iPad", "平板", "掌机", "Steam Deck", "ROG Ally",
]


def extract_games(text: str) -> list[str]:
    found = set()
    for game in GAME_NAMES:
        if game.lower() in text.lower():
            found.add(game)
    return sorted(found)


def extract_insights(segments: list[dict], speaker_id: str) -> list[str]:
    """从 speaker 的 segments 中提取洞察"""
    insights = []
    for seg in segments:
        if seg.get("speaker_id") == speaker_id:
            cat = seg.get("annotation", {}).get("category", "")
            text = seg.get("original_text", "").strip()
            if len(text) > 30:
                # 截取关键句
                sentences = re.split(r'[。！？\n]', text)
                for s in sentences:
                    s = s.strip()
                    if len(s) > 15 and len(s) < 120:
                        insights.append(f"【{cat}】{s}")
                        if len(insights) >= 5:
                            return insights
    return insights


def transform(in_path: str, out_path: str, seg_path: str):
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # 加载对应 segments
    segments = []
    if os.path.exists(seg_path):
        with open(seg_path, "r", encoding="utf-8") as f:
            segments = json.load(f)

    for resp in data:
        bg = resp.get("background", {})
        profile_raw = bg.get("profile", "") or ""

        # 提取游戏列表
        games = extract_games(profile_raw)
        games_str = "、".join(games[:10]) if games else "未知"

        # 格式化 profile
        if profile_raw and not profile_raw.startswith("【画像】"):
            bg["profile"] = f"【画像】{profile_raw}"

        # 提取洞察
        if not bg.get("game_experience"):
            sid = resp.get("speaker_id", "")
            insights = extract_insights(segments, sid)
            if insights:
                bg["game_experience"] = "\n".join(insights)
            else:
                bg["game_experience"] = None

        # 游戏总结
        if not bg.get("game_experience_summary"):
            bg["game_experience_summary"] = games_str

        resp["background"] = bg

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"  {os.path.basename(in_path)}: {len(data)} 个 respondents")


for fname in FILES:
    seg_fname = fname.replace("respondents_", "segments_")
    in_path = os.path.join(BASE, fname)
    seg_path = os.path.join(BASE, seg_fname)
    transform(in_path, in_path, seg_path)

print(f"\n✅ 3 个 respondents 文件已对齐规范格式")