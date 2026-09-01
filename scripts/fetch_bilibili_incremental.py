#!/usr/bin/env python3
"""
B站 UP 主增量爬取脚本 — 6Gang KOL 数字孪生项目
================================================
遵循项目现有规范：数据提取 → 清洗 → 入库 → Embedding

用法:
  python3 scripts/fetch_bilibili_incremental.py
  python3 scripts/fetch_bilibili_incremental.py --uid 518045432       # 单UP主
  python3 scripts/fetch_bilibili_incremental.py --download-only       # 只下载不转写
  python3 scripts/fetch_bilibili_incremental.py --max-videos 10       # 限制增量视频数

依赖:
  pip3 install requests openai-whisper
  brew install ffmpeg

数据流:
  1. B站WBI API → 获取视频列表
  2. 对比已有 _all.json → 筛选增量视频
  3. yt-dlp 下载音频
  4. whisper-medium 转写
  5. DeepSeek API 标点恢复
  6. 输出 _all.json（与现有格式完全一致）
  7. 更新 seed-kol.ts 可用的数据
"""

import json
import os
import re
import subprocess
import sys
import time
import hashlib
import urllib.parse
import multiprocessing
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests

# 加载 .env 文件
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
if _ENV_FILE.exists():
    with open(_ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                if key.strip() and val.strip() and key.strip() not in os.environ:
                    os.environ[key.strip()] = val.strip()

# ── 配置 ───────────────────────────────────────────────

# 项目根目录
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "kol"
TEMP_DIR = PROJECT_ROOT / "data" / "kol" / "_temp_audio"
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# B站 API 配置
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.bilibili.com/",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# 如果设置了 BILI_COOKIE 环境变量，使用登录态 Cookie
# 格式: BILI_COOKIE="SESSDATA=xxx; bili_jct=xxx; buvid3=xxx; ..."
if os.getenv("BILI_COOKIE"):
    HEADERS["Cookie"] = os.getenv("BILI_COOKIE")
    print("✅ 使用 BILI_COOKIE 登录态")

BILI_API_DELAY = 3.0       # B站API请求间隔（秒）
BILI_DOWNLOAD_DELAY = 3.0  # 视频下载间隔（秒）
BILI_KOL_SWITCH_DELAY = 5.0  # 切换UP主时的等待间隔（秒）
BILI_412_RETRY_DELAY = 10   # 触发风控后等待秒数
WHISPER_MODEL = "medium"    # whisper 模型大小
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
DEEPSEEK_MAX_RETRIES = 3

# 每个 UP 主的信息
KOLS = [
    {
        "name": "冷面叶星星IKGN",
        "uid": 518045432,
        "file": "冷面叶星星IKGN_all.json",
        "last_sync": "2026-07-25",  # 已有数据的最新视频日期
    },
    {
        "name": "鬼王陆行",
        "uid": 1628647,
        "file": "鬼王陆行_all.json",
        "last_sync": "2026-07-22",
    },
]

# WBI 签名映射表
MIXIN_ENC_TAB = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
    27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
    37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
    22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]


# ── B站工具函数 ─────────────────────────────────────────

def get_mixin_key() -> str:
    """获取 WBI 签名所需的 mixin_key"""
    r = requests.get(
        "https://api.bilibili.com/x/web-interface/nav",
        headers=HEADERS, timeout=10,
    )
    r.raise_for_status()
    data = r.json()
    wbi_img = data["data"]["wbi_img"]
    img_key = wbi_img["img_url"].split("/")[-1].split(".")[0]
    sub_key = wbi_img["sub_url"].split("/")[-1].split(".")[0]
    mixin = img_key + sub_key
    return "".join(mixin[i] for i in MIXIN_ENC_TAB if i < len(mixin))[:32]


def wbi_sign(params: dict) -> dict:
    """对参数进行 WBI 签名"""
    mixin_key = get_mixin_key()
    params["wts"] = int(time.time())
    query = urllib.parse.urlencode(sorted(params.items(), key=lambda x: x[0]))
    params["w_rid"] = hashlib.md5((query + mixin_key).encode()).hexdigest()
    return params


