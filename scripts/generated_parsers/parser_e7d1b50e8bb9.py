#!/usr/bin/env python3
# Auto-generated parser for XML/HTML format
# Generated at: 2026-09-03T17:51:55.202188
# Hash: e7d1b50e8bb9

import re
import xml.etree.ElementTree as ET

def parse(filepath, source_file):
    """Parse XML/HTML file and extract text segments."""
    respondents = []
    segments = []
    seen_speakers = {}

    with open(filepath, encoding="utf-8") as f:
        content = f.read()

    # Try to parse as XML
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        # Try HTML-style extraction: extract text from tags
        text = re.sub(r"<[^>]+>", " ", content)
        text = re.sub(r"\s+", " ", text).strip()
        # Split by paragraphs
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
        if not paragraphs:
            paragraphs = [text]

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

    # Extract text from all elements
    speaker_pattern = re.compile(r"^([A-Za-z0-9_\u4e00-\u9fff]{1,20})[\uff1a:]")

    def extract_text(elem, depth=0):
        texts = []
        # Check element text
        if elem.text and elem.text.strip():
            t = elem.text.strip()
            m = speaker_pattern.match(t)
            if m:
                speaker = m.group(1)
                text_content = t[m.end():].strip()
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
                    "preceding_question": "",
                    "original_text": text_content if text_content else t,
                    "source_file": source_file
                })
            elif len(t) >= 5:
                texts.append(t)

        for child in elem:
            extract_text(child, depth + 1)

        if elem.tail and elem.tail.strip():
            t = elem.tail.strip()
            if len(t) >= 5:
                texts.append(t)

        return texts

    extract_text(root)

    return respondents, segments
