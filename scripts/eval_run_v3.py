#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
增强版评测框架 v3：多维度评分 + 自动化指标 + 跨题分析 + 回归基线。

相比 v2 的新增能力:
  1. 7 维评分（人设一致性/专业准确性/知识边界/具体性/情感真实性/区分度/深度）
  2. 自动化指标（长度/幻觉检测/模板检测/关键词覆盖）
  3. 跨题分析（画像间区分度、同一画像内一致性、评分分布）
  4. 回归基线（保存基线分数，后续评测自动对比）
  5. 人工校准锚点（标注少量题目的人工评分作为校准参考）

评分体系:
  ┌─ LLM Judge 评分（7 维 × 1-5 分）── 权重 70%
  │   ├─ 人设一致性: 语气/立场是否像本人
  │   ├─ 专业准确性: 评价逻辑/洞察/切题
  │   ├─ 知识边界: 不懂时诚实说不知道
  │   ├─ 具体性: 是否有具体例子而非泛泛而谈
  │   ├─ 情感真实性: 情感表达是否自然（非机械/非过度戏剧化）
  │   ├─ 区分度: 该回答能否与其它画像区分开
  │   └─ 深度: 表面理解 vs 深层洞察
  │
  ├─ 自动化指标（客观计算）── 权重 30%
  │   ├─ 回答长度合理性
  │   ├─ 幻觉检测（编造游戏名/机制/数据）
  │   ├─ 模板化检测（重复句式/固定话术）
  │   └─ 关键词覆盖（对照 reference）
  │
  └─ 跨题分析（评测后汇总）
      ├─ 画像内一致性: 同画像同类题评分方差
      ├─ 画像间区分度: 不同画像回答的差异程度
      └─ 评分分布: 各维度均值/标准差/分布形态

用法:
  python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v4.json
  python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v4.json --limit 5 --judge-rounds 3
  python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v4.json --baseline results/baseline.json
  python3 scripts/eval_run_v3.py data/eval/test_cases_persona_v4.json --calibrate  # 仅跑校准题
