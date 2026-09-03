#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto-generate extraction parser for unknown file formats.

Analyzes a file's structure and generates a reusable parser function.
The generated parser follows the standard interface:
    def parse(filepath, source_file) -> tuple[list[dict], list[dict]]

Usage:
  python3 scripts/generate_parser.py <filepath>
  python3 scripts/generate_parser.py <filepath> --output-dir scripts/generated_parsers
  python3 scripts/generate_parser.py <filepath> --force   # overwrite existing parser

Output (stdout): JSON with parser info
  {"status": "generated", "parser_path": "...", "format_type": "tsv", "hash": "...", "message": "..."}
"""

import argparse
import csv
import hashlib
import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "generated_parsers"

# ── Encoding detection ──
ENCODINGS = ["utf-8", "gbk", "gb2312", "gb18030", "latin-1", "utf-16", "cp1252"]


def read_file_sample(filepath, max_lines=100):
    """Try multiple encodings and return (lines, encoding) for the first N lines."""
    for enc in ENCODINGS:
        try:
            with open(filepath, encoding=enc) as f:
                lines = []
                for i, line in enumerate(f):
                    if i >= max_lines:
                        break
                    lines.append(line.rstrip("\n\r"))
                if lines:
                    return lines, enc
        except (UnicodeDecodeError, UnicodeError):
            continue
    # All encodings failed — try binary read
    try:
        with open(filepath, "rb") as f:
            raw = f.read(4096)
        # Try to decode as latin-1 (never fails)
        return raw.decode("latin-1", errors="replace").split("\n")[:max_lines], "latin-1"
    except Exception:
        return [], "unknown"


# ── Structure detection ──


def detect_json(lines, encoding):
    """Detect if the file is JSON or JSONL."""
    content = "\n".join(lines[:50])
    stripped = content.strip()
    if not stripped:
        return None

    # Try JSON array or object
    try:
        json.loads(stripped)
        # Determine if it's an array of objects or a single object
        if stripped.startswith("[") and len(lines) > 1:
            return "json_array"
        return "json_object"
    except (json.JSONDecodeError, ValueError):
        pass

    # Try JSONL (each line is a JSON object)
    jsonl_count = 0
    for line in lines[:20]:
        line = line.strip()
        if not line:
            continue
        try:
            json.loads(line)
            jsonl_count += 1
        except (json.JSONDecodeError, ValueError):
            pass
    if jsonl_count >= max(2, len(lines[:20]) * 0.5):
        return "jsonl"

    return None


def detect_xml(lines, encoding):
    """Detect if the file is XML/HTML."""
    content = "\n".join(lines[:5]).strip()
    if content.startswith("<?xml") or content.startswith("<!DOCTYPE"):
        return "xml"
    if content.lower().startswith("<html"):
        return "html"
    # Check for XML/HTML tags in first 20 lines
    tag_count = 0
    for line in lines[:20]:
        if re.search(r"</?\w+[^>]*>", line):
            tag_count += 1
    if tag_count >= 3:
        return "xml"
    return None


def detect_delimiter(lines, encoding):
    """Detect delimiter-separated format (TSV, PSV, semicolon-CSV)."""
    if len(lines) < 2:
        return None

    candidates = [
        ("\t", "tsv"),
        ("|", "psv"),
        (";", "csv_semicolon"),
    ]

    for delim, name in candidates:
        counts = []
        for line in lines[:20]:
            if not line.strip():
                continue
            counts.append(len(line.split(delim)))
        if len(counts) >= 2 and len(set(counts)) == 1 and counts[0] >= 2:
            return name, delim, counts[0]

    return None


def detect_key_value(lines, encoding):
    """Detect key-value pair format."""
    kv_pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_ ]{0,40})[=:]\s*(.+)")
    matches = 0
    total = 0
    for line in lines[:30]:
        line = line.strip()
        if not line:
            continue
        total += 1
        if kv_pattern.match(line):
            matches += 1
    if total >= 5 and matches / total >= 0.7:
        return "key_value"
    return None


def detect_speaker_text(lines, encoding):
    """Detect speaker-pattern text format."""
    pattern = re.compile(r"^([A-Za-z0-9_一-鿿]{1,20})[：:]\s*(.+)")
    matches = 0
    total = 0
    for line in lines[:50]:
        line = line.strip()
        if not line:
            continue
        total += 1
        if pattern.match(line):
            matches += 1
    if total >= 5 and matches / total >= 0.3:
        return "speaker_text"
    return None


def detect_columns(lines, delim):
    """Detect which columns are text/speaker/question in a delimiter-separated file."""
    if len(lines) < 2:
        return {"text_col": 0, "speaker_col": 1, "question_col": None}

    # Check if first row is a header
    first = lines[0].split(delim)
    header_keywords = {
        "text": {"text", "content", "message", "body", "utterance", "response", "answer",
                 "文本", "内容", "消息", "回答", "发言", "对话", "原话"},
        "speaker": {"speaker", "name", "user", "author", "role", "person",
                    "说话人", "姓名", "用户", "发言人", "角色", "受访者", "主持人"},
        "question": {"question", "topic", "subject", "prompt", "query",
                     "问题", "主题", "提问", "话题", "前置问题"},
    }

    header_lower = [h.strip().lower() for h in first]
    result = {"text_col": 0, "speaker_col": None, "question_col": None}

    # Try keyword matching on headers
    for i, h in enumerate(header_lower):
        for cat, keywords in header_keywords.items():
            if any(kw in h for kw in keywords):
                if cat == "text":
                    result["text_col"] = i
                elif cat == "speaker":
                    result["speaker_col"] = i
                elif cat == "question":
                    result["question_col"] = i

    # If speaker_col not found by header, try positional heuristics
    if result["speaker_col"] is None:
        # Sample data rows (skip header)
        data_rows = [l.split(delim) for l in lines[1:11] if l.strip()]
        if data_rows and len(first) >= 2:
            # Speaker column is usually the one with fewest unique values
            col_uniques = []
            for ci in range(len(first)):
                vals = set()
                for row in data_rows:
                    if ci < len(row):
                        vals.add(row[ci].strip())
                col_uniques.append((len(vals), ci))
            col_uniques.sort()
            # Pick column with fewest unique values (but > 0) as speaker
            for count, ci in col_uniques:
                if count > 0 and ci != result["text_col"]:
                    result["speaker_col"] = ci
                    break

    # If text_col is the same as speaker_col, pick the widest column
    if result["speaker_col"] == result["text_col"]:
        data_rows = [l.split(delim) for l in lines[1:11] if l.strip()]
        max_avg_len = 0
        best_col = 0
        for ci in range(len(first)):
            total_len = 0
            count = 0
            for row in data_rows:
                if ci < len(row):
                    total_len += len(row[ci].strip())
                    count += 1
            avg_len = total_len / max(count, 1)
            if avg_len > max_avg_len:
                max_avg_len = avg_len
                best_col = ci
        result["text_col"] = best_col

    # If no speaker col found, default to column 1
    if result["speaker_col"] is None:
        result["speaker_col"] = 1 if len(first) > 1 else 0

    return result


# ── Parser code generation ──

RESPONDENT_TEMPLATE = '''            if speaker not in seen_speakers:
                sid = f"P{{len(seen_speakers)+1:03d}}"
                seen_speakers[speaker] = sid
                respondents.append({{
                    "speaker_id": sid,
                    "source_file": source_file,
                    "display_name": speaker,
                    "group_code": "",
                    "profile": {{
                        "name": speaker,
                        "age": None,
                        "gender": "",
                        "occupation": "",
                        "education": ""
                    }},
                    "gaming_background": {{
                        "current_games": [],
                        "platform": [],
                        "experience_years": None,
                        "genre_experience": []
                    }},
                    "background": {{}}
                }})'''


def _fix_braces(code):
    """Replace literal double braces with single braces in generated code."""
    return code.replace("{{", "{").replace("}}", "}")


def generate_tsv_parser(columns, delim, has_header, encoding, hash_id):
    """Generate parser for tab-separated files."""
    text_col = columns["text_col"]
    speaker_col = columns["speaker_col"]
    question_col = columns["question_col"]
    skip_header = "header = next(reader, None)" if has_header else "# no header"
    if question_col is not None:
        q_line = f'question = row[{question_col}].strip() if {question_col} < len(row) else ""'
    else:
        q_line = 'question = ""'

    code = f'''#!/usr/bin/env python3
# Auto-generated parser for TSV format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}
# Columns: text={text_col}, speaker={speaker_col}, question={question_col}

import csv

def parse(filepath, source_file):
    """Parse TSV file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    with open(filepath, encoding="{encoding}") as f:
        reader = csv.reader(f, delimiter="{delim}")
        {skip_header}

        for row in reader:
            if len(row) <= max({text_col}, {speaker_col}):
                continue

            text = row[{text_col}].strip() if {text_col} < len(row) else ""
            speaker = row[{speaker_col}].strip() if {speaker_col} < len(row) else "S001"
            {q_line}

            if not text:
                continue

