#!/usr/bin/env python3
"""将漫威/美国 segments 转为规范格式：preceding_question=null + annotation{s sheet, game, category }"""
import json
import os
import re

BASE = os.path.expanduser("~/projects/tengxun_yp_6Gang/data/sheets_processed")

FILES = [
    "segments_漫威争锋中美用户洞察研究.json",
    "segments_美国HD端射击市场用户细分研究.json",
    "segments_美国HD端用户生态与决策链路研究.json",
]

# 分类关键词 → game 映射
GAME_KEYWORDS = {
    "漫威争锋|漫威争峰|漫威|Marvel Rivals": "漫威争锋",
    "守望先锋|守望|OW|Overwatch": "守望先锋",
    "CS|CSGO|CS2|反恐精英": "CS",
    "瓦|Valorant|瓦洛兰特": "Valorant",
    "APEX|Apex": "Apex",
    "塔科夫|逃离塔科夫|EFT|暗区突围": "逃离塔科夫",
    "三角洲|Delta Force": "三角洲行动",
    "使命召唤|COD|Call of Duty": "使命召唤",
    "战地|Battlefield|BF": "战地",
    "彩虹六号|彩六|R6|Rainbow Six|Siege": "彩虹六号",
    "命运2|Destiny": "命运2",
    "枪神纪": "枪神纪",
    "地狱老司机|Helldivers|绝地潜兵": "绝地潜兵",
    "CF|穿越火线": "穿越火线",
    "Fortnite|堡垒之夜": "堡垒之夜",
    "PUBG|绝地求生": "PUBG",
    "Rust": "Rust",
    "DayZ": "DayZ",
    "Halo|光环": "光环",
    "The Finals": "The Finals",
    "英雄联盟|LOL|League": "英雄联盟",
    "DOTA": "DOTA",
    "王者荣耀": "王者荣耀",
}

# 分类关键词 → category 映射
CATEGORY_KEYWORDS = {
    "初印象|第一印象|开始玩|入坑|为什么玩|为什么选择|吸引": "初印象",
    "枪法|枪感|射击|瞄准|压枪|跟枪|定位|爆头|后坐力|手感|打击感|命中|音效.*射击|射击.*音效": "枪法手感",
    "身法|位移|走位|移动|机动性|闪避|急停": "身法机动",
    "战斗|刚枪|对枪|杀人|击杀|打架|进攻|主动|激进": "战斗倾向",
    "苟活|避战|躲|藏|蹲|苟|谨慎|保守|规避": "战斗倾向",
    "策略|战术|思考|决策|规划|地图|路线|信息|意识|运营": "策略决策",
    "团队|队友|配合|协作|开黑|组队|公会|社交|朋友|固定队|路人|队友|语音|沟通": "社交团队",
    "单人|独狼|单排|独行|一个人": "社交团队",
    "排位|段位|竞技|排名|上分|冲分|比赛|天梯|赛季|职业|电竞|胜负|赢|输": "竞技排位",
    "PVE|合作|剧情|任务|副本|打怪|Boss|刷": "PVE内容",
    "PVP|对抗|对战": "PVP内容",
    "放松|休闲|解压|消磨|碎片|随便|娱乐|开心|解闷|心情": "休闲放松",
    "沉浸|氛围|世界观|剧情|故事|角色|叙事|代入|环境|美术|画面|音效.*氛围|氛围.*音效": "沉浸体验",
    "收集|搜刮|摸金|大金|仓库|资源|装备|撤离|物资|保险|经营": "搜刮收集",
    "平台|PC|主机|手机|手游|手柄|键鼠|设备|性能|帧率|画质": "平台设备",
    "付费|氪金|皮肤|战令|买断|充值|氪|商城|价格|花钱|免费": "付费商业",
    "学习|上手|门槛|难度|新手|教程|入门|复杂|简单": "上手难度",
    "时间|肝|小时|碎片|日常|上班|学生|忙|没时间": "时间投入",
    "平衡|公平|外挂|作弊|炸鱼|ELO|匹配|辅助瞄准": "公平平衡",
    "更新|版本|新英雄|新内容|活动|赛季|改动": "版本更新",
    "模式|玩法|机制|系统|设计|大逃杀|BR|搜打撤|爆破|团队竞技|大战场|娱乐模式": "玩法模式",
    "英雄|角色|技能|大招|连携|C位|T位|奶位|辅助|坦克|输出": "英雄角色",
    "地图|据点|攻防|占点|地形|二楼": "地图设计",
    "音效|音乐|BGM|声音|听觉": "音效反馈",
    "UI|界面|HUD|交互|操作": "操作交互",
    "社区|社群|主播|UP主|视频|直播|内容|攻略|教学": "社区内容",
    "IP|漫威|DC|二次元|动漫|联动|电影|原著|宇宙": "IP题材",
    "皮肤|外观|装饰|自定义|造型|时装": "外观皮肤",
    "退款|卸载|弃坑|退游|不玩|放弃|劝退|失望": "负面体验",
    "满意|喜欢|爱|爽|好玩|推荐|吸引|优秀|出色|惊艳": "正面评价",
}


def classify_game(text: str, source_file: str) -> str:
    """从文本和源文件名推断游戏"""
    # 先看源文件名
    if "漫威" in source_file:
        return "漫威争锋"
    if "美国HD" in source_file:
        return "射击游戏（通用）"

    # 再看文本关键词
    scores = {}
    for pattern, game in GAME_KEYWORDS.items():
        matches = len(re.findall(pattern, text, re.IGNORECASE))
        if matches > 0:
            scores[game] = matches

    if scores:
        return max(scores, key=scores.get)
    return "未知"


def classify_category(text: str, source_file: str) -> str:
    """从文本推断分类"""
    # 如果文本很短，看 preceding_question
    if len(text) < 20:
        return "简短回应"

    scores = {}
    for pattern, cat in CATEGORY_KEYWORDS.items():
        matches = len(re.findall(pattern, text, re.IGNORECASE))
        if matches > 0:
            scores[cat] = scores.get(cat, 0) + matches

    if scores:
        return max(scores, key=scores.get)
    return "一般讨论"


def transform(in_path: str, out_path: str):
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for i, seg in enumerate(data):
        text = seg.get("original_text", "")
        source = seg.get("source_file", "")

        # 从源文件名提取 sheet
        if "漫威" in source:
            sheet = "中美用户洞察"
        elif "用户细分" in source:
            sheet = "用户细分研究"
        elif "生态与决策" in source:
            sheet = "用户生态与决策链路"
        else:
            sheet = "未知"

        seg["preceding_question"] = None
        seg["annotation"] = {
            "sheet": sheet,
            "game": classify_game(text, source),
            "category": classify_category(text, source),
        }
        seg["segment_index"] = i + 1

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 统计
    cats = {}
    for seg in data:
        c = seg["annotation"]["category"]
        cats[c] = cats.get(c, 0) + 1
    print(f"  {os.path.basename(in_path)}: {len(data)} 条")
    print(f"    分类分布: {dict(sorted(cats.items(), key=lambda x: -x[1])[:8])}")


for fname in FILES:
    in_path = os.path.join(BASE, fname)
    out_path = os.path.join(BASE, fname)
    transform(in_path, out_path)

print(f"\n✅ 3 个文件已按规范格式转换")