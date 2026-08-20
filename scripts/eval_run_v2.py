#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
改进版自动化评测脚本 (v2)。

相比 v1 的改进:
  1. 健壮的 SSE 解析（兼容 "data:" / "data: " 以及多行 data）
  2. 更安全的 JSON 提取（处理 judge 返回的各种包裹格式）
  3. 多轮打分取中位数（提高一致性）
  4. 自动一致性检查（同一画像相似题的回答是否自洽）
  5. 预检集成（跑之前先 validate）
  6. 支持断点续跑（--resume）
  7. 可配置节流（--delay）
  8. 统计显著性检验（评分分布、方差）

用法:
  python3 scripts/eval_run_v2.py data/eval/test_cases_persona_v2.json
  python3 scripts/eval_run_v2.py data/eval/test_cases_persona_v2.json --limit 5 --judge-rounds 2
  python3 scripts/eval_run_v2.py data/eval/test_cases_persona_v2.json --resume results/xxx.json
"""

import argparse
import json
import os
import re
import statistics
import sys
import time
from datetime import datetime, timezone
from typing import Any

import requests

# ── 常量 ──
API_BASE_DEFAULT = "http://localhost:3000"
JUDGE_DIMENSIONS = ["人设一致性", "专业准确性", "知识边界"]

ERROR_SENTINELS = (
    "[模拟用户暂时无法响应，请稍后重试]",
    "[KOL分身暂时无法响应，请稍后重试]",
)

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
    base_url = os.getenv("EVAL_JUDGE_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("EVAL_JUDGE_MODEL", "deepseek-chat")
    api_key = os.getenv("EVAL_JUDGE_API_KEY", api_env.get("DEEPSEEK_API_KEY", ""))
    return {"base_url": base_url.rstrip("/"), "model": model, "api_key": api_key}


# ── SSE 流式读取（改进版）──


def stream_chat(url: str, body: dict, timeout: int = 120) -> str:
    """POST 到 SSE 端点，健壮处理多种 SSE 格式。"""
    with requests.post(
        url,
        json=body,
        stream=True,
        timeout=timeout,
        headers={"Content-Type": "application/json"},
    ) as resp:
        resp.raise_for_status()
        resp.encoding = "utf-8"

        parts: list[str] = []
        current_data: list[str] = []

        for raw in resp.iter_lines(decode_unicode=True):
            if raw is None:
                continue

            line = raw.strip()

            # 空行表示一个 SSE 事件结束
            if not line:
                if current_data:
                    parts.append("".join(current_data))
                    current_data = []
                continue

            # 注释行
            if line.startswith(":"):
                continue

            # data 行（兼容 "data:" 和 "data: "）
            if line.startswith("data:"):
                payload = line[5:].lstrip()  # 去掉 "data:" 及可能的空格
                # 跳过 evidence JSON 事件
                if payload.startswith("{") and '"type"' in payload and "evidence" in payload:
                    continue
                current_data.append(payload)
            # 有些 SSE 实现可能直接发内容
            elif not line.startswith("event:") and not line.startswith("id:") and not line.startswith("retry:"):
                if line.startswith("{") and '"type"' in line and "evidence" in line:
                    continue
                current_data.append(line)

        # 处理最后可能残留的 data
        if current_data:
            parts.append("".join(current_data))

        return "".join(parts).strip()


# ── JSON 提取（改进版）──


def extract_json(content: str) -> str:
    """从 LLM 返回内容中提取 JSON，容错各种包裹格式。"""
    content = content.strip()

    # 尝试直接解析
    try:
        json.loads(content)
        return content
    except (json.JSONDecodeError, ValueError):
        pass

    # 去掉 markdown 代码块（```json ... ``` 或 ``` ... ```）
    # 使用非贪婪匹配提取最长的代码块
    code_blocks = re.findall(r"```(?:json)?\s*\n?(.*?)```", content, re.DOTALL)
    if code_blocks:
        # 取最长的代码块
        content = max(code_blocks, key=len).strip()
        try:
            json.loads(content)
            return content
        except (json.JSONDecodeError, ValueError):
            pass

    # 尝试找到第一个 { 到最后一个 } 之间的内容
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


# ── LLM-as-judge（改进版）──


def judge_answer(cfg: dict, question: str, reference: str, answer: str, persona_hint: str = "") -> dict:
    """用 LLM 对回答打分（1-5），返回结构化结果。"""
    dims = "、".join(JUDGE_DIMENSIONS)

    # 构建更详细的评分 prompt
    ref_section = ""
    if reference:
        ref_section = f"""
