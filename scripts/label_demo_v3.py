#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据标注 v3.0 Demo：从 群体画像v2.0_cleaned 取 10 条片段打标。

用法:
  python3 label_demo_v3.py

输出:
  data/群体画像v2.0_labeled/demo_10segments.json
"""

import json
import os
import re
import sys
import time
import socket
import urllib.request
import urllib.error
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_env():
    """从 apps/api/.env 读取密钥（已设置的不覆盖）。"""
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

API_URL = os.getenv("DEEPSEEK_BASE_URL", "https://tokenhub.tencentmaas.com/plan/anthropic").rstrip("/") + "/v1/messages"
API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro")
MAX_TOKENS = 16000
TEMP = 0.0

SRC_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_cleaned")
OUT_DIR = os.path.join(BASE_DIR, "data", "群体画像v2.0_labeled")

SYSTEM_PROMPT = """你是射击游戏用户研究领域的资深标注专家。请严格按照《数据标注标准文档 v3.1》对每条被访者发言片段进行标注。

# 核心原则

- **证据直接性优先**：M 层之间不存在强制的生成顺序。优先标注距离证据最近、映射最唯一的标签；允许 M5 证据直接支持 M1，只要 M1 自身满足证据门槛。
- **禁止为填满五层而编造标签**：链条允许断裂，某层没有证据时必须输出空数组。
- **因果关系 ≠ 情绪关系**：行为原因可以支持 M3 认知，但不能自动支持 M4 情绪。
- **Segment-level 与 Respondent-level 分层**：单片段证据不足就留空，禁止为了形成完整画像而补标签；画像在跨片段聚合阶段生成。

下游使用只消费两类标签：
- **事实层（direct）**：`status=confirmed` + `inference_type=direct` + `evidence_level=E3`，可直接进入 embedding、聚类、画像。
- **推导层（derived）**：`status=inferred` + `evidence_level=E2` + 满足该标签特定 threshold，可进入下游，但需按 confidence 加权；M1/M2 推导需特别审慎。
- **推测层（speculative）**：`evidence_level=E1` 或 `status=review`，只能进入 `review_candidates`，**不得**进入下游建模。

# 四个正交字段（各司其职，禁止互相替代）
- `status`：是否进入正式标注？confirmed / inferred / review / empty
- `inference_type`：怎么从证据得到？direct / semantic / causal / contextual
- `evidence_level`：证据本身多强？E3 / E2 / E1 / E0
- `confidence`：模型分数（未校准）或 calibrated_confidence（校准后）。当前未校准阶段填 model_score，0-1。

# 证据等级（v3.1）
- **E3 直接表达**：标签概念在原文中几乎逐字出现，或可由同义替换直接得到。
- **E2 强推断**：从证据到标签存在**短距离、方向唯一、低歧义**的映射，最多一层语义/因果跳跃。
- **E1 弱推断**：证据存在多种合理解释，或需要多跳推断。E1 不得进入正式标签。
- **E0 无证据**：输出空标签。

# Confidence 与 Threshold（v3.1）
- `evidence_level` 决定 `confidence` ceiling；标签特定 threshold 决定是否准入。
- 初始参考：M5 ≥0.70，M4 ≥0.75，M3 ≥0.80，M2 ≥0.80，M1 ≥0.85。
- E3 ceiling = 1.00；E2 ceiling 建议 M5-M4 ≤0.90，M3-M2 ≤0.90，M1 ≤0.92；E1 ceiling ≤0.75。
- 未校准阶段 `confidence` 是 model_score，不得解释为真实概率；同时输出 `calibrated_confidence: null`，`calibrated: false`。

# 标注体系（双层：冰山五层 + 框架七维）

