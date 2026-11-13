#!/usr/bin/env python3
"""把 arXiv 上的书（LaTeXML 生成的网页版）转成适合 Kindle 的分章纯 HTML。

只用于作者以开放许可（比如 CC BY 4.0）发布的书。每页底部写明原作者、许可、出处和本站做的改动。

    python3 research/tools/arxiv_book.py BOOK_ID ARXIV_ID WORK_DIR

WORK_DIR 里要有：
    book.html    arXiv 的网页版（https://arxiv.org/html/ARXIV_ID）
    src/         arXiv 的 LaTeX 源文件（https://arxiv.org/src/ARXIV_ID，解压后），用来拿宏定义和 PDF 插图
输出到 research/books/BOOK_ID/：index.html（目录）、每章一页、m/（公式图片）、img/（插图）。

做法：
  - 公式：取每个 <math> 的 alttext（原始 LaTeX），用本机的 latex + dvipng 渲染成黑白 PNG，
    按 em 设置高度和基线，跟着正文字号缩放。老 Kindle 不认 MathML，图片都认。
  - 插图：源文件里有 PDF 的用 pdftoppm 转 PNG，否则下载 arXiv 网页版里的图片。
  - 不用 JavaScript，不用网络字体。
需要：latex、dvipng、pdftoppm、python 的 bs4 和 lxml。
"""
import hashlib
import struct
import html
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

from bs4 import BeautifulSoup, Comment

DPI = 300
PX_PER_EM = DPI * 10 / 72.27  # 10pt 字号下 1em 有多少像素
CHUNK = 250
PICTURE = re.compile(r'\\begin\{picture\}.*?\\end\{picture\}', re.S)

PREAMBLE_PACKAGES = r"""\documentclass[10pt]{article}
\usepackage{amssymb, bbm, bm, mathtools}
\usepackage{amsmath}
\usepackage{color}
\usepackage[all,import]{xy}
\usepackage[active,tightpage]{preview}
\setlength\PreviewBorder{1pt}
\pagestyle{empty}
"""


def book_macros(src):
    """从主 .tex 和 frontmatter/preamble.tex 里摘出 \\def、\\newcommand 等数学宏。"""
    main = None
    for name in os.listdir(src):
        if name.endswith('.tex'):
            text = open(os.path.join(src, name), encoding='utf-8', errors='replace').read()
            if r'\begin{document}' in text:
                main = text
                break
    lines = []
    if main:
        head = main.split(r'\begin{document}')[0]
        # 一条宏定义可能跨行（\def\ind{\begin{picture}... }），按花括号配平收集
        buffer, depth = '', 0
        for line in head.splitlines():
            stripped = line.split('%')[0] if not line.strip().startswith('\\%') else line
            if not buffer and not re.match(r'\s*\\(def|newcommand|renewcommand|DeclareMathOperator|definecolor)\b', stripped):
                continue
            if re.match(r'\s*\\(newcommand|renewcommand)\{\\(ri|pkg|theparagraph)\}', stripped):
                continue  # 正文用的命令，公式里用不到，而且依赖 listings
            buffer += stripped + '\n'
            depth += stripped.count('{') - stripped.count('}')
            if depth <= 0:
                lines.append(buffer)
                buffer, depth = '', 0
    return ''.join(lines)


