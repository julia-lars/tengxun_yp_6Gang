#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据标注 v3.1 全量并行脚本。

用法:
  python3 label_all_v3.py                    # 全量跑所有 cleaned 文件
  python3 label_all_v3.py --workers 8        # 指定并发线程数
  python3 label_all_v3.py --batch 10         # 指定每批片段数
  python3 label_all_v3.py --resume           # 断点续跑（自动检测已完成 segment，补全缺失）
  python3 label_all_v3.py --resume --retry-failed  # 断点续跑并重试 api_error 的 segment
  python3 label_all_v3.py --limit-files 3    # 只跑前 3 个文件（测试）

输出:
  data/群体画像v2.0_labeled/<原相对路径>.json
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from threading import Lock

# 使用 requests + Session 复用连接，降低 RemoteDisconnected 和 TCP 握手开销
import requests
from requests.adapters import HTTPAdapter

# 复用 label_demo_v3.py 的 SYSTEM_PROMPT（v3.1）和辅助函数
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from label_demo_v3 import SYSTEM_PROMPT, extract_text, parse_json_lenient

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

API_URL = os.getenv("DEEPSEEK_BASE_URL", "https://tokenhub.tencentmaas.com/plan/anthropic").rstrip("/") + "/v1/messages"
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

# 支持多 API Key 轮询：DEEPSEEK_API_KEYS 逗号分隔，或 DEEPSEEK_API_KEY 单 key
_API_KEYS_RAW = os.getenv("DEEPSEEK_API_KEYS", "") or os.getenv("DEEPSEEK_API_KEY", "")
API_KEYS = [k.strip() for k in _API_KEYS_RAW.split(",") if k.strip()]

_api_key_lock = Lock()
_api_key_idx = 0

SRC_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_cleaned")
OUT_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_labeled")
CKPT_DIR = os.path.join(OUT_DIR, ".checkpoint")

MAX_TOKENS = 20000
TEMP = 0.0
MIN_TEXT_LEN = 10

# 全局 Session，启用连接池；每个 key 一个 Session，避免头信息混用
_sessions = {}
_session_lock = Lock()
API_TIMEOUT = (10, 300)  # (connect_timeout, read_timeout)


def get_api_key():
    """轮询返回下一个 API Key。"""
    global _api_key_idx
    if not API_KEYS:
        return ""
    with _api_key_lock:
        key = API_KEYS[_api_key_idx % len(API_KEYS)]
        _api_key_idx += 1
        return key


def get_session(api_key: str) -> requests.Session:
    """按 key 返回复用的 Session。"""
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
        # 连接池大小与并发匹配；max_retries 仅处理连接层，不重试请求体
        adapter = HTTPAdapter(
            pool_connections=20,
            pool_maxsize=40,
            max_retries=0,
        )
        s.mount("https://", adapter)
        s.mount("http://", adapter)
        _sessions[api_key] = s
        return s


