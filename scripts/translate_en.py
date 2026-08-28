#!/usr/bin/env python3
"""将群体画像v2.0_cleaned 中英文 segment 翻译为中文。"""

import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CLEANED_DIR = PROJECT_ROOT / "data" / "群体画像v2.0_cleaned"

API_URL = "https://tokenhub.tencentmaas.com/plan/anthropic/v1/messages"
API_KEY = os.environ.get("DEEPSEEK_API_KEY", "sk-tp-O28VXde1RUBDgIybP0hO2UDX5RPiQBDcZlbcYjONQ2vffwod")
MODEL = "deepseek-v4-pro"

BATCH_SIZE = 200
MAX_WORKERS = 50


def is_english_dominant(text: str) -> bool:
    if not text:
        return False
    en_chars = sum(1 for c in text if c.isascii() and c.isalpha())
    zh_chars = sum(1 for c in text if "一" <= c <= "鿿")
    return en_chars > zh_chars and en_chars > 10


def translate_batch(texts: list[str]) -> list[str]:
    """调用 DeepSeek API 批量翻译。失败返回原文。"""
    if not texts:
        return []

    items = "\n\n---\n\n".join(f"[{i}]\n{t}" for i, t in enumerate(texts))
    prompt = f"""将以下英文游戏访谈内容翻译为中文。要求：
1. 保持口语感和原始表达风格，不要过度书面化
2. 保留程度/态度/不确定性修饰词（way more→强很多，I think→我觉得，maybe→可能）
3. 游戏名统一用中文标准名（Valorant→无畏契约，Apex→Apex英雄，CS→CS，COD→使命召唤等）
4. 删除纯口语噪声（um, uh），但保留表示态度的填充词
5. 输出格式：每条翻译一行，以 [序号] 开头，不要输出任何其他内容

{items}"""

    headers = {
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    body = {
        "model": MODEL,
        "max_tokens": 65536,
        "thinking": {"type": "disabled"},
        "messages": [{"role": "user", "content": prompt}],
    }

    for attempt in range(3):
        try:
            r = requests.post(API_URL, headers=headers, json=body, timeout=600)
            if r.status_code == 200:
                resp = r.json()
                content = ""
                for block in resp.get("content", []):
                    if block.get("type") == "text":
                        content += block.get("text", "")
                return parse_translations(content, len(texts))
            else:
                print(f"    API错误 {r.status_code}: {r.text[:100]}")
                time.sleep(3)
        except Exception as e:
            print(f"    请求异常: {e}")
            time.sleep(3)

    print(f"    翻译失败，保留原文")
    return texts


def parse_translations(content: str, expected_count: int) -> list[str]:
    """解析 API 返回的 [序号] 翻译 格式。"""
    results = [""] * expected_count
    pattern = re.compile(r"\[(\d+)\]\s*")
    parts = pattern.split(content)

    i = 0
    while i < len(parts) - 1:
        if parts[i].isdigit():
            idx = int(parts[i])
            text = parts[i + 1].strip() if i + 1 < len(parts) else ""
            if 0 <= idx < expected_count and text:
                results[idx] = text
            i += 2
        else:
            i += 1

    for i in range(expected_count):
        if not results[i]:
            results[i] = f"[未翻译]"
    return results


def translate_file(filepath: Path) -> int:
    """翻译单个文件中的英文 segment，并行批量翻译。"""
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    segments = data.get("segments", [])
    if not segments:
        return 0

    # 收集需要翻译的 segment (cleaned_text)
    to_translate = []
    for i, seg in enumerate(segments):
        ct = seg.get("cleaned_text", "")
        if is_english_dominant(ct):
            to_translate.append((i, ct))

    # 同时也收集需要翻译的 preceding_question
    pq_translate = []
    for i, seg in enumerate(segments):
        pq = seg.get("preceding_question", "")
        if is_english_dominant(pq):
            pq_translate.append((i, pq))

    if not to_translate and not pq_translate:
        return 0

    # 构建所有批量任务
    tasks = []  # (batch_items, field_type)

    for batch_start in range(0, len(to_translate), BATCH_SIZE):
        batch = to_translate[batch_start : batch_start + BATCH_SIZE]
        tasks.append((batch, "cleaned_text"))

    for batch_start in range(0, len(pq_translate), BATCH_SIZE):
        batch = pq_translate[batch_start : batch_start + BATCH_SIZE]
        tasks.append((batch, "preceding_question"))

    total_batches = len(tasks)
    translated_count = 0

    # 并行执行所有批量翻译
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_to_task = {}
        for batch_items, field_type in tasks:
            texts = [t for _, t in batch_items]
            future = executor.submit(translate_batch, texts)
            future_to_task[future] = (batch_items, field_type)

        completed = 0
        for future in as_completed(future_to_task):
            completed += 1
            batch_items, field_type = future_to_task[future]
            try:
                translated = future.result()
            except Exception as e:
                print(f"    批量任务异常: {e}", flush=True)
                translated = [t for _, t in batch_items]

            for (idx, _), trans in zip(batch_items, translated):
                if trans and trans != "[未翻译]":
                    segments[idx][field_type] = trans
                    if field_type == "cleaned_text":
                        segments[idx]["char_count"] = len(trans)
                        translated_count += 1
            print(f"    [{completed}/{total_batches}] {field_type} 完成", flush=True)

    if translated_count > 0:
        data["segment_count"] = sum(
            1 for s in segments if s.get("cleaning_status") in ("kept", "needs_review")
        )
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    return translated_count


def main():
    cleaned_files = sorted(CLEANED_DIR.rglob("*_cleaned.json"))

    # 第一阶段：扫描所有文件，收集所有批量任务
    file_data = {}  # filepath -> {data, segments, tasks, translated_count, total_batches}
    all_futures = {}  # future -> (filepath, batch_items, field_type)

    print(f"🔍 扫描 {len(cleaned_files)} 个清洗文件...\n")

    total_segments = 0
    for f in cleaned_files:
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        segments = data.get("segments", [])
        if not segments:
            continue

        en_count = sum(
            1 for s in segments
            if is_english_dominant(s.get("cleaned_text", ""))
        )
        total_segments += en_count
        if en_count == 0:
            continue

        # 收集需要翻译的 segment
        to_translate = []
        for i, seg in enumerate(segments):
            ct = seg.get("cleaned_text", "")
            if is_english_dominant(ct):
                to_translate.append((i, ct))

        pq_translate = []
        for i, seg in enumerate(segments):
            pq = seg.get("preceding_question", "")
            if is_english_dominant(pq):
                pq_translate.append((i, pq))

        if not to_translate and not pq_translate:
            continue

        tasks = []
        for batch_start in range(0, len(to_translate), BATCH_SIZE):
            tasks.append((to_translate[batch_start : batch_start + BATCH_SIZE], "cleaned_text"))
        for batch_start in range(0, len(pq_translate), BATCH_SIZE):
            tasks.append((pq_translate[batch_start : batch_start + BATCH_SIZE], "preceding_question"))

        file_data[f] = {
            "data": data,
            "segments": segments,
            "tasks": tasks,
            "translated_count": 0,
            "total_batches": len(tasks),
            "completed_batches": 0,
            "path": str(f.relative_to(CLEANED_DIR)),
            "en_count": en_count,
        }

    # 第二阶段：所有批量任务提交到一个全局线程池
    batch_count = sum(d["total_batches"] for d in file_data.values())
    print(f"📦 共 {len(file_data)} 个文件，{batch_count} 个批量任务，{MAX_WORKERS} 路并发\n")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        for fp, fd in file_data.items():
            for batch_items, field_type in fd["tasks"]:
                texts = [t for _, t in batch_items]
                future = executor.submit(translate_batch, texts)
                all_futures[future] = (fp, batch_items, field_type)

        completed = 0
        for future in as_completed(all_futures):
            completed += 1
            fp, batch_items, field_type = all_futures[future]
            fd = file_data[fp]

            try:
                translated = future.result()
            except Exception as e:
                translated = [t for _, t in batch_items]

            for (idx, _), trans in zip(batch_items, translated):
                if trans and trans != "[未翻译]":
                    fd["segments"][idx][field_type] = trans
                    if field_type == "cleaned_text":
                        fd["segments"][idx]["char_count"] = len(trans)
                        fd["translated_count"] += 1

            fd["completed_batches"] += 1

            # 文件所有批次完成时，保存
            if fd["completed_batches"] == fd["total_batches"]:
                if fd["translated_count"] > 0:
                    fd["data"]["segment_count"] = sum(
                        1 for s in fd["segments"] if s.get("cleaning_status") in ("kept", "needs_review")
                    )
                    with open(fp, "w", encoding="utf-8") as f:
                        json.dump(fd["data"], f, ensure_ascii=False, indent=2)
                print(f"  ✅ [{fd['completed_batches']}/{fd['total_batches']}] {fd['path']} 翻译 {fd['translated_count']} 条", flush=True)
            else:
                print(f"  [{fd['completed_batches']}/{fd['total_batches']}] {fd['path']} ({fd['en_count']}条)", flush=True)

    total_translated = sum(d["translated_count"] for d in file_data.values())
    print(f"\n{'='*50}")
    print(f"✅ 处理 {len(file_data)} 个文件，翻译 {total_translated}/{total_segments} 条")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()