def fetch_video_list(uid: int, page: int = 1, page_size: int = 50, retries: int = 3) -> dict:
    """
    获取 UP 主视频列表（按发布时间倒序）
    返回: { "total": int, "videos": [{bvid, aid, title, ...}] }

    注意: 无 Cookie 时 B站 API 限制极严，建议设置 BILI_COOKIE 环境变量。
    """
    if not os.getenv("BILI_COOKIE"):
        print("  ⚠️  未设置 BILI_COOKIE，B站可能频繁触发风控。")
        print("     获取方法: 浏览器登录B站 → F12 → Application → Cookies →")
        print("     复制 SESSDATA, bili_jct, buvid3 的值")
        print("     export BILI_COOKIE=\"SESSDATA=xxx; bili_jct=xxx; buvid3=xxx\"")
        print()

    for attempt in range(retries):
        # 每次重试重新获取 WBI 签名
        params = wbi_sign({
            "mid": uid,
            "ps": page_size,
            "pn": page,
            "tid": 0,
            "keyword": "",
            "order": "pubdate",
        })
        try:
            r = requests.get(
                "https://api.bilibili.com/x/space/wbi/arc/search",
                params=params, headers=HEADERS, timeout=15,
            )
            if r.status_code == 412:
                if attempt < retries - 1:
                    wait = (attempt + 1) * BILI_412_RETRY_DELAY
                    print(f"  ⚠️ 412 限流，{wait}s 后重试 ({attempt+1}/{retries})...")
                    time.sleep(wait)
                    continue
                r.raise_for_status()
            r.raise_for_status()
            data = r.json()
            if data["code"] == -352:
                if attempt < retries - 1:
                    wait = (attempt + 1) * BILI_412_RETRY_DELAY
                    print(f"  ⚠️ 风控校验失败(-352)，{wait}s 后重试 ({attempt+1}/{retries})...")
                    time.sleep(wait)
                    continue
                raise RuntimeError(
                    "B站风控校验失败。请获取浏览器 Cookie 并设置 BILI_COOKIE 环境变量后重试。\n"
                    "步骤: 1) 浏览器登录 bilibili.com\n"
                    "      2) F12 → Application → Cookies → bilibili.com\n"
                    "      3) 复制 SESSDATA, bili_jct, buvid3 的值\n"
                    "      4) export BILI_COOKIE=\"SESSDATA=xxx; bili_jct=xxx; buvid3=xxx\""
                )
            if data["code"] != 0:
                raise RuntimeError(f"B站API错误: code={data['code']}, msg={data.get('message', '?')}")
            return {
                "total": data["data"]["page"]["count"],
                "videos": data["data"]["list"]["vlist"],
            }
        except requests.HTTPError as e:
            if attempt < retries - 1 and "412" in str(e):
                wait = (attempt + 1) * BILI_412_RETRY_DELAY
                print(f"  ⚠️ 412 限流，{wait}s 后重试 ({attempt+1}/{retries})...")
                time.sleep(wait)
            else:
                raise


def fetch_video_detail(bvid: str) -> dict:
    """获取单个视频的详细信息"""
    r = requests.get(
        f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}",
        headers=HEADERS, timeout=10,
    )
    r.raise_for_status()
    return r.json()["data"]


def load_existing_bvids(filepath: Path) -> set:
    """从已有 _all.json 中提取已有 BVID 集合"""
    if not filepath.exists():
        return set()
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {v["bvid"] for v in data.get("videos", [])}


def load_existing_data(filepath: Path) -> Optional[dict]:
    """加载已有 _all.json"""
    if not filepath.exists():
        return None
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


# ── 音频下载（B站 playurl API + ffmpeg） ─────────────────

