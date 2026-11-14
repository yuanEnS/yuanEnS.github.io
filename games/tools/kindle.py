#!/usr/bin/env python3
"""游戏园的 Kindle 版：不用 JavaScript 的纯 HTML 小游戏，生成到 games/kindle/。

    python3 games/tools/kindle.py

Kindle 等电子书阅读器的浏览器很旧，网页游戏跑不起来。这里把能「点一下看结果」的游戏做成静态页面：
  - 诗词填字：一句诗空一个字，四个字里选一个。题库就是 shici/poems.js。
  - 24 点：四张牌，自己心算，点「看答案」看一种算法。
选项和答案都是页面内的链接（#o1、#ans），配合 CSS 的 :target 显示结果，不需要脚本。
题目顺序用固定的随机种子打乱，每次生成结果一样。改了题库重新跑一遍就行。
"""
import html
import os
import random
import re
from fractions import Fraction

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
OUT = os.path.join(ROOT, 'games', 'kindle')
PUNCT = re.compile(r'[，。、！？；：]')

STYLE = """<style>
body { margin: 0 auto; max-width: 640px; padding: 12px 16px 40px; background: #fff; color: #000;
  font: 20px/1.7 "Kaiti SC", STKaiti, KaiTi, "Songti SC", serif; }
a { color: #000; }
.nav { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.nav a { margin-right: 12px; }
h1 { font-size: 26px; margin: 14px 0 6px; }
.note { font-size: 16px; }
.line { font-size: 34px; letter-spacing: 4px; margin: 24px 0 8px; text-align: center; }
.blank { display: inline-block; width: 1.1em; border-bottom: 3px solid #000; }
.src { text-align: center; font-size: 17px; }
.opts { text-align: center; margin: 22px 0; }
.opts a, .btn { display: inline-block; min-width: 2.2em; margin: 6px; padding: 6px 12px; border: 2px solid #000;
  font-size: 30px; text-decoration: none; text-align: center; }
.btn { font-size: 20px; }
.cards { text-align: center; margin: 26px 0; }
.card { display: inline-block; width: 2.4em; margin: 4px; padding: 14px 0; border: 3px solid #000; font: 34px/1 Georgia, serif; text-align: center; }
.result { display: none; border: 2px solid #000; padding: 10px 14px; margin: 18px 0; }
.result:target { display: block; }
.pager { margin-top: 26px; font-size: 18px; }
.pager a { margin-right: 18px; }
ul.list li { margin: 8px 0; }
</style>"""


def page(title, body, depth):
    up = '../' * depth
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{html.escape(title)} · 游戏园 Kindle 版</title><meta name="robots" content="noindex">{STYLE}</head><body>'
            f'<p class="nav"><a href="{up}index.html">Kindle 版游戏</a><a href="/games/">游戏园</a><a href="/">首页</a></p>'
            + body + '</body></html>\n')


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        handle.write(text)


def pager(n, total, name=lambda i: f'{i:03d}.html'):
    links = []
    if n > 1:
        links.append(f'<a href="{name(n - 1)}">← 上一题</a>')
    links.append(f'第 {n} / {total} 题')
    if n < total:
        links.append(f'<a href="{name(n + 1)}">下一题 →</a>')
    return '<p class="pager">' + ' '.join(links) + ' <a href="index.html">题目列表</a></p>'


# ---------- 诗词填字 ----------
def poems():
    text = open(os.path.join(ROOT, 'shici', 'poems.js'), encoding='utf-8').read()
    return re.findall(r"\['([^']+)',\s*'([^']*)',\s*'([^']*)'\]", text)


def build_shici():
    items = poems()
    rng = random.Random('kindle-shici')
    rng.shuffle(items)
    chars = sorted({ch for line, _, _ in items for ch in line if not PUNCT.match(ch)})
    folder = os.path.join(OUT, 'shici')
    total = len(items)
    rows = []
    for n, (line, title, author) in enumerate(items, 1):
        spots = [i for i, ch in enumerate(line) if not PUNCT.match(ch)]
        at = rng.choice(spots)
        answer = line[at]
        options = rng.sample([c for c in chars if c != answer and c not in line], 3) + [answer]
        rng.shuffle(options)
        shown = html.escape(line[:at]) + '<span class="blank">&nbsp;</span>' + html.escape(line[at + 1:])
        full = html.escape(line[:at]) + f'<b><u>{html.escape(answer)}</u></b>' + html.escape(line[at + 1:])
        source = f'——{html.escape(author)}《{html.escape(title)}》'
        opts = ''.join(f'<a href="#o{i}">{html.escape(c)}</a>' for i, c in enumerate(options, 1))
        results = ''
        for i, c in enumerate(options, 1):
            head = '对了！' if c == answer else f'不对，不是「{html.escape(c)}」，是「{html.escape(answer)}」。'
            nxt = f' <a href="{n + 1:03d}.html">下一题 →</a>' if n < total else ''
            results += f'<div class="result" id="o{i}"><p>{head}</p><p>{full}</p><p class="src">{source}</p><p>{nxt}</p></div>'
        body = (f'<h1>诗词填字</h1><p class="note">空的是哪个字？点一下选。</p>'
                f'<p class="line">{shown}</p><p class="src">{source}</p><p class="opts">{opts}</p>{results}'
                + pager(n, total))
        write(os.path.join(folder, f'{n:03d}.html'), page(f'诗词填字 第 {n} 题', body, 1))
        rows.append(f'<li><a href="{n:03d}.html">第 {n} 题</a> · {html.escape(title)}</li>')
    body = (f'<h1>诗词填字</h1><p class="note">一句古诗空了一个字，四个字里挑一个。共 {total} 题，'
            '从<a href="001.html">第 1 题</a>开始，做完点「下一题」。</p><ul class="list">' + ''.join(rows) + '</ul>')
    write(os.path.join(folder, 'index.html'), page('诗词填字', body, 1))
    return total


