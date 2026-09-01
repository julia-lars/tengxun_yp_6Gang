#!/usr/bin/env python3
"""
B 层评测：画像真实性 (Persona Authenticity)
============================================
基于评测指标字典 V1.0，实现 B1-B4 全部指标的计算。

B1: Evidence Coverage — 画像中每个 Claim 是否有证据支撑
B2: Evidence Support — 证据与 Claim 的语义一致性
B3: Contradiction — 是否存在反证
B4: Profile Distinctiveness — 画像间是否有足够的区分度

输入：
  - persona_claim_evidence_matrix.json：Claim × Evidence 矩阵
  - persona_descriptions.json（或从 API 获取）

输出：
  - data/eval/results/B_layer_report.json

用法：
  # 第一步：提取 Claims
  python3 scripts/eval_B_layer.py --extract-claims \\
    --api-base http://localhost:3000 \\
    --out-dir data/eval/results/

  # 第二步：检索证据
  python3 scripts/eval_B_layer.py --search-evidence \\
    --claims-file data/eval/results/persona_claims.json \\
    --api-base http://localhost:3000 \\
    --out-dir data/eval/results/

  # 第三步：评估
  python3 scripts/eval_B_layer.py --evaluate \\
    --matrix-file data/eval/results/persona_claim_evidence_matrix.json \\
    --out-dir data/eval/results/
"""

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# ============================================================
# 工具函数
# ============================================================

def load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def save_json(data, path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def safe_mean(arr):
    arr = [x for x in arr if x is not None and not (isinstance(x, float) and np.isnan(x))]
    return float(np.mean(arr)) if arr else 0.0

# ============================================================
# Step 1: Extract Claims from Persona Descriptions
# ============================================================

CLAIM_EXTRACTION_PROMPT = """你是游戏用户研究专家。请从以下玩家画像描述中提取所有**可验证的断言（Atomic Claims）**。

画像描述：
{persona_description}

提取规则：
1. 每个 Claim 必须是单一、可验证的断言（一句话）
2. 覆盖行为(M5)、感受(M4)、认知(M3)、期待(M2)、动机(M1)五个层面
3. 每个 Claim 标注 M 层
4. 每个 Claim 标注证据类型：quantitative（可用数据验证）| qualitative（需访谈验证）| inferential（推理型）

输出格式（JSON）：
```json
{{
  "persona_id": {persona_id},
  "persona_name": "{persona_name}",
  "claims": [
    {{
      "claim_id": "C-001",
      "claim": "该用户群体偏好PC端射击游戏",
      "m_layer": "M5",
      "evidence_type": "quantitative",
      "claim_category": "行为偏好"
    }}
  ]
}}
```

请直接输出 JSON，不要有其他内容。"""


def extract_claims_from_personas(personas: list, api_base: str, api_key: str,
                                  model: str = "deepseek-v4-flash") -> list:
    """使用 LLM 从画像描述中提取 Atomic Claims"""
    import requests

    all_claims = []

    for persona in personas:
        print(f"  Extracting claims from: {persona['name']} (id={persona['id']})")

        prompt = CLAIM_EXTRACTION_PROMPT.format(
            persona_description=json.dumps(persona, ensure_ascii=False, indent=2),
            persona_id=persona["id"],
            persona_name=persona["name"],
        )

        try:
            resp = requests.post(
                f"{api_base}/v1/chat/completions",  # 使用 DeepSeek API
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 4096,
                },
                timeout=120,
            )
            # Handle streaming response
            content = resp.text
            # Try to extract JSON from the response
            json_start = content.find("{")
            json_end = content.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                claims_data = json.loads(content[json_start:json_end])
                all_claims.append(claims_data)
                print(f"    Extracted {len(claims_data.get('claims', []))} claims")
            else:
                print(f"    Failed to parse response: {content[:200]}...")
        except Exception as e:
            print(f"    Error: {e}")

        time.sleep(0.5)  # Rate limiting

    return all_claims

