#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KOL 视频转录文本语义切分脚本。

将每个视频的完整转录文本按语义边界切分为独立段落，
每个段落覆盖单一完整观点。

用法:
  python3 scripts/rechunk_kol.py                        # 全量处理
  python3 scripts/rechunk_kol.py --limit 5              # 只处理前 5 个视频（测试）
  python3 scripts/rechunk_kol.py --kol 冷面叶星星IKGN   # 只处理指定 KOL
  python3 scripts/rechunk_kol.py --resume               # 断点续跑

输出:
  data/kol/冷面叶星星IKGN_segmented.json
  data/kol/鬼王陆行_segmented.json
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests
from requests.adapters import HTTPAdapter

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

API_URL = os.getenv(
    "DEEPSEEK_BASE_URL", "https://tokenhub.tencentmaas.com/plan/anthropic"
).rstrip("/") + "/v1/messages"
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

SRC_DIR = os.path.join(BASE_DIR, "data", "kol")
OUT_DIR = os.path.join(BASE_DIR, "data", "kol")
CKPT_DIR = os.path.join(OUT_DIR, ".rechunk_checkpoint")

MAX_TOKENS = 8192
TEMP = 0.0
API_TIMEOUT = (10, 300)
MAX_RETRIES = 3
# 段落长度硬上限：超过此长度的段会被 LLM 递归再切，仍超限则程序化兜底
MAX_SEG_LEN = 200
# 每批处理的视频数
BATCH_SIZE = 5

# ── 切分 System Prompt ──

SYSTEM_PROMPT = """你是游戏视频转录文本的语义切分助手。你的任务是将一段完整的视频转录文本按语义边界切分为独立段落。

## 切分原则

1. **按话题切分**：当话题转换时（如从个人经历切换到游戏评价、从玩法分析切换到音乐点评），必须切分。
2. **按论证层次切分**：当论证进入新层次时（如"首先...其次..."、"另一方面"、"但是"转折），应切分。
3. **按叙事段落切分**：原文中已有的自然段落分隔（换行）应保留为切分边界。
4. **每个段落覆盖单一完整观点**：一个段落不应混合多个独立观点。
5. **保持原文措辞**：不润色、不改写、不删除任何内容，只做切分。
6. **每段不超过 200 字**：优先按句切成约 60-180 字的小段（约 1-3 句口播内容）；宁可多切几段，也不要让一段超过 200 字。单个长句超 200 字时按逗号、语气停顿处拆开。

## 输出格式

返回一个 JSON 对象，包含一个 "segments" 数组，每个元素是一个语义独立的段落文本。

```json
{
  "segments": [
    "段落1文本...",
    "段落2文本...",
    "段落3文本..."
  ]
}
```

## 重要规则

- 不要遗漏任何原文内容
- 不要合并不同话题的段落
- 不要添加原文中没有的内容
- 广告/赞助口播内容也必须保留，作为独立段落切分
- 输出前自查：任何一段超过 200 字都必须继续切分，直到所有段落不超过 200 字
- 如果原文只有一段且不超过 200 字，返回一个只包含一个元素的数组"""


def load_env():
    """加载 .env 文件中的环境变量。"""
    for env_file in [
        os.path.join(BASE_DIR, ".env"),
        os.path.join(BASE_DIR, "apps", "api", ".env"),
    ]:
        if not os.path.exists(env_file):
            continue
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def extract_text(data: dict) -> str:
    """从 Anthropic Messages API 响应中提取文本。"""
    parts = []
    for b in data.get("content", []):
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text", ""))
    return "\n".join(parts)


def parse_json_lenient(text: str):
    """宽松 JSON 解析，处理 Markdown 代码块包裹。"""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    s = text.find("{")
    e = text.rfind("}")
    if s != -1 and e != -1 and e > s:
        try:
            return json.loads(text[s : e + 1])
        except json.JSONDecodeError:
            pass
    return None


