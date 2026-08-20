"""Merge all 漫威争锋 outputs into 2 files: respondents + segments."""
import json, os, glob

indir = r'data\群体画像'
prefix = '漫威争锋中美用户洞察研究'

# ---- Merge respondents ----
all_respondents = []
for fpath in sorted(glob.glob(os.path.join(indir, f'respondents_{prefix}_*.json'))):
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    all_respondents.extend(data)
    print(f'  + {os.path.basename(fpath)}: {len(data)} respondents')

out = os.path.join(indir, f'respondents_{prefix}.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(all_respondents, f, ensure_ascii=False, indent=2)
print(f'  -> respondents_{prefix}.json: {len(all_respondents)} total')

# ---- Merge segments ----
all_segments = []
for fpath in sorted(glob.glob(os.path.join(indir, f'segments_{prefix}_*.json'))):
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    all_segments.extend(data)
    print(f'  + {os.path.basename(fpath)}: {len(data)} segments')

out = os.path.join(indir, f'segments_{prefix}.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(all_segments, f, ensure_ascii=False, indent=2)
print(f'  -> segments_{prefix}.json: {len(all_segments)} total')

print('Done!')