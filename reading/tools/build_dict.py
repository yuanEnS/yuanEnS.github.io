#!/usr/bin/env python3
"""给英文书的「点词查义」生成小词典。

词典来自 ECDICT（https://github.com/skywind3000/ECDICT，MIT 许可）。完整的 ecdict.csv 有 6 千多万字节，
这里只留常用词和书里真出现过的词，再按前两个字母切成很多小文件，页面点到哪个词就只取那一份。

用法（在网站仓库根目录）：
    curl -L -o /tmp/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
    python3 reading/tools/build_dict.py /tmp/ecdict.csv reading/dict reading/books/<英文书>...

输出 <out>/<前两个字母>.json：{"词": ["音标", "释义"], "变形": "原形"}。
glossary.tsv 是自己的术语表（每行「词<Tab>释义」），优先于 ECDICT，用来放统计术语。
"""
import csv
import glob
import json
import os
import re
import shutil
import sys

WORD = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")
ENTRY = re.compile(r"^[a-z]+(?:['-][a-z]+)*$")
TAG = re.compile(r'<[^>]+>')
FORMS = 'pdi3srt'   # 过去式、过去分词、现在分词、三单、复数、比较级、最高级
COMMON = 40000      # 词频排名在这以内的都收
csv.field_size_limit(10 ** 8)


def book_words(folders):
    words = set()
    for folder in folders:
        for path in glob.glob(os.path.join(folder, '**', '*.html'), recursive=True):
            with open(path, encoding='utf-8') as handle:
                text = TAG.sub(' ', handle.read())
            for match in WORD.findall(text):
                words.add(match.lower().replace('’', "'"))
    return words


def short(translation):
    """释义最多留四行；有正式释义时去掉 [网络] 那一行。"""
    lines = [line.strip() for line in translation.replace('\\n', '\n').split('\n') if line.strip()]
    # 「confound的变形」这种只说是变形的行没用，有别的释义就去掉
    formal = [line for line in lines if not line.startswith('[网络]') and not re.search(r'的变形$', line)]
    lines = formal or lines
    return '\n'.join(lines[:4])[:240]


def key_of(word):
    head = re.sub(r'[^a-z]', '', word)[:2]
    return head if len(head) == 2 else (head + '_')[:2] if head else '__'


def main():
    source, out = sys.argv[1], sys.argv[2]
    rest = sys.argv[3:]
    glossary_path = next((p for p in rest if p.endswith('.tsv')), None)
    wanted = book_words([p for p in rest if not p.endswith('.tsv')])

    rows = {}
    with open(source, encoding='utf-8') as handle:
        for row in csv.DictReader(handle):
            word = row['word'].strip().lower()
            if not ENTRY.match(word) or not row['translation'].strip():
                continue
            rank = min(int(row['frq'] or 0) or 10 ** 9, int(row['bnc'] or 0) or 10 ** 9)
            if word in rows and rows[word]['rank'] <= rank:
                continue
            rows[word] = {'rank': rank, 'tag': row['tag'], 'phonetic': row['phonetic'],
                          'translation': row['translation'], 'exchange': row['exchange']}

    keep = {}
    for word, row in rows.items():
        if row['rank'] <= COMMON or row['tag'] or word in wanted:
            keep[word] = [row['phonetic'], short(row['translation'])]

    # 变形 → 原形：书里的 walked 指向 walk。变形自己有好词条（比如 found）就留着自己的
    redirect = {}
    for word, row in rows.items():
        if word not in keep:
            continue
        for part in row['exchange'].split('/'):
            kind, _, form = part.partition(':')
            form = form.strip().lower()
            if kind in FORMS and ENTRY.match(form) and form != word and form not in keep:
                redirect.setdefault(form, word)
    # 书里出现、本身是变形词条（exchange 里有 0:原形）的，也指过去
    for word in wanted:
        row = rows.get(word)
        if word in keep or word in redirect or not row:
            continue
        lemma = dict(p.split(':', 1) for p in row['exchange'].split('/') if ':' in p).get('0', '').lower()
        if lemma in keep:
            redirect[word] = lemma

    glossary = set()
    if glossary_path:
        with open(glossary_path, encoding='utf-8') as handle:
            for line in handle:
                if line.strip() and not line.startswith('#'):
                    word, meaning = line.rstrip('\n').split('\t', 1)
                    word = word.strip().lower()
                    old = keep.get(word, ['', ''])
                    keep[word] = [old[0], '【统计】' + meaning.strip() + ('\n' + old[1] if old[1] else '')]
                    redirect.pop(word, None)
                    glossary.add(word)
        # 复数指向术语原形，让 confounders 也显示术语释义
        for word in glossary:
            plural = word[:-1] + 'ies' if word.endswith('y') and word[-2:-1] not in 'aeiou' else \
                word + 'es' if word.endswith(('s', 'x', 'ch', 'sh')) else word + 's'
            if plural not in glossary:
                keep.pop(plural, None)
                redirect[plural] = word

    shards = {}
    for word, value in keep.items():
        shards.setdefault(key_of(word), {})[word] = value
    for form, lemma in redirect.items():
        shards.setdefault(key_of(form), {})[form] = lemma

    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    size = 0
    for key, entries in shards.items():
        path = os.path.join(out, key + '.json')
        with open(path, 'w', encoding='utf-8') as handle:
            json.dump(entries, handle, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
        size += os.path.getsize(path)
    missing = sorted(w for w in wanted if len(w) > 2 and w not in keep and w not in redirect and w.rstrip("s") not in keep)
    print(f'{len(keep)} 个词条，{len(redirect)} 个变形，{len(shards)} 个文件，共 {size // 1024} KB')
    print(f'书里出现的 {len(wanted)} 个词，查不到的 {len(missing)} 个，例如：{", ".join(missing[:40])}')


if __name__ == '__main__':
    main()