# ============================================================
# Step 2: Search Evidence for Each Claim
# ============================================================

def search_evidence_for_claims(claims_data: list, db_config: dict = None) -> dict:
    """
    为每个 Claim 搜索证据。
    实际实现中需要调用 RAG 检索接口或数据库查询。
    这里提供框架，实际需要根据数据源调整。
    """
    matrix = {
        "meta": {
            "version": "v1.0",
            "date": time.strftime("%Y-%m-%d"),
            "description": "Claim-Evidence Matrix for persona authenticity evaluation"
        },
        "personas": []
    }

    for persona_claims in claims_data:
        persona_entry = {
            "persona_id": persona_claims["persona_id"],
            "persona_name": persona_claims["persona_name"],
            "claims": []
        }

        for claim in persona_claims.get("claims", []):
            # 框架：每个 Claim 需要包含：
            # - evidence_items: 找到的证据列表
            # - evidence_count: 证据数量
            # - has_contradiction: 是否有反证
            claim_entry = {
                **claim,
                "evidence_items": [],
                "evidence_count": 0,
                "evidence_support_score": None,  # LLM 评分 0-1
                "contradiction_items": [],
                "has_contradiction": False,
                "contradiction_score": None,  # 反证严重程度
            }
            persona_entry["claims"].append(claim_entry)

        matrix["personas"].append(persona_entry)

    return matrix

# ============================================================
# Step 3: Evaluate (B1-B4)
# ============================================================

def compute_B1_evidence_coverage(matrix: dict) -> dict:
    """B1: 每个画像中有证据支撑的 Claim 比例"""
    results = []
    for persona in matrix.get("personas", []):
        claims = persona.get("claims", [])
        total = len(claims)
        backed = sum(1 for c in claims if c.get("evidence_count", 0) > 0)
        coverage = backed / total if total > 0 else 0.0

        # 按 M 层分别计算
        m_layer_coverage = defaultdict(lambda: {"total": 0, "backed": 0})
        for c in claims:
            m = c.get("m_layer", "unknown")
            m_layer_coverage[m]["total"] += 1
            if c.get("evidence_count", 0) > 0:
                m_layer_coverage[m]["backed"] += 1

        results.append({
            "persona_id": persona["persona_id"],
            "persona_name": persona["persona_name"],
            "total_claims": total,
            "backed_claims": backed,
            "coverage_ratio": coverage,
            "score": coverage * 100.0,
            "m_layer_coverage": {
                m: {
                    "total": d["total"],
                    "backed": d["backed"],
                    "ratio": d["backed"] / d["total"] if d["total"] > 0 else 0.0
                }
                for m, d in m_layer_coverage.items()
            }
        })

    avg_coverage = safe_mean([r["coverage_ratio"] for r in results])

    return {
        "B1_per_persona": results,
        "B1_avg_coverage": avg_coverage,
        "B1_score": avg_coverage * 100.0,
        "B1_redline": avg_coverage < 0.70,  # 红线：Evidence Coverage < 70%
    }

def compute_B2_evidence_support(matrix: dict) -> dict:
    """B2: 证据与 Claim 的语义支持度"""
    results = []
    for persona in matrix.get("personas", []):
        support_scores = []
        for claim in persona.get("claims", []):
            score = claim.get("evidence_support_score")
            if score is not None:
                support_scores.append(score)

        avg_support = safe_mean(support_scores) if support_scores else 0.0
        results.append({
            "persona_id": persona["persona_id"],
            "persona_name": persona["persona_name"],
            "claims_with_support_score": len(support_scores),
            "avg_support_score": avg_support,
            "score": avg_support * 100.0,
        })

    avg = safe_mean([r["avg_support_score"] for r in results])

    return {
        "B2_per_persona": results,
        "B2_avg_support": avg,
        "B2_score": avg * 100.0,
    }

