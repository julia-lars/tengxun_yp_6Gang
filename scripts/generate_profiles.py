#!/usr/bin/env python3
"""
Profile generation pipeline for 群体画像v2.0

Reads each merged labeled segment file independently, generates profiles
for each respondent within that file, and saves one profile JSON per project.

Usage:
    python3 scripts/generate_profiles.py                    # process all files
    python3 scripts/generate_profiles.py --dry-run          # show summary only
    python3 scripts/generate_profiles.py --file "Deadlock竞品研究"  # single file
    python3 scripts/generate_profiles.py --limit 3          # first N files
"""

import json
import os
import sys
import time
import argparse
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from collections import defaultdict, Counter
from pathlib import Path

# ---- Config ----
MERGED_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "群体画像v2.0_merged")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "群体画像v2.0_profile")
SPEC_PATH = os.path.join(os.path.dirname(__file__), "..", "docs", "用户画像Profile生成规范.md")

# DeepSeek API config (Anthropic-compatible via TokenHub)
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

MAX_CONCURRENT = 50
MAX_EVIDENCE_ITEMS_PER_TYPE = 5
MAX_TOTAL_EVIDENCE_CHARS = 8000
API_TIMEOUT = 300
API_MAX_TOKENS = 16384


# ---- Step 1: Load Single Merged File ----

def load_single_merged_file(fpath):
    """
    Load a single merged JSON file.
    Returns (project_name, respondents_by_id, segments_by_rid).

    respondents_by_id: {respondent.id -> metadata}
    segments_by_rid:   {respondent.id -> [segment]}

    Key: segments.speaker_id matches respondent.id (global unique ID within file),
    not respondent.speaker_id (which may differ).
    """
    with open(fpath, "r") as f:
        data = json.load(f)

    project_name = data.get("project", os.path.splitext(os.path.basename(fpath))[0])

    # Build respondent lookup: respondent.id -> metadata
    respondents_by_id = {}
    for r in data.get("respondents", []):
        rid = r.get("id") or r.get("speaker_id")
        if rid:
            respondents_by_id[rid] = r

    # Collect segments keyed by respondent.id (matching segments.speaker_id)
    segments_by_rid = defaultdict(list)
    for seg in data.get("segments", []):
        rid = seg.get("speaker_id")
        if rid and rid in respondents_by_id:
            segments_by_rid[rid].append({
                "project": project_name,
                "segment_id": seg.get("segment_id"),
                "source_file": seg.get("source_file"),
                "cleaned_text": seg.get("cleaned_text", ""),
                "preceding_question": seg.get("preceding_question", ""),
                "annotation": seg.get("annotation", {}),
            })

    return project_name, respondents_by_id, dict(segments_by_rid)


# ---- Step 2: Evidence Extraction ----