{RESPONDENT_TEMPLATE}

            segments.append({{
                "speaker_id": seen_speakers[speaker],
                "speaker_role": "interviewee",
                "preceding_question": question,
                "original_text": text,
                "source_file": source_file
            }})

    return respondents, segments
'''
    return _fix_braces(code)


def generate_psv_parser(columns, delim, has_header, encoding, hash_id):
    """Generate parser for pipe-separated files."""
    text_col = columns["text_col"]
    speaker_col = columns["speaker_col"]
    question_col = columns["question_col"]
    skip_header = "# skip header\n        next(reader, None)" if has_header else "# no header"
    if question_col is not None:
        q_line = f'question = row[{question_col}].strip() if {question_col} < len(row) else ""'
    else:
        q_line = 'question = ""'

    code = f'''#!/usr/bin/env python3
# Auto-generated parser for Pipe-Separated format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}
# Columns: text={text_col}, speaker={speaker_col}, question={question_col}

import csv

def parse(filepath, source_file):
    """Parse pipe-separated file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    with open(filepath, encoding="{encoding}") as f:
        reader = csv.reader(f, delimiter="|")
        {skip_header}

        for row in reader:
            if len(row) <= max({text_col}, {speaker_col}):
                continue

            text = row[{text_col}].strip() if {text_col} < len(row) else ""
            speaker = row[{speaker_col}].strip() if {speaker_col} < len(row) else "S001"
            {q_line}

            if not text:
                continue

{RESPONDENT_TEMPLATE}

            segments.append({{
                "speaker_id": seen_speakers[speaker],
                "speaker_role": "interviewee",
                "preceding_question": question,
                "original_text": text,
                "source_file": source_file
            }})

    return respondents, segments
'''
    return _fix_braces(code)


def generate_csv_semicolon_parser(columns, delim, has_header, encoding, hash_id):
    """Generate parser for semicolon-separated CSV files."""
    text_col = columns["text_col"]
    speaker_col = columns["speaker_col"]
    question_col = columns["question_col"]
    skip_header = "header = next(reader, None)" if has_header else "# no header"
    if question_col is not None:
        q_line = f'question = row[{question_col}].strip() if {question_col} < len(row) else ""'
    else:
        q_line = 'question = ""'

    code = f'''#!/usr/bin/env python3
# Auto-generated parser for Semicolon-CSV format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}
# Columns: text={text_col}, speaker={speaker_col}, question={question_col}

import csv

def parse(filepath, source_file):
    """Parse semicolon-separated CSV file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    with open(filepath, encoding="{encoding}") as f:
        reader = csv.reader(f, delimiter=";")
        {skip_header}

        for row in reader:
            if len(row) <= max({text_col}, {speaker_col}):
                continue

            text = row[{text_col}].strip() if {text_col} < len(row) else ""
            speaker = row[{speaker_col}].strip() if {speaker_col} < len(row) else "S001"
            {q_line}

            if not text:
                continue

