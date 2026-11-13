#!/usr/bin/env python3
"""阅读园：把 Standard Ebooks 上的公有领域名著转成分章的纯 HTML（Kindle 也能看），并生成书目页。

用法（在网站仓库根目录）：
    python3 reading/tools/build.py [缓存目录]

书目在 reading/books.json（手工维护）。每本书：
  1. 从 Standard Ebooks 下载 EPUB（缓存在「缓存目录」，默认是系统临时目录，下过的不再下）。
     Standard Ebooks 的电子书以 CC0 放弃了版权，原作也都是公有领域。
  2. 按 EPUB 的书脊顺序一章一页，写到 reading/books/<id>/：index.html（目录）、01.html …
     去掉书名页、版权页等；只有标题的「第几部」页并到下一页；插图转成灰度 JPEG。
  3. 生成书目页 reading/index.html：按类别（科幻、爱情……）和难度筛选，没有 JavaScript 时显示全部。
重复运行是安全的：每次重写输出。需要 python 的 bs4、Pillow；插图是 SVG 时用 macOS 的 qlmanage 转。
"""
import html
import io
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import warnings
import zipfile

from bs4 import BeautifulSoup
from bs4 import XMLParsedAsHTMLWarning
from PIL import Image

warnings.filterwarnings('ignore', category=XMLParsedAsHTMLWarning)  # EPUB 是 XHTML，用 HTML 解析器读没问题

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'reading')
SE = 'https://standardebooks.org/ebooks/'
SKIP = re.compile(r'(^|/)(titlepage|imprint|colophon|uncopyright|halftitlepage|loi|toc)\.xhtml$')
WORDS_PER_MINUTE = 200  # 母语读者的速度；读英文书可以按一半估
LEVELS = ['入门', '进阶', '挑战']
GENRE_ORDER = ['小说', '历史', '思想', '诗词', '散文', '科幻', '爱情', '推理', '奇幻', '冒险', '侠义', '成长', '哥特',
               '志怪', '笔记', '传记', '寓言', '讽刺', '社会', '家庭', '童话', '动物', '短篇']
LANGS = [('zh', '中文'), ('en', '英文')]

STYLE = """<style>
body { margin: 0 auto; max-width: 720px; padding: 12px 18px 40px; background: #fff; color: #000;
  font: 20px/1.7 Georgia, "Iowan Old Style", "Times New Roman", "Songti SC", serif; }
a { color: #000; }
.nav { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.nav a { margin-right: 12px; }
.nav.bottom { border-top: 1px solid #000; border-bottom: 0; padding-top: 8px; margin-top: 36px; }
h1 { font-size: 30px; line-height: 1.3; } h2 { font-size: 26px; line-height: 1.3; text-align: center; margin: 28px 0 20px; }
h3 { font-size: 22px; text-align: center; } hgroup p { text-align: center; font-style: italic; margin: 0 0 12px; text-indent: 0 !important; }
p { margin: 0; } p + p { text-indent: 1.4em; }
blockquote { margin: 14px 1.4em; } blockquote p + p { text-indent: 0; }
header p, footer p, .epigraph p { text-indent: 0 !important; }
img { max-width: 100%; height: auto; display: block; margin: 16px auto; }
figure { margin: 18px 0; text-align: center; } figcaption { font-size: 16px; }
table { margin: 12px auto; border-collapse: collapse; } td, th { padding: 2px 8px; }
hr { border: 0; border-top: 1px solid #000; width: 30%; margin: 24px auto; }
.toc { padding-left: 1.2em; } .toc li { margin: 4px 0; }
.about p { text-indent: 0 !important; margin: 8px 0; }
.meta { font-size: 16px; color: #333; }
.tag { border: 1px solid #000; padding: 0 5px; font-size: 15px; margin-right: 4px; }
.credit { margin-top: 28px; font-size: 14px; line-height: 1.6; color: #333; }
</style>"""


def esc(text):
    return html.escape(str(text or ''))


def download(book, cache):
    path = os.path.join(cache, f'{book["id"]}.epub')
    if os.path.exists(path) and zipfile.is_zipfile(path):
        return path
    page = urllib.request.urlopen(urllib.request.Request(SE + book['se'], headers={'User-Agent': 'static-reading-builder/1.0'}), timeout=60).read().decode('utf-8')
    found = re.search(r'href="([^"]*downloads/[^"]*_advanced\.epub)"', page)
    if not found:
        raise SystemExit(f'找不到 {book["se"]} 的下载链接')
    url = 'https://standardebooks.org' + found.group(1) + '?source=download'
    data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'static-reading-builder/1.0'}), timeout=120).read()
    with open(path, 'wb') as handle:
        handle.write(data)
    time.sleep(1)  # 别太快
    if not zipfile.is_zipfile(path):
        raise SystemExit(f'{book["se"]} 下载下来的不是 EPUB')
    return path