## 冰山五层
- M1 动机/诉求（为什么玩）。值域：competitive_proof / ability_growth / dominance / team_cooperation / social_belonging / stimulation / relaxation_escape / strategy_mastery / exploration_collection / narrative_immersion / sensory_aesthetics / expression_creation。最多 3 个，第一个为 primary: true。**M1 必须有同一片段内明确证据链支持，禁止从单一行为或结果直接跳跃。**
- M2 期待/标准（游戏"应该怎样"）。值域：fair_competition / skill_determines / rich_content / social_convenience / low_barrier / immersive_experience / positive_community / continuous_challenge / respect_time / monetization_fair / teammate_communication / teammate_competence / teammate_stability。最多 2 个。
- M3 认知/观点（"实际是怎样"）。category 从：fairness_perception / difficulty_perception / depth_perception / quality_perception / monetization_perception / meta_perception / self_ability / self_identity / self_limitation / teammate_perception / opponent_perception / developer_perception / community_perception / causal_attribution 中选；value 用简短英文短语概括。最多 2 个。
- M4 感受/情绪。值域：excitement / achievement / flow / joy / social_warmth / anger_frustration / anxiety_tension / boredom_burnout / disappointment / numbness。需标 valence(positive/negative/neutral)、intensity(low/medium/high)、trigger(win_loss/growth/team/matchmaking/monetization/cheat/performance/content/social)。最多 2 个。**不能从单一行为或因果关系自动推断情绪。**
- M5 行为/应对。值域：ranked_grind / deliberate_practice / watch_guides / social_play / casual_play / switch_mode / return / avoid_strangers / content_share / spending / quit_break / smurf / watch_esports / community_engage。可标 frequency(daily/regular/occasional/past/planned)，原文未提及则 null。最多 3 个。**时长/偏好不能直接推出具体行为模式。**
- causal_chain：仅当同一片段明确表达因果时标。基本单元是 **evidence → claim → claim**，而不是 M5→M4→M3→M2→M1 的标签链。结构：`{"from": "evidence_XX" 或 "MX:label", "from_value": "...", "to": "MX:label", "relation": "supports/causes/correlates"}`。

## 框架七维（横向画像）
- needs: {"primary": "M1 key 或 null", "secondary": ["M1 key"]}
- ability: {"level": novice/beginner/intermediate/advanced/expert/unknown, "strengths": [], "weaknesses": [], "cognitive_strengths": [], "cognitive_weaknesses": []}
- style: {"combat": passive/balanced/aggressive, "decision": strategic/contextual/instinctive, "victory": team/balanced/individual, "growth": progression/mixed/skill, "social": friends/flexible/solo}
- platform: {"primary": pc/console/mobile/multi_platform/cloud_other/unknown, "secondary": null 或 key}
- mode: {"structure": pure_pve/pve_main/balanced/pvp_main/pure_pvp/contextual, "submodes": [{"name": team_deathmatch|bomb_defusal|battle_royale|extraction|large_scale|coop_pve|story_pve|boss_loot|party_mode|open_world, "attitude": liked/accepted/neutral/disliked/rejected/not_experienced}]}
- assets: {"time": 充足/有约束/严重稀缺/未知, "ability_asset": ..., "energy": ..., "emotion": ..., "money": ...}
- sweet_spot: {"stage": novice_understanding/rapid_improvement/stable_mastery/plateau/churn/unknown, "skill_count": 整数或 null, "duration": short/medium/long/unknown, "quality": low/medium/high/unknown, "flow_factors": [多选], "peak_moment": 原文或 null, "plateau_trigger": 原文或 null}

## 产品评测扩展标签（不确定则 null 或空）
city_tier / life_stage / device / setting / art_style / perspective / ttk / match_length / social_structure / spending_level / payment_method / spending_motive / fairness_boundary / info_channel / content_type / trust_source / migration_trigger / churn_reason / recall_condition / version_expectation / match_wait / cheater_tolerance / lag_tolerance / forced_team / learning_cost

# 证据与状态规则
- 每个正式标签必须包含 status、inference_type、confidence、calibrated_confidence、evidence_level、evidence（原文引用数组）。
- E1 不得进入正式标签，只能进 review_candidates。
- review_candidates 数组承载不确定候选：{label, suggested_M, reason, evidence_level, confidence}。
- 禁止推断：行为不能自动推动机/情绪；因果关系不能自动推情绪；结果不能自动推原因；频率不能推重要性；人口属性不得从语言风格猜；机制偏好不能自动推 M5 行为模式或 M1 动机。
- 极短片段（cleaned_text < 10 字符）或纯填充词 → 各层全空，validity.is_player_evidence=false。