def compute_B3_contradiction(matrix: dict) -> dict:
    """B3: 反证检测"""
    results = []
    for persona in matrix.get("personas", []):
        claims = persona.get("claims", [])
        total = len(claims)
        with_contradiction = sum(1 for c in claims if c.get("has_contradiction", False))

        contradiction_ratio = with_contradiction / total if total > 0 else 0.0
        # 反证越少越好
        score = (1.0 - contradiction_ratio) * 100.0

        results.append({
            "persona_id": persona["persona_id"],
            "persona_name": persona["persona_name"],
            "total_claims": total,
            "contradicted_claims": with_contradiction,
            "contradiction_ratio": contradiction_ratio,
            "score": score,
        })

    avg_ratio = safe_mean([r["contradiction_ratio"] for r in results])

    return {
        "B3_per_persona": results,
        "B3_avg_contradiction_ratio": avg_ratio,
        "B3_score": (1.0 - avg_ratio) * 100.0,
    }

def compute_B4_profile_distinctiveness(personas: list) -> dict:
    """B4: 画像间区分度 — 画像描述的语义相似度"""
    # 简化实现：基于 tagSpec 的 Jaccard 相似度
    # 完整实现需要画像文本的 embedding 相似度

    n = len(personas)
    if n < 2:
        return {"B4_note": "Need at least 2 personas for distinctiveness analysis", "B4_score": 0}

    # 提取每个画像的 tagSpec 特征集
    def get_tag_set(persona):
        tags = set()
        ts = persona.get("tagSpec", {})
        for key, val in ts.items():
            if isinstance(val, list):
                for v in val:
                    tags.add(f"{key}:{v}")
            elif isinstance(val, str):
                tags.add(f"{key}:{val}")
        return tags

    tag_sets = [get_tag_set(p) for p in personas]

    pairs = []
    similarities = []

    for i in range(n):
        for j in range(i + 1, n):
            set_i = tag_sets[i]
            set_j = tag_sets[j]
            if not set_i and not set_j:
                sim = 0.0
            elif not set_i or not set_j:
                sim = 0.0
            else:
                intersection = len(set_i & set_j)
                union = len(set_i | set_j)
                sim = intersection / union  # Jaccard

            similarities.append(sim)
            pairs.append({
                "persona_a": personas[i]["name"],
                "persona_b": personas[j]["name"],
                "jaccard_similarity": sim,
                "distinctiveness": 1.0 - sim,
            })

    avg_similarity = safe_mean(similarities)
    distinctiveness = 1.0 - avg_similarity

    return {
        "B4_per_pair": pairs,
        "B4_avg_similarity": avg_similarity,
        "B4_distinctiveness": distinctiveness,
        "B4_score": distinctiveness * 100.0,
    }