{RESPONDENT_TEMPLATE}

            segments.append({{
                "speaker_id": seen_speakers[speaker],
                "speaker_role": "interviewee",
                "preceding_question": question,
                "original_text": text,
                "source_file": source_file
            }})

    return respondents, segments
'''
    return _fix_braces(code)


def generate_xml_parser(encoding, hash_id):
    """Generate parser for XML/HTML files."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for XML/HTML format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import re
import xml.etree.ElementTree as ET

def parse(filepath, source_file):
    """Parse XML/HTML file and extract text segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    with open(filepath, encoding="{encoding}") as f:
        content = f.read()

    # Try to parse as XML
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        # Try HTML-style extraction: extract text from tags
        text = re.sub(r"<[^>]+>", " ", content)
        text = re.sub(r"\\s+", " ", text).strip()
        # Split by paragraphs
        paragraphs = [p.strip() for p in text.split("\\n\\n") if p.strip()]
        if not paragraphs:
            paragraphs = [text]

        sid = "S001"
        respondents.append({{
            "speaker_id": sid,
            "source_file": source_file,
            "display_name": "Unknown",
            "group_code": "",
            "profile": {{
                "name": "Unknown",
                "age": None,
                "gender": "",
                "occupation": "",
                "education": ""
            }},
            "gaming_background": {{
                "current_games": [],
                "platform": [],
                "experience_years": None,
                "genre_experience": []
            }},
            "background": {{}}
        }})

        for para in paragraphs:
            if len(para) >= 5:
                segments.append({{
                    "speaker_id": sid,
                    "speaker_role": "interviewee",
                    "preceding_question": "",
                    "original_text": para,
                    "source_file": source_file
                }})

        return respondents, segments

    # Extract text from all elements
    speaker_pattern = re.compile(r"^([A-Za-z0-9_\\u4e00-\\u9fff]{{1,20}})[\\uff1a:]")

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
                    sid = f"P{{len(seen_speakers)+1:03d}}"
                    seen_speakers[speaker] = sid
                    respondents.append({{
                        "speaker_id": sid,
                        "source_file": source_file,
                        "display_name": speaker,
                        "group_code": "",
                        "profile": {{
                            "name": speaker,
                            "age": None,
                            "gender": "",
                            "occupation": "",
                            "education": ""
                        }},
                        "gaming_background": {{
                            "current_games": [],
                            "platform": [],
                            "experience_years": None,
                            "genre_experience": []
                        }},
                        "background": {{}}
                    }})
                segments.append({{
                    "speaker_id": seen_speakers[speaker],
                    "speaker_role": "interviewee",
                    "preceding_question": "",
                    "original_text": text_content if text_content else t,
                    "source_file": source_file
                }})
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
'''
    return _fix_braces(code)