def convert_image(epub, name, target):
    """插图裁掉白边，最宽 760 像素。黑白线稿（比如铜版画插图）存成 1 位 PNG，又小又适合墨水屏；其余存灰度 JPEG。
    target 不带扩展名，返回写出的文件名，失败返回 None。"""
    raw = epub.read(name)
    if name.endswith('.svg'):
        work = tempfile.mkdtemp()
        svg = os.path.join(work, 'a.svg')
        with open(svg, 'wb') as handle:
            handle.write(raw)
        subprocess.run(['qlmanage', '-t', '-s', '1000', '-o', work, svg], capture_output=True, timeout=120)
        png = svg + '.png'
        if not os.path.exists(png):
            shutil.rmtree(work)
            return None
        image = Image.open(png)
        image.load()
        shutil.rmtree(work)
    else:
        image = Image.open(io.BytesIO(raw))
    image = image.convert('L')
    box = Image.eval(image, lambda v: 255 - v).getbbox()
    if box:
        image = image.crop((max(0, box[0] - 8), max(0, box[1] - 8), min(image.width, box[2] + 8), min(image.height, box[3] + 8)))
    if image.width > 760 and not name.endswith('.svg'):
        image = image.resize((760, round(image.height * 760 / image.width)), Image.LANCZOS)
    histogram = image.histogram()
    middle = sum(histogram[40:216]) / max(1, image.width * image.height)
    # SVG 插图本来就是黑白线稿，一律存 1 位 PNG（不缩小，免得细密的排线糊成灰色）
    if name.endswith('.svg') or middle < 0.12:
        image.point(lambda v: 255 if v > 150 else 0).convert('1').save(target + '.png', 'PNG', optimize=True)
        return os.path.basename(target) + '.png'
    image.save(target + '.jpg', 'JPEG', quality=72, optimize=True)
    return os.path.basename(target) + '.jpg'


def toc_entries(epub, opf_dir, toc_href):
    soup = BeautifulSoup(epub.read(posixpath.join(opf_dir, toc_href)).decode('utf-8'), 'html.parser')
    nav = soup.find('nav', attrs={'epub:type': re.compile('toc')}) or soup.find('nav')
    base = posixpath.dirname(toc_href)
    entries = []

    def walk(ol, parents):
        for li in ol.find_all('li', recursive=False):
            link = li.find('a', recursive=False)
            if link is None:
                continue
            href = posixpath.normpath(posixpath.join(base, link['href']))
            label = re.sub(r'\s+([:;,.])', r'\1', re.sub(r'\s+', ' ', link.get_text(' ', strip=True)))
            entries.append({'file': href.split('#')[0], 'frag': href.split('#')[1] if '#' in href else '', 'label': label, 'parents': parents})
            sub = li.find('ol', recursive=False)
            if sub:
                walk(sub, parents + [label])

    walk(nav.find('ol'), [])
    return entries


def nice_label(label):
    # 「I」「XII」这种只有罗马数字的章名，加上 Chapter
    return f'Chapter {label}' if re.fullmatch(r'[IVXLCDM]+', label) else label


def credit(book):
    return (f'<p class="credit">{esc(book["title"])}，{esc(book["author"])}，{book["year"]} 年，原作已进入公有领域。'
            f'文本来自 <a href="{SE}{esc(book["se"])}">Standard Ebooks</a> 的精校版（CC0，放弃一切版权）。'
            '本站（gamesyuan.com）把它改成分章的纯 HTML，方便在手机和 Kindle 上读，文字没有改动。本站与 Standard Ebooks 无关。</p>')


def page(book, title, body, nav):
    bottom = nav.replace('class="nav"', 'class="nav bottom"')
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{esc(title)} · {esc(book["title"])} | 阅读园</title>{STYLE}</head>'
            f'<body>{nav}{body}{bottom}{credit(book)}</body></html>\n')