def extract_evidence(segments):
    """Extract and aggregate evidence from segments."""
    iceberg_groups = defaultdict(lambda: {"count": 0, "statuses": [], "quotes": [], "evidence_levels": []})

    framework_agg = {
        "ability": {"levels": [], "strengths": [], "weaknesses": []},
        "style": defaultdict(list),
        "platform": {"primary": [], "secondary": []},
        "mode": {"structure": [], "submodes": []},
        "needs": {"primary": [], "secondary": []},
        "assets": defaultdict(list),
        "sweet_spots": [],
    }

    product_tags_agg = defaultdict(list)
    all_evidence = []

    for seg in segments:
        ann = seg.get("annotation", {})
        if not ann:
            continue

        seg_id = seg["segment_id"]
        text = seg.get("cleaned_text", "")

        # Extract iceberg labels
        iceberg = ann.get("iceberg", {})
        for mkey in ["M1_motivation", "M2_expectation", "M3_perception", "M4_feeling", "M5_behavior"]:
            for label in iceberg.get(mkey, []):
                if label.get("status") not in ("confirmed", "inferred"):
                    continue
                value = label.get("value", "")
                group_key = f"{mkey}:{value}"
                iceberg_groups[group_key]["count"] += 1
                iceberg_groups[group_key]["statuses"].append(label.get("status"))
                iceberg_groups[group_key]["evidence_levels"].append(label.get("evidence_level"))
                for ev in label.get("evidence", []):
                    if ev and len(ev) > 3:
                        iceberg_groups[group_key]["quotes"].append(ev[:200])

        # Extract framework
        fw = ann.get("framework", {})
        if fw:
            ability = fw.get("ability") or {}
            if ability.get("level") and ability["level"] != "unknown":
                framework_agg["ability"]["levels"].append(ability["level"])
            for s in ability.get("strengths", []):
                framework_agg["ability"]["strengths"].append(s)
            for w in ability.get("weaknesses", []):
                framework_agg["ability"]["weaknesses"].append(w)

            style = fw.get("style") or {}
            for sk, sv in style.items():
                if sv and sv != "unknown":
                    framework_agg["style"][sk].append(sv)

            platform = fw.get("platform") or {}
            if platform.get("primary") and platform["primary"] != "unknown":
                framework_agg["platform"]["primary"].append(platform["primary"])
            if platform.get("secondary"):
                framework_agg["platform"]["secondary"].append(platform["secondary"])

            mode = fw.get("mode") or {}
            if mode.get("structure") and mode["structure"] != "unknown":
                framework_agg["mode"]["structure"].append(mode["structure"])
            for sm in mode.get("submodes", []):
                framework_agg["mode"]["submodes"].append(sm)

            needs = fw.get("needs") or {}
            if needs.get("primary"):
                framework_agg["needs"]["primary"].append(needs["primary"])
            for sn in needs.get("secondary", []):
                framework_agg["needs"]["secondary"].append(sn)

            assets = fw.get("assets") or {}
            for ak, av in assets.items():
                if av and av != "未知":
                    framework_agg["assets"][ak].append(av)

            if fw.get("sweet_spot"):
                framework_agg["sweet_spots"].append(fw["sweet_spot"])

        # Extract product tags
        pt = ann.get("product_tags", {})
        for tag_key, tag_val in pt.items():
            if tag_val:
                product_tags_agg[tag_key].append(str(tag_val)[:100])

        # Extract raw evidence with quotes
        for ev in ann.get("evidence", []):
            quote = ev.get("quote", "")
            if quote and len(quote) > 3:
                all_evidence.append({
                    "segment_id": seg_id,
                    "quote": quote[:200],
                    "evidence_level": ev.get("evidence_level", "?"),
                })

    return {
        "iceberg_groups": dict(iceberg_groups),
        "framework_agg": {k: dict(v) if isinstance(v, defaultdict) else v for k, v in framework_agg.items()},
        "product_tags_agg": dict(product_tags_agg),
        "all_evidence": all_evidence,
    }


def _safe_counter(items, top_n=3):
    """Wrap Counter to handle unhashable types."""
    try:
        return Counter(items).most_common(top_n)
    except TypeError:
        return [(str(i), 1) for i in items[:top_n]]


