#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试题集预检脚本：在运行评测之前，验证测试用例的完整性和质量。

检查项:
  1. 结构完整性: 必需字段是否存在、target_id 是否有效
  2. 重复检测: 基于语义相似度（字符级 Jaccard）检测近似重复
  3. 占位符检测: 扫描未填充的 XXX/XXXX 等占位符
  4. 一题多问检测: 检测包含多个问号/任务的题目
  5. 参考答案覆盖率: 统计有/无 reference 的题目比例
  6. 长度分布: 异常短/长的题目
  7. 维度分布: 各 category 的题目数量是否均衡

用法:
  python3 scripts/validate_test_cases.py data/eval/test_cases_persona.json
  python3 scripts/validate_test_cases.py data/eval/test_cases_kol.json
  python3 scripts/validate_test_cases.py data/eval/test_cases_persona.json --strict  # 严格模式: 问题即失败
"""

import argparse
import json
import re
import sys
from collections import Counter
from typing import Any


def check_structure(cases: list) -> list[str]:
    """检查结构完整性。"""
    issues = []
    required_fields = ["id", "question"]
    for c in cases:
        for field in required_fields:
            if field not in c or not c.get(field):
                issues.append(f"[{c.get('id', '?')}] 缺少必需字段 '{field}'")
        # 检查 target_id（category 和 dimension 字段名兼容）
        tid = c.get("target_id") or c.get("personaId") or c.get("kolId")
        cat = c.get("category") or c.get("dimension", "")
        if tid is None and cat != "一致性测试":
            issues.append(f"[{c.get('id', '?')}] target_id 为 null（category={cat}）")
    return issues


def check_placeholders(cases: list) -> list[str]:
    """检查占位符（排除引号内的示例模板）。"""
    issues = []
    # 匹配未填充的占位符：独立的 XXX/XXXX，但排除引号内的示例模式
    pattern = re.compile(r"[XＸ]{3,}")
    for c in cases:
        q = c["question"]
        # 跳过引号内的"XX版XX"示例模板
        # 检查引号外的 XXXX
        # 简化：去掉引号内容后再检查
        stripped = re.sub(r'"[^"]*"|"[^"]*"|\'[^\']*\'', "", q)
        if pattern.search(stripped):
            issues.append(f"[{c['id']}] 题目含占位符: {c['question'][:80]}...")
    return issues


def check_multi_question(cases: list) -> list[str]:
    """检查一题多问。"""
    issues = []
    for c in cases:
        q = c["question"]
        # 统计问号数量
        question_marks = q.count("？") + q.count("?")
        # 检测"排个序"、"分别"等多任务关键词
        multi_keywords = ["排个序", "排序", "分别", "各自", "哪几个"]
        has_multi = any(kw in q for kw in multi_keywords)

        if question_marks >= 2:
            issues.append(f"[{c['id']}] 含 {question_marks} 个问号，可能一题多问: {q[:80]}...")
        elif has_multi:
            issues.append(f"[{c['id']}] 含多任务关键词: {q[:80]}...")
    return issues


def check_duplicates(cases: list, threshold: float = 0.65) -> list[str]:
    """基于字符级 Jaccard 相似度检测近似重复。"""
    issues = []

    def char_bigrams(s: str) -> set:
        s = re.sub(r"[^\w一-鿿]", "", s)
        return {s[i : i + 2] for i in range(len(s) - 1)}

    for i in range(len(cases)):
        qi = cases[i]["question"]
        si = char_bigrams(qi)
        if len(si) < 5:
            continue
        for j in range(i + 1, len(cases)):
            qj = cases[j]["question"]
            sj = char_bigrams(qj)
            if len(sj) < 5:
                continue
            intersection = len(si & sj)
            union = len(si | sj)
            if union == 0:
                continue
            sim = intersection / union
            if sim >= threshold:
                issues.append(
                    f"[{cases[i]['id']}] ↔ [{cases[j]['id']}] "
                    f"相似度 {sim:.0%}: {qi[:60]}... vs {qj[:60]}..."
                )
    return issues


def check_reference_coverage(cases: list) -> list[str]:
    """检查参考答案覆盖率。"""
    total = len(cases)
    with_ref = sum(1 for c in cases if c.get("reference"))
    coverage = with_ref / total * 100 if total > 0 else 0

    issues = []
    if coverage < 30:
        issues.append(f"参考答案覆盖率仅 {coverage:.1f}%（{with_ref}/{total}），建议核心维度题目至少 50% 有 reference")
    else:
        # 这不算 issue，但作为 info 输出
        pass

    # 按 category 统计
    by_cat = {}
    for c in cases:
        cat = c.get("category") or c.get("dimension", "未分类")
        by_cat.setdefault(cat, {"total": 0, "with_ref": 0})
        by_cat[cat]["total"] += 1
        if c.get("reference"):
            by_cat[cat]["with_ref"] += 1

    for cat, stats in sorted(by_cat.items()):
        cov = stats["with_ref"] / stats["total"] * 100 if stats["total"] > 0 else 0
        if cov < 20 and stats["total"] >= 5:
            issues.append(f"  [{cat}] 参考答案覆盖率仅 {cov:.0f}%（{stats['with_ref']}/{stats['total']}）")

    return issues


def check_length(cases: list) -> list[str]:
    """检查题目长度异常。"""
    issues = []
    lengths = [len(c["question"]) for c in cases]
    if not lengths:
        return issues

    avg_len = sum(lengths) / len(lengths)
    for c in cases:
        qlen = len(c["question"])
        if qlen < 10:
            issues.append(f"[{c['id']}] 题目过短（{qlen} 字符）: {c['question']}")
        elif qlen > 200:
            issues.append(f"[{c['id']}] 题目过长（{qlen} 字符，平均 {avg_len:.0f}）: {c['question'][:80]}...")
    return issues


def check_category_distribution(cases: list) -> list[str]:
    """检查维度分布。"""
    issues = []
    cats = Counter(c.get("category") or c.get("dimension", "未分类") for c in cases)
    total = len(cases)
    for cat, count in cats.most_common():
        pct = count / total * 100
        if pct > 35:
            issues.append(f"[{cat}] 占比 {pct:.0f}%（{count}/{total}），可能过于集中")
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="测试题集预检验证")
    parser.add_argument("input", help="测试用例 JSON 路径")
    parser.add_argument("--strict", action="store_true", help="严格模式: 任何问题都导致非零退出码")
    parser.add_argument("--similarity-threshold", type=float, default=0.65, help="重复检测相似度阈值（默认 0.65）")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    meta = data.get("meta", {})
    cases = data.get("cases", [])
    print(f"═" * 60)
    print(f"测试题集预检: {meta.get('name', '未知')}")
    print(f"target={meta.get('target')}, 题数={len(cases)}")
    print(f"═" * 60)

    all_issues: dict[str, list[str]] = {}
    checks = [
        ("结构完整性", check_structure),
        ("占位符", check_placeholders),
        ("一题多问", check_multi_question),
        ("近似重复", lambda cs: check_duplicates(cs, args.similarity_threshold)),
        ("参考答案覆盖", check_reference_coverage),
        ("题目长度", check_length),
        ("维度分布", check_category_distribution),
    ]

    total_issues = 0
    for name, fn in checks:
        issues = fn(cases)
        all_issues[name] = issues
        total_issues += len(issues)
        icon = "✓" if not issues else "⚠"
        print(f"\n{icon} {name}: {len(issues)} 个问题")
        for issue in issues:
            print(f"    {issue}")

    print(f"\n{'═' * 60}")
    if total_issues == 0:
        print("✅ 所有检查通过，测试题集可运行")
        return 0
    else:
        print(f"⚠ 共发现 {total_issues} 个问题")
        if args.strict:
            return 1
        return 0


if __name__ == "__main__":
    sys.exit(main())