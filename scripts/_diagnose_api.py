#!/usr/bin/env python3
"""Diagnose API connectivity issues"""
import os, json, requests, sys, time

# Load env
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'api', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

API_URL = "https://tokenhub.tencentmaas.com/plan/anthropic/v1/messages"
MODEL = "deepseek-v4-flash"
keys = [k.strip() for k in os.getenv('DEEPSEEK_API_KEYS', '').split(',') if k.strip()]

print(f"Keys: {len(keys)}")
print(f"URL: {API_URL}")

# Test 1: Simple request
print("\n--- Test 1: Simple request ---")
for i, key in enumerate(keys[:1]):
    headers = {'Content-Type': 'application/json', 'x-api-key': key}
    payload = {'model': MODEL, 'max_tokens': 50, 'messages': [{'role': 'user', 'content': 'Hi'}]}
    try:
        resp = requests.post(API_URL, json=payload, headers=headers, timeout=(10, 30))
        print(f"  Key {i}: status={resp.status_code}, len={len(resp.text)}")
    except Exception as e:
        print(f"  Key {i}: {type(e).__name__}: {e}")

# Test 2: With system prompt
print("\n--- Test 2: With system prompt ---")
SYSTEM_PROMPT = "You are a helpful assistant. Label the user's text."
for i, key in enumerate(keys[:1]):
    headers = {'Content-Type': 'application/json', 'x-api-key': key}
    payload = {
        'model': MODEL, 'max_tokens': 100, 'temperature': 0.0,
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': 'Label: I like playing games.'},
        ],
    }
    try:
        resp = requests.post(API_URL, json=payload, headers=headers, timeout=(10, 30))
        print(f"  Key {i}: status={resp.status_code}, len={len(resp.text)}")
    except Exception as e:
        print(f"  Key {i}: {type(e).__name__}: {e}")

# Test 3: With thinking disabled
print("\n--- Test 3: With thinking=disabled ---")
for i, key in enumerate(keys[:1]):
    headers = {'Content-Type': 'application/json', 'x-api-key': key}
    payload = {
        'model': MODEL, 'max_tokens': 100, 'temperature': 0.0,
        'thinking': {'type': 'disabled'},
        'messages': [{'role': 'user', 'content': 'Hi'}],
    }
    try:
        resp = requests.post(API_URL, json=payload, headers=headers, timeout=(10, 30))
        print(f"  Key {i}: status={resp.status_code}, len={len(resp.text)}")
    except Exception as e:
        print(f"  Key {i}: {type(e).__name__}: {e}")

# Test 4: Concurrent requests
print("\n--- Test 4: 5 concurrent requests ---")
from concurrent.futures import ThreadPoolExecutor, as_completed

def make_request(idx):
    key = keys[idx % len(keys)]
    headers = {'Content-Type': 'application/json', 'x-api-key': key}
    payload = {
        'model': MODEL, 'max_tokens': 100, 'temperature': 0.0,
        'thinking': {'type': 'disabled'},
        'messages': [{'role': 'user', 'content': f'Request {idx}: Say hi'}],
    }
    try:
        resp = requests.post(API_URL, json=payload, headers=headers, timeout=(10, 30))
        return idx, resp.status_code, len(resp.text)
    except Exception as e:
        return idx, type(e).__name__, str(e)[:100]

with ThreadPoolExecutor(max_workers=5) as ex:
    futures = [ex.submit(make_request, i) for i in range(5)]
    for f in as_completed(futures):
        idx, status, detail = f.result()
        print(f"  Req {idx}: {status} - {detail}")

print("\nDone.")