# ============================================================
# 主函数
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="B 层评测：画像真实性")
    parser.add_argument("--extract-claims", action="store_true", help="Step 1: 从画像提取 Claims")
    parser.add_argument("--search-evidence", action="store_true", help="Step 2: 为 Claims 检索证据")
    parser.add_argument("--evaluate", action="store_true", help="Step 3: 计算 B1-B4 指标")
    parser.add_argument("--api-base", default="http://localhost:3000", help="API 地址")
    parser.add_argument("--api-key", default=None, help="LLM API Key")
    parser.add_argument("--model", default="deepseek-v4-flash", help="LLM 模型")
    parser.add_argument("--claims-file", default=None, help="Claims JSON 文件路径")
    parser.add_argument("--matrix-file", default=None, help="Claim-Evidence Matrix JSON 文件路径")
    parser.add_argument("--out-dir", default="data/eval/results/", help="输出目录")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    # 获取 API Key
    api_key = args.api_key
    if not api_key:
        # 从 .env 读取
        env_paths = [".env", "apps/api/.env"]
        for ep in env_paths:
            if os.path.exists(ep):
                with open(ep) as f:
                    for line in f:
                        if line.startswith("DEEPSEEK_API_KEY="):
                            api_key = line.split("=", 1)[1].strip()
                            break
            if api_key:
                break

    if not api_key:
        print("WARNING: No API key found. Using API proxy instead.")

    # Step 1: Extract Claims
    if args.extract_claims:
        print("=" * 60)
        print("B 层 Step 1: 从画像提取 Claims")
        print("=" * 60)

        # 从 API 获取所有画像
        import requests
        resp = requests.get(f"{args.api_base}/api/personas", timeout=30)
        resp.raise_for_status()
        personas = resp.json()
        print(f"Loaded {len(personas)} personas from API")

        claims_data = extract_claims_from_personas(personas, args.api_base, api_key, args.model)

        out_path = os.path.join(args.out_dir, "persona_claims.json")
        save_json(claims_data, out_path)
        print(f"\nClaims saved to: {out_path}")

    # Step 2: Search Evidence
    elif args.search_evidence:
        print("=" * 60)
        print("B 层 Step 2: 为 Claims 检索证据")
        print("=" * 60)

        if not args.claims_file:
            print("ERROR: --claims-file is required for --search-evidence")
            sys.exit(1)

        claims_data = load_json(args.claims_file)
        print(f"Loaded {len(claims_data)} persona claim sets")

        matrix = search_evidence_for_claims(claims_data)

        out_path = os.path.join(args.out_dir, "persona_claim_evidence_matrix.json")
        save_json(matrix, out_path)
        print(f"\nMatrix saved to: {out_path}")

    # Step 3: Evaluate
    elif args.evaluate:
        print("=" * 60)
        print("B 层 Step 3: 计算 B1-B4 指标")
        print("=" * 60)

        if not args.matrix_file:
            print("ERROR: --matrix-file is required for --evaluate")
            sys.exit(1)

        matrix = load_json(args.matrix_file)
        print(f"Loaded matrix with {len(matrix.get('personas', []))} personas")

        # 获取 personas 用于 B4
        import requests
        resp = requests.get(f"{args.api_base}/api/personas", timeout=30)
        personas = resp.json()

        results = {}

        print("\nComputing B1: Evidence Coverage...")
        results["B1"] = compute_B1_evidence_coverage(matrix)

        print("Computing B2: Evidence Support...")
        results["B2"] = compute_B2_evidence_support(matrix)

        print("Computing B3: Contradiction...")
        results["B3"] = compute_B3_contradiction(matrix)

        print("Computing B4: Profile Distinctiveness...")
        results["B4"] = compute_B4_profile_distinctiveness(personas)

        # 加权总分
        weights = {"B1": 7.0, "B2": 6.0, "B3": 6.0, "B4": 6.0}
        total_weighted = 0.0
        component_scores = {}

        for key, w in weights.items():
            score = results[key].get(f"{key}_score", 0)
            if score is not None:
                component_scores[key] = {"score": score, "weight": w, "weighted": score * w / 100.0}
                total_weighted += score * w

        results["_summary"] = {
            "total_score": total_weighted / sum(weights.values()),
            "total_weighted": total_weighted,
            "max_weighted": sum(weights.values()) * 100.0,
            "component_scores": component_scores,
            "weights": weights,
        }

        out_path = os.path.join(args.out_dir, "B_layer_report.json")
        save_json(results, out_path)

        # 打印摘要
        summary = results["_summary"]
        print(f"\n{'='*60}")
        print(f"B 层评测结果")
        print(f"{'='*60}")
        for key, comp in summary["component_scores"].items():
            print(f"  {key}: {comp['score']:.1f} (weight={comp['weight']}%)")
        print(f"  {'─'*40}")
        print(f"  TOTAL: {summary['total_score']:.1f}/100")

        # 红线检查
        b1 = results.get("B1", {})
        if b1.get("B1_redline"):
            print(f"\n🚨 REDLINE: B1 Evidence Coverage < 70%")

        print(f"\nReport saved to: {out_path}")

    else:
        print("Please specify one of: --extract-claims, --search-evidence, --evaluate")
        print("See --help for details")


if __name__ == "__main__":
    main()