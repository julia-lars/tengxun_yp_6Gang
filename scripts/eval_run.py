#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自动化评测脚本：遍历测试用例 → 调对话 API（SSE 流式）→ 保存回答 → LLM-as-judge 打分。

用法:
  # 群体画像评测（target=persona → /api/chat）
  python3 scripts/eval_run.py data/eval/test_cases_persona.json

  # KOL 评测（target=kol → /api/kol/chat）
  python3 scripts/eval_run.py data/eval/test_cases_kol.json

  # 只跑回答、不自动打分（回答保存后人工评分）
  python3 scripts/eval_run.py data/eval/test_cases_kol.json --no-judge

  # 只跑前 N 题（冒烟测试）
  python3 scripts/eval_run.py data/eval/test_cases_kol.json --limit 3

评测维度（README2 任务 7）:
  1. 人设一致性 —— 语气像本人吗
  2. 专业准确性 —— 评价逻辑对吗
  3. 知识边界   —— 不懂的会说不知道吗

依赖:
  requests（pip3 install requests）

LLM-as-judge:
  默认用 DeepSeek（读 apps/api/.env 里的 DEEPSEEK_API_KEY）。
  也可用环境变量覆盖指向其它 OpenAI 兼容端点:
    EVAL_JUDGE_API_KEY   （默认: apps/api/.env 的 DEEPSEEK_API_KEY）
    EVAL_JUDGE_BASE_URL  （默认: https://api.deepseek.com/v1）
    EVAL_JUDGE_MODEL     （默认: deepseek-chat）
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

# ── 常量 ──
API_BASE_DEFAULT = "http://localhost:3000"
JUDGE_DIMENSIONS = ["人设一致性", "专业准确性", "知识边界"]

# 对话 API 出错时服务端会把这个文案作为 token 发出来
ERROR_SENTINELS = (
    "[模拟用户暂时无法响应，请稍后重试]",
    "[KOL分身暂时无法响应，请稍后重试]",
)


# ── 配置读取 ──

def load_env_file(path: str) -> dict:
    """简单解析 KEY=VALUE 的 .env（跳过注释/空行），不引入第三方依赖。"""
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
    """确定 judge 用的 LLM 端点。优先 EVAL_JUDGE_* 环境变量，其次读 apps/api/.env。"""
    api_env = load_env_file(os.path.join(project_root, "apps", "api", ".env"))
    base_url = os.getenv("EVAL_JUDGE_BASE_URL", "https://api.deepseek.com/v1")
    model = os.getenv("EVAL_JUDGE_MODEL", "deepseek-chat")
    api_key = os.getenv("EVAL_JUDGE_API_KEY", api_env.get("DEEPSEEK_API_KEY", ""))
    return {"base_url": base_url.rstrip("/"), "model": model, "api_key": api_key}


# ── SSE 流式读取 ──

def stream_chat(url: str, body: dict, timeout: int = 120) -> str:
    """POST 到 SSE 端点，拼接所有 token，返回完整回答。"""
    with requests.post(
        url, json=body, stream=True, timeout=timeout,
        headers={"Content-Type": "application/json"},
    ) as resp:
        resp.raise_for_status()
        # Hono 的 SSE 响应不带 charset，requests 会回退到 latin-1 把中文解码成乱码，
        # 这里显式按 UTF-8 解码。
        resp.encoding = "utf-8"
        parts: list[str] = []
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw:
                continue
            line = raw
            if line.startswith("data: "):
                line = line[len("data: "):]
            # 结尾的 evidence 事件是 JSON，跳过（不混进回答）
            stripped = line.strip()
            if stripped.startswith("{") and '"type"' in stripped and "evidence" in stripped:
                continue
            parts.append(line)
        return "".join(parts).strip()


# ── LLM-as-judge ──

def judge_answer(cfg: dict, question: str, reference: str, answer: str, persona_hint: str = "") -> dict:
    """用 LLM 对一条回答在三个维度上打分（1-5 分），返回结构化结果。"""
    dims = "、".join(JUDGE_DIMENSIONS)
    ref_line = f"参考答案/期望要点：{reference}" if reference else "（本题无参考答案，请依据常识与上下文判断）"
    persona_line = f"被评测对象画像/人设：{persona_hint}" if persona_hint else ""

    prompt = f"""你是一名严谨的评测裁判，正在给一个 AI 模拟用户（或 AI 数字孪生 KOL）的回答打分。

题目：{question}
{ref_line}
{persona_line}

AI 的回答：
---
{answer}
---

请从以下三个维度各打 1-5 分（整数），并给出简短理由：
1. 人设一致性：语气/立场是否像被模拟的那个人（而非泛泛的 AI 腔）
2. 专业准确性：评价逻辑是否成立、是否有洞察、是否切题
3. 知识边界：被问到超出其经验/领域时，是否诚实地说不了解（而非胡编）

只输出一个 JSON 对象，不要输出任何其它文字，格式如下：
{{"人设一致性": {{"score": 4, "reason": "..."}}, "专业准确性": {{"score": 4, "reason": "..."}}, "知识边界": {{"score": 4, "reason": "..."}}, "overall": 4, "comment": "一句话总评"}}"""

    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": "你只输出合法 JSON，不输出任何解释或 markdown 代码块。"},
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
    # 容忍模型包一层 markdown 代码块
    content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.MULTILINE).strip()
    return json.loads(content)