def render_math(formulas, macros, out_dir, work):
    """formulas: [(key, tex, display)]。返回 {key: (file, height_em, depth_em)}，渲染失败的不在里面。"""
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(work, exist_ok=True)
    results = {}
    todo = [f for f in formulas if not os.path.exists(os.path.join(out_dir, f'{f[0]}.png'))]
    cache_file = os.path.join(out_dir, '..', '.math-sizes.json')
    sizes = json.load(open(cache_file)) if os.path.exists(cache_file) else {}

    def compile_chunk(chunk, name):
        body = []
        for _, tex, display in chunk:
            tex = tex.strip()
            if display and not tex.startswith('\\displaystyle'):
                tex = '\\displaystyle ' + tex
            body.append('\\begin{preview}$' + tex.replace('\n', ' ') + '$\\end{preview}')
        doc = PREAMBLE_PACKAGES + macros + '\\begin{document}\n' + '\n'.join(body) + '\n\\end{document}\n'
        tex_file = os.path.join(work, f'{name}.tex')
        open(tex_file, 'w', encoding='utf-8').write(doc)
        subprocess.run(['latex', '-interaction=nonstopmode', '-halt-on-error', f'{name}.tex'],
                       cwd=work, capture_output=True, text=True, timeout=600)
        log = open(os.path.join(work, f'{name}.log'), encoding='utf-8', errors='replace').read() if os.path.exists(os.path.join(work, f'{name}.log')) else ''
        dvi = os.path.join(work, f'{name}.dvi')
        if '\n! ' in log or not os.path.exists(dvi):
            return False
        out = subprocess.run(['dvipng', '-D', str(DPI), '-T', 'tight', '--depth', '--height', '-bg', 'White', '-fg', 'Black', '--gamma', '1.8',
                              '-z', '9', '-q', '-o', os.path.join(work, f'{name}-%d.png'), f'{name}.dvi'],
                             cwd=work, capture_output=True, text=True, timeout=600)
        found = re.findall(r'depth=(-?\d+) height=(-?\d+)', out.stdout)
        if len(found) != len(chunk):
            return False
        for i, ((key, _, _), (depth, height)) in enumerate(zip(chunk, found), start=1):
            shutil.move(os.path.join(work, f'{name}-{i}.png'), os.path.join(out_dir, f'{key}.png'))
            sizes[key] = [int(height), int(depth)]
        return True

    def solve(chunk, name):
        if compile_chunk(chunk, name):
            return
        if len(chunk) == 1:
            print('  公式渲染失败，改为显示原文：', chunk[0][1][:80])
            return
        half = len(chunk) // 2
        solve(chunk[:half], name + 'a')
        solve(chunk[half:], name + 'b')

    for n in range(0, len(todo), CHUNK):
        solve(todo[n:n + CHUNK], f'c{n // CHUNK}')
        print(f'  公式 {min(n + CHUNK, len(todo))}/{len(todo)}')
    json.dump(sizes, open(cache_file, 'w'))
    for key, _, _ in formulas:
        path = os.path.join(out_dir, f'{key}.png')
        if key in sizes and os.path.exists(path):
            height, depth = sizes[key]
            with open(path, 'rb') as handle:
                width = struct.unpack('>I', handle.read(24)[16:20])[0]
            results[key] = (f'{key}.png', width / PX_PER_EM, depth / PX_PER_EM)
    return results


def fetch(url, path):
    if os.path.exists(path):
        return True
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'static-reading-builder/1.0'})
        with urllib.request.urlopen(request, timeout=60) as res, open(path, 'wb') as handle:
            handle.write(res.read())
        return True
    except Exception as err:  # noqa: BLE001
        print('  下载失败', url, err)
        return False