def api_call(messages: list, api_key: str = "") -> dict:
    """调用 TokenHub Anthropic 兼容 API。"""
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key or API_KEY,
        "anthropic-version": "2023-06-01",
    }

    payload = {
        "model": MODEL,
        "max_tokens": MAX_TOKENS,
        "temperature": TEMP,
        "thinking": {"type": "disabled"},
        "messages": messages,
    }

    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.post(API_URL, json=payload, headers=headers, timeout=API_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout:
            if attempt < MAX_RETRIES - 1:
                wait = (attempt + 1) * 10
                print(f"  ⚠️ API 超时，{wait}s 后重试 ({attempt + 1}/{MAX_RETRIES})...")
                time.sleep(wait)
            else:
                raise RuntimeError("API 超时，已达最大重试次数")
        except requests.exceptions.ConnectionError as e:
            if attempt < MAX_RETRIES - 1:
                wait = (attempt + 1) * 5
                print(f"  ⚠️ 连接错误，{wait}s 后重试 ({attempt + 1}/{MAX_RETRIES}): {e}")
                time.sleep(wait)
            else:
                raise RuntimeError(f"API 连接错误: {e}")
        except requests.exceptions.HTTPError as e:
            body = e.response.text[:500] if e.response else ""
            if e.response is not None and e.response.status_code == 429:
                if attempt < MAX_RETRIES - 1:
                    wait = (attempt + 1) * 15
                    print(f"  ⚠️ 速率限制，{wait}s 后重试 ({attempt + 1}/{MAX_RETRIES})...")
                    time.sleep(wait)
                    continue
            raise RuntimeError(
                f"HTTP {e.response.status_code if e.response else '?'}: {body}"
            )
        except Exception as e:
            if attempt < MAX_RETRIES - 1:
                wait = (attempt + 1) * 5
                print(f"  ⚠️ API 错误，{wait}s 后重试 ({attempt + 1}/{MAX_RETRIES}): {e}")
                time.sleep(wait)
            else:
                raise RuntimeError(f"API 错误: {type(e).__name__}: {e}")

    raise RuntimeError("API 调用失败")


def load_kol_data(filename: str) -> dict:
    """加载 KOL JSON 数据。"""
    filepath = os.path.join(SRC_DIR, filename)
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def load_checkpoint(kol_name: str) -> dict:
    """加载已完成的 checkpoint。"""
    ckpt_file = os.path.join(CKPT_DIR, f"{kol_name}.json")
    if os.path.exists(ckpt_file):
        with open(ckpt_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_checkpoint(kol_name: str, checkpoint: dict):
    """保存 checkpoint。"""
    os.makedirs(CKPT_DIR, exist_ok=True)
    ckpt_file = os.path.join(CKPT_DIR, f"{kol_name}.json")
    with open(ckpt_file, "w", encoding="utf-8") as f:
        json.dump(checkpoint, f, ensure_ascii=False, indent=2)


def save_output(kol_name: str, result: dict):
    """保存切分结果。"""
    out_file = os.path.join(OUT_DIR, f"{kol_name}_segmented.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"  💾 已保存: {out_file}")


def split_at_punct(text: str, max_len: int = MAX_SEG_LEN) -> list[str]:
    """贪心沿标点把超长段切成 ≤ max_len 的段；窗口内无可用标点时硬切。

    可切点优先级：句末标点（。！？…）> 句中停顿（，、；：）。
    """
    text = text.strip()
    if not text:
        return []
    parts: list[str] = []
    start, n = 0, len(text)
    while n - start > max_len:
        limit = start + max_len
        cut = limit
        for i in range(limit - 1, start - 1, -1):
            if text[i] in "。！？…!?；;":
                cut = i + 1
                break
        if cut == limit:  # 句末标点不可用，找句中停顿
            for i in range(limit - 1, start - 1, -1):
                if text[i] in "，,、：: ":
                    cut = i + 1
                    break
        seg = text[start:cut].strip()
        if not seg:  # 切点贴着窗口起点（含极端硬切情形），退回按长度硬切
            cut = limit
            seg = text[start:cut]
        parts.append(seg)
        start = cut
    tail = text[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def enforce_segment_max_len(title: str, segments: list[str], max_rounds: int = 3) -> list[str]:
    """保证所有段落 ≤ MAX_SEG_LEN。

    超长段逐条交给 LLM 递归再切（最多 max_rounds 轮）；解析失败/内容丢失时
    保留原段等待下一轮；轮次耗尽仍超长的段落最后走程序化标点切分兜底，
    确保硬上限成立。
    """
    segments = [s.strip() for s in segments if s and s.strip()]
    for _ in range(max_rounds):
        over = [s for s in segments if len(s) > MAX_SEG_LEN]
        if not over:
            return segments
        print(f"    🔪 递归再切 {len(over)} 段: {[len(s) for s in over]}")
        fixed: list[str] = []
        for s in over:
            if len(s) <= MAX_SEG_LEN:
                fixed.append(s)
                continue
            user_msg = (
                f"视频标题：{title}\n\n转录文本"
                f"（要求切成每段不超过 {MAX_SEG_LEN} 字的小段，宁可多切）：\n{s}"
            )
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ]
            res = api_call(messages)
            parsed = parse_json_lenient(extract_text(res))
            subs: list[str] = []
            if parsed and isinstance(parsed, dict):
                raw = parsed.get("segments")
                if isinstance(raw, list):
                    subs = [x.strip() for x in raw if x and x.strip()]
            # 完整性校验：合并长度不足说明模型丢内容，保留原段下轮再试
            if subs and len("".join(subs)) >= len(s) * 0.5:
                fixed.extend(subs)
            else:
                fixed.append(s)
        segments = fixed
    final: list[str] = []
    for s in segments:
        if len(s) <= MAX_SEG_LEN:
            final.append(s)
        else:
            print(f"    ⚠️ {len(s)} 字段递归后仍超限，程序化兜底切分")
            final.extend(split_at_punct(s))
    return final


def chunk_video(video: dict) -> list[str]:
    """对单个视频的转录文本进行语义切分。

    返回切分后的段落列表。
    """
    title = video.get("title", "")
    subtitle_text = ""
    for sub in video.get("subtitles", []):
        if sub.get("text"):
            subtitle_text = sub["text"]
            break

    if not subtitle_text or len(subtitle_text.strip()) < 40:
        return [subtitle_text] if subtitle_text else []

    # 如果文本很短，不需要切分
    if len(subtitle_text) < 150:
        return [subtitle_text.strip()]

    user_msg = f"视频标题：{title}\n\n转录文本：\n{subtitle_text}"

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    result = api_call(messages)
    text = extract_text(result)
    parsed = parse_json_lenient(text)

    if parsed and isinstance(parsed, dict) and "segments" in parsed:
        segments = parsed["segments"]
        if isinstance(segments, list) and len(segments) > 0:
            # 验证：合并所有段落应与原文长度接近
            combined = "".join(segments)
            if len(combined) < len(subtitle_text) * 0.5:
                print(
                    f"  ⚠️ 切分结果异常（合并长度 {len(combined)} vs 原文 {len(subtitle_text)}），回退为单段"
                )
                return [subtitle_text.strip()]
            return enforce_segment_max_len(title, segments)

    # 解析失败，返回原文
    print(f"  ⚠️ JSON 解析失败，回退为单段")
    return [subtitle_text.strip()]


def process_kol(kol_file: str, kol_name: str, limit: int = 0, resume: bool = False):
    """处理单个 KOL 的全部视频。"""
    print(f"\n{'=' * 60}")
    print(f"📂 处理 {kol_name} ({kol_file})")
    print(f"{'=' * 60}")

    data = load_kol_data(kol_file)
    videos = data.get("videos", [])
    videos_with_subs = [v for v in videos if any(s.get("text", "").strip() for s in v.get("subtitles", []))]

    print(f"  📹 {len(videos_with_subs)}/{len(videos)} 个视频含字幕")

    # 加载 checkpoint
    checkpoint = load_checkpoint(kol_name) if resume else {}
    processed = set(checkpoint.get("processed_bvids", []))
    failed = list(checkpoint.get("failed_bvids", []))

    if limit > 0:
        videos_with_subs = videos_with_subs[:limit]

    # 过滤已处理的视频
    remaining = [v for v in videos_with_subs if v["bvid"] not in processed]
    if processed:
        print(f"  ⏭️ 跳过 {len(processed)} 个已处理视频，剩余 {len(remaining)} 个")

    result = {
        "uid": data["uid"],
        "segmented_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
        "videos": [],
    }

    # 先加载已处理的结果
    if resume and "videos" in checkpoint:
        result["videos"] = checkpoint.get("videos", [])

    total = len(remaining)
    success_count = 0
    fail_count = 0

    for i, video in enumerate(remaining):
        bvid = video["bvid"]
        title = video.get("title", "")
        print(f"\n  [{i + 1}/{total}] {bvid} — {title[:60]}...")

        try:
            segments = chunk_video(video)
            result["videos"].append(
                {
                    "bvid": bvid,
                    "aid": video.get("aid"),
                    "title": title,
                    "description": video.get("description", ""),
                    "duration": video.get("duration", ""),
                    "play": video.get("play", 0),
                    "comment_count": video.get("comment_count", 0),
                    "created": video.get("created", 0),
                    "segments": segments,
                }
            )
            success_count += 1
            print(f"  ✅ 切分为 {len(segments)} 段")
            # 成功才标记完成；若此前失败过则从失败列表移除
            processed.add(bvid)
            if bvid in failed:
                failed.remove(bvid)

        except Exception as e:
            fail_count += 1
            print(f"  ❌ 失败: {e}（不标记完成，下次 --resume 将重试）")
            # 只记录失败，不把整段回退塞进语料，也不标记 processed
            if bvid not in failed:
                failed.append(bvid)

        # 每处理一个视频就保存进度
        checkpoint["processed_bvids"] = list(processed)
        checkpoint["failed_bvids"] = failed
        checkpoint["videos"] = result["videos"]
        checkpoint["stats"] = {
            "total": total,
            "success": success_count,
            "fail": fail_count,
            "last_updated": datetime.now(timezone.utc).isoformat(),
        }
        save_checkpoint(kol_name, checkpoint)
        save_output(kol_name, result)

        # 避免请求过快
        time.sleep(0.5)

    # 最终统计
    total_segments = sum(len(v.get("segments", [])) for v in result["videos"])
    print(f"\n{'─' * 60}")
    print(f"📊 {kol_name} 完成:")
    print(f"   视频数: {len(result['videos'])}")
    print(f"   总段落数: {total_segments}")
    print(f"   成功: {success_count}, 失败: {fail_count}")
    print(f"   平均每视频: {total_segments / max(len(result['videos']), 1):.1f} 段")

    return result


def main():
    parser = argparse.ArgumentParser(description="KOL 视频转录文本语义切分")
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 个视频（测试用）")
    parser.add_argument("--kol", type=str, default="", help="只处理指定 KOL（冷面叶星星IKGN / 鬼王陆行）")
    parser.add_argument("--resume", action="store_true", help="断点续跑")
    args = parser.parse_args()

    load_env()

    global API_KEY, MODEL
    API_KEY = os.getenv("DEEPSEEK_API_KEY", API_KEY)
    MODEL = os.getenv("DEEPSEEK_MODEL", MODEL)

    if not API_KEY:
        print("❌ 未设置 DEEPSEEK_API_KEY 环境变量")
        sys.exit(1)

    print(f"🔧 API: {API_URL}")
    print(f"🤖 Model: {MODEL}")
    print(f"📝 Batch size: {BATCH_SIZE}")

    kols = [
        {"file": "冷面叶星星IKGN_all.json", "name": "冷面叶星星IKGN"},
        {"file": "鬼王陆行_all.json", "name": "鬼王陆行"},
    ]

    if args.kol:
        kols = [k for k in kols if k["name"] == args.kol]
        if not kols:
            print(f"❌ 未找到 KOL: {args.kol}")
            sys.exit(1)

    results = {}
    for kol in kols:
        result = process_kol(
            kol["file"], kol["name"], limit=args.limit, resume=args.resume
        )
        results[kol["name"]] = result

    # 最终汇总
    print(f"\n{'=' * 60}")
    print("🏁 全部完成!")
    for name, r in results.items():
        total_segs = sum(len(v.get("segments", [])) for v in r["videos"])
        print(f"  {name}: {len(r['videos'])} 视频 → {total_segs} 段落")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()