#!/usr/bin/env python3
# Auto-generated parser for Plain Text format (fallback)
# Generated at: 2026-09-03T17:58:28.851572
# Hash: 561bef84944d

import re

def parse(filepath, source_file):
    """Parse plain text file and extract segments."""
    respondents = []
    segments = []

    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    # Try speaker pattern first
    speaker_pattern = re.compile(r"^([A-Za-z0-9_\u4e00-\u9fff]{1,20})[\uff1a:]\s*(.+)")
    seen_speakers = {}
    has_speakers = False

    for line in content.split("\n"):
        line = line.strip()
        if speaker_pattern.match(line):
            has_speakers = True
            break

    if has_speakers:
        # Use speaker-pattern extraction
        current_speaker = None
        current_text = []

        def flush():
            nonlocal current_speaker, current_text
            if current_speaker and current_text:
                text = " ".join(current_text).strip()
                if text:
                    segments.append({
                        "speaker_id": seen_speakers.get(current_speaker, "S001"),
                        "speaker_role": "interviewee",
                        "preceding_question": "",
                        "original_text": text,
                        "source_file": source_file
                    })
            current_text = []

        for line in content.split("\n"):
            line = line.rstrip()
            stripped = line.strip()
            if not stripped:
                flush()
                continue
            m = speaker_pattern.match(stripped)
            if m:
                flush()
                speaker = m.group(1)
                text = m.group(2).strip()
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
                current_speaker = speaker
                if text:
                    current_text.append(text)
            elif current_speaker:
                current_text.append(stripped)
        flush()
    else:
        # Single speaker: split by double-newline paragraphs
        sid = "S001"
        respondents.append({
            "speaker_id": sid,
            "source_file": source_file,
            "display_name": "Unknown",
            "group_code": "",
            "profile": {
                "name": "Unknown",
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

        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [content.strip()]

        for para in paragraphs:
            if len(para) >= 5:
                segments.append({
                    "speaker_id": sid,
                    "speaker_role": "interviewee",
                    "preceding_question": "",
                    "original_text": para,
                    "source_file": source_file
                })

    return respondents, segments