def generate_jsonl_parser(encoding, hash_id):
    """Generate parser for JSONL files."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for JSONL format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import json

def parse(filepath, source_file):
    """Parse JSONL file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    # Text field candidates (in priority order)
    text_fields = ["text", "content", "message", "body", "utterance", "response",
                   "answer", "原始文本", "内容", "发言", "cleaned_text", "original_text"]
    speaker_fields = ["speaker", "name", "user", "author", "role", "说话人",
                      "姓名", "speaker_id", "display_name"]
    question_fields = ["question", "topic", "subject", "prompt", "preceding_question",
                       "问题", "主题", "提问"]

    def find_field(obj, candidates):
        for f in candidates:
            if f in obj:
                return obj[f]
        return None

    with open(filepath, encoding="{encoding}") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            if not isinstance(obj, dict):
                continue

            text = find_field(obj, text_fields)
            if not text or not str(text).strip():
                continue
            text = str(text).strip()

            speaker = find_field(obj, speaker_fields)
            speaker = str(speaker).strip() if speaker else "S001"

            question = find_field(obj, question_fields)
            question = str(question).strip() if question else ""

            if speaker not in seen_speakers:
                sid = f"P{{len(seen_speakers)+1:03d}}"
                seen_speakers[speaker] = sid
                respondents.append({{
                    "speaker_id": sid,
                    "source_file": source_file,
                    "display_name": speaker,
                    "group_code": "",
                    "profile": {{
                        "name": speaker,
                        "age": None,
                        "gender": "",
                        "occupation": "",
                        "education": ""
                    }},
                    "gaming_background": {{
                        "current_games": [],
                        "platform": [],
                        "experience_years": None,
                        "genre_experience": []
                    }},
                    "background": {{}}
                }})

            segments.append({{
                "speaker_id": seen_speakers[speaker],
                "speaker_role": "interviewee",
                "preceding_question": question,
                "original_text": text,
                "source_file": source_file
            }})

    return respondents, segments