def http_post(payload: dict, api_key: str = "") -> dict:
    """带 key 轮询和连接复用的 API 调用。

    优先使用 Session 连接池，失败时回退到直接 requests.post。
    """
    if not api_key:
        api_key = get_api_key()

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    # 尝试 Session-based 请求
    session = get_session(api_key)
    try:
        resp = session.post(API_URL, json=payload, timeout=API_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout):
        # Session 连接可能有问题，回退到直接请求
        pass
    except requests.exceptions.HTTPError as e:
        body = e.response.text[:500] if e.response else ""
        raise RuntimeError(f"HTTP {e.response.status_code if e.response else '?'}: {body}")

    # 回退：直接 requests.post（不通过 Session）
    try:
        resp = requests.post(API_URL, json=payload, headers=headers, timeout=API_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.Timeout as e:
        raise RuntimeError(f"API timeout: {e}")
    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(f"API connection error: {e}")
    except requests.exceptions.HTTPError as e:
        body = e.response.text[:500] if e.response else ""
        raise RuntimeError(f"HTTP {e.response.status_code if e.response else '?'}: {body}")
    except Exception as e:
        raise RuntimeError(f"API error: {type(e).__name__}: {e}")


# 全局统计
stats_lock = Lock()
stats = {
    "files_total": 0,
    "files_done": 0,
    "segments_total": 0,
    "segments_done": 0,
    "api_calls": 0,
    "api_errors": 0,
    "start_time": time.time(),
}


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


def find_cleaned_files():
    files = []
    for root, _, fs in os.walk(SRC_DIR):
        for f in fs:
            if f.endswith("_cleaned.json"):
                files.append(os.path.join(root, f))
    return sorted(files)


def rel_path_from_src(abs_path):
    """返回相对于 SRC_DIR 的路径，不含 _cleaned.json 后缀。"""
    rel = os.path.relpath(abs_path, SRC_DIR)
    if rel.endswith("_cleaned.json"):
        rel = rel[:-len("_cleaned.json")]
    return rel


def output_path_for(input_path):
    rel = rel_path_from_src(input_path)
    return os.path.join(OUT_DIR, rel + ".json")


def checkpoint_path_for(input_path):
    rel = rel_path_from_src(input_path)
    return os.path.join(CKPT_DIR, rel + ".jsonl")


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
            "M1_motivation": [],
            "M2_expectation": [],
            "M3_perception": [],
            "M4_feeling": [],
            "M5_behavior": [],
            "causal_chain": [],
        },
        "framework": {},
        "product_tags": {},
        "review_candidates": [],
        "evidence": [],
        "meta": {
            "confidence": 1.0,
            "calibrated": False,
            "annotator": MODEL,
            "annotated_at": datetime.now(timezone.utc).isoformat(),
            "notes": reason,
        },
    }


