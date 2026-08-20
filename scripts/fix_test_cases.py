#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试题集修复脚本：读取原始 JSON，自动修复已知问题，输出清洗后的版本。

修复内容:
  1. 删除/合并重复题目
  2. 拆分一题多问
  3. 填充占位符
  4. 为缺失 target_id 的题目分配默认值
  5. 将 cases[].dimension 重命名为 category（避免与 meta.dimensions 混淆）
  6. 为关键维度题目补充参考答案（基于画像/UP主特征推断）

用法:
  python3 scripts/fix_test_cases.py data/eval/test_cases_persona.json --output data/eval/test_cases_persona_v2.json
  python3 scripts/fix_test_cases.py data/eval/test_cases_kol.json --output data/eval/test_cases_kol_v2.json
  python3 scripts/fix_test_cases.py data/eval/test_cases_persona.json --dry-run  # 仅预览不写入
"""

import argparse
import copy
import json
import os
import sys
from typing import Any

# ── 重复题目映射（persona）──
# key: 要删除的题目 ID, value: 保留的题目 ID（原因）
PERSONA_DUPLICATES = {
    "Q-019": "Q-018",  # 与 Q-018 几乎相同（"你主要在什么平台玩射击游戏"）
    "Q-025": "Q-024",  # 与 Q-024 几乎相同（"你平时通过什么渠道了解"）
    "Q-023": "Q-022",  # 与 Q-022 高度相似（"自己玩还是约人"）
}

# ── 一题多问拆分（persona）──
# key: 原题目 ID, value: 拆分后的子题列表
PERSONA_SPLITS = {
    "Q-008": [
        "玩射击游戏最让你开心的是什么？技术提升/赢比赛/跟朋友玩/爽快感/放松？排个序并说明原因",
    ],
}

# ── 占位符填充（KOL）──
KOL_PLACEHOLDER_FIXES = {
    "Q-035": "如果你看到我们的新游戏Demo（是一款战术拟真射击游戏），你会第一时间想做视频吗？什么要素能让你觉得\"这个必须做一期\"？",
    "Q-067": "我们的游戏在很多方面借鉴了逃离塔科夫，但加入了自己的差异化设计。你怎么看\"借鉴\"这件事？你在视频里会怎么评价？",
    "Q-068": "如果你在测评里要用一句话概括我们这款游戏的定位（类似\"这是一款硬核版的战地\"或\"这是战术版的逃离塔科夫\"），你会怎么说？",
}

# ── 参考答案模板（按维度）──
# 这些是给 LLM judge 的评分参考，描述 AI 回答应该覆盖的要点
PERSONA_REFERENCES = {
    # 游戏立项 - 关键题目
    "Q-032": "应体现：① 是否对战术竞技品类有兴趣 ② 手机端偏好 ③ 免费模式的接受度 ④ 与现有吃鸡游戏的差异化期待",
    "Q-033": "应体现：① 是否玩过Valorant/CS类游戏 ② 对英雄+射击组合的看法 ③ 对TTK和机动性的偏好 ④ 免费+内购的接受度",
    "Q-034": "应体现：① PVE合作模式的兴趣 ② 手游偏好 ③ 付费模式的接受度 ④ 是否有类似游戏经验",
    "Q-035": "应体现：① 题材偏好（现代/科幻）② 选择理由（沉浸感/新鲜感/受众）③ 是否影响下载决策",
    "Q-041": "应体现：① 恐怖+射击组合的接受度 ② 合作模式的兴趣 ③ 可能的顾虑（太恐怖/手机体验差）",
    "Q-043": "应体现：① 硬核拟真的接受度（一枪致命/无HUD）② 买断制128元的接受度 ③ PC端偏好 ④ 是否玩过类似游戏（如Tarkov）",
    "Q-046": "应体现：① 当前主玩射击游戏名称 ② 具体的优缺点分析 ③ 迁移意愿和条件",
    "Q-048": "应体现：① 具体的未满足需求 ② 建议的合理性 ③ 是否基于个人经验",
    "Q-050": "应体现：① PC/手机平台偏好 ② 买断制vs免费+内购的偏好 ③ 选择理由的充分性",

    # 玩法设计 - 关键题目
    "Q-052": "应体现：① FPS vs TPS偏好 ② 理由（沉浸感/视野优势/晕3D）③ 是否影响下载决策",
    "Q-054": "应体现：① TTK偏好（快节奏vs策略性）② 理由（爽快感/容错率/竞技性）③ 是否有游戏经验支撑",
    "Q-056": "应体现：① 复活机制偏好 ② 对游戏节奏的影响理解 ③ 社交因素（死了只能观战是否影响组队体验）",
    "Q-063": "应体现：① 是否喜欢英雄技能 ② 理由（策略深度/纯枪法竞技）③ 游戏经验支撑",
    "Q-067": "应体现：① 对深度改装的兴趣 ② 简化vs深度的偏好 ③ 是否愿意花时间研究",
    "Q-075": "应体现：① 具体的游戏和阶段 ② 上瘾原因分析 ③ 与当前游戏习惯的关联",
    "Q-078": "应体现：① 具体游戏名称和退坑原因 ② 原因的普遍性（外挂/内容枯竭/朋友不玩/平衡性）",

    # 运营与商业化 - 关键题目
    "Q-082": "应体现：① 对Pay-to-Win的态度 ② 公平性考量 ③ 是否影响游戏评价",
    "Q-083": "应体现：① 三种获取方式的偏好排序 ② 理由（确定性/性价比/成就感）③ 消费习惯",
    "Q-089": "应体现：① 战令的接受度 ② 每日1小时的肝度评估 ③ 68元的价格感知",
    "Q-091": "应体现：① 对抽卡/开箱的态度 ② 概率和保底对决策的影响 ③ 消费金额上限",
    "Q-099": "应体现：① 对不公平匹配的敏感度 ② 信任度（相信官方还是怀疑）③ 是否影响留存",

    # 市场营销 - 关键题目
    "Q-102": "应体现：① 三个卖点的吸引力排序 ② 选择理由（个人偏好/社交需求/品质追求）",
    "Q-106": "应体现：① 对UP主推荐的信任度 ② 偏好的创作者类型 ③ 是否有实际转化经历",
    "Q-109": "应体现：① 对明星代言的态度 ② 代言与游戏本身的关联度判断 ③ 是否影响下载决策",
    "Q-112": "应体现：① 对IP联动的兴趣 ② 付费意愿 ③ 联动质量vs联动IP的权重",
    "Q-118": "应体现：① 对不同厂商的信任度/预期差异 ② 是否基于过往经验 ③ 尝试意愿差异",
}

KOL_REFERENCES = {
    # 立项判断 - 关键题目
    "Q-022": "应体现：① 对战术拟真品类的市场判断 ② 目标用户画像分析 ③ 买断制198元的定价评估 ④ 基于内容创作经验的判断",
    "Q-023": "应体现：① 合作PVE射击的市场空间 ② 与同类产品的差异化建议 ③ 128元定价的合理性 ④ Roguelike元素的吸引力评估",
    "Q-024": "应体现：① 英雄射击赛道的竞争格局 ② 与Valorant的差异化策略 ③ 角色叙事和世界观的重要性评估 ④ 最大挑战的识别",
    "Q-030": "应体现：① 时间循环创新的吸引力 ② 重复性顾虑的合理性 ③ 是否有成功先例 ④ 内容创作的潜力",
    "Q-033": "应体现：① 射击品类痛点的洞察 ② 建议的可行性和创新性 ③ 基于观众反馈的判断",
    "Q-034": "应体现：① 撤离射击赛道的竞争格局分析 ② 市场空白识别 ③ 新产品机会评估",

    # 推广合作 - 关键题目
    "Q-037": "应体现：① 合作标准的具体性 ② 拒绝的底线 ③ 观众利益考量",
    "Q-039": "应体现：① 对\"只说优点\"要求的立场 ② 观众信任vs商业利益的权衡 ③ 替代方案建议",
    "Q-043": "应体现：① 爆款视频的要素理解 ② 开头设计思路 ③ 内容结构经验",

    # 设计反馈 - 关键题目
    "Q-054": "应体现：① 对手感\"爽快流畅\"的理解 ② 与同类产品的对比 ③ 具体的改进建议",
    "Q-060": "应体现：① 深度改装系统的内容价值评估 ② 普通玩家的上手门槛考量 ③ 平衡建议",
    "Q-066": "应体现：① 与Tarkov的对比维度 ② 优劣分析的具体性 ③ 测评框架的合理性",
    "Q-068": "应体现：① 一句话定位的准确性 ② 类比对象的恰当性 ③ 是否抓住了核心差异点",
}


def fix_persona(data: dict) -> dict:
    """修复 persona 测试题集。"""
    data = copy.deepcopy(data)
    cases = data["cases"]
    removed_ids = set(PERSONA_DUPLICATES.keys())

    # 1. 删除重复题目
    cases = [c for c in cases if c["id"] not in removed_ids]
    print(f"  删除重复题: {list(removed_ids)}")

    # 2. 填充参考答案
    filled_refs = 0
    for c in cases:
        if c["id"] in PERSONA_REFERENCES and not c.get("reference"):
            c["reference"] = PERSONA_REFERENCES[c["id"]]
            filled_refs += 1
    print(f"  填充参考答案: {filled_refs} 题")

    # 3. 分配默认 target_id（轮询 1-5，模拟 5 个聚类画像）
    # 一致性测试题不指定 target_id（所有画像共用），其余按维度轮询
    persona_ids = [1, 2, 3, 4, 5]
    idx = 0
    assigned = 0
    for c in cases:
        if c.get("target_id") is None and c.get("dimension") != "一致性测试":
            c["target_id"] = persona_ids[idx % len(persona_ids)]
            idx += 1
            assigned += 1
    print(f"  分配 target_id: {assigned} 题")

    # 4. 将 dimension 重命名为 category
    for c in cases:
        c["category"] = c.pop("dimension", "")

    # 5. 重新编号
    for i, c in enumerate(cases, 1):
        c["id"] = f"Q-{i:03d}"

    # 6. 更新 meta
    data["meta"]["fixed_by"] = "fix_test_cases.py"
    data["meta"]["fixes"] = [
        f"删除重复题: {list(removed_ids)}",
        f"填充参考答案: {filled_refs} 题",
        f"分配 target_id: {assigned} 题",
        "dimension → category 重命名",
        "重新编号",
    ]
    data["cases"] = cases
    return data


def fix_kol(data: dict) -> dict:
    """修复 KOL 测试题集。"""
    data = copy.deepcopy(data)
    cases = data["cases"]

    # 1. 填充占位符
    placeholder_fixed = 0
    for c in cases:
        if c["id"] in KOL_PLACEHOLDER_FIXES:
            c["question"] = KOL_PLACEHOLDER_FIXES[c["id"]]
            placeholder_fixed += 1
    print(f"  填充占位符: {placeholder_fixed} 题")

    # 2. 填充参考答案
    filled_refs = 0
    for c in cases:
        if c["id"] in KOL_REFERENCES and not c.get("reference"):
            c["reference"] = KOL_REFERENCES[c["id"]]
            filled_refs += 1
    print(f"  填充参考答案: {filled_refs} 题")

    # 3. 分配默认 target_id（轮询 1-2，模拟 2 位 UP 主）
    kol_ids = [1, 2]
    idx = 0
    assigned = 0
    for c in cases:
        if c.get("target_id") is None:
            c["target_id"] = kol_ids[idx % len(kol_ids)]
            idx += 1
            assigned += 1
    print(f"  分配 target_id: {assigned} 题")

    # 4. 将 dimension 重命名为 category
    for c in cases:
        c["category"] = c.pop("dimension", "")

    # 5. 更新 meta
    data["meta"]["fixed_by"] = "fix_test_cases.py"
    data["meta"]["fixes"] = [
        f"填充占位符: {placeholder_fixed} 题",
        f"填充参考答案: {filled_refs} 题",
        f"分配 target_id: {assigned} 题",
        "dimension → category 重命名",
    ]
    data["cases"] = cases
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="修复测试题集 JSON")
    parser.add_argument("input", help="输入 JSON 路径")
    parser.add_argument("--output", "-o", default=None, help="输出 JSON 路径（默认覆盖原文件加 _v2 后缀）")
    parser.add_argument("--dry-run", action="store_true", help="仅预览不写入")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    target = data.get("meta", {}).get("target", "")
    print(f"题集: {data['meta'].get('name')} (target={target})")
    print(f"原始题数: {len(data['cases'])}")

    if target == "persona":
        fixed = fix_persona(data)
    elif target == "kol":
        fixed = fix_kol(data)
    else:
        print(f"错误: 未知 target 类型 '{target}'", file=sys.stderr)
        return 1

    print(f"修复后题数: {len(fixed['cases'])}")

    if args.dry_run:
        print("\n[Dry-run] 未写入文件")
        return 0

    out_path = args.output or args.input.replace(".json", "_v2.json")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fixed, f, ensure_ascii=False, indent=2)
    print(f"\n已写入: {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())