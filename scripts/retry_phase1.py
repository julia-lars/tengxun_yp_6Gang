#!/usr/bin/env python3
"""Phase 1 失败重试: 从 phase1 checkpoint 中找出失败的条目，重新提交 API 请求并合并结果。"""
import json, os, sys, time, re
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CKPT_PATH = os.path.join(PROJECT, "data", "eval", "results", "群体画像v2_0_测试题集_phase1_ckpt.json")
API_BASE = "http://localhost:3000"
ENDPOINT = "/api/chat"
ERROR_SENTINELS = ("[模拟用户暂时无法响应，请稍后重试]", "[KOL分身暂时无法响应，请稍后重试]")

def stream_chat(url, body, timeout=120):
    s = requests.Session()
    with s.post(url, json=body, stream=True, timeout=timeout,
                headers={"Content-Type": "application/json"}) as resp:
        resp.raise_for_status()
        resp.encoding = "utf-8"
        parts = []
        current_data = []
        for raw in resp.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            line = raw.strip()
            if not line:
                if current_data:
                    parts.append("".join(current_data))
                    current_data = []
                continue
            if line.startswith(":") or line.startswith("event:") or line.startswith("id:") or line.startswith("retry:"):
                continue
            if line.startswith("data:"):
                payload = line[5:].lstrip()
                if payload.startswith("{") and '"type"' in payload and "evidence" in payload:
                    continue
                current_data.append(payload)
            else:
                if line.startswith("{") and '"type"' in line and "evidence" in line:
                    continue
                current_data.append(line)
        if current_data:
            parts.append("".join(current_data))
        return "".join(parts).strip()

def main():
    with open(CKPT_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    results = data["results"]
    # 找出所有需要重试的条目
    to_retry = []
    for r in results:
        if r.get("error") or not r.get("answer") or not r["answer"].strip():
            to_retry.append(r)

    if not to_retry:
        print("✓ 没有需要重试的条目")
        return

    # 去重: 同一个 (case_id, persona_id) 保留一条
    seen = set()
    unique_retry = []
    for r in to_retry:
        key = (r.get("case_id"), r.get("target_id"))
        if key not in seen:
            seen.add(key)
            unique_retry.append(r)

    print(f"需要重试: {len(unique_retry)} 个唯一条目 (原始 {len(to_retry)} 条)")
    for r in unique_retry:
        print(f"  {r['id']}: {r.get('persona_name')} - {r.get('error','no answer')[:80]}")

    # 并行重试
    url = f"{API_BASE}{ENDPOINT}"
    lock = __import__('threading').Lock()
    success = [0]
    fail = [0]

    def retry_one(r):
        body = {"message": r["question"], "personaId": r["target_id"]}
        for attempt in range(3):
            try:
                answer = stream_chat(url, body)
                if any(s in answer for s in ERROR_SENTINELS):
                    if attempt < 2:
                        time.sleep(0.5)
                        continue
                    r["error"] = "LLM 调用失败(重试后)"
                    r["answer"] = answer
                elif not answer or not answer.strip():
                    if attempt < 2:
                        time.sleep(0.5)
                        continue
                    r["error"] = "Response ended prematurely (重试后)"
                else:
                    r["answer"] = answer
                    r["error"] = None
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(0.5)
                    continue
                r["error"] = str(e)

        with lock:
            if r.get("error") is None:
                success[0] += 1
                print(f"  ✓ {r['id']} ({r.get('persona_name')}) len={len(r['answer'])}")
            else:
                fail[0] += 1
                print(f"  ✗ {r['id']} ({r.get('persona_name')}): {r['error'][:80]}")
        return r

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(retry_one, r) for r in unique_retry]
        for f in as_completed(futures):
            f.result()

    # 更新 checkpoint 中对应的条目
    # 建立索引: (case_id, persona_id) -> 在 results 列表中的位置
    for retried in unique_retry:
        for i, r in enumerate(results):
            if r.get("case_id") == retried.get("case_id") and r.get("target_id") == retried.get("target_id"):
                results[i] = retried
                break

    # 去重: 同一个 id 只保留最新的（无 error 的优先）
    deduped = {}
    for r in results:
        rid = r.get("id", "")
        if rid not in deduped or (r.get("answer") and not r.get("error")):
            deduped[rid] = r
    results = list(deduped.values())

    # 保存
    data["results"] = results
    data["phase"] = "phase1_complete"
    data["retry_completed"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with open(CKPT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total_ok = sum(1 for r in results if r.get("answer") and not r.get("error"))
    total_err = sum(1 for r in results if r.get("error"))
    print(f"\n重试完成: 成功 {success[0]}, 失败 {fail[0]}")
    print(f"总计: {total_ok} 成功, {total_err} 错误 (共 {len(results)} 条)")
    print(f"Checkpoint 已更新: {CKPT_PATH}")

if __name__ == "__main__":
    main()