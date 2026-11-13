#!/usr/bin/env python3
"""阅读园的中文书：从维基文库取公有领域古籍，转成简体、分章的纯 HTML（Kindle 也能看）。

用法（在网站仓库根目录）：
    python3 reading/tools/wikisource.py [缓存目录] [书的 id ...]

书目在 reading/books.json 里 source 为 wikisource 的条目；每本书怎么取章节写在下面的 WORKS 里，
因为维基文库上每部书的组织方式都不一样。做的事：
  1. 用维基文库的 API 批量取原文（一次 50 页，取过的缓存起来，不重复取），
  2. 去掉页眉、导航等，交给维基文库的 API 排版成 HTML（一次几十页），
  3. 一章一页写两个版本：简体（用 OpenCC 从繁体转）在 reading/books/<id>/，繁体（维基文库原文用字）在
     reading/books/<id>/fan/，每页都能切换；并写 stats.json 给书目页用。
之后运行 reading/tools/build.py 生成书目页。
需要：pip install opencc-python-reimplemented beautifulsoup4
维基文库的文字：原作是公有领域，维基文库整理的部分（标点、注释）按 CC BY-SA 4.0，所以本站的这些页面也按 CC BY-SA 4.0 发布。
"""
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup
from opencc import OpenCC

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'reading')
API = 'https://zh.wikisource.org/w/api.php'
WIKI = 'https://zh.wikisource.org/wiki/'
UA = {'User-Agent': 'static-reading-builder/1.0'}
T2S = OpenCC('t2s')
S2T = OpenCC('s2t')
CHARS_PER_MINUTE = 400  # 读白话文的速度；文言文慢得多


# ---------- 每部书怎么取 ----------
# select(主页链接列表) 返回 [(来源页面, 标题或 None)]；mode：
#   chapters  一个来源页一页
#   poems     每个来源页是一首诗，按主页上的分类（五言古诗……）合成一页
#   split     只有一个来源页，按小标题每 N 首切成一页
#   daodejing 王弼本，去掉注文，分道经、德经两页
def line_title(line):
    """目录页上的一行（「*[[/第003回|第三回]]　回目」）变成「第三回　回目」。"""
    text = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', line)
    text = re.sub(r"<[^>]+>|'''|''|^[*#:\s]+", '', text)
    text = re.sub(r'\{\{[^{}]*\}\}', '', text)
    return re.sub(r'[\s　]+', '　', text).strip('　 =')


def numbered(prefix):
    pattern = re.compile(re.escape(prefix) + r'第?\d+[回卷]?$')
    return lambda links: unique([(t, ('line', line_title(line))) for _, t, _, line in links if pattern.match(t)])


def matching(regex, exclude=None):
    pattern = re.compile(regex)
    bad = re.compile(exclude) if exclude else None
    return lambda links: unique([(t, ('line', line_title(line))) for _, t, _, line in links
                                 if pattern.match(t) and not (bad and bad.search(t))])


def fixed(titles):
    return lambda links: [(t, label) for t, label in titles]


def unique(items):
    seen, out = set(), []
    for title, label in items:
        if title not in seen:
            seen.add(title)
            out.append((title, label))
    return out