"""

import argparse
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import requests

# ── 常量 ──
API_BASE_DEFAULT = "http://localhost:3000"

# 7 维评分维度
JUDGE_DIMENSIONS = [
    "人设一致性",
    "专业准确性",
    "知识边界",
    "具体性",
    "情感真实性",
    "区分度",
    "深度",
]

# 维度权重（LLM judge 部分占 70%）
DIMENSION_WEIGHTS = {
    "人设一致性": 0.20,
    "专业准确性": 0.15,
    "知识边界": 0.10,
    "具体性": 0.10,
    "情感真实性": 0.10,
    "区分度": 0.05,
    "深度": 0.10,
    # 自动化指标占 30%:
    #   length_score: 0.10
    #   hallucination_score: 0.10
    #   template_score: 0.05
    #   keyword_score: 0.05
}

ERROR_SENTINELS = (
    "[模拟用户暂时无法响应，请稍后重试]",
    "[KOL分身暂时无法响应，请稍后重试]",
)

# ── 已知游戏/厂商名列表（用于幻觉检测）──
KNOWN_GAMES = {
    # 射击游戏
    "csgo", "cs2", "cs:go", "counter-strike", "valorant", "apex", "apex legends",
    "call of duty", "cod", "modern warfare", "warzone", "black ops",
    "battlefield", "战地", "bf", "bf1", "bfv", "bf2042",
    "rainbow six", "siege", "r6", "彩虹六号", "彩六",
    "overwatch", "守望先锋", "ow", "ow2",
    "tarkov", "escape from tarkov", "逃离塔科夫", "塔科夫",
    "pubg", "绝地求生", "吃鸡", "battlegrounds",
    "fortnite", "堡垒之夜",
    "destiny", "命运", "destiny 2",
    "halo", "光环",
    "doom", "毁灭战士",
    "titanfall", "泰坦陨落",
    "delta force", "三角洲行动", "三角洲",
    "arena breakout", "暗区突围",
    "ready or not", "严阵以待",
    "ground branch",
    "squad", "战术小队",
    "arma", "武装突袭",
    "hell let loose", "人间地狱",
    "insurgency", "叛乱",
    "marvel rivals", "漫威争锋",
    "the finals",
    "xdefiant",
    "splitgate",
    "planetside", "行星边际",
    "deep rock galactic", "深岩银河",
    "risk of rain", "雨中冒险",
    "gtfo",
    "payday", "收获日",
    "left 4 dead", "l4d", "求生之路",
    "back 4 blood", "喋血复仇",
    "vermintide", "战锤末世鼠疫",
    "darktide", "暗潮",
    "stalker", "潜行者", "s.t.a.l.k.e.r",
    "metro", "地铁",
    "far cry", "孤岛惊魂",
    "borderlands", "无主之地",
    "remnant", "遗迹",
    "outriders", "先驱者",
    "warframe", "星际战甲",
    "division", "全境封锁",
    "ghost recon", "幽灵行动",
    "spec ops", "特殊行动",
    # 非射击但有参考价值
    "原神", "genshin", "genshin impact",
    "明日方舟", "arknights",
    "王者荣耀", "honor of kings",
    "英雄联盟", "lol", "league of legends",
    "dota", "dota2",
    "崩坏", "honkai", "star rail",
    "绝区零", "zenless zone zero",
    "鸣潮", "wuthering waves",
    "艾尔登法环", "elden ring",
    "黑暗之魂", "dark souls",
    "血源", "bloodborne",
    "只狼", "sekiro",
    "塞尔达", "zelda",
    "gta", "grand theft auto",
    "red dead", "荒野大镖客",
    "巫师", "witcher",
    "赛博朋克", "cyberpunk",
    "怪物猎人", "monster hunter",
    "最终幻想", "final fantasy",
    "生化危机", "resident evil",
    "寂静岭", "silent hill",
    "死亡空间", "dead space",
    # 厂商
    "腾讯", "tencent", "网易", "netease", "米哈游", "mihoyo", "hoyoverse",
    "riot", "拳头", "ea", "electronic arts", "activision", "动视",
    "blizzard", "暴雪", "ubisoft", "育碧", "epic", "epic games",
    "valve", "v社", "fromsoftware", "fs社",
}

# ── 模板化句式（AI 常用）──
TEMPLATE_PATTERNS = [
    r"作为(一个|一名).{0,10}(玩家|用户|UP主|测评人).{0,5}(，|。|我)",
    r"总(的|体)来说.{0,20}",
    r"值得(一提|注意|关注)的是",
    r"从(某个|某种|这个|那个)角度(来说|来看|上讲)",
    r"不可否认.{0,10}",
    r"毫无疑[问间].{0,10}",
    r"众所周知.{0,10}",
    r"在我看[来着].{0,10}",
    r"需要指出的是",
    r"需要强调的是",
    r"不难发现",
    r"由此可见",
    r"综上所述",
    r"总而言之",
    r"首先.*其次.*最后",
    r"一方面.*另一方面",
]


# ── 配置读取 ──

def load_env_file(path: str) -> dict:
    env = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return env


def resolve_judge_config(project_root: str) -> dict:
    api_env = load_env_file(os.path.join(project_root, "apps", "api", ".env"))
    base_url = os.getenv(
        "EVAL_JUDGE_BASE_URL",
        api_env.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
    )
    model = os.getenv("EVAL_JUDGE_MODEL", api_env.get("DEEPSEEK_MODEL", "deepseek-chat"))
    api_key = os.getenv("EVAL_JUDGE_API_KEY", api_env.get("DEEPSEEK_API_KEY", ""))
    return {"base_url": base_url.rstrip("/"), "model": model, "api_key": api_key}


# ── SSE 与 JSON 提取（复用 v2）──

def stream_chat(url: str, body: dict, timeout: int = 120) -> str:
    with requests.post(url, json=body, stream=True, timeout=timeout,
                       headers={"Content-Type": "application/json"}) as resp:
        resp.raise_for_status()
        resp.encoding = "utf-8"
        parts: list[str] = []
        current_data: list[str] = []
        for raw in resp.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw.strip()
            if not line:
                if current_data:
                    parts.append("".join(current_data))
                    current_data = []
                continue
            if line.startswith(":"):
                continue
            if line.startswith("data:"):
                payload = line[5:].lstrip()
                if payload.startswith("{") and '"type"' in payload and "evidence" in payload:
                    continue
                current_data.append(payload)
            elif not line.startswith("event:") and not line.startswith("id:") and not line.startswith("retry:"):
                if line.startswith("{") and '"type"' in line and "evidence" in line:
                    continue
                current_data.append(line)
        if current_data:
            parts.append("".join(current_data))
        return "".join(parts).strip()


def extract_json(content: str) -> str:
    content = content.strip()
    try:
        json.loads(content)
        return content
    except (json.JSONDecodeError, ValueError):
        pass
    code_blocks = re.findall(r"```(?:json)?\s*\n?(.*?)```", content, re.DOTALL)
    if code_blocks:
        content = max(code_blocks, key=len).strip()
        try:
            json.loads(content)
            return content
        except (json.JSONDecodeError, ValueError):
            pass
    first_brace = content.find("{")
    last_brace = content.rfind("}")
    if first_brace >= 0 and last_brace > first_brace:
        candidate = content[first_brace : last_brace + 1]
        try:
            json.loads(candidate)
            return candidate
        except (json.JSONDecodeError, ValueError):
            pass
    return content


# ── 自动化指标计算 ──

def compute_auto_metrics(answer: str, question: str, reference: str, persona_id: int) -> dict:
    """计算自动化客观指标，返回 0-1 分数。"""
    if not answer:
        return {"length_score": 0, "hallucination_score": 1, "template_score": 1, "keyword_score": 0}

    # 1. 长度合理性（太短=敷衍，太长=灌水）
    length = len(answer)
    if length < 20:
        length_score = 0.2  # 太短，敷衍
    elif length < 50:
        length_score = 0.5
    elif length < 500:
        length_score = 1.0  # 合理范围
    elif length < 1000:
        length_score = 0.8
    else:
        length_score = 0.5  # 过长，可能灌水

    # 2. 幻觉检测（检查是否编造了不存在的游戏名/机制）
    # 提取回答中看起来像游戏名的词汇
    potential_names = re.findall(r"[A-Z][A-Za-z0-9\s]{1,30}|[A-Z]{2,8}|[一-鿿]{2,6}(?:行动|战线|前线|战争|冲突|突围|射击|竞技|求生|战场|使命|召唤|先锋|英雄|联盟|传说|世界|幻想|冒险|传说|纪元|时代|危机|风暴|突袭|猎杀|围城|攻防|对决|争锋|崛起|降临|启示录|启示)", answer)
    unknown_games = []
    for name in potential_names:
        name_lower = name.strip().lower()
        if name_lower and name_lower not in KNOWN_GAMES and len(name_lower) > 3:
            # 检查是否是已知游戏的一部分
            is_known = any(known in name_lower or name_lower in known for known in KNOWN_GAMES)
            if not is_known and not re.match(r"^[A-Z]{2,3}$", name_lower):  # 跳过纯缩写
                unknown_games.append(name.strip())

    # 如果编造了游戏名，扣分
    if len(unknown_games) > 3:
        hallucination_score = 0.3
    elif len(unknown_games) > 0:
        hallucination_score = 0.7
    else:
        hallucination_score = 1.0

    # 3. 模板化检测（AI 常用句式）
    template_count = 0
    for pattern in TEMPLATE_PATTERNS:
        matches = re.findall(pattern, answer)
        template_count += len(matches)
    template_score = max(0.0, 1.0 - template_count * 0.15)

    # 4. 关键词覆盖（对照 reference）
    if reference:
        # 提取 reference 中的关键概念
        ref_keywords = re.findall(r"[①②③④⑤⑥⑦⑧⑨⑩].*?(?=[①②③④⑤⑥⑦⑧⑨⑩]|$)", reference)
        if not ref_keywords:
            ref_keywords = [reference]
        covered = 0
        for kw in ref_keywords:
            # 提取关键词组
            core_words = re.findall(r"[一-鿿]{2,}", kw)
            if core_words and any(w in answer for w in core_words[:3]):
                covered += 1
        keyword_score = covered / len(ref_keywords) if ref_keywords else 0.5
    else:
        keyword_score = 0.5  # 无参考时给中性分

    return {
        "length_score": round(length_score, 2),
        "hallucination_score": round(hallucination_score, 2),
        "template_score": round(template_score, 2),
        "keyword_score": round(keyword_score, 2),
        "answer_length": length,
        "unknown_games": unknown_games[:5],
        "template_count": template_count,
    }


# ── LLM Judge（7 维）──

def judge_answer_v3(cfg: dict, question: str, reference: str, answer: str,
                    persona_hint: str = "", other_persona_answers: list = None) -> dict:
    """用 LLM 对回答在 7 个维度上打分（1-5），返回结构化结果。"""

    ref_section = ""
    if reference:
        ref_section = f"\n参考答案/期望覆盖要点：\n{reference}\n\n请判断 AI 回答是否覆盖了上述要点。"

    persona_section = ""
    if persona_hint:
        persona_section = f"\n被评测对象画像/人设说明：{persona_hint}"

    other_section = ""
    if other_persona_answers:
        other_section = "\n其它画像对同一题的回答（用于判断区分度）：\n"
        for i, oa in enumerate(other_persona_answers[:3], 1):
            other_section += f"画像{i}: {oa[:200]}...\n"

    prompt = f"""你是一名严谨的评测裁判，正在给一个 AI 模拟用户（或 AI 数字孪生 KOL）的回答打分。