def _bilibili_api_download(bvid: str, output_path: Path, retries: int = 3) -> bool:
    """通过 B站 view API 获取 cid，playurl API 获取音频流，ffmpeg 下载并转 WAV"""
    for attempt in range(retries):
        try:
            # 1. 通过 view API 获取 cid 和 aid
            view_r = requests.get(
                f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}",
                headers=HEADERS, timeout=15,
            )
            if view_r.status_code == 412:
                wait = (attempt + 1) * 10
                print(f"    ⚠️ 412 限流(view)，{wait}s 后重试 ({attempt+1}/{retries})...", flush=True)
                time.sleep(wait)
                continue
            view_r.raise_for_status()
            view_data = view_r.json()
            if view_data["code"] != 0:
                print(f"    ⚠️ view API 错误: code={view_data['code']}", flush=True)
                return False
            cid = view_data["data"]["cid"]
            aid = view_data["data"]["aid"]

            # 2. 获取音频流 URL
            playurl_params = {
                "avid": aid,
                "cid": cid,
                "bvid": bvid,
                "fnval": "4048",
                "fnver": "0",
                "fourk": "1",
            }
            playurl_r = requests.get(
                "https://api.bilibili.com/x/player/playurl",
                params=playurl_params,
                headers=HEADERS,
                timeout=15,
            )
            if playurl_r.status_code == 412:
                wait = (attempt + 1) * 10
                print(f"    ⚠️ 412 限流(playurl)，{wait}s 后重试...", flush=True)
                time.sleep(wait)
                continue
            playurl_r.raise_for_status()
            playurl_data = playurl_r.json()

            if playurl_data["code"] != 0:
                print(f"    ⚠️ playurl API 错误: code={playurl_data['code']}", flush=True)
                return False

            # 提取音频流
            dash = playurl_data.get("data", {}).get("dash", {})
            audio_streams = dash.get("audio", [])
            if not audio_streams:
                print(f"    ⚠️ 无音频流: {bvid}", flush=True)
                return False

            # 选最高码率
            audio_url = audio_streams[0]["baseUrl"]

            # 3. 用 requests 下载音频流（ffmpeg 传 Cookie 不兼容 B站 CDN）
            print(f"    📥 下载音频: {bvid}", flush=True)
            m4s_path = output_path.with_suffix(".m4s")
            audio_r = requests.get(audio_url, headers=HEADERS, timeout=180, stream=True)
            if audio_r.status_code != 200:
                print(f"    ⚠️ 音频下载失败: HTTP {audio_r.status_code}", flush=True)
                return False
            with open(m4s_path, "wb") as f:
                for chunk in audio_r.iter_content(chunk_size=8192):
                    f.write(chunk)

            # 4. ffmpeg 转 WAV (16kHz mono)
            print(f"    🔄 ffmpeg 转码: {bvid}", flush=True)
            result = subprocess.run([
                "perl", "-e",
                "alarm 180; exec @ARGV; die 'exec failed: $!'",
                "ffmpeg", "-y",
                "-i", str(m4s_path),
                "-acodec", "pcm_s16le",
                "-ar", "16000",
                "-ac", "1",
                str(output_path),
            ], capture_output=True, text=True, timeout=190)

            # 清理 m4s
            try:
                m4s_path.unlink()
            except OSError:
                pass

            if result.returncode == 0 and output_path.exists():
                return True
            if result.returncode != 0:
                stderr = result.stderr[-300:] if result.stderr else ""
                print(f"    ⚠️ ffmpeg 转码失败 (code={result.returncode}): {stderr[:200]}", flush=True)
            try:
                output_path.unlink()
            except OSError:
                pass
            return False

        except Exception as e:
            if attempt < retries - 1:
                time.sleep(5)
            continue

    return False


def download_audio(bvid: str, output_dir: Path) -> Optional[Path]:
    """下载 B站视频音频为 WAV，返回文件路径或 None"""
    output_path = output_dir / f"{bvid}.wav"
    if output_path.exists():
        print(f"    ⏭️  音频已存在: {output_path.name}")
        return output_path

    print(f"    📥 下载音频: {bvid}", flush=True)
    if _bilibili_api_download(bvid, output_path):
        return output_path
    return None


# ── Whisper 转写 ─────────────────────────────────────────

def transcribe_audio(audio_path: Path) -> str:
    """
    使用 faster-whisper (CTranslate2) 转写音频
    比 openai-whisper 快 3-4x，支持 int8 量化加速
    返回转写文本
    """
    import signal
    from faster_whisper import WhisperModel
    print(f"    🎙️  faster-whisper 转写: {audio_path.name}", flush=True)
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8",
                         cpu_threads=4, num_workers=2)

    # 用 signal.alarm 实现超时保护（macOS fork 模式可用）
    result = []

    def _handler(signum, frame):
        raise TimeoutError(f"whisper 转写超时: {audio_path.name}")

    old_handler = signal.signal(signal.SIGALRM, _handler)
    signal.alarm(600)  # 10分钟超时
    try:
        segments, info = model.transcribe(str(audio_path), language="zh",
                                          beam_size=5, vad_filter=True)
        text = "".join(seg.text for seg in segments)
        result.append(text.strip())
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, old_handler)

    return result[0] if result else ""


