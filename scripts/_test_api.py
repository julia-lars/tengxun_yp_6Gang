#!/usr/bin/env python3
"""Quick API test for label_all_v3.py"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from label_all_v3 import load_env, get_api_key, get_session, API_URL, MODEL
from label_demo_v3 import SYSTEM_PROMPT

load_env()

key = get_api_key()
session = get_session(key)

# Load a real cleaned file and get 10 segments
fp = os.path.join(os.path.dirname(__file__), '..', 'data', '群体画像v2.0_cleaned', 'Deadlock竞品研究', '座谈会笔录-G2_cleaned.json')
with open(fp) as f:
    doc = json.load(f)

segs = doc.get('segments', [])
kept = [s for s in segs if s.get('cleaning_status') == 'kept'][:5]

user_lines = []
for i, seg in enumerate(kept):
    user_lines.append(
        f'[{i}] segment_id={seg.get("segment_id")}\n'
        f'speaker_id={seg.get("speaker_id")}\n'
        f'cleaned_text={seg.get("cleaned_text", "")[:200]}'
    )
user_msg = '请标注以下片段：\n\n' + '\n\n'.join(user_lines)

print(f'System prompt length: {len(SYSTEM_PROMPT)}')
print(f'User message length: {len(user_msg)}')

payload = {
    'model': MODEL,
    'max_tokens': 20000,
    'temperature': 0.0,
    'thinking': {'type': 'disabled'},
    'messages': [
        {'role': 'system', 'content': SYSTEM_PROMPT},
        {'role': 'user', 'content': user_msg},
    ],
}

try:
    resp = session.post(API_URL, json=payload, timeout=(10, 120))
    print(f'Status: {resp.status_code}')
    print(f'Body length: {len(resp.text)}')
    print(f'Body preview: {resp.text[:500]}')
except Exception as e:
    print(f'Error: {type(e).__name__}: {e}')