STYLE = """<style>
body { margin: 0 auto; max-width: 760px; padding: 12px 16px 40px; background: #fff; color: #000;
  font: 19px/1.65 Georgia, "Times New Roman", "Songti SC", serif; }
a { color: #000; }
.nav { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 8px; }
.nav a { margin-right: 12px; }
.nav.bottom { border-top: 1px solid #000; border-bottom: 0; padding-top: 8px; margin-top: 32px; }
h1 { font-size: 28px; line-height: 1.3; } h2 { font-size: 25px; line-height: 1.3; }
h3 { font-size: 22px; line-height: 1.35; } h4, h5, h6 { font-size: 19px; }
img.m { max-width: 100%; height: auto; }
table.ltx_equation, table.ltx_eqn_table, table.ltx_equationgroup { width: 100%; margin: 10px 0; border-collapse: collapse; }
table.ltx_equation { table-layout: fixed; }
.ltx_eqn_center_padleft, .ltx_eqn_center_padright { width: 0; padding: 0 !important; }
.ltx_eqn_cell { padding: 2px 0; }
.ltx_align_center { text-align: center; } .ltx_align_right { text-align: right; } .ltx_align_left { text-align: left; }
.ltx_eqn_eqno { text-align: right; width: 2.8em; white-space: nowrap; font-size: 16px; }
.ltx_theorem, .ltx_proof { margin: 14px 0; padding: 4px 0 4px 10px; border-left: 3px solid #000; }
.ltx_listing, pre { font: 14px/1.45 Menlo, Consolas, monospace; white-space: normal; overflow-wrap: anywhere;
  background: #f2f2f2; padding: 8px; margin: 12px 0; }
.ltx_listingline { display: block; white-space: pre-wrap; }
/* 多行对齐的公式组不缩小（缩了看不清），太宽时可以横着拖 */
table.ltx_equationgroup img.m { max-width: none; }
figure { margin: 18px 0; text-align: center; }
figure img { max-width: 100%; height: auto; }
figcaption { font-size: 16px; }
table.ltx_tabular { margin: 10px auto; border-collapse: collapse; font-size: 16px; }
.ltx_tabular td, .ltx_tabular th { padding: 2px 6px; }
.ltx_border_t { border-top: 1px solid #000; } .ltx_border_b { border-bottom: 1px solid #000; }
.ltx_border_tt { border-top: 2px solid #000; } .ltx_border_bb { border-bottom: 2px solid #000; }
.ltx_border_l { border-left: 1px solid #000; } .ltx_border_r { border-right: 1px solid #000; }
.overflow { overflow-x: auto; }
code.tex { font-size: 15px; }
ol.toc, ol.toc ol { padding-left: 1.2em; } ol.toc li { margin: 4px 0; }
.credit { margin-top: 28px; font-size: 14px; line-height: 1.6; color: #333; }
.ltx_bibitem { margin: 6px 0; }
.footnotes { margin-top: 28px; padding-top: 8px; border-top: 1px solid #000; font-size: 16px; }
.footnotes h4 { margin: 0 0 6px; }
</style>"""


def credit(meta):
    return (f'<p class="credit">本书：{html.escape(meta["title"])}，作者 {html.escape(meta["author"])}。'
            f'原文：<a href="https://arxiv.org/abs/{meta["arxiv"]}">arXiv:{meta["arxiv"]}</a>，'
            f'按 <a href="{meta["license_url"]}">{meta["license"]}</a> 许可发布。'
            '本站（gamesyuan.com）把 arXiv 网页版改成分章的纯 HTML，把公式渲染成图片，方便在 Kindle 等电子书阅读器上看，'
            '内容没有改动。转换难免有错，以原文为准。本站与作者和出版社无关。</p>')


def page(meta, title, body, nav):
    bottom = nav.replace('class="nav"', 'class="nav bottom"')
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{html.escape(title)} · {html.escape(meta["title"])}</title>'
            f'<link rel="canonical" href="https://arxiv.org/abs/{meta["arxiv"]}">'
            f'{STYLE}</head><body>{nav}{body}{bottom}'
            f'{credit(meta)}</body></html>\n')


def title_text(section):
    head = section.find(re.compile('^h[1-6]$'), class_=re.compile('ltx_title'))
    return re.sub(r'\s+', ' ', head.get_text(' ', strip=True)) if head else ''