def convert_book(book, cache):
    path = download(book, cache)
    epub = zipfile.ZipFile(path)
    container = BeautifulSoup(epub.read('META-INF/container.xml').decode('utf-8'), 'html.parser')
    opf_path = container.find('rootfile')['full-path']
    opf_dir = posixpath.dirname(opf_path)
    opf = BeautifulSoup(epub.read(opf_path).decode('utf-8'), 'html.parser')
    manifest = {item['id']: item for item in opf.find('manifest').find_all('item')}
    spine = [manifest[ref['idref']]['href'] for ref in opf.find('spine').find_all('itemref')]
    toc_item = next(item for item in manifest.values() if 'nav' in (item.get('properties') or ''))
    entries = toc_entries(epub, opf_dir, toc_item['href'])
    label_of = {}
    for entry in entries:
        label_of.setdefault(entry['file'], entry)

    out = os.path.join(OUT, 'books', book['id'])
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, 'img'))

    # 先决定每个文件放到哪一页：只有标题的「第几部」页并到下一页
    files = [href for href in spine if not SKIP.search(href)]
    bodies, words = {}, 0
    for href in files:
        soup = BeautifulSoup(epub.read(posixpath.join(opf_dir, href)).decode('utf-8'), 'html.parser')
        bodies[href] = soup.body
    pages, pending = [], []
    for href in files:
        text = bodies[href].get_text(' ', strip=True)
        if len(text) < 120 and not bodies[href].find('img') and href != files[-1]:
            pending.append(href)  # 「Part I」「Volume II」这种
            continue
        pages.append(pending + [href])
        pending = []
    page_of = {}
    for number, group in enumerate(pages, start=1):
        for href in group:
            page_of[href] = f'{number:02d}.html'

    images = 0
    titles = []
    for number, group in enumerate(pages, start=1):
        parts = []
        for href in group:
            body = bodies[href]
            for node in body.find_all(True):
                for attr in list(node.attrs):
                    if attr.startswith('epub:') or attr.startswith('xml:') or attr == 'role':
                        del node[attr]
            for img in body.find_all('img'):
                src = posixpath.normpath(posixpath.join(posixpath.dirname(href), img['src']))
                stem = posixpath.splitext(posixpath.basename(src))[0]
                name = convert_image(epub, posixpath.join(opf_dir, src), os.path.join(out, 'img', stem))
                if name:
                    img['src'] = f'img/{name}'
                    images += 1
                else:
                    img.decompose()
            for link in body.find_all('a', href=True):
                if re.match(r'^[a-z]+:', link['href']):
                    continue
                target, _, frag = link['href'].partition('#')
                target = posixpath.normpath(posixpath.join(posixpath.dirname(href), target)) if target else href
                if target in page_of:
                    link['href'] = ('' if page_of[target] == f'{number:02d}.html' else page_of[target]) + (f'#{frag}' if frag else '')
            words += len(re.findall(r"[A-Za-z']+", body.get_text(' ')))
            parts.append(body.decode_contents())
        main = group[-1]
        entry = label_of.get(main) or {'label': f'Page {number}', 'parents': []}
        title = nice_label(entry['label'])
        titles.append((f'{number:02d}.html', title, [p for p in entry['parents'] if p.lower() != book['title'].lower()]))
        prev_link = f'<a href="{number - 1:02d}.html">← 上一章</a>' if number > 1 else ''
        next_link = f'<a href="{number + 1:02d}.html">下一章 →</a>' if number < len(pages) else ''
        nav = f'<p class="nav"><a href="index.html">目录</a>{prev_link}{next_link}<a href="/reading/">阅读园</a></p>'
        with open(os.path.join(out, f'{number:02d}.html'), 'w', encoding='utf-8') as handle:
            handle.write(page(book, title, ''.join(parts), nav))

    # 目录：按「第几部」分组
    items, current = [], None
    for file, title, parents in titles:
        group = parents[-1] if parents else None
        if group != current:
            if current is not None:
                items.append('</ol></li>')
            if group:
                items.append(f'<li><b>{esc(group)}</b><ol>')
            current = group
        items.append(f'<li><a href="{file}">{esc(title)}</a></li>')
    if current is not None:
        items.append('</ol></li>')
    minutes = words / WORDS_PER_MINUTE
    tags = ''.join(f'<span class="tag">{esc(g)}</span>' for g in book['genres']) + f'<span class="tag">{esc(book["level"])}</span>'
    body = (f'<div class="about"><h1>{esc(book["title"])}</h1><p class="meta">{esc(book["zh"])} · {esc(book["author"])} · {book["year"]}</p>'
            f'<p class="meta">{tags}</p><p>{esc(book["intro"])}</p>'
            f'<p class="meta">约 {words / 10000:.1f} 万词，{len(pages)} 章。按每分钟 {WORDS_PER_MINUTE} 词读，约 {minutes / 60:.0f} 小时'
            '（读外语可以按两倍估）。</p>'
            f'<p><a href="01.html">从头读 →</a></p></div><ol class="toc">{"".join(items)}</ol>')
    nav = '<p class="nav"><a href="/reading/">← 阅读园</a><a href="01.html">从头读 →</a></p>'
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(page(book, '目录', body, nav))
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print(f'{book["id"]}: {len(pages)} 章，{words} 词，{images} 张插图，{size // 1024} KB')
    return {'words': words, 'chapters': len(pages)}