参考答案/期望覆盖要点：
{reference}

请判断 AI 回答是否覆盖了上述要点，以及覆盖的质量。"""

    persona_section = ""
    if persona_hint:
        persona_section = f"\n被评测对象画像/人设说明：{persona_hint}"

    prompt = f"""你是一名严谨的评测裁判，正在给一个 AI 模拟用户（或 AI 数字孪生 KOL）的回答打分。

题目：{question}
{ref_section}
{persona_section}

AI 的回答：
---
{answer}
---

请从以下三个维度各打 1-5 分（整数），并给出简短理由：

1. **人设一致性**（1-5）：语气、立场、用词习惯是否像被模拟的那个人？是否出现"作为AI"或泛泛的机器腔？是否与目标画像/KOL的特征自洽？
2. **专业准确性**（1-5）：评价逻辑是否成立？是否有具体洞察而非泛泛而谈？是否切题？论据是否合理？
3. **知识边界**（1-5）：被问到超出其经验/领域的问题时，是否诚实地说不了解（而非胡编）？在不该知道的领域假装知道应扣分。

评分标准：
- 5分：优秀，无显著缺陷
- 4分：良好，有小瑕疵但不影响整体质量
- 3分：及格，有明显不足但基本可用
- 2分：较差，存在严重问题
- 1分：极差，完全不符合要求

