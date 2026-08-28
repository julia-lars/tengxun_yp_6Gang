#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
过滤 IMUR AI 模拟用户问卷 cleaned 文件，仅保留自由回答 segments。

保留的自由回答题（按问题前缀匹配）：
1. 您最早接触的射击游戏是哪款？大约什么时候开始玩的？前后玩了多久？
2. 您最投入、最沉迷的射击游戏是哪款？当时为什么那么喜欢、投入？
3. 有没有您曾经很喜欢、但后来不玩了的射击游戏？为什么退坑？
4. 如果让您用几句话形容自己是怎样的射击游戏玩家，您会怎么说？
5. 回想您玩射击游戏的经历，有没有一件让您印象特别深的事？如果愿意，请简单说说。

其余选择题、量表题、人口统计题、联系方式题等全部删除。
同时清理无剩余 segments 的受访者，并同步更新 segment_count / summary。
"""

import json
import os
import shutil
from collections import Counter
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL_DIR = os.path.join("data", "群体画像v2.0_cleaned", "射击游戏用户问卷调研")
FILENAME = "IMUR AI模拟用户基座数据采集_1787191749_answers(1)_cleaned.json"
FILE_PATH = os.path.join(BASE_DIR, REL_DIR, FILENAME)
BACKUP_PATH = FILE_PATH + ".backup"

FREE_RESPONSE_PREFIXES = [
    "您最早接触的射击游戏是哪款？大约什么时候开始玩的？前后玩了多久？",
    "您最投入、最沉迷的射击游戏是哪款？当时为什么那么喜欢、投入？",
    "有没有您曾经很喜欢、但后来不玩了的射击游戏？为什么退坑？",
    "如果让您用几句话形容自己是怎样的射击游戏玩家，您会怎么说？",
    "回想您玩射击游戏的经历，有没有一件让您印象特别深的事？如果愿意，请简单说说。",
]


def is_free_response(question: str) -> bool:
    if not question:
        return False
    for prefix in FREE_RESPONSE_PREFIXES:
        if question.startswith(prefix):
            return True
    return False


def main():
    if not os.path.exists(FILE_PATH):
        print(f"文件不存在: {FILE_PATH}")
        return

    # 备份
    shutil.copy2(FILE_PATH, BACKUP_PATH)
    print(f"已备份: {BACKUP_PATH}")

    with open(FILE_PATH, encoding="utf-8") as f:
        doc = json.load(f)

    original_segments = doc.get("segments", [])
    original_count = len(original_segments)

    # 过滤保留自由回答
    kept_segments = [s for s in original_segments if is_free_response(s.get("preceding_question", ""))]
    deleted_count = original_count - len(kept_segments)

    # 找出仍有 segments 的受访者
    remaining_speaker_ids = set(s.get("speaker_id") for s in kept_segments if s.get("speaker_id"))
    original_respondents = doc.get("respondents", [])
    kept_respondents = [r for r in original_respondents if r.get("speaker_id") in remaining_speaker_ids]
    removed_respondents = len(original_respondents) - len(kept_respondents)

    # 统计删除的问题
    deleted_questions = Counter(
        s.get("preceding_question", "") for s in original_segments if not is_free_response(s.get("preceding_question", ""))
    )

    doc["segments"] = kept_segments
    doc["respondents"] = kept_respondents
    doc["segment_count"] = len(kept_segments)
    doc["summary"] = {
        "original_segment_count": original_count,
        "kept_segment_count": len(kept_segments),
        "deleted_segment_count": deleted_count,
        "original_respondent_count": len(original_respondents),
        "kept_respondent_count": len(kept_respondents),
        "removed_respondent_count": removed_respondents,
        "kept_questions": sorted(set(s.get("preceding_question", "") for s in kept_segments)),
        "deleted_question_count": len(deleted_questions),
        "filtered_at": datetime.now(timezone.utc).isoformat(),
    }

    with open(FILE_PATH, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)

    print(f"原始 segments: {original_count}")
    print(f"保留 segments: {len(kept_segments)}")
    print(f"删除 segments: {deleted_count}")
    print(f"原始 respondents: {len(original_respondents)}")
    print(f"保留 respondents: {len(kept_respondents)}")
    print(f"移除 respondents: {removed_respondents}")
    print(f"删除的问题种类数: {len(deleted_questions)}")
    print("\n保留的问题:")
    for q in doc["summary"]["kept_questions"]:
        print(f"  - {q}")
    print(f"\n已写入: {FILE_PATH}")


if __name__ == "__main__":
    main()
