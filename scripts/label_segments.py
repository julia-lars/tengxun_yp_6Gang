#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据标注脚本 —— 按 docs/数据标注标准文档.md (v2.0) 对访谈片段打标。

用法:
  python3 label_segments.py                      # 全量打标
  python3 label_segments.py --limit 20           # 只跑前 20 条 (测试)
  python3 label_segments.py --only 漫威争锋       # 只跑文件名含关键字的文件
  python3 label_segments.py --resume             # 断点续跑

输出: data/annotated/<原文件名>.json  —— 每条片段保留原字段 + 新增 "label" 字段(v2.0)。
断点: data/annotated/.checkpoint/<原文件名>.jsonl 记录已完成片段(key + label)。
"""

import json
import os
import re
import sys
import time
import socket
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------- 配置 ----------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_env():
    """从 apps/api/.env 读取密钥到环境变量（密钥不入库），已设置的变量不覆盖。"""
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


_load_env()

API_URL = os.getenv("ANTHROPIC_BASE_URL", "https://tokenhub.tencentmaas.com/plan/anthropic").rstrip("/") + "/v1/messages"
API_KEY = os.getenv("ANTHROPIC_AUTH_TOKEN", "")
MODEL = os.getenv("ANTHROPIC_MODEL", "deepseek-v4-pro")
BATCH_SIZE = 5          # 每次 API 调用标注的片段数
MAX_TOKENS = 16000
WORKERS = 4             # 并发线程数（太大可能触发代理限流）
TEMP = 0.0
SRC_DIRS = [
    os.path.join(BASE_DIR, "data", "群体画像"),
    os.path.join(BASE_DIR, "data", "群体画像"),
]
OUT_DIR = os.path.join(BASE_DIR, "data", "annotated")
CKPT_DIR = os.path.join(OUT_DIR, ".checkpoint")

# ---------------- System Prompt ----------------
SYSTEM_PROMPT = """你是射击游戏用户研究领域的资深标注专家。对访谈中"被访者"的每条发言片段，按下面的标准标注，并严格只输出一个 JSON 对象。

# 标注体系（双层：冰山五层 + 框架七维）

## 一、冰山五层（纵向因果链）
- M1 动机/诉求（为什么玩）。值域(英文key)：competitive_proof 竞技证明 / ability_growth 能力成长 / dominance 支配优越 / team_cooperation 团队协作 / social_belonging 社交归属 / stimulation 射击爽感 / relaxation_escape 放松逃避 / strategy_mastery 策略掌控 / exploration_collection 探索收集 / narrative_immersion 叙事沉浸 / sensory_aesthetics 视听审美 / expression_creation 表达创造。最多 3 个，第一个为 primary=true。
- M2 期待/标准（游戏"应该怎样"）。值域：fair_competition 公平竞技 / skill_determines 技术决定 / rich_content 丰富内容 / social_convenience 社交便利 / low_barrier 低门槛 / immersive_experience 沉浸体验 / positive_community 正向社区 / continuous_challenge 持续挑战 / respect_time 尊重时间 / monetization_fair 付费公平 / teammate_communication 队友沟通 / teammate_competence 队友能力匹配 / teammate_stability 队友情绪稳定。最多 2 个。
- M3 认知/观点（"实际是怎样"的判断/评价/归因）。category 从：fairness_perception 公平性 / difficulty_perception 难度 / depth_perception 深度 / quality_perception 品质 / monetization_perception 商业化 / meta_perception 版本环境 / self_ability 自我能力 / self_identity 自我身份 / self_limitation 自我限制 / teammate_perception 对队友 / opponent_perception 对对手 / developer_perception 对厂商 / community_perception 对社区 / causal_attribution 因果归因 中选；value 用简短英文短语概括具体认知(如 aim_decides)。最多 2 个。
- M4 感受/情绪。值域：excitement 兴奋 / achievement 成就感 / flow 心流 / joy 快乐 / social_warmth 社交温暖 / anger_frustration 愤怒挫败 / anxiety_tension 焦虑紧张 / boredom_burnout 无聊倦怠 / disappointment 失望失落 / numbness 麻木无所谓。需标 val(pos/neg/neu)、int(low/medium/high)、trg(win_loss/growth/team/matchmaking/monetization/cheat/performance/content/social)。最多 2 个。
- M5 行为/应对（具体可观察行为）。值域：ranked_grind 排位上分 / deliberate_practice 刻意练习 / watch_guides 看攻略学习 / social_play 社交开黑 / casual_play 休闲匹配 / switch_mode 切换模式产品 / return 回流 / avoid_strangers 回避陌生人 / content_share 内容分享 / spending 消费氪金 / quit_break 退坑休息 / smurf 换号炸鱼 / watch_esports 追比赛电竞 / community_engage 社区参与。freq(daily/regular/occasional/past/planned) 仅在原文明确提及时标，否则 null。最多 3 个。
- causal_chain：仅当同一片段明确表达因果时标，形如 ["M1:ability_growth","M5:ranked_grind"]，最多 2 条。

