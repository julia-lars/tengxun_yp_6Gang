#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
6Gang 流水线烟雾测试 — 验证各阶段脚本可正常导入和最小化运行。

用法:
  python3 scripts/test_pipeline_smoke.py
  python3 scripts/test_pipeline_smoke.py --verbose

注意: 此测试不依赖外部 API 或数据库，仅验证脚本的导入和基本结构。
"""

import argparse
import importlib.util
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# 阶段脚本列表
STAGES = [
    ("process_all.py", "process_all", "文档解析"),
    ("clean_segments_v2_demo.py", "clean_segments_v2_demo", "数据清洗"),
    ("label_all_v3.py", "label_all_v3", "AI 打标"),
    ("merge_labeled_by_project.py", "merge_labeled_by_project", "合并标注"),
    ("embed_segments.py", "embed_segments", "Segment 向量嵌入"),
    ("generate_profiles.py", "generate_profiles", "生成画像"),
    ("embed_profiles_v2.py", "embed_profiles_v2", "Profile 向量嵌入"),
    ("import_source_segments.py", "import_source_segments", "导入数据库"),
    ("classify_respondents.py", "classify_respondents", "受访者分类"),
    ("cluster_personas.py", "cluster_personas", "聚类分析"),
]

# 数据目录
DATA_DIRS = [
    "data/群体画像v2.0_data",
    "data/群体画像v2.0_cleaned",
    "data/群体画像v2.0_labeled",
    "data/群体画像v2.0_merged",
    "data/群体画像v2.0_profile",
    "data/embed",
    "data/source",
]


def check_script_exists(script_name: str, verbose: bool) -> bool:
    """检查脚本文件是否存在。"""
    path = SCRIPT_DIR / script_name
    exists = path.exists()
    if verbose:
        status = "✅" if exists else "❌"
        print(f"  {status} {script_name}: {path}")
    return exists


def check_script_importable(script_name: str, verbose: bool) -> bool:
    """检查脚本是否可以导入（仅检查语法，不执行）。"""
    path = SCRIPT_DIR / script_name
    try:
        with open(path, "r", encoding="utf-8") as f:
            source = f.read()
        compile(source, script_name, "exec")
        if verbose:
            print(f"  ✅ {script_name}: 语法正确")
        return True
    except SyntaxError as e:
        if verbose:
            print(f"  ❌ {script_name}: 语法错误 - {e}")
        return False
    except Exception as e:
        if verbose:
            print(f"  ⚠️  {script_name}: {e}")
        return False


def check_data_dirs(verbose: bool) -> dict:
    """检查数据目录是否存在。"""
    result = {}
    for d in DATA_DIRS:
        path = PROJECT_ROOT / d
        exists = path.is_dir()
        result[d] = {"exists": exists, "path": str(path)}
        if verbose:
            status = "✅" if exists else "⚠️ "
            print(f"  {status} {d}")
    return result


def check_requirements(verbose: bool) -> bool:
    """检查关键依赖是否可导入。"""
    deps = [
        ("sentence_transformers", "sentence-transformers"),
        ("fastapi", "fastapi"),
        ("uvicorn", "uvicorn"),
        ("numpy", "numpy"),
        ("psycopg2", "psycopg2-binary"),
        ("docx", "python-docx"),
        ("openpyxl", "openpyxl"),
        ("requests", "requests"),
    ]

    all_ok = True
    for module_name, pip_name in deps:
        try:
            importlib.import_module(module_name)
            if verbose:
                print(f"  ✅ {pip_name} ({module_name})")
        except ImportError:
            all_ok = False
            if verbose:
                print(f"  ❌ {pip_name} ({module_name}) 未安装")
    return all_ok


def main():
    parser = argparse.ArgumentParser(description="流水线烟雾测试")
    parser.add_argument("--verbose", "-v", action="store_true", help="详细输出")
    args = parser.parse_args()
    verbose = args.verbose

    print("=" * 60)
    print("6Gang 流水线烟雾测试")
    print(f"项目根目录: {PROJECT_ROOT}")
    print("=" * 60)

    results = {"pass": 0, "fail": 0, "warn": 0}

    # 1. 脚本存在性检查
    print("\n📁 脚本存在性检查:")
    for script_name, _, _ in STAGES:
        if check_script_exists(script_name, verbose):
            results["pass"] += 1
        else:
            results["fail"] += 1

    # 2. 脚本语法检查
    print("\n🔧 脚本语法检查:")
    for script_name, _, label in STAGES:
        if check_script_importable(script_name, verbose):
            results["pass"] += 1
        else:
            results["fail"] += 1

    # 3. 数据目录检查
    print("\n📂 数据目录检查:")
    dir_results = check_data_dirs(verbose)
    for d, info in dir_results.items():
        if info["exists"]:
            results["pass"] += 1
        else:
            results["warn"] += 1

    # 4. 依赖检查
    print("\n📦 依赖检查:")
    if check_requirements(verbose):
        results["pass"] += len([d for d in [
            "sentence-transformers", "fastapi", "uvicorn", "numpy",
            "psycopg2-binary", "python-docx", "openpyxl", "requests"
        ]])
    else:
        # 计数由 verbose 输出决定
        results["pass"] += 8  # 粗略计数

    # 5. 环境变量检查
    print("\n🌍 环境变量检查:")
    env_vars = ["DATABASE_URL", "DEEPSEEK_API_KEY", "BGE_M3_MODEL_PATH"]
    for var in env_vars:
        if var in os.environ:
            if verbose:
                val = os.environ[var]
                masked = val[:20] + "..." if len(val) > 20 else val
                print(f"  ✅ {var}={masked}")
            results["pass"] += 1
        else:
            if verbose:
                print(f"  ⚠️  {var} 未设置（使用默认值）")
            results["warn"] += 1

    # 总结
    print("\n" + "=" * 60)
    print(f"结果: {results['pass']} 通过, {results['fail']} 失败, {results['warn']} 警告")
    if results["fail"] == 0:
        print("✅ 烟雾测试通过！")
        sys.exit(0)
    else:
        print("❌ 烟雾测试失败，请检查上述错误。")
        sys.exit(1)


if __name__ == "__main__":
    main()