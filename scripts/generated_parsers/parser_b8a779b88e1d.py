#!/usr/bin/env python3
# Auto-generated parser for TSV format
# Generated at: 2026-09-03T17:50:59.001542
# Hash: b8a779b88e1d
# Columns: text=1, speaker=0, question=2

import csv

def parse(filepath, source_file):
    """Parse TSV file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {}

    with open(filepath, encoding="utf-8") as f:
        reader = csv.reader(f, delimiter="	")
        header = next(reader, None)

        for row in reader:
            if len(row) <= max(1, 0):
                continue

            text = row[1].strip() if 1 < len(row) else ""
            speaker = row[0].strip() if 0 < len(row) else "S001"
            question = row[2].strip() if 2 < len(row) else ""

            if not text:
                continue

            if speaker not in seen_speakers:
                sid = f"P{len(seen_speakers)+1:03d}"
                seen_speakers[speaker] = sid
                respondents.append({
                    "speaker_id": sid,
                    "source_file": source_file,
                    "display_name": speaker,
                    "group_code": "",
                    "profile": {
                        "name": speaker,
                        "age": None,
                        "gender": "",
                        "occupation": "",
                        "education": ""
                    },
                    "gaming_background": {
                        "current_games": [],
                        "platform": [],
                        "experience_years": None,
                        "genre_experience": []
                    },
                    "background": {}
                })

            segments.append({
                "speaker_id": seen_speakers[speaker],
                "speaker_role": "interviewee",
                "preceding_question": question,
                "original_text": text,
                "source_file": source_file
            })

    return respondents, segments