def convert(book_id, arxiv, work, site_root):
    out = os.path.join(site_root, 'research', 'books', book_id)
    os.makedirs(os.path.join(out, 'img'), exist_ok=True)
    soup = BeautifulSoup(open(os.path.join(work, 'book.html'), encoding='utf-8').read(), 'lxml')
    article = soup.find('article')
    src = os.path.join(work, 'src')
    base = f'https://arxiv.org/html/{arxiv}/'

    meta = {
        'title': title_text(article) or book_id,
        'author': article.find(class_='ltx_personname').get_text(' ', strip=True) if article.find(class_='ltx_personname') else '',
        'arxiv': arxiv,
        'license': 'CC BY 4.0',
        'license_url': 'https://creativecommons.org/licenses/by/4.0/',
    }

    # ---------- 清理：arXiv 网页版的附加物 ----------
    for node in article.find_all(class_=['ltx_TOC', 'ltx_index', 'ltx_pagination', 'ltx_page_footer']):
        node.decompose()
    for node in article.find_all(string=lambda t: isinstance(t, Comment)):
        node.extract()
    for link in article.find_all('a', href=re.compile('^data:')):
        link.decompose()  # 代码清单的「下载」链接，内嵌了整段代码
    for node in article.find_all(['button']):
        node.decompose()
    # LaTeXML 不认的命令（\chaptermark{页眉短标题}）：连同它的参数段落一起去掉
    for error in article.find_all(class_='ltx_ERROR'):
        if error.get_text(strip=True) == '\\chaptermark' and error.parent is not None:
            error.parent.decompose()

    # ---------- 插图 ----------
    figures_dir = os.path.join(src, 'figures')
    for node in article.find_all(['img', 'object']):
        ref = node.get('src') or node.get('data') or ''
        if not ref or ref.startswith('http'):
            continue
        name = os.path.basename(ref)
        stem, ext = os.path.splitext(name)
        target = os.path.join(out, 'img', stem + '.png')
        pdf = os.path.join(figures_dir, stem + '.pdf')
        ok = os.path.exists(target)
        if not ok and os.path.exists(pdf):
            subprocess.run(['pdftoppm', '-png', '-gray', '-r', '170', '-singlefile', pdf, os.path.join(out, 'img', stem)], check=False)
            ok = os.path.exists(target)
        if not ok:
            target = os.path.join(out, 'img', name)
            ok = fetch(f'https://arxiv.org/html/{ref}', target)
        img = soup.new_tag('img', src='img/' + os.path.basename(target), alt=node.get('alt') or '插图')
        node.replace_with(img)

    # ---------- 公式 ----------
    maths = article.find_all('math')
    formulas, keys = {}, []
    for node in maths:
        tex = node.get('alttext') or ''
        # LaTeXML 把用 picture 画的宏（这本书的独立符号 \ind、\nind）展开成了 latex 不认的写法，换回宏名
        tex = PICTURE.sub(lambda m: '\\nind ' if '/' in m.group(0) or '\\it' in m.group(0) else '\\ind ', tex)
        display = node.get('display') == 'block'
        key = hashlib.md5(((('D' if display else 'I') + tex)).encode('utf-8')).hexdigest()[:12]
        formulas[key] = (key, tex, display)
        keys.append(key)
    print(f'公式 {len(maths)} 处，不重复的 {len(formulas)} 个')
    rendered = render_math(list(formulas.values()), book_macros(src), os.path.join(out, 'm'), os.path.join(work, 'latex'))
    for node, key in zip(maths, keys):
        tex = formulas[key][1]
        if key in rendered:
            file, width, depth = rendered[key]
            img = soup.new_tag('img', src=f'm/{file}', alt=tex)
            img['class'] = 'm'
            # 按宽度定大小：屏幕太窄时整条公式等比缩小，不会被切掉
            img['style'] = f'width:{width:.2f}em;vertical-align:-{depth:.2f}em'
            node.replace_with(img)
        else:
            code = soup.new_tag('code')
            code['class'] = 'tex'
            code.string = f'${tex}$'
            node.replace_with(code)

    # 宽表格和长公式在小屏上可以横着拖
    for table in article.find_all('table', class_=['ltx_tabular', 'ltx_equationgroup']):
        wrapper = soup.new_tag('div')
        wrapper['class'] = 'overflow'
        table.wrap(wrapper)

    # ---------- 分页：一章（或附录、前言）一页 ----------
    pages = []  # (file, title, element, part)
    part = None
    counter = 0

    def add(element, part_title):
        nonlocal counter
        counter += 1
        pages.append((f'{counter:02d}.html', title_text(element), element, part_title))

    for child in article.find_all(recursive=False):
        classes = child.get('class') or []
        if 'ltx_part' in classes:
            part = title_text(child)
            for sub in child.find_all(recursive=False):
                sub_classes = sub.get('class') or []
                if 'ltx_chapter' in sub_classes or 'ltx_appendix' in sub_classes or 'ltx_bibliography' in sub_classes:
                    add(sub, part)
        elif 'ltx_chapter' in classes or 'ltx_appendix' in classes or 'ltx_bibliography' in classes:
            add(child, part)

    # 站内链接：#id → 所在页面#id
    where = {}
    for file, _, element, _ in pages:
        if element.get('id'):
            where[element['id']] = file
        for node in element.find_all(id=True):
            where[node['id']] = file
    for file, _, element, _ in pages:
        for link in element.find_all('a', href=True):
            href = link['href']
            target = href.split('#', 1)[1] if '#' in href else None
            if target and (href.startswith('#') or href.startswith(base) or 'arxiv.org/html' in href):
                if target in where:
                    link['href'] = ('' if where[target] == file else where[target]) + '#' + target

    # 脚注：arXiv 网页版要鼠标悬停才看得到，Kindle 上看不到。挪到每页末尾，正文里留编号链接
    for _, _, element, _ in pages:
        notes = []
        for note in element.find_all('span', class_='ltx_role_footnote'):
            content = note.find(class_='ltx_note_content')
            mark = note.find(class_='ltx_note_mark')
            number = mark.get_text(strip=True) if mark else str(len(notes) + 1)
            if content is None:
                continue
            for extra in content.find_all(class_=['ltx_note_mark', 'ltx_tag_note']):
                extra.decompose()
            anchor = f'fn-{element.get("id", "p")}-{number}'
            ref = soup.new_tag('sup')
            link = soup.new_tag('a', href=f'#{anchor}', id=f'{anchor}-ref')
            link.string = number
            ref.append(link)
            notes.append((anchor, number, content.decode_contents().strip()))
            note.replace_with(ref)
        if notes:
            box = BeautifulSoup('<section class="footnotes"><h4>脚注</h4>' + ''.join(
                f'<p id="{a}"><a href="#{a}-ref">{n}</a>. {c}</p>' for a, n, c in notes) + '</section>', 'lxml').section
            element.append(box)

    # 没有链接指向的 id 去掉，页面小一些（Kindle 加载快）
    wanted = set()
    for _, _, element, _ in pages:
        for link in element.find_all('a', href=True):
            if '#' in link['href']:
                wanted.add(link['href'].split('#', 1)[1])
            if link.get('id'):
                wanted.add(link['id'])
    for _, _, element, _ in pages:
        for node in element.find_all(id=True):
            if node['id'] not in wanted and node.name not in ('section', 'p'):
                del node['id']

    # ---------- 写文件 ----------
    toc_items, current_part = [], None
    for index, (file, title, element, part_title) in enumerate(pages):
        prev = pages[index - 1] if index else None
        nxt = pages[index + 1] if index + 1 < len(pages) else None
        nav = ('<p class="nav"><a href="index.html">目录</a>'
               + (f'<a href="{prev[0]}">← 上一章</a>' if prev else '')
               + (f'<a href="{nxt[0]}">下一章 →</a>' if nxt else '')
               + '<a href="/research/?view=books">研究园</a></p>')
        with open(os.path.join(out, file), 'w', encoding='utf-8') as handle:
            handle.write(page(meta, title, str(element), nav))
        if part_title != current_part:
            if current_part is not None:
                toc_items.append('</ol></li>')
            if part_title:
                toc_items.append(f'<li><b>{html.escape(part_title)}</b><ol>')
            current_part = part_title
        toc_items.append(f'<li><a href="{file}">{html.escape(title)}</a></li>')
    if current_part is not None:
        toc_items.append('</ol></li>')
    nav = '<p class="nav"><a href="/research/?view=books">← 研究园</a><a href="01.html">从头读 →</a></p>'
    body = (f'<h1>{html.escape(meta["title"])}</h1><p>{html.escape(meta["author"])}</p>'
            '<p>点章节名开始读。每章一页，公式是图片，Kindle 的浏览器也能看。</p>'
            '<ol class="toc">' + ''.join(toc_items) + '</ol>')
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as handle:
        handle.write(page(meta, '目录', body, nav))
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out) for f in fs)
    print(f'写好 {len(pages)} 页 → {os.path.relpath(out)}（共 {total // 1024} KB）')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)
    here = os.path.dirname(os.path.abspath(__file__))
    convert(sys.argv[1], sys.argv[2], sys.argv[3], os.path.join(here, '..', '..'))