# ── DeepSeek 标点恢复 ─────────────────────────────────────

PUNCT_PROMPT = """你是一个中文标点恢复助手。请为以下 Whisper 转录的中文文本添加正确的标点符号（句号、逗号、问号、感叹号、顿号等），并修正明显的同音错字。

规则：
1. 只添加标点和修正错字，不改变原文的措辞和表达
2. 保持原文的段落结构
3. 不要添加或删除任何内容
4. 直接输出处理后的文本，不要加任何解释

原始文本：
{text}"""


def restore_punctuation(text: str) -> str:
    """
    使用 DeepSeek API（通过腾讯 MaaS / Anthropic 兼容协议）恢复标点
    腾讯 MaaS 代理使用 Anthropic 兼容的 /v1/messages 端点
    """
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    if not api_key:
        print("    ⚠️  DEEPSEEK_API_KEY 未设置，跳过标点恢复")
        return text

    # 分段处理
    chunks = []
    for i in range(0, len(text), 1800):
        chunks.append(text[i:i + 1800])

    results = []
    for chunk in chunks:
        for attempt in range(DEEPSEEK_MAX_RETRIES):
            try:
                resp = requests.post(
                    f"{base_url}/v1/messages",
                    headers={
                        "x-api-key": api_key,
                        "Content-Type": "application/json",
                        "anthropic-version": "2023-06-01",
                    },
                    json={
                        "model": DEEPSEEK_MODEL,
                        "messages": [
                            {"role": "user", "content": PUNCT_PROMPT.format(text=chunk)}
                        ],
                        "temperature": 0.1,
                        "max_tokens": 4096,
                        "thinking": {"type": "disabled"},
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                data = resp.json()
                # Anthropic 格式: content 是数组，每项有 type 和 text
                text_blocks = [c["text"] for c in data["content"] if c.get("type") == "text"]
                result = "".join(text_blocks).strip()
                results.append(result)
                break
            except Exception as e:
                if attempt < DEEPSEEK_MAX_RETRIES - 1:
                    print(f"      ⚠️ 标点恢复重试 {attempt + 1}: {e}")
                    time.sleep(2)
                else:
                    print(f"      ❌ 标点恢复失败，使用原文: {e}")
                    results.append(chunk)

    return "\n".join(results)


# ── 数据清洗 ─────────────────────────────────────────────

# 与 seed-kol.ts 的 cleanText() 保持一致
def clean_kol_text(text: str) -> str:
    """B站话术清洗：删除固定开场白、结尾求三连、关注引流"""
    cleaned = text

    # 开头自我介绍
    cleaned = re.sub(r"大家好[,，]?\s*我是.{0,30}(?=[。！？\n，,]|$)", "", cleaned)
    cleaned = re.sub(r"大家好[,，]?\s*我说.{0,30}(?=[。！？\n，,]|$)", "", cleaned)
    cleaned = re.sub(r"我是.{0,20}(UP主|up主|博主|游戏UP)", "", cleaned)

    # 结尾求三连 / 引导
    cleaned = re.sub(r"如果你喜欢这[期些个]视频.{0,60}", "", cleaned)
    cleaned = re.sub(r"如果.{0,5}(喜欢|觉得).{0,5}(这期|这个)?视频.{0,60}", "", cleaned)
    cleaned = re.sub(
        r"(投币|点赞|收藏|转发|订阅|关注)[，,\s]*(投币|点赞|收藏|转发|订阅|关注)?[，,\s]*(投币|点赞|收藏|转发|订阅|关注)?",
        "", cleaned,
    )
    cleaned = cleaned.replace("一键三连", "")
    cleaned = re.sub(r"还请[您你]?.{0,30}(投币|点赞|收藏|转发|订阅|三连|关注).{0,30}", "", cleaned)
    cleaned = re.sub(r"带给.{0,10}(伯伯的)?关注", "", cleaned)

    # 结尾道别
    cleaned = re.sub(r"我们下期再见.{0,20}", "", cleaned)
    cleaned = re.sub(r"下期再见.{0,10}", "", cleaned)
    cleaned = re.sub(r"拜拜[~！!]*\s*$", "", cleaned, flags=re.MULTILINE)

    # 关注/互动引导
    cleaned = re.sub(r"也?可以在(私信|评论区).{0,40}", "", cleaned)
    cleaned = re.sub(r"[有想]?.{0,15}(私信|评论区).{0,20}(告诉我|留言)", "", cleaned)
    cleaned = re.sub(r"关注[我我]们?.{0,20}", "", cleaned)

    # 清理多余空白
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r" {2,}", " ", cleaned)
    return cleaned.strip()


# ── 并行转写 Worker ─────────────────────────────────────────

def _transcribe_worker(args: tuple) -> dict:
    """
    并行转写 worker：下载 + 转写 + 标点 + 清洗
    由 multiprocessing.Pool 调用，返回单条视频结果
    """
    import sys
    sys.stdout.reconfigure(line_buffering=True)  # 子进程即时输出
    bvid, v, max_videos = args  # max_videos unused here, kept for signature compat
    # 重新加载 .env（子进程环境继承）
    _ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
    if _ENV_FILE.exists():
        with open(_ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, val = line.partition("=")
                    if key.strip() and val.strip() and key.strip() not in os.environ:
                        os.environ[key.strip()] = val.strip()

    # 获取视频详情
    try:
        detail = fetch_video_detail(bvid)
        duration = detail.get("duration", "00:00")
        if isinstance(duration, int):
            mins, secs = divmod(duration, 60)
            hours, mins = divmod(mins, 60)
            if hours:
                duration = f"{hours:02d}:{mins:02d}:{secs:02d}"
            else:
                duration = f"{mins:02d}:{secs:02d}"
        stat = detail.get("stat", {})
        play = stat.get("view", 0)
        comment_count = stat.get("reply", 0)
    except Exception as e:
        print(f"    ⚠️ [{bvid}] 获取详情失败: {e}")
        duration = v.get("length", "00:00")
        play = v.get("play", 0)
        comment_count = v.get("comment", 0)

    result = {
        "bvid": bvid, "aid": v["aid"], "title": v["title"],
        "description": v.get("description", ""),
        "duration": duration, "play": play,
        "comment_count": comment_count, "created": v["created"],
        "subtitles": [], "up_replies": [],
    }

    # 下载音频
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    audio_path = download_audio(bvid, TEMP_DIR)
    if not audio_path:
        print(f"    ❌ [{bvid}] 音频下载失败")
        return result

    # Whisper 转写
    try:
        raw_text = transcribe_audio(audio_path)
        if not raw_text or len(raw_text) < 30:
            print(f"    ⚠️ [{bvid}] 转写文本过短 ({len(raw_text)} 字)，跳过")
            try: audio_path.unlink()
            except OSError: pass
            return result
    except Exception as e:
        print(f"    ❌ [{bvid}] 转写失败: {e}")
        try: audio_path.unlink()
        except OSError: pass
        return result

    # 标点恢复
    print(f"    📝 [{bvid}] 转写原文 ({len(raw_text)} 字)")
    punct_text = restore_punctuation(raw_text)
    print(f"    📝 [{bvid}] 标点恢复后 ({len(punct_text)} 字)")

    # 清洗
    cleaned_text = clean_kol_text(punct_text)
    print(f"    📝 [{bvid}] 清洗后 ({len(cleaned_text)} 字)")
    if len(cleaned_text) < 30:
        print(f"    ⚠️ [{bvid}] 清洗后文本过短，使用清洗前文本")
        cleaned_text = punct_text

    result["subtitles"] = [{
        "lang": "zh-auto",
        "text": cleaned_text,
        "method": "faster-whisper-medium+punct+cleaned",
    }]
    print(f"    ✅ [{bvid}] 完成: {len(cleaned_text)} 字")

    # 清理音频
    try: audio_path.unlink()
    except OSError: pass

    return result


# ── 主流程 ───────────────────────────────────────────────

def process_kol(kol: dict, max_videos: Optional[int] = None, download_only: bool = False,
                parallel: int = 0) -> dict:
    """
    处理单个 UP 主：增量爬取 → 转写 → 标点 → 清洗

    返回: 合并后的完整数据（旧 + 新）
    """
    name = kol["name"]
    uid = kol["uid"]
    filepath = DATA_DIR / kol["file"]

    print(f"\n{'='*60}")
    print(f"📺 {name} (uid={uid})")
    print(f"{'='*60}")

    # 1. 加载已有数据
    existing_data = load_existing_data(filepath)
    existing_bvids = load_existing_bvids(filepath)
    existing_videos = existing_data["videos"] if existing_data else []
    print(f"📊 已有 {len(existing_videos)} 个视频")

    # 2. 获取完整视频列表（分页）
    all_new_videos = []
    page = 1
    total_fetched = 0

    print(f"🔍 获取视频列表...")
    while True:
        try:
            result = fetch_video_list(uid, page=page, page_size=50)
        except Exception as e:
            print(f"  ⚠️ 获取第 {page} 页失败: {e}")
            break

        for v in result["videos"]:
            bvid = v["bvid"]
            if bvid in existing_bvids:
                continue
            all_new_videos.append(v)
            total_fetched += 1

        print(f"  📄 第 {page} 页: {len(result['videos'])} 个, "
              f"累计新增 {len(all_new_videos)} / 总共 {result['total']}")

        if len(result["videos"]) < 50 or (max_videos and len(all_new_videos) >= max_videos):
            break

        page += 1
        time.sleep(BILI_API_DELAY)

    if max_videos and len(all_new_videos) > max_videos:
        all_new_videos = all_new_videos[:max_videos]

    if not all_new_videos:
        print(f"✅ 没有新视频，数据已是最新")
        return existing_data

    print(f"\n🎯 发现 {len(all_new_videos)} 个增量视频")

    if download_only:
        # 只下载音频，不转写
        new_videos = []
        for i, v in enumerate(all_new_videos):
            bvid = v["bvid"]
            title = v["title"]
            created_str = time.strftime("%Y-%m-%d", time.localtime(v["created"]))
            print(f"\n── [{i+1}/{len(all_new_videos)}] {bvid} | {created_str}")
            print(f"    {title[:60]}")

            try:
                detail = fetch_video_detail(bvid)
                duration = detail.get("duration", "00:00")
                if isinstance(duration, int):
                    mins, secs = divmod(duration, 60)
                    hours, mins = divmod(mins, 60)
                    if hours:
                        duration = f"{hours:02d}:{mins:02d}:{secs:02d}"
                    else:
                        duration = f"{mins:02d}:{secs:02d}"
                stat = detail.get("stat", {})
                play = stat.get("view", 0)
                comment_count = stat.get("reply", 0)
            except Exception as e:
                print(f"    ⚠️ 获取详情失败: {e}")
                duration = v.get("length", "00:00")
                play = v.get("play", 0)
                comment_count = v.get("comment", 0)

            time.sleep(BILI_API_DELAY)

            audio_path = download_audio(bvid, TEMP_DIR)
            new_videos.append({
                "bvid": bvid, "aid": v["aid"], "title": title,
                "description": v.get("description", ""),
                "duration": duration, "play": play,
                "comment_count": comment_count, "created": v["created"],
                "subtitles": [], "up_replies": [],
            })
            if audio_path:
                print(f"    ✅ 音频已下载: {audio_path.name}")

        merged = existing_data.copy() if existing_data else {"uid": uid, "videos": []}
        merged["videos"] = existing_videos + new_videos
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=2)
        print(f"\n📊 {name} 汇总: 下载 {len(new_videos)} 个音频")
        return merged

    # =====================================================
    # 3. 并行处理
    # =====================================================
    if parallel > 0:
        print(f"\n⚡ 并行转写模式: {parallel} 个 worker")
        print(f"📥 第一阶段: 下载所有音频...")
        # 先下载所有音频（顺序执行，B站限流）
        download_queue = []
        for i, v in enumerate(all_new_videos):
            bvid = v["bvid"]
            title = v["title"]
            created_str = time.strftime("%Y-%m-%d", time.localtime(v["created"]))
            print(f"\n── [{i+1}/{len(all_new_videos)}] {bvid} | {created_str}")
            print(f"    {title[:60]}")

            # 获取视频详情（B站限流）
            try:
                detail = fetch_video_detail(bvid)
                duration = detail.get("duration", "00:00")
                if isinstance(duration, int):
                    mins, secs = divmod(duration, 60)
                    hours, mins = divmod(mins, 60)
                    if hours:
                        duration = f"{hours:02d}:{mins:02d}:{secs:02d}"
                    else:
                        duration = f"{mins:02d}:{secs:02d}"
                stat = detail.get("stat", {})
                play = stat.get("view", 0)
                comment_count = stat.get("reply", 0)
            except Exception as e:
                print(f"    ⚠️ 获取详情失败: {e}")
                duration = v.get("length", "00:00")
                play = v.get("play", 0)
                comment_count = v.get("comment", 0)
            time.sleep(BILI_API_DELAY)

            # 下载音频
            audio_path = download_audio(bvid, TEMP_DIR)
            if audio_path:
                # 将视频信息传给 worker
                v["_duration"] = duration
                v["_play"] = play
                v["_comment_count"] = comment_count
                download_queue.append(v)
                print(f"    ✅ 音频已下载: {audio_path.name}")
            else:
                print(f"    ❌ 音频下载失败，跳过")

        if not download_queue:
            print("⚠️ 没有成功下载的音频")
            return existing_data

        print(f"\n⚡ 第二阶段: 并行转写 ({len(download_queue)} 个视频, {parallel} workers)...")
        pool_args = [(v["bvid"], v, max_videos) for v in download_queue]
        new_videos = []
        completed_count = 0
        with multiprocessing.Pool(parallel) as pool:
            # 使用 imap_unordered 实现实时写入：每完成一个就保存到文件
            for result in pool.imap_unordered(_transcribe_worker, pool_args):
                completed_count += 1
                if result and (result.get("subtitles") or download_only):
                    new_videos.append(result)
                    # 实时写入文件
                    merged = existing_data.copy() if existing_data else {"uid": uid, "videos": []}
                    merged["videos"] = existing_videos + new_videos
                    with open(filepath, "w", encoding="utf-8") as f:
                        json.dump(merged, f, ensure_ascii=False, indent=2)
                    print(f"    💾 已保存到文件 ({completed_count}/{len(download_queue)})")
                else:
                    print(f"    ⚠️ [{completed_count}/{len(download_queue)}] 结果无效，跳过")

    else:
        # =====================================================
        # 顺序处理（原版逻辑）
        # =====================================================
        new_videos = []
        for i, v in enumerate(all_new_videos):
            bvid = v["bvid"]
            title = v["title"]
            created_str = time.strftime("%Y-%m-%d", time.localtime(v["created"]))
            print(f"\n── [{i+1}/{len(all_new_videos)}] {bvid} | {created_str}")
            print(f"    {title[:60]}")

            # 3a. 获取视频详情
            try:
                detail = fetch_video_detail(bvid)
                duration = detail.get("duration", "00:00")
                if isinstance(duration, int):
                    mins, secs = divmod(duration, 60)
                    hours, mins = divmod(mins, 60)
                    if hours:
                        duration = f"{hours:02d}:{mins:02d}:{secs:02d}"
                    else:
                        duration = f"{mins:02d}:{secs:02d}"
                stat = detail.get("stat", {})
                play = stat.get("view", 0)
                comment_count = stat.get("reply", 0)
            except Exception as e:
                print(f"    ⚠️ 获取详情失败: {e}")
                duration = v.get("length", "00:00")
                play = v.get("play", 0)
                comment_count = v.get("comment", 0)

            time.sleep(BILI_API_DELAY)

            # 3b. 下载音频
            audio_path = download_audio(bvid, TEMP_DIR)
            if not audio_path:
                print(f"    ❌ 跳过: 音频下载失败")
                continue

            # 3c. Whisper 转写
            try:
                raw_text = transcribe_audio(audio_path)
                if not raw_text or len(raw_text) < 30:
                    print(f"    ⚠️ 转写文本过短 ({len(raw_text)} 字)，跳过")
                    continue
            except Exception as e:
                print(f"    ❌ 转写失败: {e}")
                continue

            # 3d. DeepSeek 标点恢复
            print(f"    📝 转写原文 ({len(raw_text)} 字)")
            punct_text = restore_punctuation(raw_text)
            print(f"    📝 标点恢复后 ({len(punct_text)} 字)")

            # 3e. 数据清洗
            cleaned_text = clean_kol_text(punct_text)
            print(f"    📝 清洗后 ({len(cleaned_text)} 字)")

            # 保护：如果清洗后文本过短，使用清洗前的文本
            if len(cleaned_text) < 30:
                print(f"    ⚠️ 清洗后文本过短 ({len(cleaned_text)} 字)，使用清洗前文本")
                cleaned_text = punct_text

            new_videos.append({
                "bvid": bvid, "aid": v["aid"], "title": title,
                "description": v.get("description", ""),
                "duration": duration, "play": play,
                "comment_count": comment_count, "created": v["created"],
                "subtitles": [{
                    "lang": "zh-auto",
                    "text": cleaned_text,
                    "method": "faster-whisper-medium+punct+cleaned",
                }],
                "up_replies": [],
            })

            print(f"    ✅ 完成: {len(cleaned_text)} 字")

            # 实时写入
            merged = existing_data.copy() if existing_data else {"uid": uid, "videos": []}
            merged["videos"] = existing_videos + new_videos
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(merged, f, ensure_ascii=False, indent=2)

            # 清理临时音频
            try:
                audio_path.unlink()
            except OSError:
                pass

            time.sleep(BILI_DOWNLOAD_DELAY)

    # 4. 汇总 + 保存
    merged = existing_data.copy() if existing_data else {"uid": uid, "videos": []}
    merged["videos"] = existing_videos + new_videos
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)

    total_chars = sum(
        len(v["subtitles"][0]["text"]) if v.get("subtitles") else 0
        for v in merged["videos"]
    )
    print(f"\n📊 {name} 汇总:")
    print(f"   总视频: {len(merged['videos'])} (新增 {len(new_videos)})")
    print(f"   总字数: {total_chars:,}")
    print(f"   已保存: {filepath}")

    return merged