def format_evidence_for_prompt(evidence, max_chars=8000):
    """Format evidence summary as a string for the LLM prompt."""
    parts = []
    total_chars = 0

    # 1. Iceberg labels (most important)
    iceberg = evidence.get("iceberg_groups", {})
    if iceberg:
        parts.append("## 冰山标注 (Iceberg Labels)")
        sorted_groups = sorted(iceberg.items(), key=lambda x: -x[1]["count"])
        for group_key, group_data in sorted_groups:
            m_layer, value = group_key.split(":", 1)
            count = group_data["count"]
            statuses = group_data["statuses"]
            els = group_data["evidence_levels"]
            quotes = group_data["quotes"][:MAX_EVIDENCE_ITEMS_PER_TYPE]

            layer_name = {
                "M1_motivation": "动机",
                "M2_expectation": "期待",
                "M3_perception": "认知",
                "M4_feeling": "情绪",
                "M5_behavior": "行为",
            }.get(m_layer, m_layer)

            line = f"\n[{layer_name}] {value} (×{count}, {max(set(statuses), key=statuses.count)}, {max(set(els), key=els.count)})"
            if total_chars + len(line) > max_chars:
                break
            parts.append(line)
            total_chars += len(line)

            for q in quotes:
                qline = f'  - "{q}"'
                if total_chars + len(qline) > max_chars:
                    break
                parts.append(qline)
                total_chars += len(qline)

    # 2. Framework (abbreviated)
    fw = evidence.get("framework_agg", {})
    fw_strs = []
    if fw.get("ability", {}).get("levels"):
        lvls = Counter(fw["ability"]["levels"])
        fw_strs.append(f"能力等级: {dict(lvls)}")
    if fw.get("style"):
        for sk, sv in fw["style"].items():
            if sv and isinstance(sv, (list, dict)) and len(sv) > 0:
                items = sv if isinstance(sv, list) else list(sv.values()) if isinstance(sv, dict) else []
                if items:
                    fw_strs.append(f"风格.{sk}: {_safe_counter(items)}")
    if fw.get("platform", {}).get("primary"):
        fw_strs.append(f"平台: {_safe_counter(fw['platform']['primary'])}")
    if fw.get("mode", {}).get("structure"):
        fw_strs.append(f"模式: {_safe_counter(fw['mode']['structure'])}")
    if fw.get("needs", {}).get("primary"):
        fw_strs.append(f"核心需求: {_safe_counter(fw['needs']['primary'])}")

    if fw_strs:
        fw_text = "\n## 框架标注 (Framework)\n" + "\n".join(f"  - {s}" for s in fw_strs)
        if total_chars + len(fw_text) < max_chars:
            parts.append(fw_text)
            total_chars += len(fw_text)

    # 3. Product tags (abbreviated)
    pt = evidence.get("product_tags_agg", {})
    if pt:
        pt_text = "\n## 产品标签 (Product Tags)\n" + "\n".join(f"  - {k}: {_safe_counter(v)}" for k, v in list(pt.items())[:10])
        if total_chars + len(pt_text) < max_chars:
            parts.append(pt_text)
            total_chars += len(pt_text)

    return "\n".join(parts)


# ---- Step 3: Build Prompt ----

SYSTEM_PROMPT = """你是用户画像生成专家。根据以下规范从受访者的标注证据中生成 Profile。

# 核心原则
- 六大一级维度固定：context, experience_capability, behaviors, preferences, motivations_needs, perceptions_beliefs
- 每个 Trait 必须有证据支持，无证据不生成，空维度输出 []
- 禁止推断：行为≠偏好，偏好≠动机，时长≠能力，单次陈述≠稳定特征
- 从证据到 Trait 到 Summary，不反向污染

# Trait 字段
- trait_id: T+三位数字
- dimension: 六大维度之一
- trait_type: 二级分类（见下方参考）
- statement: 15-50字中文陈述
- status: supported(有直接证据) / inferred(需推导)
- temporal_scope: temporary/current/recurring/stable/historical/unknown
- confidence: 0.0-1.0 (E3多条=0.90-0.98, E3单条=0.80-0.90, E2多条=0.75-0.85, E2单条=0.60-0.75)
- evidence: [{segment_id, quote, evidence_level, inference_type}]
- supporting_segments: [segment_id列表]

# Trait Type 参考
Context: social_context, time_context, life_context, constraint, trigger, usage_context
Experience/Capability: experience, capability
Behaviors: current_behavior, historical_behavior, recurring_behavior, play_behavior, choice_behavior, cessation_behavior, social_behavior, consumption_behavior
Preferences: genre_preference, gameplay_preference, combat_preference, camera_preference, social_preference, aesthetic_preference, platform_preference, mode_preference, content_preference
Motivations/Needs: motivation, need, expectation, goal, desired_outcome
Perceptions/Beliefs: quality_perception, self_identity, belief, mental_model, causal_attribution, evaluation, interpretation

# 聚合规则
- 同一维度内语义相同的证据合并为一个 Trait
- 不同维度不合并
- 存在时间变化时分别保留，标记不同 temporal_scope
- 存在冲突时均保留，标记 status=conflicted，在 contradictions 中记录

# 输出格式
输出纯 JSON（不要 markdown 代码块），包含 profile_version, respondent_id, generated_at, source_segments_count, model, metadata, profile(含六大维度), patterns, contradictions, summary, review_candidates。

Summary 必须从已有 Trait 派生，不引入新事实。"""


