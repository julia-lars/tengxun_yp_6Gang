#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证评测题集有效性：对比 AI 回答与真人访谈回答，检验评测体系能否区分二者。

验证逻辑:
  1. 加载测试题集（persona_v4 / kol_v4）
  2. 加载真人访谈数据（segments_*.json），按主题匹配测试题
  3. 生成 AI 回答（调用 API）
  4. 对 AI 回答和真人回答分别打分（7 维 + 自动化指标）
  5. 统计对比：AI vs 真人 在各维度上的差异是否显著
  6. 输出验证报告

核心指标:
  - 区分度：AI 与真人回答的分数差异是否有统计显著性（Cohen's d）
  - 维度有效性：哪些维度最能区分 AI 和真人
  - 分类准确率：仅凭评分能否正确分类 AI/真人

用法:
  python3 scripts/validate_with_human.py data/eval/test_cases_persona_v4.json --limit 20
  python3 scripts/validate_with_human.py data/eval/test_cases_persona_v4.json --no-ai  # 仅分析真人数据
  python3 scripts/validate_with_human.py data/eval/test_cases_persona_v4.json --api-base http://localhost:3000
"""

import argparse
import json
import math
import os
import random
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from typing import Any

import requests

# ── 复用 eval_run_v3 的评分逻辑 ──
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eval_run_v3 import (
    compute_auto_metrics,
    extract_json,
    stream_chat,
    resolve_judge_config,
    multi_round_judge_v3,
    compute_final_score,
    JUDGE_DIMENSIONS,
    DIMENSION_WEIGHTS,
    ERROR_SENTINELS,
)

# ── 常量 ──
SEGMENTS_DIR = "data/群体画像"
RESPONDENTS_DIR = "data/群体画像"
KOL_DIR = "data/kol"

# 测试题 category → 访谈主题关键词映射
CATEGORY_KEYWORDS = {
    "游戏立项": ["立项", "新游戏", "开发", "题材", "买断", "免费", "付费模式", "128", "198", "298",
                 "上线", "试玩", "demo", "下载", "尝试", "科幻", "现代战争", "废土", "恐怖",
                 "感兴趣", "吸引", "品类", "类型", "端游", "手游", "PC", "主机"],
    "玩法设计": ["玩法", "TTK", "视角", "FPS", "TPS", "第一人称", "第三人称", "复活", "技能",
                 "英雄", "匹配", "地图", "模式", "手感", "改装", "武器", "枪", "Rank",
                 "排位", "段位", "机制", "设计", "操作", "难", "简单", "硬核", "休闲"],
    "运营与商业化": ["付费", "皮肤", "内购", "抽卡", "开箱", "战令", "Battle Pass", "肝",
                    "氪金", "Pay to Win", "公平", "价格", "花钱", "充值", "活动", "更新",
                    "运营", "日常", "任务", "奖励", "通行证", "限时", "商城", "定价"],
    "市场营销": ["广告", "UP主", "主播", "KOL", "代言", "联动", "IP", "品牌", "宣传",
                "口碑", "推荐", "朋友", "社区", "视频", "直播", "评测", "测评", "预告",
                "信任", "厂商", "腾讯", "网易", "米哈游", "EA", "暴雪", "育碧"],
    "一致性测试": ["玩游戏", "时间", "频率", "每天", "每周", "偏好", "喜欢", "习惯",
                  "类型", "风格", "平台", "设备", "外挂", "队友", "开黑", "组队",
                  "单排", "游戏经历", "经历", "第一次", "最", "沉迷", "退坑", "弃坑"],
    "设计反馈": ["设计", "反馈", "建议", "改进", "问题", "痛点", "体验", "差",
                "不好", "弃坑", "流失", "意见", "看法", "评价", "对比", "借鉴"],
    "推广合作": ["合作", "推广", "广告", "视频", "内容", "观众", "粉丝", "商单",
                "报价", "标准", "原则", "底线", "信任", "口碑", "品牌", "恰饭"],
    "立项判断": ["立项", "判断", "市场", "赛道", "竞争", "差异化", "潜力", "风险",
                "成功", "失败", "案例", "数据", "趋势", "机会", "挑战"],
}


def load_segments(segments_dir: str) -> list[dict]:
    """加载所有真人访谈 segment。"""
    all_segments = []
    for fname in sorted(os.listdir(segments_dir)):
        if fname.startswith("segments_") and fname.endswith(".json"):
            path = os.path.join(segments_dir, fname)
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for seg in data:
                seg["_source_file"] = fname
                all_segments.append(seg)
    return all_segments


def load_respondents(respondents_dir: str) -> dict[str, dict]:
    """加载受访者画像信息。"""
    respondents = {}
    for fname in sorted(os.listdir(respondents_dir)):
        if fname.startswith("respondents_") and fname.endswith(".json"):
            path = os.path.join(respondents_dir, fname)
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            for r in data:
                sid = r.get("speaker_id", "")
                if sid:
                    respondents[sid] = r
    return respondents


def match_segments_to_category(segments: list[dict], category: str, max_results: int = 50) -> list[dict]:
    """根据关键词匹配，找到与某 category 最相关的真人回答 segment。"""
    keywords = CATEGORY_KEYWORDS.get(category, [])
    scored = []

    for seg in segments:
        text = (seg.get("original_text") or "") + " " + (seg.get("cleaned_text") or "")
        if not text.strip() or len(text) < 30:
            continue
        # 只取受访者回答（非主持人提问）
        if seg.get("speaker_role") != "interviewee":
            continue

        # 关键词匹配得分
        score = 0
        for kw in keywords:
            if kw in text or kw in (seg.get("preceding_question") or ""):
                score += 1

        if score > 0:
            scored.append((score, seg))

    scored.sort(key=lambda x: -x[0])
    return [s[1] for s in scored[:max_results]]


def find_best_match(segments: list[dict], question: str, top_n: int = 3) -> list[dict]:
    """找到与给定测试题最匹配的真人回答（基于关键词 + 字符 overlap）。"""
    q_chars = set(re.sub(r"[^\w一-鿿]", "", question))

    scored = []
    for seg in segments:
        text = (seg.get("original_text") or "") + " " + (seg.get("cleaned_text") or "")
        if not text.strip() or len(text) < 30:
            continue
        if seg.get("speaker_role") != "interviewee":
            continue

        # Jaccard 相似度
        t_chars = set(re.sub(r"[^\w一-鿿]", "", text))
        if not t_chars:
            continue
        intersection = len(q_chars & t_chars)
        union = len(q_chars | t_chars)
        jaccard = intersection / union if union > 0 else 0

        # 关键词匹配加分
        q_words = set(re.findall(r"[一-鿿]{2,}", question))
        keyword_bonus = sum(1 for w in q_words if w in text) * 0.05

        score = jaccard + keyword_bonus
        if score > 0.05:
            scored.append((score, seg))

    scored.sort(key=lambda x: -x[0])
    return [s[1] for s in scored[:top_n]]


def answer_by_speaker(segments: list[dict], speaker_id: str) -> str:
    """将同一受访者的多个 segment 合并为一段回答。"""
    texts = []
    for seg in segments:
        text = seg.get("cleaned_text") or seg.get("original_text") or ""
        if text.strip() and len(text) > 20:
            texts.append(text.strip())
    return "\n\n".join(texts[:5])  # 最多 5 段


def generate_ai_answers(cases: list[dict], api_base: str, target: str, delay: float = 0.3) -> list[dict]:
    """调用 API 为测试题生成 AI 回答。"""
    endpoint = "/api/kol/chat" if target == "kol" else "/api/chat"
    results = []

    for i, case in enumerate(cases):
        question = case["question"]
        target_id = case.get("target_id")
        body = {"message": question}
        if target == "kol":
            body["kolId"] = target_id
        else:
            body["personaId"] = target_id

        rec = {
            "id": case.get("id", f"Q{i+1}"),
            "category": case.get("category", ""),
            "question": question,
            "reference": case.get("reference", ""),
            "target_id": target_id,
            "answer": "",
            "error": None,
            "source": "ai",
        }

        url = f"{api_base.rstrip('/')}{endpoint}"
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
        status = "✓" if rec["error"] is None else "✗"
        print(f"  [{i+1}/{len(cases)}] {status} {rec['id']} len={len(rec['answer'])}")
        time.sleep(delay)

    return results


def generate_ai_via_deepseek(cases: list[dict], judge_cfg: dict, delay: float = 0.5) -> list[dict]:
    """通过 DeepSeek API 直接生成 AI 回答（模拟画像/KOL 角色）。"""
    results = []

    for i, case in enumerate(cases):
        question = case["question"]
        category = case.get("category", "")
        target_id = case.get("target_id")

        # 构建角色提示
        persona_prompt = "你是一个真实的射击游戏玩家，请用自然的口语化语言回答，像在和朋友聊天一样。"
        if target_id:
            persona_prompt += f" 你的玩家画像ID是{target_id}，请基于该画像的典型特征回答。"

        payload = {
            "model": judge_cfg["model"],
            "messages": [
                {"role": "system", "content": persona_prompt},
                {"role": "user", "content": question},
            ],
            "temperature": 0.7,
            "max_tokens": 1024,
        }

        rec = {
            "id": case.get("id", f"Q{i+1}"),
            "category": category,
            "question": question,
            "reference": case.get("reference", ""),
            "target_id": target_id,
            "answer": "",
            "error": None,
            "source": "ai",
            "ai_provider": "deepseek",
        }

        try:
            resp = requests.post(
                f"{judge_cfg['base_url']}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {judge_cfg['api_key']}"},
                timeout=120,
            )
            if resp.ok:
                rec["answer"] = resp.json()["choices"][0]["message"]["content"].strip()
            else:
                rec["error"] = f"API {resp.status_code}: {resp.text[:200]}"
        except Exception as e:
            rec["error"] = str(e)

        results.append(rec)
        status = "✓" if rec["error"] is None else "✗"
        print(f"  [{i+1}/{len(cases)}] {status} {rec['id']} len={len(rec['answer'])}")
        time.sleep(delay)

    return results


def generate_simulated_ai(cases: list[dict]) -> list[dict]:
    """生成模拟 AI 回答（用于在没有 API 时测试评测框架的区分能力）。

    模拟 AI 回答的典型特征：
      - 模板化句式（综上所述、首先其次最后）
      - 泛泛而谈，缺乏具体例子
      - 过于礼貌/正式
      - 偶尔会编造游戏名
    """
    import random

    # 预设的 AI 模板回答（按 category）
    AI_TEMPLATES = {
        "一致性测试": [
            "作为一个热爱射击游戏的玩家，我平时主要玩PC端的射击游戏。首先，我觉得射击游戏的核心在于竞技性和操作感。其次，团队配合也非常重要。总体来说，我每周花在游戏上的时间大概在10-15小时左右，会根据工作和生活节奏灵活调整。在游戏选择上，我比较看重游戏的平衡性和更新频率，这也是我长期留在一款游戏的关键因素。",
            "从我的游戏经历来看，射击游戏最重要的就是手感和反馈。我玩过很多款射击游戏，包括一些主流和相对小众的。总的来说，我更喜欢硬核一点的射击体验，但也不排斥休闲玩法。值得关注的是，现在很多游戏都在往简化方向发展，这可能会影响核心玩家的体验。",
            "我从小就接触射击游戏，从CS时代开始一路玩到现在。整体而言，我觉得现在的游戏画面越来越好，但社交性反而下降了。以前大家一起去网吧开黑的体验很难再现。当然，手游的兴起也改变了很多人玩射击游戏的方式，随时随地来一把确实方便。",
        ],
        "游戏立项": [
            "首先，我认为这款游戏的立项方向是值得肯定的。从市场角度来看，射击游戏赛道仍然有很大的增长空间。其次，需要关注的是差异化竞争策略，目前市场上已经有很多成熟的产品，如何在玩法上做出创新是关键。总体来说，如果能在核心体验上做好，配合合理的商业模式，这款游戏是有潜力的。",
            "关于这个游戏立项，我有几点看法。第一，题材选择很重要，科幻和现代战争是目前最受欢迎的两种方向。第二，付费模式直接影响用户获取，免费+内购的方式在移动端更有优势。第三，需要考虑目标用户群体的游戏习惯和偏好。综上所述，建议先做小规模测试验证核心玩法。",
        ],
        "玩法设计": [
            "在玩法设计方面，我认为平衡性是首要考虑的因素。FPS和TPS各有优劣，但从沉浸感角度来说，FPS更有优势。TTK的设计也很关键，太短会导致挫败感，太长又缺乏竞技性。值得注意的是，复活机制直接影响游戏节奏和玩家体验。总体来说，建议参考市场上成熟产品的设计，同时加入自己的特色元素。",
            "关于这个玩法设计问题，首先需要明确目标用户群体。硬核玩家和休闲玩家对TTK、操作难度的偏好完全不同。其次，英雄技能系统可以增加策略深度，但也会带来平衡性挑战。最后，匹配机制的好坏直接影响玩家留存。综上所述，玩法设计需要以核心用户体验为出发点，兼顾不同层次玩家的需求。",
        ],
        "运营与商业化": [
            "在运营和商业化方面，我认为公平性是底线。Pay-to-Win的模式长期来看会伤害游戏生态。战令系统是目前比较成熟的变现方式，既保证了收入又不会让玩家觉得不公平。皮肤和外观类道具的售卖是更健康的商业模式。值得注意的是，抽卡/开箱类机制需要明确的概率公示和保底机制，否则容易引发玩家不满。",
            "关于商业化，战令+皮肤是目前最主流的模式。68-98元的战令定价在PC端接受度较高，手游端可能需要在30-50元区间。限时活动和联动也能有效刺激消费，但频率需要控制，太密集会让玩家产生疲劳感。总体来说，商业化设计需要平衡收入目标和玩家体验。",
        ],
        "市场营销": [
            "在市场营销方面，我认为KOL和UP主的推荐是最有效的推广方式。首先，游戏相关的UP主有精准的受众群体，转化率较高。其次，IP联动可以吸引非核心用户。关于明星代言，效果因人而异，需要看代言人与游戏调性的匹配度。总体来说，营销策略应该以内容为导向，而非单纯的曝光。",
        ],
        "推广合作": [
            "关于推广合作，我有自己的原则和底线。首先，游戏质量是合作的前提，如果游戏本身不过关，再高的报价也不会接。其次，我会在视频中如实表达自己的观点，不会因为商单就说违心的话。观众对我的信任是最重要的资产。总的来说，合作需要在商业利益和内容质量之间找到平衡。",
        ],
        "设计反馈": [
            "从设计角度来看，这款游戏有几个可以改进的方向。首先，手感方面需要更细致的打磨，包括枪械反馈、命中音效等。其次，UI/UX的设计可以更简洁直观。另外，新手引导的体验也需要优化，降低上手门槛。总的来说，整体框架不错，但细节打磨还需要更多投入。",
        ],
        "立项判断": [
            "从市场角度判断，这个品类目前竞争激烈但也有机会。首先，需要分析目标用户群体的规模和增长趋势。其次，差异化定位是关键，如果只是简单模仿已有产品，很难突围。另外，团队的研发能力和运营经验也是重要因素。总的来说，如果能在核心体验上做好差异化，并且有足够的推广资源，这个项目是有成功可能的。",
        ],
    }

    # 默认模板
    DEFAULT_TEMPLATES = [
        "作为一个游戏玩家，我对这个问题有自己的看法。首先，需要从实际体验出发来考虑。其次，市场环境和个人偏好也很重要。总的来说，这是一个需要综合考虑的问题。",
        "关于这个问题，我的理解是：首先，核心体验是最重要的。其次，社交因素也不可忽视。最后，价格和性价比也是很关键的考量因素。综上所述，这需要平衡多方面的因素。",
    ]

    results = []
    for i, case in enumerate(cases):
        category = case.get("category", "")
        templates = AI_TEMPLATES.get(category, DEFAULT_TEMPLATES)
        answer = random.choice(templates)

        # 随机添加一些模板化句式
        extras = [
            " 不可否认的是，每个人对游戏的理解和偏好都不同。",
            " 需要指出的是，游戏体验是一个非常主观的事情。",
            " 在我个人看来，这取决于具体的游戏设计和目标用户群。",
            " 从长远来看，只有真正尊重玩家的游戏才能获得长期成功。",
        ]
        if random.random() < 0.3:
            answer += random.choice(extras)

        rec = {
            "id": case.get("id", f"Q{i+1}"),
            "category": category,
            "question": case["question"],
            "reference": case.get("reference", ""),
            "target_id": case.get("target_id"),
            "answer": answer,
            "error": None,
            "source": "ai_simulated",
            "ai_provider": "simulated",
        }
        results.append(rec)

    return results


def prepare_human_answers(cases: list[dict], all_segments: list[dict]) -> list[dict]:
    """为每个测试题找到最匹配的真人回答。"""
    results = []

    for i, case in enumerate(cases):
        question = case["question"]
        category = case.get("category", "")

        # 先按 category 过滤，再按具体问题匹配
        relevant = match_segments_to_category(all_segments, category, max_results=200)
        best_matches = find_best_match(relevant, question, top_n=5)

        if not best_matches:
            # 扩大搜索范围
            best_matches = find_best_match(all_segments, question, top_n=5)

        # 合并匹配到的回答
        answer = answer_by_speaker(best_matches, best_matches[0].get("speaker_id", "") if best_matches else "")

        rec = {
            "id": case.get("id", f"Q{i+1}"),
            "category": category,
            "question": question,
            "reference": case.get("reference", ""),
            "target_id": case.get("target_id"),
            "answer": answer,
            "error": None if answer else "未找到匹配的真人回答",
            "source": "human",
            "match_count": len(best_matches),
            "match_speakers": list(set(s.get("speaker_id", "") for s in best_matches)),
        }
        results.append(rec)
        print(f"  [{i+1}/{len(cases)}] {rec['id']} matched={len(best_matches)} speakers={rec['match_speakers'][:3]}")

    return results


def score_answers(answers: list[dict], judge_cfg: dict, judge_rounds: int = 1) -> list[dict]:
    """对回答列表进行评分。"""
    for i, rec in enumerate(answers):
        if rec.get("error") or not rec.get("answer"):
            continue

        print(f"  [{i+1}/{len(answers)}] 评分 {rec['id']} ({rec.get('source', '?')})...", end=" ")

        # 自动化指标
        auto = compute_auto_metrics(rec["answer"], rec["question"], rec.get("reference", ""), rec.get("target_id", 0))

        # LLM Judge
        if judge_cfg and judge_cfg.get("api_key") and not judge_cfg["api_key"].startswith("sk-your-"):
            try:
                rec["judge"] = multi_round_judge_v3(
                    judge_cfg, rec["question"], rec.get("reference", ""),
                    rec["answer"], "", None, rounds=judge_rounds,
                )
            except Exception as e:
                rec["judge"] = {"error": str(e)}
        else:
            rec["judge"] = None

        # 综合评分
        if rec.get("judge") and "error" not in rec["judge"]:
            rec["final_score"] = compute_final_score(rec["judge"], auto)
            print(f"composite={rec['final_score']['composite_score']}")
        else:
            rec["final_score"] = {"auto_metrics": auto, "composite_score": None}
            if rec.get("judge") and "error" in rec["judge"]:
                print(f"judge failed: {rec['judge']['error']}")
            else:
                print("no judge")

        time.sleep(0.3)

    return answers


def cohens_d(group1: list[float], group2: list[float]) -> float:
    """计算 Cohen's d 效应量。"""
    if len(group1) < 2 or len(group2) < 2:
        return 0.0
    mean1, mean2 = statistics.mean(group1), statistics.mean(group2)
    n1, n2 = len(group1), len(group2)
    var1 = statistics.variance(group1) if n1 > 1 else 0
    var2 = statistics.variance(group2) if n2 > 1 else 0
    pooled_std = math.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))
    if pooled_std == 0:
        return 0.0
    return (mean1 - mean2) / pooled_std