'''
    return _fix_braces(code)


def generate_json_array_parser(encoding, hash_id):
    """Generate parser for JSON array of objects."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for JSON array format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import json

def parse(filepath, source_file):
    """Parse JSON array file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    text_fields = ["text", "content", "message", "body", "utterance", "response",
                   "answer", "原始文本", "内容", "发言", "cleaned_text", "original_text"]
    speaker_fields = ["speaker", "name", "user", "author", "role", "说话人",
                      "姓名", "speaker_id", "display_name"]
    question_fields = ["question", "topic", "subject", "preceding_question",
                       "问题", "主题", "提问"]

    def find_field(obj, candidates):
        for f in candidates:
            if f in obj:
                return obj[f]
        return None

    with open(filepath, encoding="{encoding}") as f:
        data = json.load(f)

    items = data if isinstance(data, list) else [data]

    for obj in items:
        if not isinstance(obj, dict):
            continue

        text = find_field(obj, text_fields)
        if not text or not str(text).strip():
            continue
        text = str(text).strip()

        speaker = find_field(obj, speaker_fields)
        speaker = str(speaker).strip() if speaker else "S001"

        question = find_field(obj, question_fields)
        question = str(question).strip() if question else ""

        if speaker not in seen_speakers:
            sid = f"P{{len(seen_speakers)+1:03d}}"
            seen_speakers[speaker] = sid
            respondents.append({{
                "speaker_id": sid,
                "source_file": source_file,
                "display_name": speaker,
                "group_code": "",
                "profile": {{
                    "name": speaker,
                    "age": None,
                    "gender": "",
                    "occupation": "",
                    "education": ""
                }},
                "gaming_background": {{
                    "current_games": [],
                    "platform": [],
                    "experience_years": None,
                    "genre_experience": []
                }},
                "background": {{}}
            }})

        segments.append({{
            "speaker_id": seen_speakers[speaker],
            "speaker_role": "interviewee",
            "preceding_question": question,
            "original_text": text,
            "source_file": source_file
        }})

    return respondents, segments
'''


def generate_json_object_parser(encoding, hash_id):
    """Generate parser for single JSON object."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for JSON object format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import json

def parse(filepath, source_file):
    """Parse JSON object file and extract segments."""
    respondents = []
    segments = []

    with open(filepath, encoding="{encoding}") as f:
        data = json.load(f)

    # Extract all string values from the JSON object
    texts = []

    def extract_strings(obj, prefix=""):
        if isinstance(obj, str) and len(obj.strip()) >= 5:
            texts.append(("S001", prefix, obj.strip()))
        elif isinstance(obj, dict):
            for key, val in obj.items():
                if isinstance(val, str) and len(val.strip()) >= 5:
                    texts.append(("S001", str(key), val.strip()))
                elif isinstance(val, (dict, list)):
                    extract_strings(val, str(key))
        elif isinstance(obj, list):
            for item in obj:
                extract_strings(item, prefix)

    extract_strings(data)

    if texts:
        sid = "S001"
        respondents.append({{
            "speaker_id": sid,
            "source_file": source_file,
            "display_name": "Unknown",
            "group_code": "",
            "profile": {{
                "name": "Unknown",
                "age": None,
                "gender": "",
                "occupation": "",
                "education": ""
            }},
            "gaming_background": {{
                "current_games": [],
                "platform": [],
                "experience_years": None,
                "genre_experience": []
            }},
            "background": {{}}
        }})

        for speaker, question, text in texts:
            segments.append({{
                "speaker_id": speaker,
                "speaker_role": "interviewee",
                "preceding_question": question,
                "original_text": text,
                "source_file": source_file
            }})

    return respondents, segments
'''
    return _fix_braces(code)


def generate_key_value_parser(encoding, hash_id):
    """Generate parser for key-value pair files."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for Key-Value format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import re

