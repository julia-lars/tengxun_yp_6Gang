#!/usr/bin/env python3
"""
快速对比评测：当前流程 vs 原流程
用少量题目测试群体画像回答质量。
"""
import json, time, sys, requests

API = "http://localhost:3000"
PERSONAS = [
    {"id": 7, "name": "社交归属型"},
    {"id": 10, "name": "沉浸探索型"},
    {"id": 6, "name": "竞技成长型"},
    {"id": 9, "name": "战斗刺激型"},
    {"id": 8, "name": "低压解压型"},
]

# 少量测试题（覆盖不同维度）
QUESTIONS = [
    "你平时喜欢玩什么类型的游戏？",
    "你跟朋友一起玩游戏吗？",
]

def chat(persona_id, question, timeout=120):
    """调用 /api/chat，返回结果"""
    t0 = time.time()
    full_answer = ""
    meta = {}
    evidence_count = 0
    relevance_scores = []

    try:
        resp = requests.post(
            f"{API}/api/chat",
            json={"personaId": persona_id, "message": question},
            stream=True, timeout=timeout,
        )
        buf = ""
        for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
            if not chunk:
                continue
            buf += chunk
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = line.strip()
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                # 尝试解析 JSON
                try:
                    parsed = json.loads(data)
                    if isinstance(parsed, dict):
                        if parsed.get("type") == "meta":
                            meta = parsed
                            evidence_count = len(parsed.get("evidence", []))
                            for e in parsed.get("evidence", []):
                                if e.get("relevanceScore") is not None:
                                    relevance_scores.append(e["relevanceScore"])
                        elif parsed.get("type") == "evidenceUpdate":
                            ev = parsed.get("evidence")
                            if ev and len(ev) > 0:
                                evidence_count = len(ev)
                            for e in (ev or []):
                                if e.get("relevanceScore") is not None:
                                    relevance_scores.append(e["relevanceScore"])
                except (json.JSONDecodeError, ValueError):
                    full_answer += data
        # 处理剩余 buffer
        if buf.strip().startswith("data: "):
            data = buf.strip()[6:]
            try:
                json.loads(data)
            except (json.JSONDecodeError, ValueError):
                full_answer += data
    except Exception as e:
        return {"error": str(e), "elapsed": time.time() - t0}

    elapsed = time.time() - t0
    return {
        "persona": persona_id,
        "question": question,
        "answer": full_answer[:500],
        "answer_len": len(full_answer),
        "elapsed": round(elapsed, 1),
        "evidence_count": evidence_count,
        "relevance_scores": relevance_scores,
        "avg_relevance": round(sum(relevance_scores) / len(relevance_scores), 3) if relevance_scores else None,
        "has_error": False,
    }

def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "current"
    print(f"\n{'='*60}")
    print(f"评测模式: {label}")
    print(f"{'='*60}")

    results = []
    for persona in PERSONAS:
        for q in QUESTIONS:
            print(f"\n  [{persona['name']}] Q: {q}")
            r = chat(persona["id"], q)
            results.append(r)
            print(f"    耗时: {r['elapsed']}s | 回答长度: {r['answer_len']}字 | 证据数: {r['evidence_count']} | 平均匹配度: {r['avg_relevance']}")
            if r.get("error"):
                print(f"    ERROR: {r['error']}")
            time.sleep(1)  # 避免请求过快

    # 汇总
    print(f"\n{'='*60}")
    print(f"汇总 ({label})")
    print(f"{'='*60}")
    success = [r for r in results if not r.get("error")]
    if success:
        avg_time = sum(r["elapsed"] for r in success) / len(success)
        avg_len = sum(r["answer_len"] for r in success) / len(success)
        avg_ev = sum(r["evidence_count"] for r in success) / len(success)
        all_scores = [s for r in success for s in r["relevance_scores"]]
        avg_rel = round(sum(all_scores) / len(all_scores), 3) if all_scores else None
        print(f"  总题数: {len(success)}/{len(results)}")
        print(f"  平均耗时: {avg_time:.1f}s")
        print(f"  平均回答长度: {avg_len:.0f}字")
        print(f"  平均证据数: {avg_ev:.1f}")
        print(f"  平均LLM匹配度: {avg_rel}")

    # 保存结果
    out = {"label": label, "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"), "results": results}
    fn = f"/tmp/eval_{label}.json"
    with open(fn, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n结果已保存: {fn}")

if __name__ == "__main__":
    main()