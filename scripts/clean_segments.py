"""Clean all 3 segments files: remove non-game, very short, or meaningless content."""
import json, re, os

indir = r'data\sheets_data'
files = [
    'segments_漫威争锋中美用户洞察研究.json',
    'segments_美国HD端射击市场用户细分研究.json',
    'segments_美国HD端用户生态与决策链路研究.json',
]

# Pure noise/conversation flow patterns (not game discussion)
NOISE = re.compile(
    r'^[对是嗯好行可可以]+[，,。.]?$|'
    r'^[没不][有会是知道清楚懂行能]+[，,。.]?$|'
    r'^(Cool|Yeah|Yep|Nope|Yes|No|Okay|Ok|Sure|Right|Gotcha|Perfect|Fantastic|Great|Nice|Thanks|Sorry|Fine|Alright|Absolutely|Exactly|Definitely|Totally|Indeed|Correct|Fair|True|Maybe|Perhaps|Probably|Hello|Hi|Hey|Wow|What|Why|When|Where|How|Who)$|'
    r'^[Mm]+[hm]+[，,。.]?$|'
    r'^[啊哦嗯呃唉哎哟嘿]$|'
    r'^(Dial-up|Go ahead|I\'ll start|Yay|Good shirt|There you go|That\'s it|No sleep|All right|See you)',
    re.IGNORECASE
)

# Pure conversation flow / admin content (brief, non-game)
FLOW = re.compile(
    r'^(I\'ll start\.?|Go ahead\.?|Dial-up\.?|Sorry\.?|Excuse me\.?|'
    r'You look great.*|That\'s funny\.?|That\'s great\.?|Oh, cool\.?|'
    r'Oh, yeah\.?|Yeah, yeah\.?|No, no\.?|'
    r'There you go\.?|That\'s it\.?|No sleep\.?|All right\.?|'
    r'Is it the new DLC\?|Happy early birthday\.?|Thank you\.?|'
    r'Probably not\.?|Cool\. All right\.?)$',
    re.IGNORECASE
)

for fname in files:
    fpath = os.path.join(indir, fname)
    with open(fpath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    original = len(data)
    cleaned = []

    for s in data:
        t = s['original_text'].strip()

        # Skip pure noise
        if NOISE.match(t):
            continue
        # Skip too short (no meaningful game discussion under 15 chars)
        if len(t) < 15:
            continue
        # Skip pure conversation flow
        if FLOW.match(t):
            continue

        cleaned.append(s)

    with open(fpath, 'w', encoding='utf-8') as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)

    print(f'{fname}: {original} -> {len(cleaned)} (removed {original - len(cleaned)})')

print('Done!')