def parse(filepath, source_file):
    """Parse key-value file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    kv_pattern = re.compile(r"^([A-Za-z_][A-Za-z0-9_ ]{{0,40}})[=:]\\s*(.+)")

    with open(filepath, encoding="{encoding}") as f:
        current_speaker = "S001"

        for line in f:
            line = line.strip()
            if not line:
                continue

            m = kv_pattern.match(line)
            if m:
                key = m.group(1).strip()
                value = m.group(2).strip()

                if not value:
                    continue

                if key not in seen_speakers:
                    sid = f"P{{len(seen_speakers)+1:03d}}"
                    seen_speakers[key] = sid
                    respondents.append({{
                        "speaker_id": sid,
                        "source_file": source_file,
                        "display_name": key,
                        "group_code": "",
                        "profile": {{
                            "name": key,
                            "age": None,
                            "gender": "",
                            "occupation": "",
                            "education": ""
                        }},
                        "gaming_background": {{
                            "current_games": [],
                            "platform": [],
                            "experience_years": None,
                            "genre_experience": []
                        }},
                        "background": {{}}
                    }})

                segments.append({{
                    "speaker_id": seen_speakers[key],
                    "speaker_role": "interviewee",
                    "preceding_question": key,
                    "original_text": value,
                    "source_file": source_file
                }})

    return respondents, segments
'''


def generate_speaker_text_parser(encoding, hash_id):
    """Generate parser for speaker-pattern text files."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for Speaker-Text format
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import re

def parse(filepath, source_file):
    """Parse speaker-pattern text file and extract segments."""
    respondents = []
    segments = []
    seen_speakers = {{}}

    speaker_pattern = re.compile(r"^([A-Za-z0-9_\\u4e00-\\u9fff]{{1,20}})[\\uff1a:]\\s*(.+)")

    with open(filepath, encoding="{encoding}") as f:
        current_speaker = None
        current_text = []

        def flush():
            nonlocal current_speaker, current_text
            if current_speaker and current_text:
                text = " ".join(current_text).strip()
                if text:
                    segments.append({{
                        "speaker_id": seen_speakers.get(current_speaker, "S001"),
                        "speaker_role": "interviewee",
                        "preceding_question": "",
                        "original_text": text,
                        "source_file": source_file
                    }})
            current_text = []

        for line in f:
            line = line.rstrip("\\n\\r")
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
                    sid = f"P{{len(seen_speakers)+1:03d}}"
                    seen_speakers[speaker] = sid
                    respondents.append({{
                        "speaker_id": sid,
                        "source_file": source_file,
                        "display_name": speaker,
                        "group_code": "",
                        "profile": {{
                            "name": speaker,
                            "age": None,
                            "gender": "",
                            "occupation": "",
                            "education": ""
                        }},
                        "gaming_background": {{
                            "current_games": [],
                            "platform": [],
                            "experience_years": None,
                            "genre_experience": []
                        }},
                        "background": {{}}
                    }})

                current_speaker = speaker
                if text:
                    current_text.append(text)
            else:
                # Continuation line
                if current_speaker:
                    current_text.append(stripped)

        flush()

    return respondents, segments
'''
    return _fix_braces(code)


def generate_plain_text_parser(encoding, hash_id):
    """Generate parser for plain text files (fallback)."""
    code = f'''#!/usr/bin/env python3