# 标签互斥默认规则（v3.1）
- 同一属性轴内，若两个标签关系未在字典声明，默认互斥/需 review，不得自动共存。
- 跨属性轴未声明关系，默认允许共存，但仍需独立证据。

# 外部知识限制（v3.1）
- 禁止将外部知识（其他 Segment、Profile、互联网常识、统计规律、模型经验）作为当前 Segment 的证据。
- 标签字典/规范中的领域知识可以使用（如“排位赛是竞技模式”），但不能据此推断当前用户动机。

# 断裂链示例（必须遵守）

**示例 A：仅有时长，不能推断行为模式**
原文："Apex 英雄玩了 1200 小时。"
输出：M5_behavior=[]；M4/M3/M2/M1=[]；causal_chain=[]；review_candidates 中可放 long_term_engagement(E1)。
**禁止**因"玩得久"而推断 casual_play、ranked_grind、M1=ability_growth 或 M4=joy。

**示例 B：机制偏好支持 M3/M4，不自动支持 M5/M1**
原文："我喜欢长一点的 TTK 加快速机动性，因为这样操作空间更大，打起来更刺激。"
输出：M5=[]；M4=excitement(E3，"刺激"直接表达)；M3=operational_space_matters(E2，"操作空间更大")；M2=[]；M1=[]；causal_chain 连接 evidence → M3 → M4。
**禁止**因"喜欢长 TTK"而推断 M5=casual_play 或 M1=stimulation。

**示例 C：M5 可推导 M3，但 M4 不能由因果关系自动推出**
原文："最近因为工作，没有一起开黑的朋友，所以玩得少了。"
输出：M5=quit_break(E3)，M4=[]，M3=group_experience_depends_on_friends(E2)，M2=[]，M1=[]；review_candidates 中放 social_belonging(E1)、disappointment(E1)。

# 输出格式
只输出一个 JSON 对象，不要 markdown 代码块，不要解释文字：
{"results": [
  {
    "annotation_version": "3.1",
    "source": {"file": "...", "segment_index": 0, "speaker_id": "...", "language": "zh", "preceding_question": "..."},
    "validity": {"is_player_evidence": true, "skip_reason": null, "duplicate_of": null, "requires_context": false},
    "iceberg": {
      "M1_motivation": [{"value": "ability_growth", "primary": true, "status": "confirmed", "inference_type": "direct", "confidence": 0.90, "calibrated_confidence": null, "evidence_level": "E3", "evidence": ["我专门练枪就是想打得更准"]}],
      "M2_expectation": [],
      "M3_perception": [],
      "M4_feeling": [],
      "M5_behavior": [{"value": "deliberate_practice", "frequency": null, "status": "confirmed", "inference_type": "direct", "confidence": 0.95, "calibrated_confidence": null, "evidence_level": "E3", "evidence": ["我专门练枪"]}],
      "causal_chain": [
        {"from": "evidence_01", "from_value": "想打得更准", "to": "M1:ability_growth", "relation": "supports"},
        {"from": "evidence_02", "from_value": "专门练枪", "to": "M5:deliberate_practice", "relation": "supports"}
      ]
    },
    "framework": {
      "needs": {"primary": "ability_growth", "secondary": []},
      "ability": {"level": "intermediate", "strengths": ["aim-tracking"], "weaknesses": [], "cognitive_strengths": [], "cognitive_weaknesses": []},
      "style": {"combat": "aggressive", "decision": "instinctive", "victory": "individual", "growth": "skill", "social": "friends"},
      "platform": {"primary": "pc", "secondary": null},
      "mode": {"structure": "pvp_main", "submodes": []},
      "assets": {"time": "充足", "ability_asset": "有约束", "energy": "充足", "emotion": "有约束", "money": "未知"},
      "sweet_spot": null
    },
    "product_tags": {"city_tier": null, "life_stage": null, "device": null, "spending_level": null},
    "review_candidates": [],
    "evidence": [
      {"id": "evidence_01", "quote": "想打得更准", "supports": ["iceberg.M1_motivation[0]"], "evidence_level": "E3"},
      {"id": "evidence_02", "quote": "专门练枪", "supports": ["iceberg.M5_behavior[0]"], "evidence_level": "E3"}
    ],
    "meta": {"confidence": 0.90, "calibrated": false, "annotator": "MODEL", "annotated_at": "ISO时间", "notes": ""}
  }
]}

