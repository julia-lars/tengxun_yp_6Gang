#!/usr/bin/env python3
import os, subprocess, sys

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'apps', 'api', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

keys = [k.strip() for k in os.getenv('DEEPSEEK_API_KEYS', '').split(',') if k.strip()]
print(f'Keys: {len(keys)}')
if keys:
    import requests
    key = keys[0]
    url = "https://tokenhub.tencentmaas.com/plan/anthropic/v1/messages"
    headers = {'Content-Type': 'application/json', 'x-api-key': key}
    payload = {'model': 'deepseek-v4-flash', 'max_tokens': 10, 'messages': [{'role': 'user', 'content': 'Hi'}]}
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=(10, 30))
        print(f'Status: {resp.status_code}')
        print(f'Body: {resp.text[:200]}')
    except Exception as e:
        print(f'Error: {type(e).__name__}: {e}')