WORKS = {
    'hongloumeng': {'main': '紅樓夢', 'select': numbered('紅樓夢/第')},
    'xiyouji': {'main': '西遊記', 'select': numbered('西遊記/第')},
    'shuihuzhuan': {'main': '水滸傳 (100回本)', 'select': matching(r'^水滸傳 \(100回本\)/(引首|第\d+回)$')},
    'sanguo': {'main': '三國演義', 'select': numbered('三國演義/第')},
    'shiji': {'main': '史記', 'select': matching(r'^史記/卷\d+$')},
    'zizhitongjian': {'main': '資治通鑑', 'select': fixed([
        ('資治通鑑/卷001', '卷一　周纪一（三家分晋）'),
        ('資治通鑑/卷002', '卷二　周纪二（商鞅变法）'),
        ('資治通鑑/卷007', '卷七　秦纪二（荆轲刺秦王）'),
        ('資治通鑑/卷009', '卷九　汉纪一（鸿门宴）'),
        ('資治通鑑/卷065', '卷六十五　汉纪五十七（赤壁之战）'),
        ('資治通鑑/卷105', '卷一百五　晋纪二十七（淝水之战）'),
        ('資治通鑑/卷191', '卷一百九十一　唐纪七（玄武门之变）'),
    ]), 'check': {'資治通鑑/卷001': '智伯', '資治通鑑/卷002': '衞鞅', '資治通鑑/卷007': '荊軻', '資治通鑑/卷009': '鴻門',
                  '資治通鑑/卷065': '赤壁', '資治通鑑/卷105': '肥水', '資治通鑑/卷191': '玄武門'}},
    'guwenguanzhi': {'main': '古文觀止', 'select': matching(r'^古文觀止/卷\d+$')},
    'lunyu': {'main': '論語', 'select': matching(r'^論語/.+第[一二三四五六七八九十]+$', exclude='知道')},
    'mengzi': {'main': '孟子', 'select': matching(r'^孟子/.+[上下]$')},
    'daodejing': {'main': '道德經 (王弼本)', 'select': fixed([('道德經 (王弼本)', None)]), 'mode': 'daodejing'},
    'zhuangzi': {'main': '莊子', 'select': matching(r'^莊子/.+$', exclude='全覽')},
    'tangshi': {'main': '唐詩三百首', 'mode': 'poems'},
    'songci': {'main': '宋詞三百首', 'select': fixed([('宋詞三百首', None)]), 'mode': 'split', 'per': 40},
    'shishuo': {'main': '世說新語', 'select': matching(r'^世說新語/.+$', exclude='全覽|/序$')},
    'liaozhai': {'main': '聊齋志異', 'select': matching(r'^聊齋志異/(作者自志|第\d+卷)$')},
    'rulinwaishi': {'main': '儒林外史', 'select': numbered('儒林外史/第')},
    'fushengliuji': {'main': '浮生六記', 'select': matching(r'^浮生六記/卷[一二三四] ')},
}


# ---------- 维基文库 API ----------
def call(params, post=False):
    params = dict(params, format='json', formatversion=2, maxlag=5)
    body = urllib.parse.urlencode(params).encode()
    for attempt in range(8):
        try:
            request = urllib.request.Request(API, data=body, headers=UA)
            return json.load(urllib.request.urlopen(request, timeout=180))
        except urllib.error.HTTPError as err:
            if err.code in (429, 503):
                wait = 20 * (attempt + 1)
                print(f'  维基文库让慢一点，等 {wait} 秒')
                time.sleep(wait)
                continue
            raise
    raise SystemExit('维基文库一直拒绝，稍后再试')


