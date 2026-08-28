#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IMUR 单文件并行标注脚本 — 把 batch 级别的 API 调用并行化。
用法:
  python3 label_imur_parallel.py
"""

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from threading import Lock

import requests
from requests.adapters import HTTPAdapter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from label_demo_v3 import SYSTEM_PROMPT, extract_text, parse_json_lenient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

API_URL = os.getenv("DEEPSEEK_BASE_URL", "https://tokenhub.tencentmaas.com/plan/anthropic").rstrip("/") + "/v1/messages"
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

_API_KEYS_RAW = os.getenv("DEEPSEEK_API_KEYS", "") or os.getenv("DEEPSEEK_API_KEY", "")
API_KEYS = [k.strip() for k in _API_KEYS_RAW.split(",") if k.strip()]

MAX_TOKENS = 20000
TEMP = 0.0
MIN_TEXT_LEN = 10
API_TIMEOUT = (10, 300)

_api_key_lock = Lock()
_api_key_idx = 0

_sessions = {}
_session_lock = Lock()

# 输入文件
INPUT_FILE = os.path.join(BASE_DIR, "data", "群体画像v2.0_cleaned", "射击游戏用户问卷调研",
                          "IMUR AI模拟用户基座数据采集_1787191749_answers(1)_cleaned.json")
OUT_FILE = os.path.join(BASE_DIR, "data", "群体画像v2.0_labeled", "射击游戏用户问卷调研",
                        "IMUR AI模拟用户基座数据采集_1787191749_answers(1).json")
CKPT_FILE = os.path.join(BASE_DIR, "data", "群体画像v2.0_labeled", ".checkpoint", "射击游戏用户问卷调研",
                         "IMUR AI模拟用户基座数据采集_1787191749_answers(1).jsonl")

# 并发和批大小
BATCH_SIZE = 10
WORKERS = 50

# 进度
stats_lock = Lock()
segments_done = 0
api_calls = 0
api_errors = 0
start_time = 0


def load_env():
    env_path = os.path.join(BASE_DIR, "apps", "api", ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def get_api_key():
    global _api_key_idx
    if not API_KEYS:
        return ""
    with _api_key_lock:
        key = API_KEYS[_api_key_idx % len(API_KEYS)]
        _api_key_idx += 1
        return key


def get_session(api_key: str) -> requests.Session:
    if api_key in _sessions:
        return _sessions[api_key]
    with _session_lock:
        if api_key in _sessions:
            return _sessions[api_key]
        s = requests.Session()
        s.headers.update({
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        })
        adapter = HTTPAdapter(pool_connections=20, pool_maxsize=40, max_retries=0)
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _sessions[api_key] = s
        return s


def http_post(payload: dict, api_key: str = "") -> dict:
    if not api_key:
        api_key = get_api_key()
    session = get_session(api_key)
    try:
        resp = session.post(API_URL, json=payload, timeout=API_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout as e:
        raise RuntimeError(f"API timeout: {e}")
    except requests.exceptions.HTTPError as e:
        body = e.response.text[:500] if e.response else ""
        raise RuntimeError(f"HTTP {e.response.status_code if e.response else '?'}: {body}")
    except Exception as e:
        raise RuntimeError(f"API error: {type(e).__name__}: {e}")


def normalize_label(label: dict, seg: dict, idx: int) -> dict:
    label.setdefault("annotation_version", "3.1")
    source = label.setdefault("source", {})
    source["file"] = seg.get("source_file")
    source.setdefault("segment_index", idx)
    source.setdefault("speaker_id", seg.get("speaker_id"))
    source.setdefault("language", "zh")
    source.setdefault("preceding_question", seg.get("preceding_question", ""))
    label.setdefault("validity", {"is_player_evidence": True, "skip_reason": None, "duplicate_of": None, "requires_context": False})
    ib = label.setdefault("iceberg", {})
    for k in ("M1_motivation", "M2_expectation", "M3_perception", "M4_feeling", "M5_behavior"):
        ib.setdefault(k, [])
    ib.setdefault("causal_chain", [])
    label.setdefault("framework", {})
    label.setdefault("product_tags", {})
    label.setdefault("review_candidates", [])
    label.setdefault("evidence", [])
    meta = label.setdefault("meta", {})
    meta.setdefault("confidence", 0.8)
    meta.setdefault("calibrated", False)
    meta.setdefault("annotator", MODEL)
    meta["annotated_at"] = datetime.now(timezone.utc).isoformat()
    meta.setdefault("notes", "")
    return label


def empty_annotation(seg: dict, idx: int, reason: str = "too_short") -> dict:
    return {
        "annotation_version": "3.1",
        "source": {
            "file": seg.get("source_file"),
            "segment_index": idx,
            "speaker_id": seg.get("speaker_id"),
            "language": "zh",
            "preceding_question": seg.get("preceding_question", ""),
        },
        "validity": {"is_player_evidence": False, "skip_reason": reason, "duplicate_of": None, "requires_context": False},
        "iceberg": {
            "M1_motivation": [], "M2_expectation": [], "M3_perception": [],
            "M4_feeling": [], "M5_behavior": [], "causal_chain": [],
        },
        "framework": {},
        "product_tags": {},
        "review_candidates": [],
        "evidence": [],
        "meta": {
            "confidence": 1.0, "calibrated": False, "annotator": MODEL,
            "annotated_at": datetime.now(timezone.utc).isoformat(), "notes": reason,
        },
    }


def label_one_batch(batch_info: tuple) -> tuple:
    """标注一个 batch，返回 (batch_segs_with_idx, results)。
    batch_segs_with_idx: list of (original_idx, seg)"""
    batch_segs_with_idx = batch_info
    batch = [seg for _, seg in batch_segs_with_idx]

    user_lines = []
    for orig_idx, seg in batch_segs_with_idx:
        user_lines.append(
            f"[{orig_idx}] segment_id={seg.get('segment_id')}\n"
            f"speaker_id={seg.get('speaker_id')}\n"
            f"preceding_question={seg.get('preceding_question', '')}\n"
            f"cleaned_text={seg.get('cleaned_text', '')}"
        )
    user_msg = "请标注以下片段（保持顺序）：\n\n" + "\n\n".join(user_lines)

    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": TEMP,
        "thinking": {"type": "disabled"},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
    }

    for attempt in range(3):
        try:
            data = http_post(payload)
            raw = extract_text(data)
            parsed = parse_json_lenient(raw)
            if parsed is None:
                raise RuntimeError(f"无法解析 JSON: {raw[:500]}")
            results = parsed.get("results") if isinstance(parsed, dict) else parsed
            if not isinstance(results, list):
                raise RuntimeError(f"results 不是数组: {raw[:500]}")
            with stats_lock:
                global api_calls
                api_calls += 1
            return (batch_segs_with_idx, results[:len(batch)])
        except Exception as e:
            wait = 2 ** (attempt + 1)
            print(f"  batch API 失败（尝试 {attempt+1}/3）: {e}，{wait}s 后重试...", file=sys.stderr)
            time.sleep(wait)

    with stats_lock:
        global api_errors
        api_errors += 1
        api_calls += 1
    return (batch_segs_with_idx, [None] * len(batch))


def save_checkpoint_and_apply(out_rows: list, ckpt_f, batch_segs_with_idx: list, results: list):
    """把一批结果写入 checkpoint 并应用到 out_rows；线程安全"""
    for (orig_idx, seg), result in zip(batch_segs_with_idx, results):
        sid = seg.get("segment_id")
        if result:
            ann = normalize_label(result, seg, orig_idx)
        else:
            ann = empty_annotation(seg, orig_idx, "api_error")
        out_rows[orig_idx]["annotation"] = ann
        ckpt_f.write(json.dumps({"segment_id": sid, "done": True}, ensure_ascii=False) + "\n")
        ckpt_f.flush()
        with stats_lock:
            global segments_done
            segments_done += 1


def main():
    global start_time, segments_done
    start_time = time.time()

    load_env()

    if not API_KEYS:
        print("错误：未找到 DEEPSEEK_API_KEY(S)", file=sys.stderr)
        sys.exit(1)

    print(f"使用 API Keys: {len(API_KEYS)} 个, 模型: {MODEL}")
    print(f"并发: {WORKERS} workers, 每批: {BATCH_SIZE} segments")

    # 加载数据
    with open(INPUT_FILE, encoding="utf-8") as f:
        doc = json.load(f)

    segments = doc.get("segments", [])
    kept = [(i, s) for i, s in enumerate(segments) if s.get("cleaning_status") == "kept"]

    # 加载断点
    done_ids = set()
    if os.path.exists(CKPT_FILE):
        try:
            with open(CKPT_FILE, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        obj = json.loads(line)
                        done_ids.add(obj.get("segment_id"))
            print(f"断点续跑：{len(done_ids)} 条已完成")
        except Exception as e:
            print(f"读取断点失败: {e}")

    out_rows = [dict(s) for s in segments]
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    os.makedirs(os.path.dirname(CKPT_FILE), exist_ok=True)

    # 本地跳过短片段，同时应用 annotation 到 out_rows
    short_count = 0
    for idx, seg in kept:
        sid = seg.get("segment_id")
        if sid in done_ids:
            # 已经在 checkpoint 中，但需要把 short 的 annotation 也应用到 out_rows
            if len(seg.get("cleaned_text", "")) < MIN_TEXT_LEN:
                out_rows[idx]["annotation"] = empty_annotation(seg, idx, "too_short")
                short_count += 1
            continue
        if len(seg.get("cleaned_text", "")) < MIN_TEXT_LEN:
            out_rows[idx]["annotation"] = empty_annotation(seg, idx, "too_short")
            done_ids.add(sid)
            short_count += 1

    if short_count:
        # 把短的写入 checkpoint
        with open(CKPT_FILE, "a", encoding="utf-8") as ckpt_f:
            for idx, seg in kept:
                sid = seg.get("segment_id")
                if sid in done_ids and len(seg.get("cleaned_text", "")) < MIN_TEXT_LEN:
                    ckpt_f.write(json.dumps({"segment_id": sid, "done": True}, ensure_ascii=False) + "\n")
        segments_done += short_count
        print(f"本地跳过 {short_count} 条短片段")

    # 构建待处理的 batch 列表（只包含需要 API 的长片段）
    batches = []
    current = []
    for idx, seg in kept:
        sid = seg.get("segment_id")
        if sid in done_ids:
            continue
        current.append((idx, seg))
        if len(current) >= BATCH_SIZE:
            batches.append(tuple(current))
            current = []
    if current:
        batches.append(tuple(current))

    total = len(batches)
    segments_total = short_count + sum(len(b) for b in batches)
    print(f"待处理: {total} 个 batch, 共 {segments_total} 条")

    ckpt_lock = Lock()

    # 并行处理所有 batch
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(label_one_batch, b): b for b in batches}

        with open(CKPT_FILE, "a", encoding="utf-8") as ckpt_f:
            for future in as_completed(futures):
                try:
                    batch_segs_with_idx, results = future.result()
                    with ckpt_lock:
                        save_checkpoint_and_apply(out_rows, ckpt_f, batch_segs_with_idx, results)
                except Exception as e:
                    print(f"[错误] batch: {e}", file=sys.stderr)
                    with stats_lock:
                        global api_errors
                        api_errors += 1

                elapsed = time.time() - start_time
                done = segments_done
                speed = done / elapsed if elapsed > 0 else 0
                eta = (segments_total - done) / speed if speed > 0 else 0
                print(f"[进度] 片段 {done}/{segments_total} | API调用 {api_calls} | "
                      f"速度 {speed:.2f} seg/s | 预计剩余 {eta/60:.1f}min")

    # 保存最终文件
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "source_file": doc.get("source_file"),
            "annotated_at": datetime.now(timezone.utc).isoformat(),
            "model": MODEL,
            "segments": out_rows,
        }, f, ensure_ascii=False, indent=2)

    elapsed = time.time() - start_time
    print(f"\n完成！耗时 {elapsed/60:.1f}min, 输出: {OUT_FILE}")


if __name__ == "__main__":
    main()