# ── 入口 ─────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(description="B站UP主增量爬取")
    parser.add_argument("--uid", type=int, help="只处理指定UID的UP主")
    parser.add_argument("--max-videos", type=int, help="限制增量视频数")
    parser.add_argument("--download-only", action="store_true", help="只下载音频不转写")
    parser.add_argument("--parallel", type=int, default=4,
                        help="并行转写 worker 数 (默认4, 推荐 2-4)")
    args = parser.parse_args()

    # 检查环境
    if not os.getenv("DEEPSEEK_API_KEY"):
        print("⚠️  DEEPSEEK_API_KEY 未设置，将跳过标点恢复步骤")

    kols = KOLS
    if args.uid:
        kols = [k for k in KOLS if k["uid"] == args.uid]
        if not kols:
            print(f"❌ 未找到 uid={args.uid} 的 UP 主配置")
            sys.exit(1)

    all_results = {}
    for kol in kols:
        try:
            result = process_kol(kol, max_videos=args.max_videos, download_only=args.download_only, parallel=args.parallel)
            all_results[kol["name"]] = result
        except Exception as e:
            print(f"❌ {kol['name']} 处理失败: {e}")
            import traceback
            traceback.print_exc()
        # 切换UP主时等待，避免风控
        time.sleep(BILI_KOL_SWITCH_DELAY)

    # 汇总
    print(f"\n{'='*60}")
    print(f"🏁 增量爬取完成")
    for name, result in all_results.items():
        if result:
            new_count = len(result["videos"]) - (
                len(load_existing_data(DATA_DIR / next(
                    k["file"] for k in KOLS if k["name"] == name
                ))["videos"]) if load_existing_data(DATA_DIR / next(
                    k["file"] for k in KOLS if k["name"] == name
                )) else 0
            )
            print(f"   {name}: {len(result['videos'])} 视频 (新增 {new_count})")

    print(f"\n📋 下一步:")
    print(f"   1. 检查新数据: data/kol/ 目录")
    print(f"   2. 运行 seed-kol.ts 导入数据: bun run apps/api/src/db/seed-kol.ts --force")
    print(f"   3. 运行 embed_kol.py 生成向量: python3 scripts/embed_kol.py")


if __name__ == "__main__":
    main()