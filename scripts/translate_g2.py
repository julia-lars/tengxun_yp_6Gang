#!/usr/bin/env python3
"""
翻译 G2 座谈会笔录：cleaned + labeled + merged 三个版本
将 preceding_question 和 cleaned_text 从英文翻译为中文
"""

import json
import os
import sys
import time
import requests

# ---- 配置（从 .env 文件读取）----
def _load_env():
    """从 ../../apps/api/.env 读取 API 配置"""
    env_path = os.path.join(os.path.dirname(__file__), "..", "apps", "api", ".env")
    env = {}
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    env[key.strip()] = val.strip()
    return env

_env = _load_env()
API_KEY = _env.get("DEEPSEEK_API_KEY", "")
BASE_URL = _env.get("DEEPSEEK_BASE_URL", "https://tokenhub.tencentmaas.com/plan/anthropic")
MODEL = "deepseek-v4-flash"
BATCH_SIZE = 20  # 每批翻译的 segment 数

DATA_DIR = "/Users/jessicajyan/tengxun_yp_6Gang/data"

FILES = {
    "cleaned": f"{DATA_DIR}/群体画像v2.0_cleaned/搜打撤品类研究/海外/座谈会笔录/座谈会笔录-G2_cleaned.json",
    "labeled": f"{DATA_DIR}/群体画像v2.0_labeled/搜打撤品类研究/海外/座谈会笔录/座谈会笔录-G2.json",
    "merged": f"{DATA_DIR}/群体画像v2.0_merged/搜打撤品类研究.json",
}

SYSTEM_PROMPT = """你是一个专业的游戏用户研究翻译助手。请将以下英文座谈会笔录翻译成中文。

翻译要求：
1. 翻译要自然流畅，符合中文口语习惯，模拟真实的中文座谈会对话
2. 游戏术语保留英文原名（如 Tarkov、FPS、RPG、extraction shooter 等），或使用业界通用译名
3. 保持原文的语气、情感和口语化表达（如犹豫、重复、口头禅等）
4. 不要添加或删减内容，忠实于原文
5. 输出格式：每行一个翻译结果，用 "---" 分隔每个条目，顺序与输入一致"""


def call_llm(messages: list[dict], max_tokens: int = 4096) -> str:
    """调用 DeepSeek API 进行翻译"""
    body = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    for attempt in range(3):
        try:
            resp = requests.post(
                f"{BASE_URL}/v1/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": API_KEY,
                    "anthropic-version": "2023-06-01",
                },
                json=body,
                timeout=120,
            )
            if resp.status_code != 200:
                print(f"  API error {resp.status_code}: {resp.text[:300]}")
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                return ""
            data = resp.json()
            text_blocks = [c["text"] for c in data.get("content", []) if c.get("type") == "text"]
            return "".join(text_blocks)
        except Exception as e:
            print(f"  Request error: {e}")
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                return ""


def translate_batch(texts: list[str], description: str) -> list[str]:
    """批量翻译文本"""
    results = []
    total = len(texts)

    for i in range(0, total, BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]
        # 构建输入：编号列表
        input_text = "\n\n---\n\n".join(f"[{j+1}] {t}" for j, t in enumerate(batch, i))

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"请翻译以下{description}（共 {len(batch)} 条），保持编号和分隔符：\n\n{input_text}"},
        ]

        translated = call_llm(messages, max_tokens=8192)
        if not translated:
            print(f"  Batch {i//BATCH_SIZE + 1} 翻译失败，保留原文")
            results.extend(batch)
            continue

        # 解析翻译结果：按 "[N]" 分割
        parsed = []
        # 按编号模式分割
        import re
        parts = re.split(r'\n?(?=\[\d+\])', translated.strip())
        for part in parts:
            # 去掉编号前缀
            cleaned = re.sub(r'^\[\d+\]\s*', '', part.strip())
            if cleaned:
                parsed.append(cleaned)

        if len(parsed) == len(batch):
            results.extend(parsed)
        else:
            print(f"  Batch {i//BATCH_SIZE + 1} 解析数量不匹配: got {len(parsed)}, expected {len(batch)}，保留原文")
            results.extend(batch)

        print(f"  [{description}] 进度: {min(i + BATCH_SIZE, total)}/{total}")
        time.sleep(0.5)  # 避免请求过快

    return results