## 二、框架七维（横向画像）
- needs: {"p": 主诉求(M1 key), "s": [次诉求列表]}
- ability: {"lvl": novice/beginner/intermediate/advanced/expert/unknown(以自评为准), "str": [强项], "wk": [短板], "cog_str": [认知强项], "cog_wk": [认知短板]}
  技巧子项(供 str/wk 用)：aim-flick 拉枪 / aim-micro 微调 / aim-recoil 压枪 / aim-tracking 跟枪 / aim-prefire 预瞄 / move-basic 基础身法 / move-peek 闪身 / move-stop 急停 / move-react 快速反应 / info-sound 听声辨位 / info-spot 复杂场景识敌 / info-state 状态资源收集 / tactics-predict 敌情预测 / tactics-utility 投掷物技能 / tactics-route 路线规划 / tactics-retreat 战撤决策 / tactics-position 有利位置 / tactics-map 地图记忆 / know-rules 规则目标 / know-mechanic 核心机制 / know-meta 角色武器版本理解。
  认知子项(cog_str/cog_wk 用)：reasoning 推理 / procedural_motor 程序化动作 / game_knowledge 游戏知识 / visual_spatial 视觉空间 / auditory_processing 听觉处理 / motor_control 运动控制 / processing_speed 加工速度 / reaction_speed 反应速度 / psychomotor_speed 心理运动速度 / short_term_memory 短时记忆 / long_term_memory 长时记忆。
- style: {"combat": passive苟活/balanced灵活/aggressive刚枪, "decision": strategic策略/contextual情境/instinctive本能, "victory": team团队/balanced平衡/individual个人, "growth": progression数值/mixed混合/skill操作, "social": friends熟人/flexible均可/solo单人}
- platform: {"p": pc/console/mobile/multi_platform/cloud_other/unknown, "s": 次选或 null}
- mode: {"struct": pure_pve/pve_main/balanced/pvp_main/pure_pvp/contextual, "sub": [{"n": team_deathmatch|bomb_defusal|battle_royale|extraction|large_scale|coop_pve|story_pve|boss_loot|party_mode|open_world, "a": liked/accepted/neutral/disliked/rejected/not_experienced}]}
- assets: {"time","ability_asset","energy","emotion","money"} 各选 充足/有约束/严重稀缺/未知
- sweet_spot: {"stage": novice_understanding/rapid_improvement/stable_mastery/plateau/churn/unknown, "skill_count": 整数或 null, "duration": short/medium/long/unknown, "quality": low/medium/high/unknown, "flow": [多选 clear_goals/immediate_feedback/skill_challenge_balance/sense_of_control/focus/action_awareness_merge/selflessness/time_distortion/autotelic], "peak": 峰值事件原文或 null, "plateau": 平台期触发原文或 null}

## 三、产品评测扩展标签(不确定就省略或 null)
city_tier 一线/新一线/二线/三线及以下/海外/unknown · life_stage 学生/初入职场/稳定职场/育儿家庭/其他 · device 固定桌面/客厅主机/移动碎片/网吧公共设备 · setting 现代军事/历史战争/近未来科幻/末日废土/奇幻二次元/恐怖 · art_style 高写实/半写实/风格化/卡通Q版/二次元 · perspective FPS/TPS/自由切换 · ttk 低TTK/高TTK · match_length 短/中/长 · social_structure 固定队/熟人偶尔开黑/路人组队/单人孤狼/公会 · spending_level 不付费/低付费/中付费/高付费/unknown · payment_method 直购/战令/订阅/抽奖/买断 · spending_motive 审美自用/社交展示/收藏限定/支持内容/效率成长 · fairness_boundary 仅外观/轻度便利/数值付费/任何优势付费都拒绝 · info_channel B站/抖音/直播/朋友口碑/应用商店/社区论坛/媒体 · content_type 技术教学/搞笑整活/深度评测/电竞/高光实机/CG/UGC · trust_source 熟人/专业评测/技术KOL/娱乐KOL/电竞选手/明星/厂商品牌 · migration_trigger/churn_reason/recall_condition/version_expectation 原文 · match_wait/cheater_tolerance/lag_tolerance/forced_team/learning_cost 原文或 null

## 证据等级
E3 直接证据(0.85-1.0) / E2 强推断(0.70-0.85) / E1 弱推断(0.50-0.70) / E0 无证据。
每个标签给 c(置信度 0-1) 和 e(证据等级)。M1/M2 无 E3 证据时 c<=0.70。c<0.6 时该条 meta.rs=review。