def build_user_prompt(respondent_id, metadata, evidence_summary, segment_count, source_files):
    """Build the user prompt for a single respondent."""
    meta_parts = [f"受访者ID: {respondent_id}"]
    if metadata:
        profile = metadata.get("profile", {})
        if profile:
            demo = []
            if profile.get("age"):
                age = profile["age"]
                if isinstance(age, dict):
                    age = age.get("value", str(age))
                demo.append(f"{age}岁")
            if profile.get("gender"):
                gender = profile["gender"]
                if isinstance(gender, dict):
                    gender = gender.get("value", str(gender))
                if gender:
                    demo.append(str(gender))
            if profile.get("occupation"):
                occ = profile["occupation"]
                if isinstance(occ, dict):
                    occ = occ.get("value", str(occ))
                if occ:
                    demo.append(str(occ))
            if profile.get("education"):
                edu = profile["education"]
                if isinstance(edu, dict):
                    edu = edu.get("value", str(edu))
                if edu:
                    demo.append(str(edu))
            if demo:
                meta_parts.append(f"人口属性: {', '.join(demo)}")

        gb = metadata.get("gaming_background", {})
        if gb:
            if gb.get("current_games"):
                games = [str(g) if isinstance(g, dict) else g for g in gb['current_games'][:8]]
                meta_parts.append(f"当前游戏: {', '.join(games)}")
            if gb.get("genre_experience"):
                genres = [str(g) if isinstance(g, dict) else g for g in gb['genre_experience'][:8]]
                meta_parts.append(f"品类经验: {', '.join(genres)}")
            if gb.get("platform"):
                plats = [str(p) if isinstance(p, dict) else p for p in gb['platform']]
                meta_parts.append(f"平台: {', '.join(plats)}")
            if gb.get("game_hours"):
                hours_str = ", ".join(f"{k}: {v}" for k, v in list(gb["game_hours"].items())[:8])
                meta_parts.append(f"游戏时长: {hours_str}")
            if gb.get("rank"):
                if isinstance(gb["rank"], dict):
                    rank_str = ", ".join(f"{k}: {v}" for k, v in gb["rank"].items())
                else:
                    rank_str = str(gb["rank"])
                meta_parts.append(f"段位: {rank_str}")

    meta_parts.append(f"总Segment数: {segment_count}")
    meta_parts.append(f"来源文件: {', '.join(str(s) for s in source_files[:5])}")

    prompt = "\n".join(meta_parts)
    prompt += f"\n\n---\n\n{evidence_summary}"
    prompt += f"\n\n---\n\n请为 {respondent_id} 生成完整的 Profile JSON。"
    return prompt


# ---- Step 4: API Call ----