def translate_cleaned():
    """翻译 cleaned 版本"""
    filepath = FILES["cleaned"]
    print(f"\n=== 翻译 cleaned: {filepath} ===")

    with open(filepath) as f:
        data = json.load(f)

    segments = data["segments"]
    total = len(segments)

    # 收集唯一 PQ 和所有 text
    pqs = [s["preceding_question"] for s in segments]
    texts = [s["cleaned_text"] for s in segments]

    # 翻译 PQ（去重）
    unique_pqs = list(dict.fromkeys(pqs))  # 保持顺序去重
    print(f"翻译 {len(unique_pqs)} 个唯一问题...")
    translated_pqs = translate_batch(unique_pqs, "主持人问题")

    # 建立 PQ 映射
    pq_map = dict(zip(unique_pqs, translated_pqs))

    # 翻译 cleaned_text
    print(f"翻译 {total} 个回答...")
    translated_texts = translate_batch(texts, "受访者回答")

    # 更新 segments
    for i, s in enumerate(segments):
        s["preceding_question"] = pq_map.get(pqs[i], pqs[i])
        s["cleaned_text"] = translated_texts[i] if i < len(translated_texts) else texts[i]

    # 保存
    with open(filepath, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"cleaned 版本已保存: {total} segments")


def translate_labeled():
    """翻译 labeled 版本"""
    filepath = FILES["labeled"]
    print(f"\n=== 翻译 labeled: {filepath} ===")

    with open(filepath) as f:
        data = json.load(f)

    segments = data["segments"]
    total = len(segments)

    pqs = [s["preceding_question"] for s in segments]
    texts = [s["cleaned_text"] for s in segments]

    # 翻译 PQ（去重 - 注意 labeled 的 PQ 和 cleaned 可能不完全一致）
    unique_pqs = list(dict.fromkeys(pqs))
    print(f"翻译 {len(unique_pqs)} 个唯一问题...")
    translated_pqs = translate_batch(unique_pqs, "主持人问题")
    pq_map = dict(zip(unique_pqs, translated_pqs))

    # 翻译 cleaned_text
    print(f"翻译 {total} 个回答...")
    translated_texts = translate_batch(texts, "受访者回答")

    # 更新 segments
    for i, s in enumerate(segments):
        old_pq = pqs[i]
        new_pq = pq_map.get(old_pq, old_pq)
        s["preceding_question"] = new_pq
        s["cleaned_text"] = translated_texts[i] if i < len(translated_texts) else texts[i]
        # 更新 annotation.source.preceding_question
        if "annotation" in s and "source" in s["annotation"]:
            s["annotation"]["source"]["preceding_question"] = new_pq

    with open(filepath, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"labeled 版本已保存: {total} segments")


def translate_merged():
    """翻译 merged 版本中海外 G2 的 segments"""
    filepath = FILES["merged"]
    print(f"\n=== 翻译 merged: {filepath} ===")

    with open(filepath) as f:
        data = json.load(f)

    # 找到所有海外 G2 的 segments
    g2_indices = []
    for i, s in enumerate(data["segments"]):
        src = s.get("source_file", "")
        if "海外" in src and "座谈会笔录-G2" in src:
            g2_indices.append(i)

    print(f"找到 {len(g2_indices)} 个海外 G2 segments")

    g2_segments = [data["segments"][i] for i in g2_indices]
    pqs = [s["preceding_question"] for s in g2_segments]
    texts = [s["cleaned_text"] for s in g2_segments]

    # 翻译 PQ
    unique_pqs = list(dict.fromkeys(pqs))
    print(f"翻译 {len(unique_pqs)} 个唯一问题...")
    translated_pqs = translate_batch(unique_pqs, "主持人问题")
    pq_map = dict(zip(unique_pqs, translated_pqs))

    # 翻译 text
    print(f"翻译 {len(texts)} 个回答...")
    translated_texts = translate_batch(texts, "受访者回答")

    # 更新
    for j, idx in enumerate(g2_indices):
        s = data["segments"][idx]
        old_pq = pqs[j]
        new_pq = pq_map.get(old_pq, old_pq)
        s["preceding_question"] = new_pq
        s["cleaned_text"] = translated_texts[j] if j < len(translated_texts) else texts[j]
        if "annotation" in s and "source" in s["annotation"]:
            s["annotation"]["source"]["preceding_question"] = new_pq

    with open(filepath, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"merged 版本已保存: {len(g2_indices)} 个海外 G2 segments")


if __name__ == "__main__":
    translate_cleaned()
    translate_labeled()
    translate_merged()
    print("\n=== 全部翻译完成 ===")