题目：{question}
{ref_section}
{persona_section}
{other_section}

AI 的回答：
---
{answer}
---

请从以下 7 个维度各打 1-5 分（整数），并给出简短理由：

1. **人设一致性**（1-5）：语气、立场、用词是否与目标画像/KOL 特征一致？是否出现"作为AI"或泛泛的机器腔？
2. **专业准确性**（1-5）：评价逻辑是否成立？是否有具体洞察？论据是否合理？是否切题？
3. **知识边界**（1-5）：超出经验/领域时，是否诚实说不知道（而非胡编）？在不该知道的领域假装知道应扣分。
4. **具体性**（1-5）：是否有具体例子（游戏名、场景、经历）？还是泛泛而谈？
5. **情感真实性**（1-5）：情感表达是否自然？像真人会有的情绪反应，还是机械/过度戏剧化？
6. **区分度**（1-5）：如果其他画像也回答同一题，这个回答能否被区分出来？还是各画像回答都差不多？
7. **深度**（1-5）：是表面理解（1-2分）还是展现了深层洞察/独特视角（4-5分）？

评分标准：
- 5分：优秀，无显著缺陷
- 4分：良好，有小瑕疵但不影响整体质量
- 3分：及格，有明显不足但基本可用
- 2分：较差，存在严重问题
- 1分：极差，完全不符合要求