## 标注规则(必须遵守)
1. 原文为准，只标片段中明确表达的内容，不做推断跳级；宁缺毋滥，无法确定就留空。
2. 参考 preceding_question 理解语境，但只对被访者发言标注。
3. 填充词/无意义片段("嗯""对""好的"等，或原文<10字符) → 各层全空，meta.rs="skip"。
4. 纯事实陈述且无态度/评价 → 不标冰山/框架。
5. 禁止推断：玩得久≠高手、PC玩家≠能力强、不得从语言风格猜人口属性、不得把 unknown 强行推断成确定值。
6. 每条必给 meta.c(整体置信度) 和 meta.rs(auto_pass/review/skip)。

## 输出 JSON Schema（只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字）
{"results": [
  {
    "iceberg": {
      "M1": [{"v": "ability_growth", "primary": true, "inferred": false, "c": 0.9, "e": "E3"}],
      "M2": [{"v": "fair_competition", "c": 0.8, "e": "E2"}],
      "M3": [{"cat": "meta_perception", "v": "aim_decides", "c": 0.9, "e": "E3"}],
      "M4": [{"v": "achievement", "val": "pos", "int": "high", "trg": "win_loss", "c": 0.95, "e": "E3"}],
      "M5": [{"v": "ranked_grind", "freq": "daily", "c": 0.95, "e": "E3"}],
      "causal_chain": [["M1:ability_growth", "M5:ranked_grind"]]
    },
    "framework": {
      "needs": {"p": "ability_growth", "s": ["competitive_proof"]},
      "ability": {"lvl": "advanced", "str": ["aim-tracking"], "wk": [], "cog_str": ["reaction_speed"], "cog_wk": []},
      "style": {"combat": "aggressive", "decision": "instinctive", "victory": "individual", "growth": "skill", "social": "friends"},
      "platform": {"p": "pc", "s": null},
      "mode": {"struct": "pvp_main", "sub": [{"n": "bomb_defusal", "a": "liked"}]},
      "assets": {"time": "充足", "ability_asset": "有约束", "energy": "充足", "emotion": "有约束", "money": "未知"},
      "sweet_spot": {"stage": "rapid_improvement", "skill_count": 3, "duration": "medium", "quality": "high", "flow": ["clear_goals"], "peak": null, "plateau": null}
    },
    "product_tags": {"city_tier": null, "life_stage": null, "spending_level": null},
    "evidence": [{"q": "我每天练枪", "s": ["M5:deliberate_practice"], "e": "E3"}],
    "note": "中文推断说明(可省略)",
    "meta": {"c": 0.88, "rs": "auto_pass"}
  }
]}

空片段(无任何标签)示例：{"iceberg": {"M1": [], "M2": [], "M3": [], "M4": [], "M5": [], "causal_chain": []}, "framework": {}, "evidence": [], "meta": {"c": 1.0, "rs": "skip"}}

