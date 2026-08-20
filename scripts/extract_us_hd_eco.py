"""Extract 美国HD端用户生态与决策链路研究: respondents + segments, merge into 2 files."""
import docx, re, os, json

base = r'C:\Users\鸢尾\Desktop\腾讯-模拟用户\资料\虚拟用户-笔录 for 元培\虚拟用户-笔录 for 元培\美国HD端用户生态与决策链路研究'
outdir = r'data\群体画像'
prefix = '美国HD端用户生态与决策链路研究'

FILE_INTRO_END = {
    '座谈会笔录-G1（放松向）.docx': 141,
    '座谈会笔录-G2（竞技向）.docx': 92,
    '座谈会笔录-G3（社交向）.docx': 99,
    '座谈会笔录-G4（叙事向）.docx': 129,
}

NOISE = re.compile(
    r'^[对是嗯好行可可以]+[，,。.]?$|'
    r'^[没不][有会是知道清楚懂行能]+[，,。.]?$|'
    r'^(Cool|Yeah|Yep|Nope|Yes|No|Okay|Ok|Sure|Right|Gotcha|Perfect|Fantastic|Great|Nice|Thanks|Sorry|Fine|Alright|Absolutely|Exactly|Definitely|Totally|Indeed|Correct|Fair|True|Maybe|Perhaps|Probably|Hello|Hi|Hey)$|'
    r'^[Mm]+[hm]+[，,。.]?$|'
    r'^[啊哦嗯呃唉哎哟嘿]$',
    re.IGNORECASE
)

all_respondents = []
all_segments = []

for fname in sorted(os.listdir(base)):
    if not fname.endswith('.docx'):
        continue
    print(f'=== {fname} ===')
    doc = docx.Document(os.path.join(base, fname))

    # Parse turns: format 'SpeakerName:' or 'SpeakerName: text'
    turns = []
    cur_spk = None; cur_txt = None
    for p in doc.paragraphs:
        text = p.text.strip()
        if not text: continue
        m = re.match(r'^(.+?):\s*$', text)
        if m:
            if cur_spk and cur_txt: turns.append({'speaker': cur_spk, 'text': cur_txt.strip()})
            cur_spk = m.group(1).strip(); cur_txt = None; continue
        m = re.match(r'^(.+?):\s*(.+)', text)
        if m:
            if cur_spk and cur_txt: turns.append({'speaker': cur_spk, 'text': cur_txt.strip()})
            cur_spk = m.group(1).strip(); cur_txt = m.group(2); continue
        if cur_spk: cur_txt = (cur_txt + ' ' + text) if cur_txt else text
    if cur_spk and cur_txt: turns.append({'speaker': cur_spk, 'text': cur_txt.strip()})

    intro_end = FILE_INTRO_END.get(fname, 0)

    # Extract respondents from intro
    respondents = {}
    for t in turns[:intro_end]:
        if t['speaker'].lower() == 'moderator':
            continue
        if t['speaker'] not in respondents:
            respondents[t['speaker']] = {
                'source_file': f'{prefix}/{fname}',
                'speaker_id': t['speaker'], 'display_name': None, 'group_code': None,
                'background': {'profile': '', 'game_experience': None, 'game_experience_summary': None}
            }
        respondents[t['speaker']]['background']['profile'] += ('; ' if respondents[t['speaker']]['background']['profile'] else '') + t['text']

    # Extract segments from game discussion
    segments = []
    last_mod = None
    seg_idx = 0
    for t in turns[intro_end:]:
        if t['speaker'].lower() == 'moderator':
            last_mod = t['text']
        else:
            if NOISE.match(t['text']) or len(t['text']) <= 2:
                continue
            segments.append({
                'source_file': f'{prefix}/{fname}',
                'segment_index': seg_idx,
                'speaker_id': t['speaker'],
                'speaker_role': 'interviewee',
                'preceding_question': last_mod,
                'original_text': t['text'],
                'cleaned_text': None, 'char_count': None, 'annotation': {}
            })
            seg_idx += 1

    all_respondents.extend(respondents.values())
    all_segments.extend(segments)
    print(f'  respondents: {len(respondents)}, segments: {len(segments)}')

# Save
out_r = os.path.join(outdir, f'respondents_{prefix}.json')
with open(out_r, 'w', encoding='utf-8') as f:
    json.dump(all_respondents, f, ensure_ascii=False, indent=2)
print(f'\nrespondents: {len(all_respondents)} total -> {out_r}')

out_s = os.path.join(outdir, f'segments_{prefix}.json')
with open(out_s, 'w', encoding='utf-8') as f:
    json.dump(all_segments, f, ensure_ascii=False, indent=2)
print(f'segments: {len(all_segments)} total -> {out_s}')
print('Done!')