# Auto-generated parser for Plain Text format (fallback)
# Generated at: {__import__("datetime").datetime.now().isoformat()}
# Hash: {hash_id}

import re

def parse(filepath, source_file):
    """Parse plain text file and extract segments."""
    respondents = []
    segments = []

    with open(filepath, encoding="{encoding}") as f:
        content = f.read()

    # Try speaker pattern first
    speaker_pattern = re.compile(r"^([A-Za-z0-9_\\u4e00-\\u9fff]{{1,20}})[\\uff1a:]\\s*(.+)")
    seen_speakers = {{}}
    has_speakers = False

    for line in content.split("\\n"):
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
                    segments.append({{
                        "speaker_id": seen_speakers.get(current_speaker, "S001"),
                        "speaker_role": "interviewee",
                        "preceding_question": "",
                        "original_text": text,
                        "source_file": source_file
                    }})
            current_text = []

        for line in content.split("\\n"):
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
                    sid = f"P{{len(seen_speakers)+1:03d}}"
                    seen_speakers[speaker] = sid
                    respondents.append({{
                        "speaker_id": sid,
                        "source_file": source_file,
                        "display_name": speaker,
                        "group_code": "",
                        "profile": {{
                            "name": speaker,
                            "age": None,
                            "gender": "",
                            "occupation": "",
                            "education": ""
                        }},
                        "gaming_background": {{
                            "current_games": [],
                            "platform": [],
                            "experience_years": None,
                            "genre_experience": []
                        }},
                        "background": {{}}
                    }})
                current_speaker = speaker
                if text:
                    current_text.append(text)
            elif current_speaker:
                current_text.append(stripped)
        flush()
    else:
        # Single speaker: split by double-newline paragraphs
        sid = "S001"
        respondents.append({{
            "speaker_id": sid,
            "source_file": source_file,
            "display_name": "Unknown",
            "group_code": "",
            "profile": {{
                "name": "Unknown",
                "age": None,
                "gender": "",
                "occupation": "",
                "education": ""
            }},
            "gaming_background": {{
                "current_games": [],
                "platform": [],
                "experience_years": None,
                "genre_experience": []
            }},
            "background": {{}}
        }})

        paragraphs = [p.strip() for p in content.split("\\n\\n") if p.strip()]
        if not paragraphs:
            paragraphs = [content.strip()]

        for para in paragraphs:
            if len(para) >= 5:
                segments.append({{
                    "speaker_id": sid,
                    "speaker_role": "interviewee",
                    "preceding_question": "",
                    "original_text": para,
                    "source_file": source_file
                }})

    return respondents, segments
