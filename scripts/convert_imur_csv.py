#!/usr/bin/env python3
"""
将 IMUR AI模拟用户基座数据采集 CSV 转换为符合数据提取规范 v1.3 的 JSON。
输出：群体画像v2.0/射击游戏用户问卷调研/IMUR_AI模拟用户基座数据采集.json
"""

import csv
import json
import os
import re
from datetime import date

# === 路径配置 ===
SOURCE_FILE = os.path.expanduser(
    "Desktop/腾讯用户画像-data/data/虚拟用户-笔录 for 元培/"
    "IMUR AI模拟用户基座数据采集_1787191749_answers(1).csv"
)
OUTPUT_DIR = os.path.expanduser("tengxun_yp_6Gang/data/群体画像v2.0/射击游戏用户问卷调研")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "IMUR_AI模拟用户基座数据采集.json")
SOURCE_NAME = "射击游戏用户问卷调研/IMUR AI模拟用户基座数据采集_1787191749_answers(1).csv"

# === 列分类 ===
# 元数据列索引 (0-28)
META_COLS = set(range(29))  # 0-28 都是元数据

# Profile 映射
PROFILE_COL_MAP = {
    4: "province",       # 省份
    5: "city",           # 城市
    331: "age_group",    # Q29 年龄
    332: "occupation",   # Q30 职业
    333: "occupation_open", # Q30 open
    334: "gender",       # Q31 性别
}

# 用于提取 question_text 的正则
# 匹配模式: Q<num>_<question_text> 或 Q<num>_<index>_<question_text>_<option>
# 或 Q<num><question_text> (无下划线)
RE_Q_SIMPLE = re.compile(r'^Q(\d+)[_](.+)$')  # Q1_xxx 或 Q13xxx
RE_Q_MULTI = re.compile(r'^Q(\d+)_(\d+)_(.+)_(.+)$')  # Q3_1_question_option

# 特殊：Q13, Q14, Q15, Q32, Q33, Q35 没有下划线
RE_Q_NOUS = re.compile(r'^Q(\d+)([^_].*)$')  # Q13您最早...


def parse_question_col(col_name: str):
    """
    解析问题列名，返回 (question_id, question_text, option_text, is_open)
    例如:
      "Q1_您以前..." -> ("Q1", "您以前...", None, False)
      "Q3_1_截至目前..._穿越火线 CF" -> ("Q3", "截至目前...", "穿越火线 CF", False)
      "Q3_30_..._其他...__open" -> ("Q3", "...", "其他...", True)
      "Q13您最早..." -> ("Q13", "您最早...", None, False)
    """
    is_open = col_name.endswith("__open")
    # 先去掉 __open 后缀再解析，避免贪婪匹配干扰
    clean_name = col_name[:-6] if is_open else col_name

    # Q<num>_<index>_<question>_<option> 模式
    m = RE_Q_MULTI.match(clean_name)
    if m:
        qid = f"Q{m.group(1)}"
        qtext = m.group(3)
        opt = m.group(4)
        return qid, qtext, opt, is_open

    # Q<num>_<question> 模式 (如 Q1_xxx, Q2_xxx, Q8_xxx, Q8_xxx__open)
    m = RE_Q_SIMPLE.match(clean_name)
    if m:
        qid = f"Q{m.group(1)}"
        rest = m.group(2)
        return qid, rest, None, is_open

    # Q<num><question> 模式 (如 Q13xxx, Q14xxx)
    m = RE_Q_NOUS.match(clean_name)
    if m:
        qid = f"Q{m.group(1)}"
        qtext = m.group(2)
        return qid, qtext, None, is_open

    return None, col_name, None, is_open