# ── 报告生成 ──

def avg(scores: list) -> float:
    return round(sum(scores) / len(scores), 2) if scores else 0.0


def render_markdown(meta: dict, results: list, judged: bool, started: str) -> str:
    lines = [
        f"# 评测报告 · {meta.get('name', '未命名')}",
        "",
        f"- 目标类型: {meta.get('target')}",
        f"- 题目来源: {meta.get('source_file', '—')}",
        f"- 生成时间: {started}",
        f"- 总题数: {len(results)}",
        f"- 成功回答: {sum(1 for r in results if r.get('answer') and not r.get('error'))}",
        f"- 评分方式: {'LLM-as-judge' if judged else '人工（未自动打分）'}",
        "",
    ]

    if judged:
        lines.append("## 分维度平均分")
        lines.append("")
        lines.append("| 维度 | 平均分 |")
        lines.append("| --- | --- |")
        for dim in JUDGE_DIMENSIONS:
            scores = [r["judge"][dim]["score"] for r in results if r.get("judge") and dim in r["judge"]]
            lines.append(f"| {dim} | {avg(scores)} |")
        overall = [r["judge"]["overall"] for r in results if r.get("judge")]
        lines.append(f"| 综合 | {avg(overall)} |")
        lines.append("")

    lines.append("## 逐题明细")
    lines.append("")
    for r in results:
        lines.append(f"### {r['id']}（{r.get('dimension', '—')}）")
        lines.append("")
        lines.append(f"**题目**：{r['question']}")
        if r.get("reference"):
            lines.append(f"")
            lines.append(f"**参考答案**：{r['reference']}")
        if r.get("error"):
            lines.append("")
            lines.append(f"**回答**：❌ 调用失败 —— {r['error']}")
        else:
            lines.append("")
            lines.append(f"**回答**：{r['answer']}")
        if r.get("judge"):
            j = r["judge"]
            lines.append("")
            lines.append(f"**评分**：综合 {j.get('overall')}/5")
            for dim in JUDGE_DIMENSIONS:
                if dim in j:
                    d = j[dim]
                    lines.append(f"- {dim}：{d['score']}/5 —— {d['reason']}")
            if j.get("comment"):
                lines.append(f"- 总评：{j['comment']}")
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


# ── 主流程 ──

def main() -> int:
    parser = argparse.ArgumentParser(description="自动化评测脚本")
    parser.add_argument("cases_path", help="测试用例 JSON 路径")
    parser.add_argument("--no-judge", action="store_true", help="只跑回答不自动打分")
    parser.add_argument("--limit", type=int, default=None, help="只跑前 N 题（冒烟测试）")
    parser.add_argument("--api-base", default=API_BASE_DEFAULT, help="API 地址")
    parser.add_argument("--target-id", type=int, default=None, help="当测试用例无 target_id 时，统一指定的 personaId/kolId")
    parser.add_argument("--out-dir", default=None, help="结果输出目录（默认 data/eval/results）")
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

    judge_cfg = resolve_judge_config(project_root) if not args.no_judge else None

    out_dir = args.out_dir or os.path.join(project_root, "data", "eval", "results")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = re.sub(r"[^\w一-鿿-]+", "_", meta.get("name", "eval")).strip("_") or "eval"

    results = []
    for i, case in enumerate(cases, 1):
        qid = case.get("id", f"Q{i}")
        question = case["question"]
        target_id = case.get("target_id") or case.get("personaId") or case.get("kolId") or args.target_id
        body = {"message": question}
        if target == "kol":
            body["kolId"] = target_id
        else:
            body["personaId"] = target_id

        rec = {
            "id": qid,
            "dimension": case.get("dimension", ""),
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
                        rec["judge"] = judge_answer(
                            judge_cfg, question, case.get("reference", ""), answer, persona_hint
                        )
                    except Exception as e:  # judge 失败不影响答题结果
                        rec["judge"] = {"error": f"judge 失败: {e}"}
                elif judge_cfg:
                    rec["judge"] = {"error": "缺少有效 API Key，跳过打分"}
        except Exception as e:
            rec["error"] = str(e)

        results.append(rec)
        status = "✓" if rec["error"] is None else "✗"
        print(f"[{i}/{len(cases)}] {status} {qid}  len={len(rec['answer'])}")
        time.sleep(0.3)  # 温和节流，避免打满 API

    started = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    out_json = os.path.join(out_dir, f"{name}_{stamp}.json")
    out_md = os.path.join(out_dir, f"{name}_{stamp}.md")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "started": started, "results": results}, f, ensure_ascii=False, indent=2)
    with open(out_md, "w", encoding="utf-8") as f:
        f.write(render_markdown(meta, results, not args.no_judge, started))

    print(f"\n完成。JSON: {out_json}")
    print(f"报告: {out_md}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