'''
    return _fix_braces(code)


# ── Parser code generation ──

GENERATORS = {
    "tsv": generate_tsv_parser,
    "psv": generate_psv_parser,
    "csv_semicolon": generate_csv_semicolon_parser,
    "xml": generate_xml_parser,
    "html": generate_xml_parser,
    "jsonl": generate_jsonl_parser,
    "json_array": generate_json_array_parser,
    "json_object": generate_json_object_parser,
    "key_value": generate_key_value_parser,
    "speaker_text": generate_speaker_text_parser,
    "plain_text": generate_plain_text_parser,
}


def compute_hash(structure_signature):
    """Compute a short hash from the structure signature."""
    return hashlib.md5(structure_signature.encode()).hexdigest()[:12]


def analyze_and_generate(filepath, output_dir, force=False):
    """Analyze a file and generate a parser for it."""
    if not os.path.exists(filepath):
        return {"status": "error", "message": f"File not found: {filepath}"}

    if os.path.getsize(filepath) == 0:
        return {"status": "error", "message": "Empty file"}

    # ── Step 1: Read file sample ──
    lines, encoding = read_file_sample(filepath)

    if not lines:
        return {"status": "error", "message": "Cannot read file (all encodings failed)"}

    # ── Step 2: Detect structure ──
    format_type = None
    extra_info = {}

    # Check JSON first
    json_type = detect_json(lines, encoding)
    if json_type:
        format_type = json_type
        extra_info["encoding"] = encoding

    # Check XML
    if not format_type:
        xml_type = detect_xml(lines, encoding)
        if xml_type:
            format_type = xml_type
            extra_info["encoding"] = encoding

    # Check delimiter
    if not format_type:
        delim_result = detect_delimiter(lines, encoding)
        if delim_result:
            format_type, delim, col_count = delim_result
            has_header = not any(
                c.isdigit() for c in lines[0].split(delim)[:3]
            ) if len(lines) > 0 else False
            columns = detect_columns(lines, delim)
            extra_info = {
                "delim": delim,
                "col_count": col_count,
                "has_header": has_header,
                "columns": columns,
                "encoding": encoding,
            }

    # Check key-value
    if not format_type:
        kv_type = detect_key_value(lines, encoding)
        if kv_type:
            format_type = kv_type
            extra_info["encoding"] = encoding

    # Check speaker text
    if not format_type:
        st_type = detect_speaker_text(lines, encoding)
        if st_type:
            format_type = st_type
            extra_info["encoding"] = encoding

    # Fallback to plain text
    if not format_type:
        format_type = "plain_text"
        extra_info["encoding"] = encoding

    # ── Step 3: Compute hash ──
    signature_parts = [format_type]
    if "delim" in extra_info:
        signature_parts.append(f"delim={extra_info['delim']}")
    if "col_count" in extra_info:
        signature_parts.append(f"cols={extra_info['col_count']}")
    if "has_header" in extra_info:
        signature_parts.append(f"header={extra_info['has_header']}")
    signature_parts.append(f"enc={encoding}")

    structure_hash = compute_hash("|".join(signature_parts))

    # ── Step 4: Check if parser already exists ──
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    parser_path = output_dir / f"parser_{structure_hash}.py"

    if parser_path.exists() and not force:
        return {
            "status": "cached",
            "parser_path": str(parser_path),
            "format_type": format_type,
            "hash": structure_hash,
            "message": f"Parser already exists for {format_type} format",
        }

    # ── Step 5: Generate parser code ──
    generator = GENERATORS.get(format_type)
    if not generator:
        return {"status": "error", "message": f"No generator for format: {format_type}"}

    if format_type in ("tsv", "psv", "csv_semicolon"):
        parser_code = generator(
            extra_info["columns"],
            extra_info["delim"],
            extra_info["has_header"],
            encoding,
            structure_hash,
        )
    elif format_type in ("jsonl", "json_array", "json_object"):
        parser_code = generator(encoding, structure_hash)
    else:
        parser_code = generator(encoding, structure_hash)

    # ── Step 6: Save parser ──
    try:
        with open(parser_path, "w", encoding="utf-8") as f:
            f.write(parser_code)
    except Exception as e:
        return {"status": "error", "message": f"Cannot write parser: {e}"}

    # ── Step 7: Return result ──
    msg_parts = [f"Generated {format_type} parser"]
    if "col_count" in extra_info:
        msg_parts.append(f"with {extra_info['col_count']} columns")
    if "delim" in extra_info:
        delim_name = {"\t": "tab", "|": "pipe", ";": "semicolon"}.get(extra_info["delim"], extra_info["delim"])
        msg_parts.append(f"({delim_name}-delimited)")

    return {
        "status": "generated",
        "parser_path": str(parser_path),
        "format_type": format_type,
        "hash": structure_hash,
        "encoding": encoding,
        "message": " ".join(msg_parts),
    }


def main():
    parser = argparse.ArgumentParser(description="Generate parser for unknown file format")
    parser.add_argument("filepath", help="Path to the file to analyze")
    parser.add_argument(
        "--output-dir",
        default=str(DEFAULT_OUTPUT_DIR),
        help=f"Output directory for generated parsers (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing parser if it already exists",
    )
    args = parser.parse_args()

    result = analyze_and_generate(args.filepath, args.output_dir, force=args.force)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()