def extract_profile(row):
    """从行数据中提取 profile 信息"""
    profile = {
        "name": "",
        "age": "",
        "gender": "",
        "occupation": "",
        "education": "",
        "location": "",
    }

    # 省份
    province = row[4].strip() if len(row) > 4 else ""
    city = row[5].strip() if len(row) > 5 else ""
    if province or city:
        profile["location"] = f"{province}{city}" if province and city else province or city

    # 年龄 (Q29)
    if len(row) > 331:
        profile["age"] = row[331].strip()

    # 职业 (Q30)
    if len(row) > 332:
        profile["occupation"] = row[332].strip()

    # 性别 (Q31)
    if len(row) > 334:
        profile["gender"] = row[334].strip()

    return profile


def extract_gaming_background(row, header):
    """从行数据中提取 gaming_background"""
    gb = {
        "current_games": [],
        "platform": [],
        "experience_years": None,
        "genre_experience": [],
    }

    # 非游戏标签（过滤掉）
    NON_GAME_LABELS = {
        "没有在电脑上玩过", "没有在手机上玩过", "以上游戏都没玩过",
        "其他电脑/主机游戏，请说明", "其他手机/平板游戏，请说明",
        "其他代表游戏1", "其他代表游戏2", "其他代表游戏3",
    }

    # Q1: 是否玩过射击游戏
    # Q2: 玩了多久
    if len(row) > 30:
        gb["experience_duration"] = row[30].strip() if row[30].strip() else None

    # Q3: 玩过的游戏列表 (列 31-78)
    # 从 header 中提取游戏名（选项文本），然后检查该列是否被选中
    games_played = []
    for i in range(31, 79):
        if len(row) > i and row[i].strip():
            val = row[i].strip()
            if val not in NON_GAME_LABELS:
                games_played.append(val)
    # 去重并保持顺序
    seen = set()
    unique_games = []
    for g in games_played:
        if g not in seen:
            seen.add(g)
            unique_games.append(g)
    gb["current_games"] = unique_games

    # Q8: 投入最多的游戏
    if len(row) > 258:
        gb["most_invested_game"] = row[258].strip() if row[258].strip() else None

    # Q9: 每周时长
    if len(row) > 260:
        gb["peak_weekly_hours"] = row[260].strip() if row[260].strip() else None

    # Q10: 水平
    if len(row) > 261:
        gb["skill_level"] = row[261].strip() if row[261].strip() else None

    # Q11: 最近最常玩
    if len(row) > 262:
        gb["recent_most_played"] = row[262].strip() if row[262].strip() else None

    # Q12: 最近每周时长
    if len(row) > 264:
        gb["recent_weekly_hours"] = row[264].strip() if row[264].strip() else None

    return gb