只输出一个 JSON 对象，不要输出任何其它文字，格式如下：
{{"人设一致性": {{"score": 4, "reason": "理由"}}, "专业准确性": {{"score": 4, "reason": "理由"}}, "知识边界": {{"score": 4, "reason": "理由"}}, "overall": 4, "comment": "一句话总评"}}"""

    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": "你只输出合法 JSON，不输出任何解释或 markdown 代码块。你的回复必须以 { 开头，以 } 结尾。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.0,
        "max_tokens": 1024,
    }

    resp = requests.post(
        f"{cfg['base_url']}/chat/completions",
        json=payload,
        headers={"Authorization": f"Bearer {cfg['api_key']}"},
        timeout=180,
    )
    if not resp.ok:
        raise RuntimeError(f"judge 请求失败 {resp.status_code}: {resp.text[:300]}")

    content = resp.json()["choices"][0]["message"]["content"].strip()
    content = extract_json(content)
    return json.loads(content)


def multi_round_judge(cfg: dict, question: str, reference: str, answer: str, persona_hint: str = "", rounds: int = 3) -> dict:
    """多轮打分取中位数，减少单次评分的随机性。"""
    if rounds <= 1:
        return judge_answer(cfg, question, reference, answer, persona_hint)

    all_scores = []
    for r in range(rounds):
        try:
            result = judge_answer(cfg, question, reference, answer, persona_hint)
            all_scores.append(result)
        except Exception as e:
            print(f"    judge 第 {r+1}/{rounds} 轮失败: {e}")
        time.sleep(0.5)

    if not all_scores:
        raise RuntimeError("所有 judge 轮次均失败")

    if len(all_scores) == 1:
        return all_scores[0]

    # 对每个维度取中位数
    merged = {}
    for dim in JUDGE_DIMENSIONS:
        scores = []
        reasons = []
        for r in all_scores:
            if dim in r and "score" in r[dim]:
                scores.append(r[dim]["score"])
                reasons.append(r[dim].get("reason", ""))
        if scores:
            median_score = int(statistics.median(scores))
            # 取中位数对应轮次的理由
            mid_idx = scores.index(median_score) if median_score in scores else 0
            merged[dim] = {"score": median_score, "reason": reasons[mid_idx] if mid_idx < len(reasons) else reasons[0]}

    overalls = [r.get("overall", 0) for r in all_scores]
    merged["overall"] = int(statistics.median(overalls)) if overalls else 0
    merged["comment"] = all_scores[0].get("comment", "")
    merged["judge_rounds"] = rounds
    merged["score_variance"] = {
        dim: round(statistics.variance([r[dim]["score"] for r in all_scores if dim in r]), 2)
        for dim in JUDGE_DIMENSIONS
        if all(dim in r for r in all_scores)
    }

    return merged


# ── 一致性自检 ──


def check_consistency(results: list) -> list[dict]:
    """检查同一 target_id 的回答在相似问题上是否自洽。"""
    warnings = []
    # 按 target_id 分组
    by_target: dict[int, list] = {}
    for r in results:
        tid = r.get("target_id")
        if tid is None:
            continue
        by_target.setdefault(tid, []).append(r)

    for tid, items in by_target.items():
        if len(items) < 2:
            continue

        # 检查同一 category 下是否有矛盾回答
        # 简化：检查同一 category 内评分方差是否异常大
        by_cat: dict[str, list] = {}
        for item in items:
            cat = item.get("category", item.get("dimension", ""))
            if item.get("judge") and isinstance(item["judge"], dict) and "overall" in item["judge"]:
                by_cat.setdefault(cat, []).append(item["judge"]["overall"])

        for cat, scores in by_cat.items():
            if len(scores) >= 3:
                var = statistics.variance(scores) if len(scores) > 1 else 0
                if var > 2.0:  # 方差过大说明同画像同维度的回答质量不一致
                    warnings.append({
                        "target_id": tid,
                        "category": cat,
                        "variance": round(var, 2),
                        "scores": scores,
                        "message": f"画像 {tid} 在 {cat} 维度下评分方差 {var:.1f}，可能回答不一致",
                    })

    return warnings


# ── 报告生成 ──


def avg(scores: list) -> float:
    return round(sum(scores) / len(scores), 2) if scores else 0.0


def render_markdown(meta: dict, results: list, judged: bool, started: str, consistency_warnings: list) -> str:
    lines = [
        f"# 评测报告 · {meta.get('name', '未命名')}",
        "",
        f"- 目标类型: {meta.get('target')}",
        f"- 题目来源: {meta.get('source_file', '—')}",
        f"- 生成时间: {started}",
        f"- 总题数: {len(results)}",
        f"- 成功回答: {sum(1 for r in results if r.get('answer') and not r.get('error'))}",
        f"- 评分方式: {'LLM-as-judge（改进版）' if judged else '人工（未自动打分）'}",
        "",
    ]

    if judged:
        lines.append("## 分维度平均分")
        lines.append("")
        lines.append("| 维度 | 平均分 | 标准差 | 最低 | 最高 |")
        lines.append("| --- | --- | --- | --- | --- |")
        for dim in JUDGE_DIMENSIONS:
            scores = [r["judge"][dim]["score"] for r in results if r.get("judge") and isinstance(r["judge"], dict) and dim in r["judge"]]
            if scores:
                lines.append(f"| {dim} | {avg(scores)} | {round(statistics.stdev(scores), 2) if len(scores) > 1 else 0} | {min(scores)} | {max(scores)} |")
        overall = [r["judge"]["overall"] for r in results if r.get("judge") and isinstance(r["judge"], dict) and "overall" in r["judge"]]
        if overall:
            lines.append(f"| 综合 | {avg(overall)} | {round(statistics.stdev(overall), 2) if len(overall) > 1 else 0} | {min(overall)} | {max(overall)} |")
        lines.append("")

        # 按 category 分维度统计
        lines.append("## 按题目分类统计")
        lines.append("")
        by_cat: dict[str, list] = {}
        for r in results:
            cat = r.get("category", r.get("dimension", "—"))
            by_cat.setdefault(cat, []).append(r)

        lines.append("| 分类 | 题数 | 综合均分 | 人设一致性 | 专业准确性 | 知识边界 |")
        lines.append("| --- | --- | --- | --- | --- | --- |")
        for cat, items in sorted(by_cat.items()):
            n = len(items)
            cat_overall = [it["judge"]["overall"] for it in items if it.get("judge") and isinstance(it["judge"], dict) and "overall" in it["judge"]]
            cat_scores = {}
            for dim in JUDGE_DIMENSIONS:
                cat_scores[dim] = [it["judge"][dim]["score"] for it in items if it.get("judge") and isinstance(it["judge"], dict) and dim in it["judge"]]
            lines.append(
                f"| {cat} | {n} | {avg(cat_overall)} | {avg(cat_scores['人设一致性'])} | {avg(cat_scores['专业准确性'])} | {avg(cat_scores['知识边界'])} |"
            )
        lines.append("")

        # 一致性警告
        if consistency_warnings:
            lines.append("## 一致性警告")
            lines.append("")
            for w in consistency_warnings:
                lines.append(f"- **画像 {w['target_id']}** / {w['category']}: 评分方差 {w['variance']}，{w['message']}")
            lines.append("")

    lines.append("## 逐题明细")
    lines.append("")
    for r in results:
        lines.append(f"### {r['id']}（{r.get('category', r.get('dimension', '—'))}）")
        lines.append("")
        lines.append(f"**题目**：{r['question']}")
        if r.get("reference"):
            lines.append(f"")
            lines.append(f"**参考要点**：{r['reference']}")
        if r.get("error"):
            lines.append("")
            lines.append(f"**回答**：❌ 调用失败 —— {r['error']}")
        else:
            lines.append("")
            lines.append(f"**回答**：{r['answer']}")
        if r.get("judge") and isinstance(r["judge"], dict):
            j = r["judge"]
            if j.get("error"):
                lines.append(f"")
                lines.append(f"**评分**：❌ {j['error']}")
            else:
                lines.append("")
                judge_rounds = j.get("judge_rounds", 1)
                lines.append(f"**评分**：综合 {j.get('overall')}/5（{judge_rounds} 轮取中位数）")
                for dim in JUDGE_DIMENSIONS:
                    if dim in j:
                        d = j[dim]
                        lines.append(f"- {dim}：{d['score']}/5 —— {d['reason']}")
                if j.get("comment"):
                    lines.append(f"- 总评：{j['comment']}")
                if j.get("score_variance"):
                    lines.append(f"- 评分方差：{j['score_variance']}")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


# ── 主流程 ──


def validate_input(cases: list, args) -> list[str]:
    """运行前的基本校验。"""
    issues = []
    for i, c in enumerate(cases):
        if not c.get("question"):
            issues.append(f"第 {i+1} 题缺少 question")
        tid = c.get("target_id") or c.get("personaId") or c.get("kolId") or args.target_id
        if tid is None:
            issues.append(f"[{c.get('id', i+1)}] target_id 缺失且未指定 --target-id")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="自动化评测脚本 v2")
    parser.add_argument("cases_path", help="测试用例 JSON 路径")
    parser.add_argument("--no-judge", action="store_true", help="只跑回答不自动打分")
    parser.add_argument("--limit", type=int, default=None, help="只跑前 N 题")
    parser.add_argument("--api-base", default=API_BASE_DEFAULT, help="API 地址")
    parser.add_argument("--target-id", type=int, default=None, help="统一指定 personaId/kolId")
    parser.add_argument("--out-dir", default=None, help="结果输出目录")
    parser.add_argument("--delay", type=float, default=0.3, help="请求间隔秒数（默认 0.3）")
    parser.add_argument("--judge-rounds", type=int, default=3, help="judge 打分轮数（默认 3，取中位数）")
    parser.add_argument("--resume", default=None, help="从已有结果 JSON 续跑（跳过已完成的题）")
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
        issues = validate_input(cases, args)
        if issues:
            print("⚠ 预检发现以下问题:")
            for issue in issues:
                print(f"  - {issue}")
            print("如确认要继续，请加 --skip-validation 或修复后重试")
            return 1
        print("✓ 预检通过")

    # 续跑逻辑
    completed_ids = set()
    previous_results = []
    if args.resume:
        with open(args.resume, "r", encoding="utf-8") as f:
            prev = json.load(f)
        previous_results = prev.get("results", [])
        completed_ids = {r["id"] for r in previous_results if r.get("answer") and not r.get("error")}
        print(f"续跑: 已完成 {len(completed_ids)} 题，跳过")

    judge_cfg = resolve_judge_config(project_root) if not args.no_judge else None
    if judge_cfg and judge_cfg["api_key"]:
        print(f"Judge: {judge_cfg['model']} @ {judge_cfg['base_url']}（{args.judge_rounds} 轮取中位数）")
    elif judge_cfg:
        print("⚠ 未找到有效 API Key，将跳过自动打分")

    out_dir = args.out_dir or os.path.join(project_root, "data", "eval", "results")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = re.sub(r"[^\w一-鿿-]+", "_", meta.get("name", "eval")).strip("_") or "eval"

    results = list(previous_results)
    new_count = 0

    for i, case in enumerate(cases, 1):
        qid = case.get("id", f"Q{i}")

        # 跳过已完成的
        if qid in completed_ids:
            continue

        question = case["question"]
        target_id = case.get("target_id") or case.get("personaId") or case.get("kolId") or args.target_id
        body = {"message": question}
        if target == "kol":
            body["kolId"] = target_id
        else:
            body["personaId"] = target_id

        rec = {
            "id": qid,
            "category": case.get("category", case.get("dimension", "")),
            "question": question,
            "reference": case.get("reference", ""),
            "target_id": target_id,
            "answer": "",
            "error": None,
            "judge": None,
        }

        url = f"{args.api_base.rstrip('/')}{endpoint}"
        try:
            answer = stream_chat(url, body)
            if any(s in answer for s in ERROR_SENTINELS):
                rec["error"] = "LLM 调用失败（API Key 无效或端点不可用）"
                rec["answer"] = answer
            else:
                rec["answer"] = answer
                if judge_cfg and judge_cfg["api_key"] and not judge_cfg["api_key"].startswith("sk-your-"):
                    persona_hint = case.get("persona_hint", "")
                    try:
                        rec["judge"] = multi_round_judge(
                            judge_cfg,
                            question,
                            case.get("reference", ""),
                            answer,
                            persona_hint,
                            rounds=args.judge_rounds,
                        )
                    except Exception as e:
                        rec["judge"] = {"error": f"judge 失败: {e}"}
                elif judge_cfg:
                    rec["judge"] = {"error": "缺少有效 API Key，跳过打分"}
        except Exception as e:
            rec["error"] = str(e)

        results.append(rec)
        new_count += 1
        status = "✓" if rec["error"] is None else "✗"
        score_str = ""
        if rec.get("judge") and isinstance(rec["judge"], dict) and "overall" in rec["judge"]:
            score_str = f" score={rec['judge']['overall']}/5"
        print(f"[{len(results)}/{len(cases)}] {status} {qid}  len={len(rec['answer'])}{score_str}")
        time.sleep(args.delay)

    # 一致性检查
    consistency_warnings = check_consistency(results) if not args.no_judge else []

    started = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    out_json = os.path.join(out_dir, f"{name}_{stamp}.json")
    out_md = os.path.join(out_dir, f"{name}_{stamp}.md")

    output = {
        "meta": meta,
        "started": started,
        "config": {
            "judge_rounds": args.judge_rounds,
            "delay": args.delay,
        },
        "consistency_warnings": consistency_warnings,
        "results": results,
    }

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    with open(out_md, "w", encoding="utf-8") as f:
        f.write(render_markdown(meta, results, not args.no_judge, started, consistency_warnings))

    print(f"\n{'═' * 60}")
    print(f"新增: {new_count} 题，总计: {len(results)} 题")
    if consistency_warnings:
        print(f"⚠ 一致性警告: {len(consistency_warnings)} 项")
        for w in consistency_warnings:
            print(f"  - {w['message']}")
    print(f"JSON: {out_json}")
    print(f"报告: {out_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())