def call_deepseek(system_prompt, user_prompt, max_tokens=API_MAX_TOKENS):
    """Call DeepSeek API (Anthropic-compatible format)."""
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY not set")

    body = {
        "model": DEEPSEEK_MODEL,
        "messages": [{"role": "user", "content": user_prompt}],
        "system": system_prompt,
        "max_tokens": max_tokens,
        "temperature": 0.3,
        "thinking": {"type": "disabled"},
    }

    resp = requests.post(
        f"{DEEPSEEK_BASE_URL}/v1/messages",
        headers={
            "Content-Type": "application/json",
            "x-api-key": DEEPSEEK_API_KEY,
            "anthropic-version": "2023-06-01",
        },
        json=body,
        timeout=API_TIMEOUT,
    )

    if not resp.ok:
        raise RuntimeError(f"API {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    text_blocks = [c["text"] for c in data.get("content", []) if c.get("type") == "text"]
    return "".join(text_blocks)


def parse_profile_response(raw_text, respondent_id, segment_count, source_files, project_name):
    """Parse LLM response into a valid profile JSON, with fallback repair."""
    text = raw_text.strip()
    if "```" in text:
        lines = text.split("\n")
        cleaned = []
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("```") or stripped == "```":
                continue
            cleaned.append(line)
        text = "\n".join(cleaned)

    try:
        profile = json.loads(text)
    except json.JSONDecodeError as e:
        import re
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                profile = json.loads(match.group())
            except json.JSONDecodeError:
                json_str = match.group()
                json_str = re.sub(r",\s*([}\]])", r"\1", json_str)
                try:
                    profile = json.loads(json_str)
                except json.JSONDecodeError:
                    debug_dir = os.path.join(OUTPUT_DIR, ".debug", project_name)
                    os.makedirs(debug_dir, exist_ok=True)
                    debug_path = os.path.join(debug_dir, f"{respondent_id}_raw.txt")
                    with open(debug_path, "w", encoding="utf-8") as df:
                        df.write(f"Parse error: {e}\n\n")
                        df.write(f"--- First 2000 chars ---\n{text[:2000]}\n\n")
                        df.write(f"--- Full raw text ---\n{text}\n")
                    print(f"  [{respondent_id}] 🐛 Debug saved to {debug_path}")
                    return None
        else:
            debug_dir = os.path.join(OUTPUT_DIR, ".debug", project_name)
            os.makedirs(debug_dir, exist_ok=True)
            debug_path = os.path.join(debug_dir, f"{respondent_id}_raw.txt")
            with open(debug_path, "w", encoding="utf-8") as df:
                df.write(f"Parse error: {e} (no JSON object found)\n\n")
                df.write(f"--- First 2000 chars ---\n{text[:2000]}\n\n")
                df.write(f"--- Full raw text ---\n{text}\n")
            print(f"  [{respondent_id}] 🐛 Debug saved to {debug_path}")
            return None

    profile.setdefault("profile_version", "1.0")
    profile.setdefault("respondent_id", respondent_id)
    profile.setdefault("generated_at", time.strftime("%Y-%m-%dT%H:%M:%SZ"))
    profile.setdefault("source_segments_count", segment_count)
    profile.setdefault("model", DEEPSEEK_MODEL)
    profile.setdefault("metadata", {})
    profile.setdefault("profile", {})
    profile.setdefault("patterns", [])
    profile.setdefault("contradictions", [])
    profile.setdefault("summary", "")
    profile.setdefault("review_candidates", [])

    for dim in ["context", "experience_capability", "behaviors", "preferences", "motivations_needs", "perceptions_beliefs"]:
        profile["profile"].setdefault(dim, [])

    return profile


# ---- Step 5: Process Single Respondent ----

def process_respondent(respondent_id, metadata, segments, project_name, dry_run=False):
    """Generate profile for a single respondent within a project."""
    source_files = list(set(s.get("source_file", "") for s in segments))
    segment_count = len(segments)

    print(f"  [{project_name}/{respondent_id}] {segment_count} segments, extracting evidence...")

    evidence = extract_evidence(segments)
    evidence_summary = format_evidence_for_prompt(evidence)

    annotated_count = sum(1 for s in segments if s.get("annotation"))
    iceberg_count = len(evidence.get("iceberg_groups", {}))
    print(f"  [{project_name}/{respondent_id}] {annotated_count} annotated, {iceberg_count} iceberg types, {len(evidence_summary)} chars evidence")

    if dry_run:
        return None

    user_prompt = build_user_prompt(respondent_id, metadata, evidence_summary, segment_count, source_files)

    print(f"  [{project_name}/{respondent_id}] Calling API (prompt={len(user_prompt)} chars)...")
    start = time.time()

    try:
        raw = call_deepseek(SYSTEM_PROMPT, user_prompt)
        elapsed = time.time() - start
        print(f"  [{project_name}/{respondent_id}] API response in {elapsed:.1f}s ({len(raw)} chars)")

        profile = parse_profile_response(raw, respondent_id, segment_count, source_files, project_name)
        if profile is None:
            print(f"  [{project_name}/{respondent_id}] ⚠️  Failed to parse JSON response")
            return None

        if metadata:
            profile["metadata"] = {
                "respondent_id": respondent_id,
                "display_name": metadata.get("display_name", ""),
                "source_files": source_files,
                "segment_count": segment_count,
                "demographics": metadata.get("profile", {}),
                "gaming_background": metadata.get("gaming_background", {}),
            }

        profile["_evidence_summary"] = {
            "iceberg_label_types": iceberg_count,
            "annotated_segments": annotated_count,
            "total_segments": segment_count,
        }

        return profile

    except Exception as e:
        elapsed = time.time() - start
        print(f"  [{project_name}/{respondent_id}] ❌ Error after {elapsed:.1f}s: {e}")
        return None


# ---- Step 6: Save Project Profiles ----

def save_project_profiles(project_name, profiles):
    """Save all profiles for a project into a single JSON file."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    fname = f"{project_name}_profiles.json"
    fp = os.path.join(OUTPUT_DIR, fname)
    with open(fp, "w", encoding="utf-8") as f:
        json.dump(profiles, f, ensure_ascii=False, indent=2)
    print(f"  [{project_name}] ✅ Saved {len(profiles)} profiles to {fname}")
    return fp


# ---- Step 7: Process All Projects (Cross-File Parallel) ----

def process_all_projects(merged_files, dry_run=False):
    """Process all merged files in parallel across all respondents."""
    # Collect all respondent tasks from all files
    all_tasks = []  # [(project_name, rid, metadata, segments)]
    file_stats = {}  # project_name -> {rids, segments}

    for fpath in merged_files:
        project_name, respondents_by_id, segments_by_rid = load_single_merged_file(fpath)
        total_segments = sum(len(segs) for segs in segments_by_rid.values())
        file_stats[project_name] = {"respondents": len(segments_by_rid), "segments": total_segments}

        for rid, segs in segments_by_rid.items():
            meta = respondents_by_id.get(rid)
            all_tasks.append((project_name, rid, meta, segs))

    # Sort by segment count desc (prioritize large respondents)
    all_tasks.sort(key=lambda t: -len(t[3]))

    print(f"\n{'=' * 60}")
    print(f"🌐 Processing {len(all_tasks)} respondents across {len(file_stats)} files")
    print(f"   Concurrency: {MAX_CONCURRENT} workers")
    print(f"{'=' * 60}")

    if dry_run:
        for proj, stats in file_stats.items():
            print(f"  {proj}: {stats['respondents']} respondents, {stats['segments']} segments")
        return {}

    # Process all respondents in parallel (cross-file)
    results_by_project = defaultdict(list)
    success = 0
    failed = 0
    error = 0

    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT) as executor:
        futures = {}
        for proj_name, rid, meta, segs in all_tasks:
            future = executor.submit(process_respondent, rid, meta, segs, proj_name)
            futures[future] = (proj_name, rid)

        for future in as_completed(futures):
            proj_name, rid = futures[future]
            try:
                profile = future.result()
                if profile:
                    results_by_project[proj_name].append(profile)
                    success += 1
                    # Save incrementally after each profile completes
                    save_project_profiles(proj_name, results_by_project[proj_name])
                else:
                    failed += 1
            except Exception as e:
                print(f"  [{proj_name}/{rid}] ❌ Unexpected error: {e}")
                error += 1

    # Print project summary
    print(f"\n{'=' * 60}")
    print("📊 Results by project:")
    for proj_name in sorted(results_by_project.keys()):
        count = len(results_by_project[proj_name])
        expected = file_stats.get(proj_name, {}).get("respondents", "?")
        print(f"  {proj_name}: {count}/{expected} profiles")
    print(f"\n  Total: ✅ {success} | ⚠️ {failed} | ❌ {error}")

    return results_by_project


# ---- Main ----

def main():
    parser = argparse.ArgumentParser(description="Generate respondent profiles per project")
    parser.add_argument("--dry-run", action="store_true", help="Show summary only, no API calls")
    parser.add_argument("--file", type=str, help="Process single project file (partial name match)")
    parser.add_argument("--limit", type=int, default=0, help="Limit to first N files")
    args = parser.parse_args()

    # Load API config from .env
    global DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, DEEPSEEK_MODEL
    script_dir = os.path.dirname(os.path.abspath(__file__))
    env_candidates = [
        os.path.join(script_dir, "..", "apps", "api", ".env"),
        os.path.join(os.getcwd(), "apps", "api", ".env"),
        os.path.join(os.getcwd(), ".env"),
    ]
    for env_path in env_candidates:
        if os.path.exists(env_path):
            print(f"   Loading config from {env_path}")
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("DEEPSEEK_API_KEY=") and not DEEPSEEK_API_KEY:
                        DEEPSEEK_API_KEY = line.split("=", 1)[1].strip('"').strip("'")
                    elif line.startswith("DEEPSEEK_API_KEYS=") and not DEEPSEEK_API_KEY:
                        keys = line.split("=", 1)[1].strip('"').strip("'")
                        DEEPSEEK_API_KEY = keys.split(",")[0].strip()
                    elif line.startswith("DEEPSEEK_BASE_URL=") and DEEPSEEK_BASE_URL == "https://api.deepseek.com/v1":
                        DEEPSEEK_BASE_URL = line.split("=", 1)[1].strip('"').strip("'")
                    elif line.startswith("DEEPSEEK_MODEL=") and DEEPSEEK_MODEL == "deepseek-chat":
                        DEEPSEEK_MODEL = line.split("=", 1)[1].strip('"').strip("'")
            break

    if not DEEPSEEK_API_KEY and not args.dry_run:
        print("❌ DEEPSEEK_API_KEY not set. Set it in apps/api/.env or environment.")
        print("   Run with --dry-run to see what would be processed.")
        sys.exit(1)

    if "," in (DEEPSEEK_API_KEY or ""):
        keys = DEEPSEEK_API_KEY.split(",")
        DEEPSEEK_API_KEY = keys[0].strip()
        print(f"   Using first of {len(keys)} API keys")

    print("=" * 60)
    print("Profile Generation Pipeline (per-project)")
    print(f"Model: {DEEPSEEK_MODEL}")
    print(f"Output: {OUTPUT_DIR}")
    print("=" * 60)

    # Find merged files
    print("\n📂 Loading merged files...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Get list of merged files
    merged_files = []
    for fname in sorted(os.listdir(MERGED_DIR)):
        if fname.endswith(".json"):
            merged_files.append(os.path.join(MERGED_DIR, fname))

    if args.file:
        # Filter by partial name match
        merged_files = [f for f in merged_files if args.file in os.path.basename(f)]
        if not merged_files:
            print(f"❌ No file matching '{args.file}'")
            sys.exit(1)

    if args.limit > 0:
        merged_files = merged_files[:args.limit]

    print(f"   Processing {len(merged_files)} file(s)")

    # Quick scan to show total counts
    total_respondents = 0
    total_segments = 0
    for fp in merged_files:
        _, _, segments_by_rid = load_single_merged_file(fp)
        total_respondents += len(segments_by_rid)
        total_segments += sum(len(segs) for segs in segments_by_rid.values())

    print(f"   Total respondents across all files: {total_respondents}")
    print(f"   Total segments: {total_segments}")

    if args.dry_run:
        print("\n📋 DRY RUN — Details:")
        for fp in merged_files:
            project_name, _, segments_by_rid = load_single_merged_file(fp)
            count = len(segments_by_rid)
            segs = sum(len(s) for s in segments_by_rid.values())
            print(f"  {project_name}: {count} respondents, {segs} segments")
        print("\n✅ Dry run complete. Remove --dry-run to generate profiles.")
        return

    # Process all files in parallel (cross-file)
    process_all_projects(merged_files, dry_run=False)


if __name__ == "__main__":
    main()