def create_segments(row, header, row_idx):
    """为一行受访者数据创建所有 Segment"""
    segments = []
    seg_idx = 0

    for col_idx, col_name in enumerate(header):
        if col_idx in META_COLS:
            continue
        if col_idx >= len(row):
            continue

        cell_val = row[col_idx].strip()
        if not cell_val:
            continue

        qid, qtext, opt, is_open = parse_question_col(col_name)
        if qid is None:
            continue

        # 构建 preceding_question
        if opt and is_open:
            # 开放文本：pq = 问题 - 选项，ot = 用户输入
            pq = f"{qtext} - {opt}"
            ot = cell_val
        elif opt and not is_open:
            # 复选框类问题：pq = 问题 - 选项，ot = 单元格实际值
            # （Q5/Q6/Q7 的 cell_val 是阶段/时长/状态，不是游戏名）
            pq = f"{qtext} - {opt}"
            ot = cell_val
        else:
            # 简单问题
            pq = qtext
            ot = cell_val

        seg_idx += 1
        segments.append({
            "segment_id": seg_idx,  # 临时 ID，后续会重新编号
            "source_file": SOURCE_NAME,
            "segment_index": seg_idx,
            "speaker_id": "",  # 后续填入
            "speaker_role": "interviewee",
            "preceding_question": pq,
            "original_text": ot,
            "cleaned_text": None,
            "char_count": len(ot),
        })

    return segments


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 读取 CSV
    print(f"读取源文件: {SOURCE_FILE}")
    with open(SOURCE_FILE, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)

    print(f"共 {len(rows)} 条受访者数据")

    # 过滤有效数据（答题状态为"有效"或"已完成"）
    valid_rows = []
    skipped = 0
    for row in rows:
        if len(row) < 28:
            skipped += 1
            continue
        status = row[26].strip() if len(row) > 26 else ""
        q_status = row[27].strip() if len(row) > 27 else ""
        # 保留"有效"和"已完成"的答卷
        if status in ("已完成",) or q_status in ("有效", "正式回收"):
            valid_rows.append(row)
        else:
            skipped += 1

    print(f"有效数据: {len(valid_rows)} 条, 跳过: {skipped} 条")

    # 处理每条数据
    respondents = []
    all_segments = []
    global_seg_id = 0

    for row_idx, row in enumerate(valid_rows):
        speaker_id = f"P{row_idx + 1:04d}"

        # 用户 ID
        user_id = row[16].strip() if len(row) > 16 else ""

        # 提取 profile
        profile = extract_profile(row)

        # 提取 gaming_background
        gaming_background = extract_gaming_background(row, header)

        # 创建 respondent
        respondent = {
            "speaker_id": speaker_id,
            "source_file": SOURCE_NAME,
            "display_name": user_id,
            "group_code": "",
            "profile": profile,
            "gaming_background": gaming_background,
            "background": {
                "user_id": user_id,
                "province": row[4].strip() if len(row) > 4 else "",
                "city": row[5].strip() if len(row) > 5 else "",
                "start_time": row[11].strip() if len(row) > 11 else "",
                "end_time": row[12].strip() if len(row) > 12 else "",
                "duration_seconds": row[13].strip() if len(row) > 13 else "",
                "platform": row[14].strip() if len(row) > 14 else "",
                "language": row[15].strip() if len(row) > 15 else "",
                "device_info": row[8].strip() if len(row) > 8 else "",
                "os_type": row[10].strip() if len(row) > 10 else "",
            },
        }
        respondents.append(respondent)

        # 创建 segments
        row_segments = create_segments(row, header, row_idx)
        for seg in row_segments:
            global_seg_id += 1
            seg["segment_id"] = global_seg_id
            seg["segment_index"] = global_seg_id
            seg["speaker_id"] = speaker_id
        all_segments.extend(row_segments)

    # 构建输出 JSON
    output = {
        "meta": {
            "version": "v2.2",
            "processing_date": str(date.today()),
            "source_file": SOURCE_NAME,
            "source_type": "问卷调研（Survey）",
            "participant_count": len(respondents),
            "segment_count": len(all_segments),
            "processing_notes": [
                "§6.4 记录表（xlsx）提取规范 — 行=受访者、列=问题的转置回答矩阵",
                "§6.7 默认规则：preceding_question = 直接触发该回答的问题文本",
                "复选框类问题（Q3-Q7, Q22-Q27）：每个选中项 = 1 条 Segment",
                "开放文本（__open）：preceding_question = 问题文本 + 选项，original_text = 用户输入",
                "过滤条件：仅保留答题状态为'已完成'+问卷状态为'有效/正式回收'的答卷",
                "profile 从 Q29(年龄) Q30(职业) Q31(性别) 及元数据列(省份/城市) 提取",
                "gaming_background 从 Q1(是否玩过) Q2(时长) Q3(游戏列表) Q8-Q12 提取",
            ],
        },
        "respondents": respondents,
        "segments": all_segments,
    }

    # 写入 JSON
    print(f"写入输出: {OUTPUT_FILE}")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # 统计
    print(f"\n=== 提取结果 ===")
    print(f"受访者数: {len(respondents)}")
    print(f"Segment 数: {len(all_segments)}")
    print(f"输出文件: {OUTPUT_FILE}")

    # 文件大小
    file_size = os.path.getsize(OUTPUT_FILE)
    print(f"文件大小: {file_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()