def classification_accuracy(ai_scores: list[float], human_scores: list[float]) -> dict:
    """基于分数阈值，计算分类准确率。"""
    all_scores = [(s, "ai") for s in ai_scores] + [(s, "human") for s in human_scores]
    if not all_scores:
        return {"accuracy": 0, "threshold": 0, "precision": 0, "recall": 0}

    # 找到最佳阈值
    best_acc = 0
    best_threshold = 0
    sorted_scores = sorted(set(s for s, _ in all_scores))

    for threshold in sorted_scores:
        correct = 0
        for score, label in all_scores:
            pred = "ai" if score < threshold else "human"
            if pred == label:
                correct += 1
        acc = correct / len(all_scores)
        if acc > best_acc:
            best_acc = acc
            best_threshold = threshold

    # 用最佳阈值计算 precision/recall
    tp = sum(1 for s, l in all_scores if l == "human" and s >= best_threshold)
    fp = sum(1 for s, l in all_scores if l == "ai" and s >= best_threshold)
    fn = sum(1 for s, l in all_scores if l == "human" and s < best_threshold)

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0

    return {
        "accuracy": round(best_acc, 3),
        "threshold": round(best_threshold, 2),
        "precision": round(precision, 3),
        "recall": round(recall, 3),
        "f1": round(2 * precision * recall / (precision + recall), 3) if (precision + recall) > 0 else 0,
    }