# ---------- 24 点 ----------
FACES = {1: 'A', 11: 'J', 12: 'Q', 13: 'K'}


def solve(items):
    if len(items) == 1:
        return items[0][1] if items[0][0] == 24 else None
    for i in range(len(items)):
        for j in range(len(items)):
            if i == j:
                continue
            rest = [items[k] for k in range(len(items)) if k not in (i, j)]
            (a, ta), (b, tb) = items[i], items[j]
            for op, value in (('+', a + b), ('−', a - b), ('×', a * b), ('÷', a / b if b else None)):
                if value is None or (op in '+×' and i > j):
                    continue
                found = solve(rest + [(value, f'({ta} {op} {tb})')])
                if found:
                    return found
    return None


def build_24():
    rng = random.Random('kindle-24')
    seen, puzzles = set(), []
    while len(puzzles) < 100:
        nums = sorted(rng.randint(1, 13) for _ in range(4))
        if tuple(nums) in seen:
            continue
        way = solve([(Fraction(x), str(x)) for x in nums])
        if way:
            seen.add(tuple(nums))
            rng.shuffle(nums)
            puzzles.append((nums, re.sub(r'^\((.*)\)$', r'\1', way)))
    folder = os.path.join(OUT, '24')
    total = len(puzzles)
    rows = []
    for n, (nums, way) in enumerate(puzzles, 1):
        cards = ''.join(f'<span class="card">{FACES.get(x, x)}</span>' for x in nums)
        faces = '，'.join(f'{FACES[x]} 是 {x}' for x in sorted(set(nums)) if x in FACES)
        nxt = f' <a href="{n + 1:03d}.html">下一题 →</a>' if n < total else ''
        body = (f'<h1>24 点</h1><p class="note">四张牌各用一次，加减乘除（可以加括号）算出 24。想好了点「看答案」。'
                f'{("（" + faces + "）") if faces else ""}</p>'
                f'<p class="cards">{cards}</p><p class="opts"><a class="btn" href="#ans">看答案</a></p>'
                f'<div class="result" id="ans"><p>一种算法：</p><p class="line" style="font-size:26px">{html.escape(way)} = 24</p>'
                f'<p>也可能有别的算法。{nxt}</p></div>' + pager(n, total))
        write(os.path.join(folder, f'{n:03d}.html'), page(f'24 点 第 {n} 题', body, 1))
        rows.append(f'<li><a href="{n:03d}.html">第 {n} 题</a> · {" ".join(str(FACES.get(x, x)) for x in nums)}</li>')
    body = (f'<h1>24 点</h1><p class="note">共 {total} 题，每题都有解。从<a href="001.html">第 1 题</a>开始。</p>'
            '<ul class="list">' + ''.join(rows) + '</ul>')
    write(os.path.join(folder, 'index.html'), page('24 点', body, 1))
    return total


def main():
    shici = build_shici()
    twenty_four = build_24()
    body = ('<h1>游戏园 · Kindle 版</h1>'
            '<p class="note">Kindle 等电子书阅读器的浏览器比较旧，大部分网页游戏跑不起来。这几个是专门做的纯网页版，点一下就能玩。</p>'
            f'<ul class="list"><li><a href="shici/index.html"><b>诗词填字</b></a> · 古诗空一个字，四选一，{shici} 题</li>'
            f'<li><a href="24/index.html"><b>24 点</b></a> · 四张牌算出 24，心算后看答案，{twenty_four} 题</li></ul>'
            '<p class="note">游戏园首页会自动检查你的阅读器，能跑的完整版游戏也会列出来。</p>')
    write(os.path.join(OUT, 'index.html'), page('游戏园 Kindle 版', body, 0))
    print(f'诗词填字 {shici} 题，24 点 {twenty_four} 题 → games/kindle/')


if __name__ == '__main__':
    main()
