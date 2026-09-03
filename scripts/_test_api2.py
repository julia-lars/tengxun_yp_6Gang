#!/usr/bin/env python3
"""Test API with/without thinking param"""
import os, json, requests

# Find .env
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
key = os.getenv('DEEPSEEK_API_KEYS', '').split(',')[0].strip()
headers = {'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'}

# Test 1: WITHOUT thinking
payload1 = {
    'model': MODEL, 'max_tokens': 100, 'temperature': 0.0,
    'messages': [{'role': 'user', 'content': 'Say hello'}],
}
try:
    resp = requests.post(API_URL, json=payload1, headers=headers, timeout=(10, 30))
    print(f'Without thinking: Status={resp.status_code}')
except Exception as e:
    print(f'Without thinking: Error={type(e).__name__}: {e}')

# Test 2: WITH thinking
payload2 = {
    'model': MODEL, 'max_tokens': 100, 'temperature': 0.0,
    'thinking': {'type': 'disabled'},
    'messages': [{'role': 'user', 'content': 'Say hello'}],
}
try:
    resp = requests.post(API_URL, json=payload2, headers=headers, timeout=(10, 30))
    print(f'With thinking: Status={resp.status_code}')
except Exception as e:
    print(f'With thinking: Error={type(e).__name__}: {e}')