空片段示例：{"annotation_version": "3.1", "source": {...}, "validity": {"is_player_evidence": false, "skip_reason": "too_short", ...}, "iceberg": {"M1_motivation": [], "M2_expectation": [], "M3_perception": [], "M4_feeling": [], "M5_behavior": [], "causal_chain": []}, "framework": {}, "product_tags": {}, "review_candidates": [], "evidence": [], "meta": {"confidence": 1.0, "calibrated": false, "annotator": "MODEL", "annotated_at": "ISO时间", "notes": ""}}

输入片段会提供 segment_index、speaker_id、preceding_question、cleaned_text。请对每段输出上述结构，放在 results 数组中，保持顺序一致。"""


def http_post(payload: dict) -> dict:
    req = urllib.request.Request(API_URL, data=json.dumps(payload).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("x-api-key", API_KEY)
    req.add_header("anthropic-version", "2023-06-01")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:500]}")
    except socket.timeout as e:
        raise RuntimeError(f"API timeout: {e}")
    except Exception as e:
        raise RuntimeError(f"API error: {type(e).__name__}: {e}")


def extract_text(data: dict) -> str:
    parts = []
    for b in data.get("content", []):
        if isinstance(b, dict) and b.get("type") == "text":
            parts.append(b.get("text", ""))
    return "\n".join(parts)


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


def find_cleaned_files():
    files = []
    for root, _, fs in os.walk(SRC_DIR):
        for f in fs:
            if f.endswith("_cleaned.json"):
                files.append(os.path.join(root, f))
    return sorted(files)


def label_segments(segments: list) -> list:
    user_lines = []
    for i, seg in enumerate(segments):
        user_lines.append(
            f"[{i}] segment_id={seg.get('segment_id')}\n"
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
    data = http_post(payload)
    raw = extract_text(data)
    parsed = parse_json_lenient(raw)
    if parsed is None:
        raise RuntimeError(f"无法解析 JSON: {raw[:500]}")
    results = parsed.get("results") if isinstance(parsed, dict) else parsed
    if not isinstance(results, list):
        raise RuntimeError(f"results 不是数组: {raw[:500]}")
    return results[:len(segments)]


def normalize_label(label: dict, seg: dict, idx: int) -> dict:
    label.setdefault("annotation_version", "3.1")
    source = label.setdefault("source", {})
    # 强制使用真实 source_file 与当前时间，避免模型照抄示例里的占位值
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


def main():
    if not API_KEY:
        print("错误：未找到 DEEPSEEK_API_KEY，请检查 apps/api/.env", file=sys.stderr)
        sys.exit(1)

    files = find_cleaned_files()
    if not files:
        print(f"错误：在 {SRC_DIR} 下未找到 *_cleaned.json 文件", file=sys.stderr)
        sys.exit(1)
    print(f"找到 {len(files)} 个 cleaned 文件，使用第一个：{files[0]}")

    with open(files[0], encoding="utf-8") as f:
        doc = json.load(f)

    segs = [s for s in doc.get("segments", []) if s.get("cleaning_status") == "kept"][:10]
    print(f"取前 10 条 kept 片段进行标注...")

    t0 = time.time()
    results = label_segments(segs)
    dt = time.time() - t0
    print(f"API 调用完成，耗时 {dt:.1f}s，返回 {len(results)} 条标注")

    out_rows = []
    for i, seg in enumerate(segs):
        row = dict(seg)
        if i < len(results) and results[i]:
            row["annotation"] = normalize_label(results[i], seg, i)
        else:
            row["annotation"] = normalize_label({}, seg, i)
        out_rows.append(row)

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "demo_10segments.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({
            "source_file": doc.get("source_file"),
            "demo_count": len(out_rows),
            "annotated_at": datetime.now(timezone.utc).isoformat(),
            "model": MODEL,
            "segments": out_rows,
        }, f, ensure_ascii=False, indent=2)
    print(f"输出已保存：{out_path}")


if __name__ == "__main__":
    main()