现在，用户会给你一批片段(每段有 source_file/segment_index/speaker_id/preceding_question/original_text)，你要对每段输出上述结构的标注，放在 JSON 数组 results 里返回。保持顺序与输入一致。"""


def http_post(payload: dict) -> dict:
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-api-key", API_KEY)
    req.add_header("anthropic-version", "2023-06-01")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:  # 3 min timeout
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:400]}")
    except socket.timeout as e:
        raise RuntimeError(f"API timeout: {e}")
    except Exception as e:
        raise RuntimeError(f"API error: {type(e).__name__}: {e}")


def extract_text_blocks(data: dict) -> str:
    out = []
    for b in data.get("content", []):
        if isinstance(b, dict) and b.get("type") == "text":
            out.append(b.get("text", ""))
    return "\n".join(out)


def parse_json_lenient(text: str):
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
            return json.loads(text[s:e + 1])
        except json.JSONDecodeError:
            pass
    return None


def normalize_label(label):
    """确保 label 结构完整，缺的层补空。"""
    if not isinstance(label, dict):
        return None
    label.setdefault("annotation_version", "2.0")
    ib = label.setdefault("iceberg", {})
    for k in ("M1", "M2", "M3", "M4", "M5"):
        ib.setdefault(k, [])
    ib.setdefault("causal_chain", [])
    label.setdefault("framework", {})
    label.setdefault("product_tags", {})
    label.setdefault("evidence", [])
    meta = label.setdefault("meta", {})
    meta.setdefault("annotator", MODEL)
    meta.setdefault("c", meta.get("c", 0.8))
    if "rs" not in meta:
        meta["rs"] = "skip" if not any(ib[k] for k in ("M1", "M2", "M3", "M4", "M5")) else "auto_pass"
    return label


def label_batch(segments: list) -> list:
    """对一批片段打标，返回与输入同长的 label 列表(失败为 None)。"""
    user_lines = []
    for i, seg in enumerate(segments):
        q = (seg.get("preceding_question") or "").strip()
        t = (seg.get("original_text") or "").strip()
        user_lines.append(
            f"[{i}] speaker_id={seg.get('speaker_id') or ''}\n"
            f"preceding_question={q}\n"
            f"original_text={t}"
        )
    user_msg = "请标注以下片段：\n\n" + "\n\n".join(user_lines)

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
    data = http_post(payload)
    raw = extract_text_blocks(data)
    parsed = parse_json_lenient(raw)
    if parsed is None:
        raise RuntimeError(f"无法解析 JSON: {raw[:200]}")
    results = parsed.get("results") if isinstance(parsed, dict) else parsed
    if not isinstance(results, list):
        raise RuntimeError(f"results 不是数组: {raw[:200]}")
    out = [None] * len(segments)
    for i, r in enumerate(results[: len(segments)]):
        out[i] = normalize_label(r)
    return out


def annotate_file(path: str, limit: int | None, resume: bool, errors: list) -> dict:
    name = os.path.basename(path)
    data = json.load(open(path, encoding="utf-8"))
    if limit:
        data = data[:limit]

    ckpt_path = os.path.join(CKPT_DIR, name + ".jsonl")
    done_map = {}
    if os.path.exists(ckpt_path):
        with open(ckpt_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                    done_map[(rec["source_file"], rec["segment_index"])] = rec["label"]
                except Exception:
                    pass

    def key_of(seg):
        return (seg.get("source_file"), seg.get("segment_index"))

    results = dict(done_map)  # 已有(断点恢复)的标签
    todo = [seg for seg in data if key_of(seg) not in done_map]

    os.makedirs(CKPT_DIR, exist_ok=True)
    ckpt_f = open(ckpt_path, "a", encoding="utf-8")

    stats = {"total": len(data), "done": len(done_map), "failed": 0, "skipped": 0}

    def worker(batch):
        try:
            labels = label_batch(batch)
            return [(key_of(s), labels[i]) for i, s in enumerate(batch)]
        except Exception as e:
            return [(key_of(s), ("__err__", str(e))) for s in batch]

    batches = [todo[i:i + BATCH_SIZE] for i in range(0, len(todo), BATCH_SIZE)]
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(worker, b): b for b in batches}
        for fut in as_completed(futs):
            for key, val in fut.result():
                if isinstance(val, tuple) and val and val[0] == "__err__":
                    stats["failed"] += 1
                    errors.append((name, key, val[1][:200]))
                    continue
                if val is None:
                    stats["failed"] += 1
                    continue
                results[key] = val
                if val.get("meta", {}).get("rs") == "skip":
                    stats["skipped"] += 1
                ckpt_f.write(json.dumps(
                    {"source_file": key[0], "segment_index": key[1], "label": val},
                    ensure_ascii=False) + "\n")
                ckpt_f.flush()
    ckpt_f.close()

    out_rows = []
    for seg in data:
        seg = dict(seg)
        k = key_of(seg)
        if k in results:
            seg["label"] = results[k]
        out_rows.append(seg)
    out_path = os.path.join(OUT_DIR, name)
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(out_rows, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    stats["annotated"] = len(results)
    return stats


def main():
    args = sys.argv[1:]
    limit = None
    resume = False
    only = None
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--limit":
            i += 1
            limit = int(args[i])
        elif a == "--resume":
            resume = True
        elif a == "--only":
            i += 1
            only = args[i]
        i += 1

    files = []
    for d in SRC_DIRS:
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.startswith("segments_") and f.endswith(".json"):
                if only and only not in f:
                    continue
                files.append(os.path.join(d, f))

    print(f"待处理 {len(files)} 个文件:")
    for f in files:
        print("  -", os.path.basename(f))

    errors = []
    total_annotated = 0
    for f in files:
        t0 = time.time()
        st = annotate_file(f, limit, resume, errors)
        dt = time.time() - t0
        total_annotated += st["annotated"]
        print(f"[完成] {os.path.basename(f)}: 总{st['total']} 已标{st['annotated']} skip{st['skipped']} 失败{st['failed']} 用时{dt:.0f}s")
    if errors:
        print(f"\n失败 {len(errors)} 条（前 10 条）:")
        for e in errors[:10]:
            print("  ", e)
    print(f"\n全部完成，共标注 {total_annotated} 条。输出目录: {OUT_DIR}")


if __name__ == "__main__":
    main()