def wikitexts(titles, cache):
    """批量取原文，缓存在 cache 目录。返回 {标题: 原文}。"""
    file = os.path.join(cache, 'wikitext.json')
    store = json.load(open(file, encoding='utf-8')) if os.path.exists(file) else {}
    todo = [t for t in titles if t not in store]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        data = call({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main',
                     'redirects': 1, 'titles': '|'.join(batch)}, post=True)
        query = data['query']
        back = {r['to']: r['from'] for r in query.get('redirects', [])}
        norm = {n['to']: n['from'] for n in query.get('normalized', [])}
        for page in query['pages']:
            title = page['title']
            original = norm.get(back.get(title, title), back.get(title, title))
            store[original] = None if page.get('missing') else page['revisions'][0]['slots']['main']['content']
        for title in batch:
            store.setdefault(title, None)
        json.dump(store, open(file, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'  取原文 {min(i + 50, len(todo))}/{len(todo)}')
        time.sleep(3)
    return {t: store.get(t) for t in titles}


LINK = re.compile(r'\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]')


def main_links(title, text):
    out, section = [], ''
    for line in (text or '').splitlines():
        head = re.match(r'^(=+)\s*(.*?)\s*\1\s*$', line)
        if head:
            section = re.sub(r"'''|\[\[[^|\]]*\||\]\]|\[\[", '', head.group(2)).strip()
        for match in LINK.finditer(line):
            target = match.group(1).strip()
            if ':' in target.split('/')[0]:
                continue
            if target.startswith('/'):
                target = title + target
            out.append((section, target, (match.group(2) or target).strip(), line))
    return out


# ---------- 原文整理 ----------
def strip_template(text, names):
    """去掉指定名字的模板（花括号配平，可以跨行）。"""
    pattern = re.compile(r'\{\{\s*(' + '|'.join(names) + r')\s*[|}]', re.I)
    while True:
        match = pattern.search(text)
        if not match:
            return text
        depth, i = 0, match.start()
        while i < len(text):
            if text.startswith('{{', i):
                depth += 1
                i += 2
            elif text.startswith('}}', i):
                depth -= 1
                i += 2
                if depth == 0:
                    break
            else:
                i += 1
        text = text[:match.start()] + text[i:]


def header_section(text):
    match = re.search(r'\{\{\s*header2?\b[^{}]*?\|\s*section\s*=\s*([^\n|}]*)', text or '', re.I)
    if not match:
        return None
    value = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]|'''|''", r'\1', match.group(1)).strip()
    return value or None


def first_bold_line(text):
    match = re.search(r"\{\{center\|'''(.+?)'''\}\}", text or '')
    return match.group(1).strip() if match else None


NOISE = ['header', 'header2', 'header3', 'textquality', '檢索', 'further', 'versions', '注本', '注意', 'wikipedia',
         'Col-begin', 'Col-break', 'col-begin', 'col-break', 'Col-end', 'col-end', '样式:古典小說', '唐詩三百首',
         'album header', '道德真经注', 'PD-old', 'PD-old-100', 'Copyright', 'Process header', 'DEFAULTSORT']


def clean_wikitext(text):
    if '<onlyinclude>' in text:
        text = '\n'.join(re.findall(r'<onlyinclude>(.*?)</onlyinclude>', text, re.S))
    text = re.sub(r'<noinclude>.*?</noinclude>', '', text, flags=re.S)
    text = strip_template(text, [re.escape(n) for n in NOISE] + [r'[^|{}]*作品'])
    text = re.sub(r'\[\[(Category|分類|分类):[^\]]*\]\]', '', text)
    lines = [line for line in text.splitlines()
             if not re.match(r'^\s*(\[\[\.\./[^\]]*\]\][\s　]*)+$', line) and line.strip() != '----']
    return '\n'.join(lines).strip()


# ---------- 排版 ----------
def render(chunks, cache, context):
    """chunks: [(key, wikitext)]。交给维基文库排版，返回 {key: html}，结果缓存。"""
    file = os.path.join(cache, 'rendered.json')
    store = json.load(open(file, encoding='utf-8')) if os.path.exists(file) else {}
    todo = [(k, t) for k, t in chunks if k not in store]
    batch, size = [], 0

    def flush():
        nonlocal batch, size
        if not batch:
            return
        parts = []
        for n, (key, text) in enumerate(batch):
            parts.append(f'<div class="ws-split" data-n="{n}"></div>\n{text}\n<references/>\n')
        data = call({'action': 'parse', 'text': '\n'.join(parts), 'title': context, 'contentmodel': 'wikitext',
                     'prop': 'text', 'disablelimitreport': 1, 'disableeditsection': 1, 'disabletoc': 1}, post=True)
        out = data['parse']['text']
        pieces = re.split(r'<div class="ws-split" data-n="(\d+)"></div>', out)
        for i in range(1, len(pieces), 2):
            store[batch[int(pieces[i])][0]] = pieces[i + 1]
        json.dump(store, open(file, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'  排版 {len(store)} 页')
        batch, size = [], 0
        time.sleep(3)

    for key, text in todo:
        if size + len(text) > 250000:
            flush()
        batch.append((key, text))
        size += len(text)
    flush()
    return {k: store.get(k, '') for k, _ in chunks}


DROP_CLASSES = ['mw-editsection', 'ws-noexport', 'noprint', 'navbox', 'catlinks', 'licenseContainer', 'headertemplate',
                'ws-header', 'mw-empty-elt', 'sistersitebox', 'plainlinks metadata', 'wst-wikipedia', 'mw-cite-backlink',
                'variant-tooltip']  # 异文提示（鼠标悬停才显示的），留着会和正文混在一起


def tidy(fragment):
    soup = BeautifulSoup(fragment, 'html.parser')
    for name in DROP_CLASSES:
        for node in soup.find_all(class_=name):
            node.decompose()
    for node in soup.find_all(['style', 'script', 'link', 'meta']):
        node.decompose()
    # 指向维基文库其他页面的链接只留文字；页内的注释链接保留
    for link in soup.find_all('a'):
        href = link.get('href', '')
        if href.startswith('#'):
            continue
        link.unwrap()
    for node in soup.find_all(True):
        for attr in ('style', 'title', 'lang', 'dir', 'data-mw', 'typeof', 'about'):
            if attr in node.attrs and not (attr == 'style' and node.name in ('td', 'th')):
                del node[attr]
    for img in soup.find_all('img'):
        img.decompose()  # 维基文库页里的图标、徽章，不要
    # 空的段落
    for p in soup.find_all('p'):
        if not p.get_text(strip=True) and not p.find(['br', 'sup']):
            p.decompose()
    # 原文段首自带的全角空格去掉，缩进由样式统一给
    for p in soup.find_all('p'):
        first = p.find(string=True)
        if first and first.startswith(('　', ' ')):
            first.replace_with(first.lstrip('　 '))
    body = str(soup)
    return re.sub(r'\n{3,}', '\n\n', body).strip()


# ---------- 写页面 ----------
STYLE = """<style>
body { margin: 0 auto; max-width: 720px; padding: 12px 18px 40px; background: #fff; color: #000;
  font: 20px/1.9 "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif; }
a { color: #000; }
.nav { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; text-indent: 0; }
.nav a { margin-right: 12px; }
.nav.bottom { border-top: 1px solid #000; border-bottom: 0; padding-top: 8px; margin-top: 36px; }
h1 { font-size: 30px; line-height: 1.4; } h2 { font-size: 24px; line-height: 1.4; text-align: center; margin: 28px 0 18px; }
h3 { font-size: 21px; margin: 22px 0 10px; } h4 { font-size: 19px; }
p { margin: 0 0 0.6em; text-indent: 2em; }
dl, dd { margin: 0; } dd { padding-left: 2em; color: #222; }
.poem, .poem p { text-indent: 0; text-align: center; }
.lines p { text-indent: 0; margin: 0; }
.poem { margin: 10px 0 16px; }
blockquote { margin: 12px 2em; }
sup.reference { font-size: 70%; } sup.reference a { text-decoration: none; }
ol.references { font-size: 15px; line-height: 1.6; margin-top: 24px; padding-top: 8px; border-top: 1px solid #000; }
ol.references p { text-indent: 0; margin: 0; }
table { margin: 10px auto; border-collapse: collapse; } td, th { padding: 2px 6px; }
.toc { padding-left: 1.4em; } .toc li { margin: 4px 0; }
.about p { text-indent: 0 !important; margin: 8px 0; }
.meta { font-size: 16px; color: #333; }
.tag { border: 1px solid #000; padding: 0 5px; font-size: 15px; margin-right: 4px; }
.credit { margin-top: 28px; font-size: 14px; line-height: 1.6; color: #333; text-indent: 0; }
</style>"""


def esc(text):
    return html.escape(str(text or ''))


# 两个版本：简体（转出来的）和繁体（维基文库原文用字）。简体在 books/<id>/，繁体在 books/<id>/fan/，文件名一一对应
VARIANTS = {
    'jian': {'dir': '', 'lang': 'zh-CN', 'other': ('fan/', '繁體版'), 'ui': lambda t: t},
    'fan': {'dir': 'fan', 'lang': 'zh-Hant', 'other': ('../', '简体版'), 'ui': lambda t: S2T.convert(t)},
}


def credit(book, variant):
    url = WIKI + urllib.parse.quote(WORKS[book['id']]['main'])
    note = ('并用 OpenCC 自动把繁体转成简体（个别字可能转得不准，以原文为准）' if variant == 'jian'
            else '繁体版保留维基文库原文用字，站内的说明文字由 OpenCC 转成繁体')
    text = (f'{book["title"]}，{book["author"]}。原作已进入公有领域。'
            f'文本来自<a href="{url}">维基文库</a>，维基文库整理的标点、注释等按 '
            '<a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hans">CC BY-SA 4.0</a> 许可使用；'
            f'本站把它改成分章网页，{note}，本页同样按 CC BY-SA 4.0 发布。本站与维基文库无关。')
    return f'<p class="credit">{VARIANTS[variant]["ui"](text)}</p>'


def page(book, title, body, nav, variant):
    ui = VARIANTS[variant]['ui']
    bottom = nav.replace('class="nav"', 'class="nav bottom"')
    return (f'<!doctype html><html lang="{VARIANTS[variant]["lang"]}"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{esc(title)} · {esc(ui(book["title"]))} | {ui("阅读园")}</title>{STYLE}</head>'
            f'<body>{nav}{body}{bottom}{credit(book, variant)}</body></html>\n')


def write_variant(book, chapters, variant):
    """chapters: [(标题, html)]，用维基文库原文的繁体字。"""
    v = VARIANTS[variant]
    ui = v['ui']
    if variant == 'jian':
        chapters = [(T2S.convert(t), T2S.convert(b)) for t, b in chapters]
    else:
        chapters = [(S2T.convert(t), b) for t, b in chapters]  # 标题里有本站写的简体字（比如节选的卷名）
    out = os.path.join(OUT, 'books', book['id'], v['dir'])
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith('.html'):
            os.remove(os.path.join(out, old))
    other_dir, other_name = v['other']
    chars = 0
    for number, (title, body) in enumerate(chapters, start=1):
        chars += len(re.findall(r'[\u4e00-\u9fff]', BeautifulSoup(body, 'html.parser').get_text()))
        prev_link = f'<a href="{number - 1:03d}.html">{ui("← 上一章")}</a>' if number > 1 else ''
        next_link = f'<a href="{number + 1:03d}.html">{ui("下一章 →")}</a>' if number < len(chapters) else ''
        nav = (f'<p class="nav"><a href="index.html">{ui("目录")}</a>{prev_link}{next_link}'
               f'<a href="{other_dir}{number:03d}.html">{other_name}</a><a href="/reading/">{ui("阅读园")}</a></p>')
        # 正文开头已经有标题（h1、h2，或居中的粗体回目）就不再加
        start = re.sub(r'\s|　', '', BeautifulSoup(body[:1500], 'html.parser').get_text())[:80]
        has_title = re.search(r'<h[12][ >]', body[:400]) or re.sub(r'\s|　', '', title)[:6] in start
        heading = '' if has_title else f'<h2>{esc(title)}</h2>'
        with open(os.path.join(out, f'{number:03d}.html'), 'w', encoding='utf-8') as handle:
            handle.write(page(book, title, heading + body, nav, variant))
    items = ''.join(f'<li><a href="{n:03d}.html">{esc(t)}</a></li>' for n, (t, _) in enumerate(chapters, start=1))
    tags = ''.join(f'<span class="tag">{esc(ui(g))}</span>' for g in book['genres']) + f'<span class="tag">{esc(ui(book["level"]))}</span>'
    body = (f'<div class="about"><h1>{esc(ui(book["title"]))}</h1><p class="meta">{esc(ui(book["author"]))} · {esc(ui(book["era"]))}</p>'
            f'<p class="meta">{tags}</p><p>{esc(ui(book["intro"]))}</p>'
            f'<p class="meta">{ui(f"约 {chars / 10000:.1f} 万字，{len(chapters)} 章。")}</p>'
            f'<p><a href="001.html">{ui("从头读 →")}</a>　<a href="{other_dir}index.html">{other_name}</a></p></div>'
            f'<ol class="toc">{items}</ol>')
    nav = (f'<p class="nav"><a href="/reading/">{ui("← 阅读园")}</a><a href="001.html">{ui("从头读 →")}</a>'
           f'<a href="{other_dir}index.html">{other_name}</a></p>')
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(page(book, ui('目录'), body, nav, variant))
    return chars


def write_book(book, chapters):
    chars = write_variant(book, chapters, 'jian')
    write_variant(book, chapters, 'fan')
    out = os.path.join(OUT, 'books', book['id'])
    json.dump({'chars': chars, 'chapters': len(chapters), 'fan': True}, open(os.path.join(out, 'stats.json'), 'w'))
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print(f'{book["id"]}: {len(chapters)} 章，{chars} 字，简繁两版共 {size // 1024} KB')


# ---------- 各种书 ----------
def title_of(source, text, label):
    """标题：节选给定的直接用；否则在页眉、正文开头的粗体标题、目录页那一行里取最完整的。"""
    if isinstance(label, str):
        return label
    candidates = [header_section(text), first_bold_line(text), label[1] if label else None]
    candidates = [re.sub(r'<ref.*?(</ref>|$)|<[^>]+>', '', c, flags=re.S) for c in candidates if c]
    candidates = [re.sub(r'[\s　]+', '　', c).strip('　 ') for c in candidates]
    candidates = [c for c in candidates if c]
    if not candidates:
        return source.split('/')[-1]
    return max(candidates, key=len)


def build(book, cache):
    work = WORKS[book['id']]
    main_text = wikitexts([work['main']], cache)[work['main']]
    links = main_links(work['main'], main_text)
    mode = work.get('mode', 'chapters')

    if mode == 'poems':
        # 唐诗三百首：主页上每行是「作者 [[诗]]」，按小标题分体
        entries = []
        for section, target, label, line in links:
            if not section or '序' in section:
                continue
            author = re.sub(r'^[#*\s]+', '', line.split('[[')[0]).strip()
            entries.append((section, target, label, author))
        texts = wikitexts([t for _, t, _, _ in entries], cache)
        chunks = [(f'{book["id"]}|{t}', clean_wikitext(texts[t] or '')) for _, t, _, _ in entries if texts.get(t)]
        rendered = render(chunks, cache, work['main'])
        groups = {}
        for section, target, label, author in entries:
            body = rendered.get(f'{book["id"]}|{target}')
            if not body:
                continue
            name = re.sub(r'\s*\(.*\)$', '', label)
            groups.setdefault(section, []).append(f'<h3>{esc(name)}<small>　{esc(author)}</small></h3>{tidy(body)}')
        write_book(book, [(section, ''.join(poems)) for section, poems in groups.items()])
        return

    sources = work['select'](links)
    texts = wikitexts([s for s, _ in sources], cache)
    for source, word in work.get('check', {}).items():
        if word not in (texts.get(source) or ''):
            raise SystemExit(f'{source} 里没有「{word}」，节选的卷可能选错了')
    missing = [s for s, _ in sources if not texts.get(s)]
    if missing:
        print('  维基文库上没有：', missing[:5])
    sources = [(s, label) for s, label in sources if texts.get(s)]

    if mode == 'daodejing':
        text = texts[sources[0][0]]
        text = re.sub(r'^:\{\{\*\|.*$', '', text, flags=re.M)  # 王弼注
        text = re.sub(r'\{\{\*\|[^{}]*\}\}', '', text)
        text = re.sub(r'^(=老子[^\n]*|:華亭[^\n]*|:晉[^\n]*)$', '', text, flags=re.M)  # 版本说明，注文已经去掉了
        upper, mark, lower = clean_wikitext(text).partition('==三十八章==')
        if not mark:
            raise SystemExit('道德经里找不到第三十八章，没法分道经、德经')
        lower = mark + lower
        rendered = render([('daodejing|上', upper), ('daodejing|下', lower)], cache, work['main'])
        write_book(book, [('道经（第一章至第三十七章）', '<div class="lines">' + tidy(rendered['daodejing|上']) + '</div>'),
                          ('德经（第三十八章至第八十一章）', '<div class="lines">' + tidy(rendered['daodejing|下']) + '</div>')])
        return

    chunks = [(f'{book["id"]}|{s}', clean_wikitext(texts[s])) for s, _ in sources]
    rendered = render(chunks, cache, work['main'])

    if mode == 'split':
        body = tidy(rendered[f'{book["id"]}|{sources[0][0]}'])
        pieces = re.split(r'(?=<h2[ >])', body)
        poems = [p for p in pieces if p.startswith('<h2')]
        per = work.get('per', 40)
        chapters = []
        for i in range(0, len(poems), per):
            chunk = poems[i:i + per]
            chapters.append((f'第 {i + 1}～{i + len(chunk)} 首', ''.join(chunk)))
        write_book(book, chapters)
        return

    chapters = [(title_of(s, texts[s], label), tidy(rendered[f'{book["id"]}|{s}'])) for s, label in sources]
    write_book(book, chapters)


def main():
    args = sys.argv[1:]
    cache = args.pop(0) if args and os.path.isdir(args[0]) else os.path.join(tempfile.gettempdir(), 'reading-cache', 'wikisource')
    os.makedirs(cache, exist_ok=True)
    books = [b for b in json.load(open(os.path.join(OUT, 'books.json'), encoding='utf-8'))['books'] if b.get('source') == 'wikisource']
    if args:
        books = [b for b in books if b['id'] in args]
    for book in books:
        print(f'== {book["title"]}')
        build(book, cache)


if __name__ == '__main__':
    main()