def label_batch(segments: list, start_idx: int) -> list:
    """调用 API 标注一批片段，返回与输入等长的标注列表。"""
    user_lines = []
    for i, seg in enumerate(segments):
        user_lines.append(
            f"[{start_idx + i}] segment_id={seg.get('segment_id')}\n"
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
            # 每次重试使用不同的 API Key（轮询）
            data = http_post(payload, api_key="" if attempt > 0 else None)
            raw = extract_text(data)
            parsed = parse_json_lenient(raw)
            if parsed is None:
                raise RuntimeError(f"无法解析 JSON: {raw[:500]}")
            results = parsed.get("results") if isinstance(parsed, dict) else parsed
            if not isinstance(results, list):
                raise RuntimeError(f"results 不是数组: {raw[:500]}")
            return results[:len(segments)]
        except Exception as e:
            # 超时/限流/断连时增大退避，给服务端喘息时间
            wait = 2 ** (attempt + 1)
            print(f"  API 调用失败（尝试 {attempt+1}/3）: {e}，{wait}s 后重试...", file=sys.stderr)
            time.sleep(wait)
    return [None] * len(segments)


def process_file(input_path: str, batch_size: int, resume: bool, retry_failed: bool = False) -> dict:
    """处理单个 cleaned 文件，返回统计信息。"""
    out_path = output_path_for(input_path)
    ckpt_path = checkpoint_path_for(input_path)

    with open(input_path, encoding="utf-8") as f:
        doc = json.load(f)

    segments = doc.get("segments", [])
    kept = [(i, s) for i, s in enumerate(segments) if s.get("cleaning_status") == "kept"]

    # 断点：加载已完成的 segment_id
    done_ids = set()
    out_rows = None

    if resume and os.path.exists(out_path):
        # 加载已有输出，检查内容完整性（而非仅检查文件存在）
        with open(out_path, encoding="utf-8") as f:
            existing = json.load(f)
        existing_segs = existing.get("segments", [])

        # 安全检查：输出文件的 segment 数量必须与输入一致
        if len(existing_segs) != len(segments):
            print(f"  ⚠️ 输出文件 segment 数量不匹配（输出={len(existing_segs)}, 输入={len(segments)}），重新处理")
            out_rows = [dict(s) for s in segments]
        else:
            # 检查哪些 kept segment 已有有效 annotation
            all_complete = True
            for idx, seg in kept:
                sid = seg.get("segment_id")
                ann = existing_segs[idx].get("annotation")
                if ann is None:
                    # 完全没有标注 → 需要补
                    all_complete = False
                elif retry_failed and isinstance(ann, dict) and ann.get("meta", {}).get("notes") == "api_error":
                    # --retry-failed 模式：api_error 的 segment 需要重新标注
                    all_complete = False
                else:
                    # 已有有效标注 → 标记为已完成
                    done_ids.add(sid)

            if all_complete:
                return {"input": input_path, "status": "skipped", "reason": "output_complete"}

            # 不完整：使用已有输出作为基础，只补全缺失的 segment
            out_rows = existing_segs
            incomplete_count = len(kept) - len(done_ids)
            print(f"  续跑：已有 {len(done_ids)}/{len(kept)} 条已标注，需补全 {incomplete_count} 条")
    else:
        out_rows = [dict(s) for s in segments]

    # 同时从 checkpoint 文件加载已完成的 segment_id
    # 注意：如果已从输出文件加载了 done_ids，则跳过 checkpoint
    # 因为输出文件是权威数据源，checkpoint 可能与输出文件不同步
    #（例如：脚本中断时 checkpoint 已写入但输出文件未保存）
    if resume and os.path.exists(ckpt_path) and out_rows is None:
        try:
            with open(ckpt_path, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        obj = json.loads(line)
                        done_ids.add(obj.get("segment_id"))
            print(f"  checkpoint 加载: {len(done_ids)} 条已完成")
        except Exception as e:
            print(f"  读取断点失败: {e}")

    print(f"  断点续跑：{len(done_ids)}/{len(kept)} 条已完成，{len(kept) - len(done_ids)} 条待处理")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    os.makedirs(os.path.dirname(ckpt_path), exist_ok=True)

    # 先处理本地可跳过的短片段
    for idx, seg in kept:
        sid = seg.get("segment_id")
        if sid in done_ids:
            continue
        text = seg.get("cleaned_text", "")
        if len(text) < MIN_TEXT_LEN:
            out_rows[idx]["annotation"] = empty_annotation(seg, idx, "too_short")
            with stats_lock:
                stats["segments_done"] += 1
            done_ids.add(sid)

    # 批量 API 调用
    # 每个 batch 元素是 (segment_index_in_array, segment_dict)，确保索引正确
    batches = []
    current = []
    for idx, seg in kept:
        sid = seg.get("segment_id")
        if sid in done_ids:
            continue
        current.append((idx, seg))
        if len(current) >= batch_size:
            batches.append(current)
            current = []
    if current:
        batches.append(current)

    for batch in batches:
        segments_only = [seg for _, seg in batch]
        results = label_batch(segments_only, batch[0][0])
        with open(ckpt_path, "a", encoding="utf-8") as ckpt_f:
            for i, (idx, seg) in enumerate(batch):
                sid = seg.get("segment_id")
                if i < len(results) and results[i]:
                    ann = normalize_label(results[i], seg, idx)
                else:
                    ann = empty_annotation(seg, idx, "api_error")
                out_rows[idx]["annotation"] = ann
                ckpt_f.write(json.dumps({"segment_id": sid, "done": True}, ensure_ascii=False) + "\n")
                ckpt_f.flush()
                with stats_lock:
                    stats["segments_done"] += 1
        with stats_lock:
            stats["api_calls"] += 1

    # 保存最终文件
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "source_file": doc.get("source_file"),
            "annotated_at": datetime.now(timezone.utc).isoformat(),
            "model": MODEL,
            "segments": out_rows,
        }, f, ensure_ascii=False, indent=2)

    return {"input": input_path, "status": "done", "segments": len(segments), "kept": len(kept)}