def compare_ai_vs_human(ai_results: list[dict], human_results: list[dict]) -> dict:
    """对比 AI 和真人回答的评分差异。"""
    comparison = {}

    # 匹配相同 ID 的题目（优先用 composite_score，否则用 auto_metrics）
    ai_map_judge = {r["id"]: r for r in ai_results if r.get("final_score") and r["final_score"].get("composite_score")}
    human_map_judge = {r["id"]: r for r in human_results if r.get("final_score") and r["final_score"].get("composite_score")}
    common_ids_judge = set(ai_map_judge.keys()) & set(human_map_judge.keys())

    # 所有有 auto_metrics 的题目
    ai_map_auto = {r["id"]: r for r in ai_results if r.get("final_score") and "auto_metrics" in r["final_score"]}
    human_map_auto = {r["id"]: r for r in human_results if r.get("final_score") and "auto_metrics" in r["final_score"]}
    common_ids_auto = set(ai_map_auto.keys()) & set(human_map_auto.keys())

    common_ids = common_ids_judge if common_ids_judge else common_ids_auto
    print(f"\n  可配对题目 (judge): {len(common_ids_judge)}/{len(ai_results)}")
    print(f"  可配对题目 (auto):  {len(common_ids_auto)}/{len(ai_results)}")

    if not common_ids:
        return {"error": "没有可配对的题目"}

    # 1. 综合分对比（如果有 judge 分数）
    if common_ids_judge:
        ai_composite = [ai_map_judge[qid]["final_score"]["composite_score"] for qid in common_ids_judge]
        human_composite = [human_map_judge[qid]["final_score"]["composite_score"] for qid in common_ids_judge]

        comparison["composite"] = {
            "ai_mean": round(statistics.mean(ai_composite), 2),
            "ai_std": round(statistics.stdev(ai_composite), 2) if len(ai_composite) > 1 else 0,
            "human_mean": round(statistics.mean(human_composite), 2),
            "human_std": round(statistics.stdev(human_composite), 2) if len(human_composite) > 1 else 0,
            "cohens_d": round(cohens_d(ai_composite, human_composite), 3),
            "classification": classification_accuracy(ai_composite, human_composite),
        }

    # 2. 逐维度对比（仅当有 judge 分数时）
    if common_ids_judge:
        dim_comparison = {}
        for dim in JUDGE_DIMENSIONS:
            ai_scores = []
            human_scores = []
            for qid in common_ids_judge:
                ai_j = ai_map_judge[qid].get("judge", {})
                human_j = human_map_judge[qid].get("judge", {})
                if isinstance(ai_j, dict) and dim in ai_j and isinstance(ai_j[dim], dict):
                    ai_scores.append(ai_j[dim].get("score", 0))
                if isinstance(human_j, dict) and dim in human_j and isinstance(human_j[dim], dict):
                    human_scores.append(human_j[dim].get("score", 0))

            if len(ai_scores) >= 2 and len(human_scores) >= 2:
                d = cohens_d(ai_scores, human_scores)
                dim_comparison[dim] = {
                    "ai_mean": round(statistics.mean(ai_scores), 2),
                    "human_mean": round(statistics.mean(human_scores), 2),
                    "cohens_d": round(d, 3),
                    "effect_size": "大" if abs(d) > 0.8 else ("中" if abs(d) > 0.5 else ("小" if abs(d) > 0.2 else "无")),
                    "discriminative": abs(d) > 0.5,
                }
        comparison["dimensions"] = dim_comparison
    else:
        comparison["dimensions"] = {}

    # 3. 自动化指标对比
    auto_comparison = {}
    auto_keys = ["length_score", "hallucination_score", "template_score", "keyword_score", "answer_length", "template_count"]
    for key in auto_keys:
        ai_vals = []
        human_vals = []
        for qid in common_ids_auto:
            ai_am = ai_map_auto[qid].get("final_score", {}).get("auto_metrics", {})
            human_am = human_map_auto[qid].get("final_score", {}).get("auto_metrics", {})
            if key in ai_am:
                ai_vals.append(ai_am[key])
            if key in human_am:
                human_vals.append(human_am[key])

        if len(ai_vals) >= 2 and len(human_vals) >= 2:
            d = cohens_d(ai_vals, human_vals)
            auto_comparison[key] = {
                "ai_mean": round(statistics.mean(ai_vals), 2),
                "human_mean": round(statistics.mean(human_vals), 2),
                "cohens_d": round(d, 3),
                "discriminative": abs(d) > 0.5,
            }
    comparison["auto_metrics"] = auto_comparison

    # 4. 逐题差异（基于 auto_metrics 的综合评分）
    per_question = []
    # 构建一个简单的 auto composite score（当没有 judge 分数时）
    def _auto_composite(am: dict) -> float:
        if not am:
            return 0
        return (am.get("length_score", 0.5) * 0.3 +
                am.get("hallucination_score", 1.0) * 0.3 +
                am.get("template_score", 1.0) * 0.2 +
                am.get("keyword_score", 0.5) * 0.2) * 5

    for qid in sorted(common_ids_auto):
        ai_score = ai_map_auto[qid]["final_score"].get("composite_score")
        human_score = human_map_auto[qid]["final_score"].get("composite_score")
        if ai_score is None:
            ai_score = _auto_composite(ai_map_auto[qid]["final_score"].get("auto_metrics", {}))
        if human_score is None:
            human_score = _auto_composite(human_map_auto[qid]["final_score"].get("auto_metrics", {}))
        per_question.append({
            "id": qid,
            "category": ai_map_auto[qid].get("category", ""),
            "question": ai_map_auto[qid]["question"][:100],
            "ai_score": round(ai_score, 2),
            "human_score": round(human_score, 2),
            "delta": round(human_score - ai_score, 2),
        })
    comparison["per_question"] = sorted(per_question, key=lambda x: -abs(x["delta"]))

    # 5. 总体判断
    if common_ids_judge:
        dim_comparison = comparison.get("dimensions", {})
    else:
        dim_comparison = {}
    effective_dims = [d for d, v in dim_comparison.items() if v.get("discriminative")]
    effective_auto = [k for k, v in auto_comparison.items() if v.get("discriminative")]

    # 使用 auto metrics 判断区分度
    if auto_comparison:
        # 取所有 auto metrics 的 Cohen's d 绝对值均值
        auto_d_values = [abs(v["cohens_d"]) for v in auto_comparison.values()]
        comp_d = statistics.mean(auto_d_values) if auto_d_values else 0
    else:
        comp_d = 0

    # 如果有 judge 分数，以 judge 为准
    if comparison.get("composite"):
        comp_d = abs(comparison["composite"]["cohens_d"])

    comparison["verdict"] = {
        "is_effective": abs(comp_d) > 0.3,
        "composite_d": abs(comp_d),
        "effective_dimensions": effective_dims,
        "effective_auto_metrics": effective_auto,
        "classification_accuracy": comparison.get("composite", {}).get("classification", {}).get("accuracy", None),
        "summary": "",
    }

    if abs(comp_d) > 0.8:
        comparison["verdict"]["summary"] = "评测体系非常有效，综合分能强力区分 AI 和真人回答"
    elif abs(comp_d) > 0.5:
        comparison["verdict"]["summary"] = "评测体系有效，综合分能较好区分 AI 和真人回答"
    elif abs(comp_d) > 0.3:
        comparison["verdict"]["summary"] = "评测体系有一定区分能力，但效果有限，建议优化权重或增加区分度高的维度"
    else:
        comparison["verdict"]["summary"] = "评测体系区分能力较弱，需要在评分维度或题目设计上做较大改进"

    return comparison