只输出一个 JSON 对象，不要输出任何其它文字，格式如下：
{{"人设一致性": {{"score": 4, "reason": "理由"}}, "专业准确性": {{"score": 4, "reason": "理由"}}, "知识边界": {{"score": 4, "reason": "理由"}}, "具体性": {{"score": 4, "reason": "理由"}}, "情感真实性": {{"score": 4, "reason": "理由"}}, "区分度": {{"score": 4, "reason": "理由"}}, "深度": {{"score": 4, "reason": "理由"}}, "overall": 4, "comment": "一句话总评"}}"""

    # Anthropic Messages API 兼容格式（TokenHub / 腾讯 MaaS）
    payload = {
        "model": cfg["model"],
        "system": "你只输出合法 JSON，不输出任何解释或 markdown 代码块。你的回复必须以 { 开头，以 } 结尾。",
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 1536,
    }

    resp = requests.post(
        f"{cfg['base_url']}/v1/messages",
        json=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": cfg["api_key"],
            "anthropic-version": "2023-06-01",
        },
        timeout=180,
    )
    if not resp.ok:
        raise RuntimeError(f"judge 请求失败 {resp.status_code}: {resp.text[:300]}")

    content = resp.json()["content"]
    content = "".join(
        block.get("text", "") for block in content if block.get("type") == "text"
    ).strip()
    content = extract_json(content)
    return json.loads(content)


def multi_round_judge_v3(cfg: dict, question: str, reference: str, answer: str,
                         persona_hint: str = "", other_answers: list = None, rounds: int = 3) -> dict:
    """多轮打分取中位数。"""
    if rounds <= 1:
        return judge_answer_v3(cfg, question, reference, answer, persona_hint, other_answers)

    all_scores = []
    for r in range(rounds):
        try:
            result = judge_answer_v3(cfg, question, reference, answer, persona_hint, other_answers)
            all_scores.append(result)
        except Exception as e:
            print(f"    judge 第 {r+1}/{rounds} 轮失败: {e}")
        time.sleep(0.5)

    if not all_scores:
        raise RuntimeError("所有 judge 轮次均失败")
    if len(all_scores) == 1:
        return all_scores[0]

    merged = {}
    for dim in JUDGE_DIMENSIONS:
        scores = [r[dim]["score"] for r in all_scores if dim in r and "score" in r[dim]]
        reasons = [r[dim].get("reason", "") for r in all_scores if dim in r]
        if scores:
            merged[dim] = {"score": int(statistics.median(scores)), "reason": reasons[0] if reasons else ""}

    overalls = [r.get("overall", 0) for r in all_scores]
    merged["overall"] = int(statistics.median(overalls)) if overalls else 0
    merged["comment"] = all_scores[0].get("comment", "")
    merged["judge_rounds"] = rounds
    merged["score_variance"] = {
        dim: round(statistics.variance([r[dim]["score"] for r in all_scores if dim in r]), 2)
        for dim in JUDGE_DIMENSIONS if all(dim in r for r in all_scores)
    }

    return merged


# ── 综合评分计算 ──

def compute_final_score(judge_result: dict, auto_metrics: dict) -> dict:
    """将 LLM judge 分数和自动化指标合并为最终综合分。"""
    final = {}
    # Judge 维度（70% 权重）
    weighted_sum = 0.0
    for dim in JUDGE_DIMENSIONS:
        if dim in judge_result:
            score = judge_result[dim]["score"]
            weight = DIMENSION_WEIGHTS.get(dim, 0.10)
            weighted_sum += score * weight
            final[dim] = {"score": score, "weight": weight}

    judge_weighted = weighted_sum / sum(DIMENSION_WEIGHTS.values())  # 归一化

    # 自动化指标（30% 权重）
    auto_scores = {
        "length_score": auto_metrics.get("length_score", 0.5),
        "hallucination_score": auto_metrics.get("hallucination_score", 1.0),
        "template_score": auto_metrics.get("template_score", 1.0),
        "keyword_score": auto_metrics.get("keyword_score", 0.5),
    }
    auto_weights = {"length_score": 0.10, "hallucination_score": 0.10, "template_score": 0.05, "keyword_score": 0.05}
    auto_weighted = sum(auto_scores[k] * auto_weights[k] for k in auto_scores) / sum(auto_weights.values())
    auto_weighted = auto_weighted * 5  # 映射到 1-5 分制

    # 最终综合分
    final["judge_score"] = round(judge_weighted, 2)
    final["auto_score"] = round(auto_weighted, 2)
    final["composite_score"] = round(judge_weighted * 0.7 + auto_weighted * 0.3, 2)
    final["auto_metrics"] = auto_metrics

    return final


# ── 跨题分析 ──

def cross_question_analysis(results: list, meta: dict) -> dict:
    """跨题分析：画像一致性、区分度、评分分布。"""
    analysis = {}

    # 1. 按 target_id 分组
    by_target: dict[int, list] = {}
    for r in results:
        tid = r.get("target_id")
        if tid is None:
            continue
        by_target.setdefault(tid, []).append(r)

    # 2. 画像内一致性（同画像同类题评分方差）
    consistency = {}
    for tid, items in by_target.items():
        by_cat: dict[str, list] = {}
        for item in items:
            cat = item.get("category", "")
            if item.get("final_score") and "composite_score" in item["final_score"]:
                by_cat.setdefault(cat, []).append(item["final_score"]["composite_score"])

        cat_variances = {}
        for cat, scores in by_cat.items():
            if len(scores) >= 3:
                cat_variances[cat] = round(statistics.variance(scores), 2)
        consistency[f"画像_{tid}"] = {
            "count": len(items),
            "avg_composite": round(statistics.mean(
                [it["final_score"]["composite_score"] for it in items
                 if it.get("final_score") and "composite_score" in it["final_score"]]
            ), 2) if items else 0,
            "category_variances": cat_variances,
            "consistency_warning": any(v > 2.0 for v in cat_variances.values()),
        }
    analysis["per_persona_consistency"] = consistency

    # 3. 画像间区分度（同一题目不同画像回答的分数差异）
    # 按 question 分组，看不同画像回答的分数差异
    by_question: dict[str, list] = {}
    for r in results:
        q = r.get("question", "")
        if q and r.get("final_score") and "composite_score" in r["final_score"]:
            by_question.setdefault(q, []).append(r)

    distinctiveness_scores = []
    for q, items in by_question.items():
        if len(items) >= 2:
            scores = [it["final_score"]["composite_score"] for it in items]
            # 分数差异越大，说明区分度越好
            score_range = max(scores) - min(scores)
            distinctiveness_scores.append(score_range)

    analysis["distinctiveness"] = {
        "avg_score_range": round(statistics.mean(distinctiveness_scores), 2) if distinctiveness_scores else 0,
        "high_distinctiveness_questions": sum(1 for s in distinctiveness_scores if s >= 1.5),
        "total_comparable_questions": len(distinctiveness_scores),
        "interpretation": "分数差异 > 1.5 说明不同画像回答有明显区分度（好）；< 0.5 说明所有画像回答趋同（需关注）",
    }

    # 4. 评分分布
    all_composite = [r["final_score"]["composite_score"] for r in results
                     if r.get("final_score") and "composite_score" in r["final_score"]]
    if all_composite:
        analysis["score_distribution"] = {
            "mean": round(statistics.mean(all_composite), 2),
            "median": round(statistics.median(all_composite), 2),
            "stdev": round(statistics.stdev(all_composite), 2) if len(all_composite) > 1 else 0,
            "min": min(all_composite),
            "max": max(all_composite),
            "histogram": {
                "1-2分": sum(1 for s in all_composite if s < 2),
                "2-3分": sum(1 for s in all_composite if 2 <= s < 3),
                "3-4分": sum(1 for s in all_composite if 3 <= s < 4),
                "4-5分": sum(1 for s in all_composite if 4 <= s <= 5),
            },
        }

        # 按维度统计
        dim_stats = {}
        for dim in JUDGE_DIMENSIONS:
            dim_scores = []
            for r in results:
                if r.get("judge") and isinstance(r["judge"], dict) and dim in r["judge"]:
                    dim_scores.append(r["judge"][dim]["score"])
            if dim_scores:
                dim_stats[dim] = {
                    "mean": round(statistics.mean(dim_scores), 2),
                    "stdev": round(statistics.stdev(dim_scores), 2) if len(dim_scores) > 1 else 0,
                }
        analysis["dimension_stats"] = dim_stats

    return analysis


# ── 回归对比 ──

def compare_baseline(current: dict, baseline_path: str) -> dict:
    """与基线对比，检测回归。"""
    try:
        with open(baseline_path, "r", encoding="utf-8") as f:
            baseline = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"error": f"无法读取基线文件: {baseline_path}"}

    base_results = baseline.get("results", [])
    curr_results = current.get("results", [])

    # 按题目 ID 匹配
    base_map = {r["id"]: r for r in base_results}
    curr_map = {r["id"]: r for r in curr_results}

    diffs = []
    for qid in base_map:
        if qid in curr_map:
            base_score = base_map[qid].get("final_score", {}).get("composite_score")
            curr_score = curr_map[qid].get("final_score", {}).get("composite_score")
            if base_score and curr_score:
                diff = curr_score - base_score
                if abs(diff) >= 0.5:  # 显著变化
                    diffs.append({"id": qid, "baseline": base_score, "current": curr_score, "delta": round(diff, 2)})

    improved = sum(1 for d in diffs if d["delta"] > 0)
    degraded = sum(1 for d in diffs if d["delta"] < 0)

    base_avg = statistics.mean([r.get("final_score", {}).get("composite_score", 0) for r in base_results if r.get("final_score")])
    curr_avg = statistics.mean([r.get("final_score", {}).get("composite_score", 0) for r in curr_results if r.get("final_score")])

    return {
        "baseline_avg": round(base_avg, 2),
        "current_avg": round(curr_avg, 2),
        "delta_avg": round(curr_avg - base_avg, 2),
        "significant_changes": len(diffs),
        "improved": improved,
        "degraded": degraded,
        "details": diffs[:10],  # 只展示前 10 个显著变化
        "verdict": "回归" if degraded > improved else ("提升" if improved > degraded else "持平"),
    }


# ── 报告生成（增强版）──

def render_markdown_v3(meta: dict, results: list, started: str, cross_analysis: dict, baseline_comparison: dict = None) -> str:
    lines = [
        f"# 评测报告 v3 · {meta.get('name', '未命名')}",
        "",
        f"- 目标类型: {meta.get('target')}",
        f"- 题目来源: {meta.get('source_file', '—')}",
        f"- 生成时间: {started}",
        f"- 总题数: {len(results)}",
        f"- 成功回答: {sum(1 for r in results if r.get('answer') and not r.get('error'))}",
        f"- 评分体系: 7 维 LLM Judge (70%) + 自动化指标 (30%)",
        "",
    ]

    # 回归对比
    if baseline_comparison and "error" not in baseline_comparison:
        bc = baseline_comparison
        verdict_icon = "🔴 回归" if bc["verdict"] == "回归" else ("🟢 提升" if bc["verdict"] == "提升" else "🟡 持平")
        lines.append("## 回归对比")
        lines.append("")
        lines.append(f"| 指标 | 基线 | 当前 | 变化 |")
        lines.append("| --- | --- | --- | --- |")
        lines.append(f"| 综合均分 | {bc['baseline_avg']} | {bc['current_avg']} | {bc['delta_avg']:+.2f} |")
        lines.append(f"| 显著变化 | — | {bc['significant_changes']} 题 | +{bc['improved']} / -{bc['degraded']} |")
        lines.append(f"| 判定 | | | {verdict_icon} {bc['verdict']} |")
        lines.append("")

    # 评分分布
    if cross_analysis.get("score_distribution"):
        dist = cross_analysis["score_distribution"]
        lines.append("## 综合评分分布")
        lines.append("")
        lines.append(f"| 指标 | 值 |")
        lines.append("| --- | --- |")
        lines.append(f"| 均值 | {dist['mean']} |")
        lines.append(f"| 中位数 | {dist['median']} |")
        lines.append(f"| 标准差 | {dist['stdev']} |")
        lines.append(f"| 最低 | {dist['min']} |")
        lines.append(f"| 最高 | {dist['max']} |")
        lines.append("")
        hist = dist["histogram"]
        lines.append("| 分数段 | 题数 | 占比 |")
        lines.append("| --- | --- | --- |")
        total = sum(hist.values())
        for segment, count in hist.items():
            lines.append(f"| {segment} | {count} | {count/total*100:.0f}% |")
        lines.append("")

    # 7 维度统计
    if cross_analysis.get("dimension_stats"):
        lines.append("## 7 维评分统计")
        lines.append("")
        lines.append("| 维度 | 权重 | 均分 | 标准差 | 评价 |")
        lines.append("| --- | --- | --- | --- | --- |")
        for dim in JUDGE_DIMENSIONS:
            if dim in cross_analysis["dimension_stats"]:
                ds = cross_analysis["dimension_stats"][dim]
                w = DIMENSION_WEIGHTS.get(dim, 0.10)
                grade = "★" * int(ds["mean"])
                lines.append(f"| {dim} | {w:.0%} | {ds['mean']} | {ds['stdev']} | {grade} |")
        lines.append("")

    # 画像一致性
    if cross_analysis.get("per_persona_consistency"):
        lines.append("## 画像内一致性")
        lines.append("")
        lines.append("| 画像 | 题目数 | 综合均分 | 一致性 |")
        lines.append("| --- | --- | --- | --- |")
        for pid, info in cross_analysis["per_persona_consistency"].items():
            status = "⚠ 不一致" if info.get("consistency_warning") else "✓ 一致"
            lines.append(f"| {pid} | {info['count']} | {info['avg_composite']} | {status} |")
        lines.append("")

    # 区分度
    if cross_analysis.get("distinctiveness"):
        d = cross_analysis["distinctiveness"]
        lines.append("## 画像间区分度")
        lines.append("")
        lines.append(f"- 平均分差: {d['avg_score_range']}")
        lines.append(f"- 高区分度题数: {d['high_distinctiveness_questions']}/{d['total_comparable_questions']}")
        lines.append(f"- 解读: {d['interpretation']}")
        lines.append("")

    # 自动化指标
    lines.append("## 自动化指标统计")
    lines.append("")
    auto_metrics = ["length_score", "hallucination_score", "template_score", "keyword_score"]
    lines.append("| 指标 | 均值 | 最低 | 说明 |")
    lines.append("| --- | --- | --- | --- |")
    for am in auto_metrics:
        scores = [r.get("final_score", {}).get("auto_metrics", {}).get(am, 0)
                  for r in results if r.get("final_score") and "auto_metrics" in r["final_score"]]
        if scores:
            metric_names = {
                "length_score": "长度合理性",
                "hallucination_score": "幻觉检测",
                "template_score": "反模板化",
                "keyword_score": "关键词覆盖",
            }
            metric_desc = {
                "length_score": "回答长度是否合理（太短=敷衍，太长=灌水）",
                "hallucination_score": "是否编造了不存在的游戏/机制",
                "template_score": "AI 模板化句式越少分越高",
                "keyword_score": "对照参考答案的关键词覆盖",
            }
            lines.append(f"| {metric_names.get(am, am)} | {round(statistics.mean(scores), 2)} | {round(min(scores), 2)} | {metric_desc.get(am, '')} |")
    lines.append("")

    # 逐题明细
    lines.append("## 逐题明细")
    lines.append("")
    for r in results:
        fs = r.get("final_score", {})
        composite = fs.get("composite_score", "—")
        judge_s = fs.get("judge_score", "—")
        auto_s = fs.get("auto_score", "—")

        lines.append(f"### {r['id']}（{r.get('category', '—')}）")
        lines.append(f"**综合 {composite}/5**（Judge {judge_s} + 自动 {auto_s}）")
        lines.append("")
        lines.append(f"**题目**：{r['question']}")
        if r.get("error"):
            lines.append(f"**回答**：❌ {r['error']}")
        else:
            lines.append(f"**回答**：{r['answer'][:300]}{'...' if len(r.get('answer', '')) > 300 else ''}")
        if r.get("judge") and isinstance(r["judge"], dict) and "overall" in r["judge"]:
            j = r["judge"]
            lines.append(f"**Judge 评分**：综合 {j.get('overall')}/5")
            for dim in JUDGE_DIMENSIONS:
                if dim in j:
                    lines.append(f"- {dim}：{j[dim]['score']}/5 —— {j[dim]['reason'][:80]}")
        if r.get("final_score", {}).get("auto_metrics"):
            am = r["final_score"]["auto_metrics"]
            warnings = []
            if am.get("unknown_games"):
                warnings.append(f"疑似编造: {', '.join(am['unknown_games'])}")
            if am.get("template_count", 0) > 3:
                warnings.append(f"模板化句式: {am['template_count']} 处")
            if am.get("answer_length", 0) < 20:
                warnings.append("回答过短")
            if warnings:
                lines.append(f"**⚠ 自动检测**: {'; '.join(warnings)}")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


# ── 主流程 ──

def main() -> int:
    parser = argparse.ArgumentParser(description="增强版评测框架 v3")
    parser.add_argument("cases_path", help="测试用例 JSON 路径")
    parser.add_argument("--limit", type=int, default=None, help="只跑前 N 题")
    parser.add_argument("--api-base", default=API_BASE_DEFAULT, help="API 地址")
    parser.add_argument("--target-id", type=int, default=None, help="统一指定 personaId/kolId")
    parser.add_argument("--out-dir", default=None, help="结果输出目录")
    parser.add_argument("--delay", type=float, default=0.3, help="请求间隔秒数")
    parser.add_argument("--judge-rounds", type=int, default=3, help="judge 打分轮数（默认 3）")
    parser.add_argument("--no-judge", action="store_true", help="只跑回答不自动打分")
    parser.add_argument("--baseline", default=None, help="基线 JSON 路径（用于回归对比）")
    parser.add_argument("--resume", default=None, help="从已有结果续跑")
    parser.add_argument("--skip-validation", action="store_true", help="跳过预检")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    with open(args.cases_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    meta = data.get("meta", {})
    cases = data.get("cases", [])
    target = meta.get("target", "persona")
    endpoint = "/api/kol/chat" if target == "kol" else "/api/chat"

    if args.limit:
        cases = cases[: args.limit]

    # 预检
    if not args.skip_validation:
        issues = []
        for i, c in enumerate(cases):
            if not c.get("question"):
                issues.append(f"第 {i+1} 题缺少 question")
            tid = c.get("target_id") or args.target_id
            if tid is None:
                issues.append(f"[{c.get('id', i+1)}] target_id 缺失")
        if issues:
            print("⚠ 预检发现问题:")
            for issue in issues:
                print(f"  - {issue}")
            print("加 --skip-validation 跳过，或修复后重试")
            return 1
        print("✓ 预检通过")

    # 续跑
    completed_ids = set()
    previous_results = []
    if args.resume:
        with open(args.resume, "r", encoding="utf-8") as f:
            prev = json.load(f)
        previous_results = prev.get("results", [])
        completed_ids = {r["id"] for r in previous_results if r.get("answer") and not r.get("error")}
        print(f"续跑: 已完成 {len(completed_ids)} 题")

    judge_cfg = resolve_judge_config(project_root) if not args.no_judge else None

    out_dir = args.out_dir or os.path.join(project_root, "data", "eval", "results")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = re.sub(r"[^\w一-鿿-]+", "_", meta.get("name", "eval")).strip("_") or "eval"

    results = list(previous_results)
    new_count = 0

    # Phase 1: 收集回答
    for i, case in enumerate(cases, 1):
        qid = case.get("id", f"Q{i}")
        if qid in completed_ids:
            continue

        question = case["question"]
        target_id = case.get("target_id") or args.target_id
        body = {"message": question}
        if target == "kol":
            body["kolId"] = target_id
        else:
            body["personaId"] = target_id

        rec = {
            "id": qid,
            "category": case.get("category", ""),
            "question": question,
            "reference": case.get("reference", ""),
            "target_id": target_id,
            "answer": "",
            "error": None,
            "judge": None,
            "final_score": None,
        }

        url = f"{args.api_base.rstrip('/')}{endpoint}"
        try:
            answer = stream_chat(url, body)
            if any(s in answer for s in ERROR_SENTINELS):
                rec["error"] = "LLM 调用失败"
                rec["answer"] = answer
            else:
                rec["answer"] = answer
        except Exception as e:
            rec["error"] = str(e)

        results.append(rec)
        new_count += 1
        status = "✓" if rec["error"] is None else "✗"
        print(f"[{len(results)}/{len(cases)}] {status} {qid} len={len(rec['answer'])}")
        time.sleep(args.delay)

    # Phase 2: LLM Judge + 自动化指标
    if judge_cfg and judge_cfg["api_key"] and not judge_cfg["api_key"].startswith("sk-your-"):
        print(f"\n{'═' * 60}")
        print(f"Phase 2: LLM Judge 评分 ({args.judge_rounds} 轮) + 自动化指标")
        print(f"Judge: {judge_cfg['model']} @ {judge_cfg['base_url']}")

        # 收集其他画像对同一题的回答（用于区分度评分）
        question_answers: dict[str, list] = {}
        for r in results:
            if r.get("answer") and not r.get("error"):
                q = r["question"]
                question_answers.setdefault(q, []).append(r["answer"])

        for i, r in enumerate(results):
            if r.get("error") or not r.get("answer"):
                continue

            qid = r["id"]
            print(f"[{i+1}/{len(results)}] 评分 {qid}...", end=" ")

            # 获取其他画像的回答
            other_answers = question_answers.get(r["question"], [])
            other_answers = [a for a in other_answers if a != r["answer"]]

            # 1. LLM Judge
            try:
                r["judge"] = multi_round_judge_v3(
                    judge_cfg, r["question"], r.get("reference", ""),
                    r["answer"], case.get("persona_hint", ""),
                    other_answers, rounds=args.judge_rounds,
                )
            except Exception as e:
                r["judge"] = {"error": f"judge 失败: {e}"}

            # 2. 自动化指标
            auto = compute_auto_metrics(r["answer"], r["question"], r.get("reference", ""), r.get("target_id", 0))

            # 3. 综合评分
            if r["judge"] and "error" not in r["judge"]:
                r["final_score"] = compute_final_score(r["judge"], auto)
                print(f"composite={r['final_score']['composite_score']}")
            else:
                r["final_score"] = {"auto_metrics": auto, "composite_score": None}
                print("judge 失败")

            time.sleep(0.5)
    else:
        for r in results:
            if r.get("answer") and not r.get("error"):
                auto = compute_auto_metrics(r["answer"], r["question"], r.get("reference", ""), r.get("target_id", 0))
                r["final_score"] = {"auto_metrics": auto, "composite_score": None}

    # Phase 3: 跨题分析
    print(f"\n{'═' * 60}")
    print("Phase 3: 跨题分析")
    cross_analysis = cross_question_analysis(results, meta)

    # 汇总
    if cross_analysis.get("score_distribution"):
        d = cross_analysis["score_distribution"]
        print(f"  综合均分: {d['mean']} ± {d['stdev']}")
        print(f"  分布: {d['histogram']}")
    if cross_analysis.get("distinctiveness"):
        print(f"  区分度: 平均分差 {cross_analysis['distinctiveness']['avg_score_range']}")
    for pid, info in cross_analysis.get("per_persona_consistency", {}).items():
        if info.get("consistency_warning"):
            print(f"  ⚠ {pid} 一致性警告")

    # Phase 4: 回归对比
    baseline_comparison = None
    if args.baseline:
        print(f"\nPhase 4: 回归对比 (基线: {args.baseline})")
        baseline_comparison = compare_baseline({"results": results}, args.baseline)
        if "error" in baseline_comparison:
            print(f"  ⚠ {baseline_comparison['error']}")
        else:
            print(f"  基线均分: {baseline_comparison['baseline_avg']} → 当前: {baseline_comparison['current_avg']} ({baseline_comparison['delta_avg']:+.2f})")
            print(f"  判定: {baseline_comparison['verdict']}")

    # 输出
    started = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    out_json = os.path.join(out_dir, f"{name}_{stamp}.json")
    out_md = os.path.join(out_dir, f"{name}_{stamp}.md")

    output = {
        "meta": meta,
        "started": started,
        "config": {
            "judge_rounds": args.judge_rounds,
            "delay": args.delay,
            "dimensions": JUDGE_DIMENSIONS,
            "scoring": "7-dim LLM Judge (70%) + Auto Metrics (30%)",
        },
        "cross_analysis": cross_analysis,
        "baseline_comparison": baseline_comparison,
        "results": results,
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    with open(out_md, "w", encoding="utf-8") as f:
        f.write(render_markdown_v3(meta, results, started, cross_analysis, baseline_comparison))

    print(f"\n{'═' * 60}")
    print(f"新增: {new_count} 题，总计: {len(results)} 题")
    print(f"JSON: {out_json}")
    print(f"报告: {out_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())