def print_progress():
    with stats_lock:
        elapsed = time.time() - stats["start_time"]
        files_done = stats["files_done"]
        files_total = stats["files_total"]
        segs_done = stats["segments_done"]
        segs_total = stats["segments_total"]
        api_calls = stats["api_calls"]
        speed = segs_done / elapsed if elapsed > 0 else 0
        eta = (segs_total - segs_done) / speed if speed > 0 else 0
        print(
            f"[进度] 文件 {files_done}/{files_total} | 片段 {segs_done}/{segs_total} "
            f"| API调用 {api_calls} | 速度 {speed:.2f} seg/s | 预计剩余 {eta/3600:.1f}h"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=15, help="并发线程数")
    parser.add_argument("--batch", type=int, default=10, help="每批 API 请求包含的片段数")
    parser.add_argument("--resume", action="store_true", help="断点续跑")
    parser.add_argument("--retry-failed", action="store_true", help="重新标注之前标记为 api_error 的 segment")
    parser.add_argument("--limit-files", type=int, default=None, help="只跑前 N 个文件（测试）")
    parser.add_argument("--api-keys", type=str, default=None, help="逗号分隔的多个 API Key")
    args = parser.parse_args()

    global API_KEYS
    if args.api_keys:
        API_KEYS = [k.strip() for k in args.api_keys.split(",") if k.strip()]

    if not API_KEYS:
        print("错误：未找到 DEEPSEEK_API_KEY(S)，请检查 apps/api/.env 或用 --api-keys 传入", file=sys.stderr)
        sys.exit(1)

    print(f"使用 API Keys: {len(API_KEYS)} 个")
    print(f"使用模型: {MODEL}")

    files = find_cleaned_files()
    if args.limit_files:
        files = files[:args.limit_files]

    total_segments = 0
    already_done = 0

    for fp in files:
        with open(fp, encoding="utf-8") as f:
            doc = json.load(f)
        total_segments += len([s for s in doc.get("segments", []) if s.get("cleaning_status") == "kept"])

    # 断点续跑时，预扫描已完成文件，统计已标注的 segment 数
    if args.resume:
        for fp in files:
            out_path = output_path_for(fp)
            if os.path.exists(out_path):
                try:
                    with open(out_path, encoding="utf-8") as f:
                        existing = json.load(f)
                    existing_segs = existing.get("segments", [])
                    with open(fp, encoding="utf-8") as f:
                        doc = json.load(f)
                    segments = doc.get("segments", [])
                    if len(existing_segs) == len(segments):
                        # 检查每个 kept segment 是否已有有效 annotation
                        all_complete = True
                        for i, seg in enumerate(segments):
                            if seg.get("cleaning_status") != "kept":
                                continue
                            ann = existing_segs[i].get("annotation")
                            if ann is None:
                                all_complete = False
                            elif args.retry_failed and isinstance(ann, dict) and ann.get("meta", {}).get("notes") == "api_error":
                                all_complete = False
                            else:
                                already_done += 1
                except Exception:
                    pass

    stats["files_total"] = len(files)
    stats["segments_total"] = total_segments
    stats["segments_done"] = already_done

    pending = total_segments - already_done
    print(f"全量标注开始：{len(files)} 个文件，{total_segments} 条 kept 片段")
    if args.resume and already_done > 0:
        print(f"  已标注: {already_done} 条，待标注: {pending} 条")
    print(f"并发: {args.workers} workers, 每批: {args.batch} segments")

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_file, fp, args.batch, args.resume, args.retry_failed): fp for fp in files}
        for future in as_completed(futures):
            fp = futures[future]
            try:
                result = future.result()
                with stats_lock:
                    stats["files_done"] += 1
                print(f"[完成] {os.path.basename(fp)}: {result.get('status', 'unknown')}")
            except Exception as e:
                with stats_lock:
                    stats["files_done"] += 1
                    stats["api_errors"] += 1
                print(f"[错误] {os.path.basename(fp)}: {e}", file=sys.stderr)
            print_progress()

    print("\n全部完成。输出目录:", OUT_DIR)


if __name__ == "__main__":
    load_env()
    main()