def write_index(books, stats):
    # 类别按常用程度排；books.json 里新出现的类别排在后面
    genres = [g for g in GENRE_ORDER if any(g in b['genres'] for b in books)]
    for book in books:
        for genre in book['genres']:
            if genre not in genres:
                genres.append(genre)
    cards = []
    # 中文书在前
    for book in sorted(books, key=lambda b: b.get('lang', 'en') != 'zh'):
        stat = stats[book['id']]
        lang = book.get('lang', 'en')
        tags = ''.join(f'<span class="label">{esc(g)}</span>' for g in book['genres'])
        if lang == 'zh':
            by = f'{esc(book["author"])} · {esc(book["era"])}'
            size = f'约 {stat["chars"] / 10000:.1f} 万字 · {stat["chapters"]} 章'
        else:
            hours = stat['words'] / WORDS_PER_MINUTE / 60
            by = f'{esc(book["zh"])} · {esc(book["author"])} · {book["year"]}'
            size = f'约 {stat["words"] / 10000:.1f} 万词 · {stat["chapters"]} 章 · 母语读者约 {hours:.0f} 小时读完'
        cards.append(
            f'<article class="book" data-lang="{lang}" data-genres="{esc(" ".join(book["genres"]))}" data-level="{esc(book["level"])}">'
            f'<p class="book-tags"><span class="label lang">{dict(LANGS)[lang]}</span>{tags}<span class="label kind">{esc(book["level"])}</span></p>'
            f'<h2><a href="books/{book["id"]}/">{esc(book["title"])}</a></h2>'
            f'<p class="book-by">{by}</p>'
            f'<p class="book-intro">{esc(book["intro"])}</p>'
            f'<p class="book-size">{size}</p>'
            f'<p class="book-links"><a href="books/{book["id"]}/">开始读 →</a></p></article>')
    chips = lambda name, values: ''.join(  # noqa: E731
        f'<button type="button" class="chip" data-{name}="{esc(v)}" aria-pressed="false">{esc(v)}</button>' for v in values)
    levels = [level for level in LEVELS if any(b['level'] == level for b in books)]
    template = open(os.path.join(OUT, 'tools', 'index.template.html'), encoding='utf-8').read()
    langs = [name for code, name in LANGS if any(b.get('lang', 'en') == code for b in books)]
    result = (template.replace('{{LANGS}}', ''.join(
        f'<button type="button" class="chip" data-lang="{code}" aria-pressed="false">{name}</button>'
        for code, name in LANGS if name in langs)).replace('{{GENRES}}', chips('genre', genres)).replace('{{LEVELS}}', chips('level', levels))
              .replace('{{BOOKS}}', '\n'.join(cards)).replace('{{COUNT}}', str(len(books))))
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(result)


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else os.path.join(tempfile.gettempdir(), 'reading-cache')
    os.makedirs(cache, exist_ok=True)
    books = json.load(open(os.path.join(OUT, 'books.json'), encoding='utf-8'))['books']
    stats = {}
    for book in books:
        if book.get('source') == 'wikisource':
            # 中文书由 wikisource.py 转换，这里只读它写的统计
            path = os.path.join(OUT, 'books', book['id'], 'stats.json')
            if not os.path.exists(path):
                print(f'{book["id"]}: 还没转换，先运行 reading/tools/wikisource.py，这次书目页里不放它')
                continue
            stats[book['id']] = json.load(open(path))
        else:
            stats[book['id']] = convert_book(book, cache)
    books = [b for b in books if b['id'] in stats]
    write_index(books, stats)
    print(f'书目页 reading/index.html：{len(books)} 本')


if __name__ == '__main__':
    main()