def render_validation_report(comparison: dict, ai_results: list, human_results: list, meta: dict) -> str:
    """生成验证报告 Markdown。"""
    lines = [
        f"# 评测题集有效性验证报告",
        "",
        f"- 题集: {meta.get('name', '未知')}",
        f"- 目标: {meta.get('target', '?')}",
        f"- 生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"- AI 回答数: {len(ai_results)}",
        f"- 真人回答数: {len(human_results)}",
        f"- 可配对题目: {len(comparison.get('per_question', []))}",
        "",
    ]

    # 总体判断
    verdict = comparison.get("verdict", {})
    lines.append(f"## 总体判断")
    lines.append(f"")
    lines.append(f"**{verdict.get('summary', 'N/A')}**")
    lines.append(f"")
    if verdict.get("composite_d"):
        lines.append(f"- 综合分 Cohen's d: **{verdict['composite_d']:.3f}**")
        lines.append(f"- 分类准确率: **{verdict.get('classification_accuracy', 'N/A')}**")
        lines.append(f"- 有效区分维度: {', '.join(verdict.get('effective_dimensions', [])) or '无'}")
        lines.append(f"- 有效自动化指标: {', '.join(verdict.get('effective_auto_metrics', [])) or '无'}")
    lines.append("")

    # 综合分对比
    comp = comparison.get("composite", {})
    if comp:
        lines.append("## 综合分对比")
        lines.append("")
        lines.append("| 指标 | AI 回答 | 真人回答 | Cohen's d |")
        lines.append("| --- | --- | --- | --- |")
        lines.append(f"| 综合分 | {comp['ai_mean']} ± {comp['ai_std']} | {comp['human_mean']} ± {comp['human_std']} | {comp['cohens_d']} |")
        cls = comp.get("classification", {})
        if cls:
            lines.append(f"| 分类准确率 | | | {cls['accuracy']} (阈值={cls['threshold']}) |")
        lines.append("")

    # 维度对比
    dims = comparison.get("dimensions", {})
    if dims:
        lines.append("## 7 维评分对比")
        lines.append("")
        lines.append("| 维度 | AI 均分 | 真人均分 | Cohen's d | 效应量 | 有效性 |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for dim in JUDGE_DIMENSIONS:
            if dim in dims:
                d = dims[dim]
                icon = "✅" if d.get("discriminative") else "❌"
                lines.append(f"| {dim} | {d['ai_mean']} | {d['human_mean']} | {d['cohens_d']} | {d['effect_size']} | {icon} |")
        lines.append("")

    # 自动化指标对比
    auto = comparison.get("auto_metrics", {})
    if auto:
        lines.append("## 自动化指标对比")
        lines.append("")
        lines.append("| 指标 | AI 均值 | 真人均值 | Cohen's d | 有效性 |")
        lines.append("| --- | --- | --- | --- | --- |")
        for key, vals in auto.items():
            icon = "✅" if vals.get("discriminative") else "❌"
            lines.append(f"| {key} | {vals['ai_mean']} | {vals['human_mean']} | {vals['cohens_d']} | {icon} |")
        lines.append("")

    # 逐题差异 Top 10
    pq = comparison.get("per_question", [])
    if pq:
        lines.append("## 差异最大的题目（Top 10）")
        lines.append("")
        lines.append("| ID | 类别 | AI | 真人 | Δ | 题目 |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for item in pq[:10]:
            lines.append(f"| {item['id']} | {item['category']} | {item['ai_score']} | {item['human_score']} | {item['delta']:+.2f} | {item['question'][:60]}... |")
        lines.append("")

    # 建议
    lines.append("## 改进建议")
    lines.append("")
    effective_dims = verdict.get("effective_dimensions", [])
    if len(effective_dims) < 3:
        lines.append(f"- ⚠ 当前仅有 {len(effective_dims)} 个维度能有效区分 AI 和真人，建议：")
        lines.append('  - 增加「情感真实性」「具体性」「知识边界」相关维度的题目数量')
        lines.append('  - 提高「区分度」和「人设一致性」维度的权重')
        lines.append("  - 考虑增加新的客观指标（如：回答中的命名实体数量、时间线索密度）")
    else:
        lines.append(f"- ✅ {len(effective_dims)} 个维度能有效区分 AI 和真人，评测体系总体有效")
    lines.append("")

    if verdict.get("classification_accuracy") and verdict["classification_accuracy"] < 0.7:
        lines.append("- ⚠ 分类准确率偏低，建议：")
        lines.append('  - 增加「真人探测器」类型题目（具体记忆、身体体验、社交细节）')
        lines.append("  - 引入回答时间戳、打字节奏等行为特征")
        lines.append("  - 结合多个维度做加权分类而非简单阈值")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="验证评测题集有效性：AI vs 真人回答对比")
    parser.add_argument("cases_path", help="测试用例 JSON 路径")
    parser.add_argument("--limit", type=int, default=None, help="只测试前 N 题")
    parser.add_argument("--api-base", default="http://localhost:3000", help="API 地址")
    parser.add_argument("--no-ai", action="store_true", help="不生成 AI 回答（仅分析已有数据）")
    parser.add_argument("--simulate-ai", action="store_true", help="使用模拟 AI 回答（模板化/泛泛而谈）代替真实 API")
    parser.add_argument("--ai-via-deepseek", action="store_true", help="通过 DeepSeek API 生成 AI 回答")
    parser.add_argument("--no-judge", action="store_true", help="不调用 LLM judge（仅自动化指标）")
    parser.add_argument("--judge-rounds", type=int, default=1, help="judge 轮数（默认 1 以节省时间）")
    parser.add_argument("--out-dir", default=None, help="输出目录")
    parser.add_argument("--delay", type=float, default=0.3, help="API 请求间隔")
    args = parser.parse_args()

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # 1. 加载测试题
    with open(args.cases_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    meta = data.get("meta", {})
    cases = data.get("cases", [])
    target = meta.get("target", "persona")

    if args.limit:
        cases = cases[:args.limit]

    print(f"{'═' * 60}")
    print(f"验证评测题集有效性: {meta.get('name', '未知')}")
    print(f"target={target}, 题数={len(cases)}")
    print(f"{'═' * 60}")

    # 2. 加载真人数据
    segments_dir = os.path.join(project_root, SEGMENTS_DIR)
    respondents_dir = os.path.join(project_root, RESPONDENTS_DIR)

    if not os.path.isdir(segments_dir):
        print(f"⚠ 真人数据目录不存在: {segments_dir}")
        print("将仅对 AI 回答评分，不进行对比")
        all_segments = []
    else:
        print(f"\n加载真人访谈数据...")
        all_segments = load_segments(segments_dir)
        respondents = load_respondents(respondents_dir)
        print(f"  访谈段落: {len(all_segments)}")
        print(f"  受访者: {len(respondents)}")

    # 3. 生成 AI 回答
    ai_results = []
    judge_cfg = resolve_judge_config(project_root) if not args.no_judge else None

    if args.simulate_ai:
        print(f"\nPhase 1: 生成模拟 AI 回答...")
        ai_results = generate_simulated_ai(cases)
    elif args.ai_via_deepseek:
        if not judge_cfg or not judge_cfg.get("api_key"):
            print("⚠ 需要 DeepSeek API key，请设置 EVAL_JUDGE_API_KEY 环境变量或在 apps/api/.env 中配置")
            return 1
        print(f"\nPhase 1: 通过 DeepSeek API 生成 AI 回答 ({judge_cfg['model']})...")
        ai_results = generate_ai_via_deepseek(cases, judge_cfg, args.delay)
    elif not args.no_ai:
        print(f"\nPhase 1: 生成 AI 回答 (本地 API)...")
        ai_results = generate_ai_answers(cases, args.api_base, target, args.delay)
    else:
        print(f"\n跳过 AI 回答生成（--no-ai）")

    # 4. 匹配真人回答
    human_results = []
    if all_segments:
        print(f"\nPhase 2: 匹配真人回答...")
        human_results = prepare_human_answers(cases, all_segments)

    # 5. 评分
    if ai_results:
        print(f"\nPhase 3a: 评分 AI 回答...")
        ai_results = score_answers(ai_results, judge_cfg, args.judge_rounds)

    if human_results:
        print(f"\nPhase 3b: 评分真人回答...")
        human_results = score_answers(human_results, judge_cfg, args.judge_rounds)

    # 6. 对比分析
    comparison = None
    if ai_results and human_results:
        print(f"\n{'═' * 60}")
        print("Phase 4: 对比分析 AI vs 真人")
        comparison = compare_ai_vs_human(ai_results, human_results)

        verdict = comparison.get("verdict", {})
        print(f"\n  综合分 Cohen's d: {comparison.get('composite', {}).get('cohens_d', 'N/A')}")
        print(f"  分类准确率: {verdict.get('classification_accuracy', 'N/A')}")
        print(f"  有效维度: {verdict.get('effective_dimensions', [])}")
        print(f"  判定: {verdict.get('summary', 'N/A')}")

    # 7. 输出
    out_dir = args.out_dir or os.path.join(project_root, "data", "eval", "validation")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = re.sub(r"[^\w一-鿿-]+", "_", meta.get("name", "validation")).strip("_") or "validation"

    output = {
        "meta": meta,
        "config": {
            "limit": args.limit,
            "judge_rounds": args.judge_rounds,
            "ai_answers": len(ai_results),
            "human_answers": len(human_results),
        },
        "ai_results": ai_results,
        "human_results": human_results,
        "comparison": comparison,
    }

    out_json = os.path.join(out_dir, f"{name}_validation_{stamp}.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    if comparison:
        report = render_validation_report(comparison, ai_results, human_results, meta)
        out_md = os.path.join(out_dir, f"{name}_validation_{stamp}.md")
        with open(out_md, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"\n报告: {out_md}")

    print(f"JSON: {out_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())