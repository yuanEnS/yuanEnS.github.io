#!/usr/bin/env python3
"""研究园：把文献周报和按年整理的期刊目录变成 research/papers/（按年分文件）和简易版。

用法（在网站仓库根目录）：
    python3 research/tools/build.py ../journal ../journal2

参数是一个或几个文件夹，里面的 .md 都会读（子文件夹也读）：
  - journal/：每周的周报，文件名带日期（2026-05-08.md），这个日期记作「收录于」。
  - journal2/：按期刊、按年份整理的目录（journal2/JRSSB/README_JRSSB_2023.md），每篇带发表日期。
另外读两个手工维护的文件：research/books.json（经典书籍）、research/articles.json（本站有原文的文章）。

输出：
  research/papers/index.json   年份、期刊、主题列表，和每篇文章的筛选信息（不带摘要，很小），用来算每个选项有多少篇
  research/papers/<年>.json     这一年的文章全文信息（标题、作者、摘要……），选了这一年才下载
  research/lite/               不用 JavaScript 的简易版

做的事：
  1. 读所有 .md（几种写法都认：「- Journal:」「**Journal:**」「**Title**:」等）。
  2. 只留统计期刊和 JMLR、Econometrica（STAT_JOURNALS），Nature、Science、流行病学、生信、预印本都不要。
  3. 同一篇文章在几份周报里重复出现时按 DOI（没有 DOI 时按标题）合并，保留最好的英文摘要。
  4. 按标题、摘要、关键词打主题标签（TOPICS），一篇最多三个。
  5. 链接只用 DOI 或出版社自己的网址；邮件里的点击跟踪链接（带个人标识）一律不用。
  6. 另外生成纯 HTML 的简易版 research/lite/（不用 JavaScript），给 Kindle 和老浏览器看。
重复运行是安全的：每次从头生成，结果只取决于 journal 文件夹里的内容。
"""
import glob
import json
import shutil
import os
import re
import sys
from urllib.parse import quote

# ---------- 期刊 ----------
# 代码 → (显示的简称, 全称)
STAT_JOURNALS = {
    'JASA': ('JASA', 'Journal of the American Statistical Association'),
    'AOS': ('AoS', 'Annals of Statistics'),
    'JRSSB': ('JRSSB', 'Journal of the Royal Statistical Society Series B'),
    'JRSSA': ('JRSSA', 'Journal of the Royal Statistical Society Series A'),
    'JRSSC': ('JRSSC', 'Journal of the Royal Statistical Society Series C'),
    'BIOMETRIKA': ('Biometrika', 'Biometrika'),
    'BIOMETRICS': ('Biometrics', 'Biometrics'),
    'SIM': ('SiM', 'Statistics in Medicine'),
    'SMMR': ('SMMR', 'Statistical Methods in Medical Research'),
    'JSSAM': ('JSSAM', 'Journal of Survey Statistics and Methodology'),
    'TAS': ('TAS', 'The American Statistician'),
    'JMLR': ('JMLR', 'Journal of Machine Learning Research'),
    'ECTA': ('Econometrica', 'Econometrica'),
}

# DOI 前缀认期刊，最可靠
DOI_JOURNAL = [
    ('10.1080/01621459', 'JASA'), ('10.1214/', None), ('10.1093/jrsssb', 'JRSSB'), ('10.1111/rssb', 'JRSSB'),
    ('10.1093/jrsssa', 'JRSSA'), ('10.1111/rssa', 'JRSSA'), ('10.1093/jrsssc', 'JRSSC'), ('10.1111/rssc', 'JRSSC'),
    ('10.1093/biomet', 'BIOMETRIKA'), ('10.1093/biomtc', 'BIOMETRICS'), ('10.1111/biom', 'BIOMETRICS'),
    ('10.1002/sim', 'SIM'), ('10.1177/09622802', 'SMMR'), ('10.1093/jssam', 'JSSAM'), ('10.1080/00031305', 'TAS'),
    ('10.3982/ecta', 'ECTA'),
]
# 期刊名的写法（按顺序匹配，先长后短）
NAME_JOURNAL = [
    (r'royal statistical society,? series b|\bjrss-?b\b', 'JRSSB'),
    (r'royal statistical society,? series a|\bjrss-?a\b', 'JRSSA'),
    (r'royal statistical society,? series c|\bjrss-?c\b', 'JRSSC'),
    (r'journal of the american statistical association|\bjasa\b', 'JASA'),
    (r'annals of statistics|\baos\b', 'AOS'),
    (r'statistical methods in medical research|\bsmmr\b', 'SMMR'),
    (r'statistics in medicine|\bstat med\b', 'SIM'),
    (r'survey statistics and methodology|\bjssam\b', 'JSSAM'),
    (r'american statistician', 'TAS'),
    (r'machine learning research|\bjmlr\b', 'JMLR'),
    (r'\beconometrica\b', 'ECTA'),
    (r'\bbiometrika\b', 'BIOMETRIKA'),
    (r'\bbiometrics\b', 'BIOMETRICS'),
]
URL_JOURNAL = [
    ('academic.oup.com/biometrics', 'BIOMETRICS'), ('academic.oup.com/biomet', 'BIOMETRIKA'),
    ('academic.oup.com/jrsssa', 'JRSSA'), ('academic.oup.com/jrsssb', 'JRSSB'), ('academic.oup.com/jrsssc', 'JRSSC'),
    ('academic.oup.com/jssam', 'JSSAM'), ('/doi/10.1002/sim', 'SIM'), ('jmlr.org/papers', 'JMLR'),
    ('econometricsociety.org/publications/econometrica', 'ECTA'),
]
# journal2 按期刊分的文件夹名
FOLDER_JOURNAL = {'aos': 'AOS', 'biometrics': 'BIOMETRICS', 'biometrika': 'BIOMETRIKA', 'econometrica': 'ECTA',
                  'jasa': 'JASA', 'jmlr': 'JMLR', 'jrssb': 'JRSSB', 'jrssa': 'JRSSA', 'jrssc': 'JRSSC', 'smmr': 'SMMR',
                  'statmed': 'SIM', 'sim': 'SIM', 'jssam': 'JSSAM', 'tas': 'TAS'}
# 统计期刊里的 Sage 只订了 SMMR，邮件提醒里的 Sage 链接都是它
SAGE_ALERT = 'sagepub.com/ls/click'

# 可以放到网页上的链接（出版社和公共索引）。其余的多半是邮件里的跟踪链接，不用
SAFE_HOSTS = ('doi.org', 'dx.doi.org', 'academic.oup.com', 'onlinelibrary.wiley.com', 'www.tandfonline.com',
              'tandfonline.com', 'projecteuclid.org', 'imstat.org', 'journals.sagepub.com', 'pubmed.ncbi.nlm.nih.gov',
              'arxiv.org', 'www.jmlr.org', 'jmlr.org', 'www.econometricsociety.org', 'www.nber.org', 'ideas.repec.org')

# ---------- 主题 ----------
# 标签 → 关键词（小写，正则）。标题里出现算 3 分，关键词里 2 分，摘要里 1 分；够 3 分才打上
TOPICS = [
    ('Causal Inference', r'causal|treatment effect|potential outcome|counterfactual|propensity score|instrumental variable'
     r'|mendelian randomi[sz]ation|confound|mediation|doubly robust|treatment regime|individuali[sz]ed treatment'
     r'|target trial|difference-in-differences|synthetic control|interference|policy learning|off-policy|uplift'
     r'|observational stud|sensitivity model|heterogeneous (treatment )?effect|evidence factor|balancing weight'),
    ('Survival Analysis', r'surviv|hazard|time-to-event|censor|\bcox\b|competing risk|recurrent event|cure model'
     r'|failure time|accelerated failure|restricted mean'),
    ('Longitudinal Data', r'longitudinal|repeated measure|mixed[- ]effects?|mixed model|panel data|growth curve'
     r'|trajector|joint model|ecological momentary|intensive measure'),
    ('Clinical Trials', r'clinical trial|randomi[sz]ed controlled|adaptive design|dose[- ]finding|phase i|sample size'
     r'|interim analys|basket trial|platform trial|non-?inferiority|cluster randomi[sz]ed|stepped[- ]wedge|estimand'),
    ('Bayesian Methods', r'bayes|posterior|\bprior\b|mcmc|markov chain monte carlo|variational inference|gibbs sampl'),
    ('High-Dimensional', r'high[- ]dimension|sparse|sparsity|lasso|variable selection|penali[sz]ed|feature selection'),
    ('Machine Learning', r'neural network|deep learning|machine learning|random forest|reinforcement learning'
     r'|generative model|diffusion model|transformer|large language model|\bllm|artificial intelligence|boosting'),
    ('Testing & Uncertainty', r'multiple testing|false discovery|\bfdr\b|hypothesis test|p-value|e-value|selective inference'
     r'|conformal|confidence (interval|set|band)|anytime-valid|permutation test|randomi[sz]ation test|bootstrap|knockoff'),
    ('Missing Data & Measurement Error', r'missing data|missingness|imputation|measurement error|misclassif|missing not at random'),
    ('Spatial & Time Series', r'spatial|spatio-temporal|time series|forecast|point process|autoregress|garch|volatility'
     r'|hawkes|jump-diffusion|change[- ]point'),
    ('Functional Data', r'functional data|functional regression|functional principal|curves? data'),
    ('Networks & Graphs', r'network|graphical model|\bgraph'),
    ('Latent Variables & Mixtures', r'latent|factor model|factor analysis|mixture model|clustering|item response|hidden markov'),
    ('Survey & Sampling', r'\bsurvey|sampling design|small area|nonresponse|official statistics|census'),
    ('Genetics & Omics', r'genetic|genom|gwas|single-cell|rna-seq|omics|microbiome|sequencing|polygenic'),
    ('Meta-Analysis & Data Integration', r'meta-analys|evidence synthesis|data integration|transfer learning|federated|distributed|multi-source'),
    ('Nonparametric & Semiparametric', r'nonparametric|semiparametric|kernel|efficient influence|empirical likelihood'
     r'|quantile regression|spline|copula|rank-based|kendall'),
    ('Optimization & Learning Theory', r'regret|bandit|online (convex )?optimi|optimi[sz]ation|stochastic gradient|gradient descent'
     r'|generali[sz]ation (bound|error)|overfitting|wasserstein|optimal transport|markov decision|q-learning'
     r'|matrix factori[sz]ation|sample complexity|learnab'),
    ('Econometrics & Economics', r'econom|market|\btrade\b|wage|labou?r|\btax|monetary|inflation|financ|auction'
     r'|mechanism design|incentive|equilibri|game theor|partial identification|set-valued|incidental parameter|external validity'),
    ('Diagnostics & Prediction', r'prediction model|risk prediction|diagnostic accuracy|biomarker|calibration|roc curve|\bauc\b|dynamic prediction'),
]
TOPIC_ZH = {
    'Causal Inference': '因果推断', 'Survival Analysis': '生存分析', 'Longitudinal Data': '纵向数据',
    'Clinical Trials': '临床试验', 'Bayesian Methods': '贝叶斯', 'High-Dimensional': '高维与变量选择',
    'Machine Learning': '机器学习', 'Testing & Uncertainty': '检验与不确定性', 'Missing Data & Measurement Error': '缺失与测量误差',
    'Spatial & Time Series': '空间与时间序列', 'Functional Data': '函数型数据', 'Networks & Graphs': '网络与图',
    'Latent Variables & Mixtures': '潜变量与混合模型', 'Survey & Sampling': '调查抽样', 'Genetics & Omics': '遗传与组学',
    'Meta-Analysis & Data Integration': 'Meta 分析与数据融合', 'Nonparametric & Semiparametric': '非参数与半参数',
    'Diagnostics & Prediction': '诊断与预测', 'Optimization & Learning Theory': '优化与学习理论',
    'Econometrics & Economics': '计量与经济', 'Other': '其他',
}
TOPIC_RE = [(name, re.compile(pattern, re.I)) for name, pattern in TOPICS]
MAX_TOPICS = 3

# ---------- 解析 ----------
FIELD = re.compile(r'^\s*(?:[-*]\s+)?\*{0,2}(Title|Authors|Keywords|Journal|Link|Abstract|DOI|Date|Published)\b\*{0,2}'
                   r'\s*[:：]?\s*\*{0,2}\s*[:：]?\s*(.*)$', re.I)
HEAD = re.compile(r'^#{2,4}\s+(?:\d+\.\s+)(.+?)\s*$')
DOI_RE = re.compile(r'10\.\d{4,9}/[^\s)\]>"\'<,;]+')
URL_RE = re.compile(r'https?://[^\s)\]>"\'<]+')
CJK = re.compile(r'[一-鿿]')
REPORT_DATE = re.compile(r'(\d{4}-\d{2}-\d{2})')
ONLINE_DATE = re.compile(r'online\s+(\d{4}-\d{2}-\d{2})', re.I)


def parse_file(path):
    entries, cur, last = [], None, None
    for line in open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        head = HEAD.match(line)
        if head:
            cur = {'title': head.group(1)}
            entries.append(cur)
            last = None
            continue
        field = FIELD.match(line)
        if field:
            key, value = field.group(1).lower(), field.group(2).strip()
            if key == 'title':
                # 「**Title**:」开头的写法：一个新条目
                if cur is None or cur.get('journal') or cur.get('abstract') or cur.get('_titled'):
                    cur = {}
                    entries.append(cur)
                cur['title'] = value
                cur['_titled'] = True
                last = 'title'
                continue
            if cur is not None:
                cur[key] = value
                last = key
            continue
        if line.startswith('#') or line.strip() in ('---', '***') or line.startswith('<a id') or line.startswith('|'):
            last = None
            continue
        if last == 'abstract' and cur is not None and line.strip():
            cur['abstract'] += ' ' + line.strip()
    return [e for e in entries if e.get('title') and (e.get('journal') or e.get('link') or e.get('doi'))]


def clean_md(text):
    text = re.sub(r'<[^>]+>', '', text or '')
    text = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', text)
    text = text.replace('**', '').replace('&amp;', '&')
    return re.sub(r'\s+', ' ', text).strip()


def find_doi(entry):
    for key in ('doi', 'link', 'abstract'):
        match = DOI_RE.search(entry.get(key, '') or '')
        if match:
            return match.group(0).rstrip('.').lower()
    return None


def journal_of(entry, doi, default):
    if doi:
        for prefix, code in DOI_JOURNAL:
            if doi.startswith(prefix):
                if code:
                    return code
                if '-aos' in doi or 'aos' in doi.split('/')[-1]:
                    return 'AOS'
    link = entry.get('link', '') or ''
    for part, code in URL_JOURNAL:
        if part in link:
            return code
    name = clean_md(entry.get('journal', '')).lower()
    if re.search(r'\bnature\b|\bscience\b|epidemiology|bioinformatics|arxiv', name):
        return None
    for pattern, code in NAME_JOURNAL:
        if re.search(pattern, name):
            return code
    if SAGE_ALERT in link:
        return 'SMMR'
    if not name or name.startswith('unknown'):
        return default
    return None


def safe_link(entry, doi):
    if doi:
        return f'https://doi.org/{doi}'
    urls = [url.rstrip('.,') for url in URL_RE.findall(entry.get('link', '') or '') if url.split('/')[2].lower() in SAFE_HOSTS]
    # Econometrica 的「即将刊出」总页面不指向具体文章，有工作论文的地址时用那个
    urls.sort(key=lambda url: 'forthcoming-papers' in url)
    return urls[0] if urls else None


BAD_ABSTRACT = re.compile(r'read article|not available|not retrieved|abstract not|未能获取|未获取|无法获取', re.I)


def abstract_score(text):
    if not text or len(text) < 80 or BAD_ABSTRACT.search(text):
        return -1
    zh = len(CJK.findall(text)) / max(1, len(text))
    return (2 if zh < 0.05 else 1) * 100000 + min(len(text), 5000)


def clean_abstract(text):
    text = clean_md(text)
    text = re.sub(r'^abstract[:.]?\s*', '', text, flags=re.I)
    return text.strip('"“” ')


def tidy_title(title):
    title = clean_md(title)
    title = re.sub(r'\s*\{#[^}]*\}$', '', title)
    return title.rstrip('.').strip()


ERRATUM = re.compile(r'^(correction|corrigendum|erratum|retraction)\b', re.I)
DISCUSSION = re.compile(r'contribution to the discussion|^discussion of|^discussion on|^rejoinder|^commentary|^comment on'
                        r'|^response to|^reply to|^book review|^vote of thanks|^proposer of the vote|seconder of the vote', re.I)


def title_key(title):
    return re.sub(r'[^a-z0-9]', '', title.lower())


def keyword_text(entry):
    text = clean_md(entry.get('keywords', ''))
    # 自动抽的关键词里有很多碎词，权重低，只当摘要用
    return text


def topics_of(title, keywords, abstract):
    scores = {}
    for name, pattern in TOPIC_RE:
        score = 3 * len(pattern.findall(title)) + 2 * min(2, len(pattern.findall(keywords))) + min(3, len(pattern.findall(abstract)))
        if score >= 3:
            scores[name] = score
    ranked = sorted(scores, key=lambda n: -scores[n])[:MAX_TOPICS]
    return ranked or ['Other']


def published_date(entry, file_year=None):
    """「**Published:** online 2023-01-27; print/issue 2023-02-27」取网上首发的日期，没有就取第一个日期；
    只写了年份的（Econometrica「online 2021」、JMLR「Vol. 21, no. 37, 2020」）只记年份；
    什么都没写的，用目录文件名里的年份（README_JRSSB_2023.md 收的就是 2023 年首发的）"""
    text = entry.get('published') or entry.get('date') or ''
    found = ONLINE_DATE.search(text) or REPORT_DATE.search(text)
    if found:
        return found.group(1)
    year = re.search(r'\b(?:19|20)\d{2}\b', text)
    return year.group(0) if year else file_year


def build(folders):
    papers = {}
    by_title = {}
    files = []
    for folder in folders:
        files += sorted(glob.glob(os.path.join(folder, '**', '*.md'), recursive=True))
    for path in files:
        name = os.path.basename(path)
        if name.lower().startswith('arxiv'):
            continue  # 预印本，不是期刊
        found = REPORT_DATE.search(name)
        week = found.group(1) if found else None  # 只有周报的文件名带完整日期
        file_year = None if week else (re.search(r'(?:19|20)\d{2}', name) or [None])[0]
        with open(path, encoding='utf-8') as handle:
            first = handle.readline()
        default = FOLDER_JOURNAL.get(os.path.basename(os.path.dirname(path)).lower())
        if not default and 'Statistics in Medicine' in first:
            default = 'SIM'
        for entry in parse_file(path):
            doi = find_doi(entry)
            code = journal_of(entry, doi, default)
            if code not in STAT_JOURNALS:
                continue
            title = tidy_title(entry['title'])
            if not title or ERRATUM.search(title):
                continue
            key = doi or title_key(title)
            tkey = title_key(title)
            paper = papers.get(key) or (by_title.get(tkey) if tkey else None)
            if paper is None:
                paper = {'doi': doi, 'title': title, 'journal': code, 'authors': '', 'abstract': '', '_score': -1,
                         'week': week, 'date': None, 'keywords': '', 'link': None}
                papers[key] = paper
            if tkey:
                by_title[tkey] = paper
            if doi and not paper['doi']:
                paper['doi'] = doi
            if week and (not paper['week'] or week < paper['week']):
                paper['week'] = week
            date = published_date(entry, file_year)
            if date and (not paper['date'] or date < paper['date']):
                paper['date'] = date
            authors = clean_md(entry.get('authors', ''))
            authors = re.sub(r'\s*\([^)]*\)', '', authors)  # 去掉单位
            if authors and (not paper['authors'] or len(authors) < len(paper['authors']) and paper['authors'].count('(')):
                paper['authors'] = authors
            elif authors and not paper['authors']:
                paper['authors'] = authors
            abstract = clean_abstract(entry.get('abstract', ''))
            score = abstract_score(abstract)
            if score > paper['_score']:
                paper['abstract'], paper['_score'] = abstract, score
            keywords = keyword_text(entry)
            if len(keywords) > len(paper['keywords']):
                paper['keywords'] = keywords
            link = safe_link(entry, doi)
            if link and (not paper['link'] or 'doi.org' in link):
                paper['link'] = link

    out = []
    for paper in {id(p): p for p in papers.values()}.values():
        zh = paper['_score'] >= 0 and paper['_score'] < 200000
        link = paper['link'] or 'https://scholar.google.com/scholar?q=' + quote(paper['title'])
        out.append({
            'id': paper['doi'] or title_key(paper['title'])[:40],
            'title': paper['title'],
            'authors': paper['authors'],
            'journal': STAT_JOURNALS[paper['journal']][0],
            'topics': topics_of(paper['title'], paper['keywords'], paper['abstract'] if paper['_score'] >= 0 else ''),
            'date': paper['date'] or paper['week'],  # 发表日期；周报里没写的用收录日期
            'week': paper['week'],
            'link': link,
            'abstract': paper['abstract'] if paper['_score'] >= 0 else '',
            'abstractZh': zh,  # 只有周报里的中文概述，不是原文
        })
        if DISCUSSION.search(paper['title']):
            out[-1]['discussion'] = True  # 讨论、评论、回应，不是研究论文
    out.sort(key=lambda p: (p['date'] or '', p['title']), reverse=True)
    return out


def add_articles(papers, articles):
    """research/articles.json：本站有原文（分章或全文网页）的文章。能对上的给它加 reader，对不上的单独加一条。"""
    by_doi = {p['link'].split('doi.org/')[-1].lower(): p for p in papers if 'doi.org/' in p['link']}
    by_title = {title_key(p['title']): p for p in papers}
    added = 0
    for item in articles:
        doi = (item.get('doi') or '').lower() or None
        paper = (by_doi.get(doi) if doi else None) or by_title.get(title_key(item['title']))
        if paper is None:
            code = item.get('journal') or 'arXiv'
            paper = {
                'id': doi or item.get('arxiv') or title_key(item['title'])[:40],
                'title': item['title'], 'authors': ', '.join(item.get('authors', [])) if isinstance(item.get('authors'), list) else item.get('authors', ''),
                'journal': code, 'topics': item.get('topics') or topics_of(item['title'], '', item.get('abstract', '')),
                'date': item.get('date') or str(item.get('year', '')) or None, 'week': None,
                'link': item.get('link') or (f'https://doi.org/{doi}' if doi else f'https://arxiv.org/abs/{item["arxiv"]}' if item.get('arxiv') else item['reader']),
                'abstract': item.get('abstract', ''), 'abstractZh': False,
            }
            papers.append(paper)
            added += 1
        paper['reader'] = item['reader']
    papers.sort(key=lambda p: (p['date'] or '', p['title']), reverse=True)
    return added


# ---------- 简易版：纯 HTML，不用 JavaScript，给 Kindle 和老浏览器 ----------
LITE_PER_PAGE = 40
LITE_STYLE = """<style>
body { margin: 0 auto; max-width: 760px; padding: 12px 16px 40px; background: #fff; color: #000;
  font: 19px/1.6 Georgia, "Times New Roman", "Songti SC", serif; }
a { color: #000; }
h1 { font-size: 28px; margin: 12px 0 4px; }
h2 { font-size: 21px; margin: 24px 0 8px; }
.nav, .meta, .authors, .note, .pager { font-size: 16px; }
.meta { margin: 0; }
.tag { border: 1px solid #000; padding: 0 4px; }
.journal { background: #000; color: #fff; padding: 0 5px; }
article { padding: 14px 0; border-bottom: 1px solid #000; }
article h3 { font-size: 20px; margin: 6px 0 4px; font-weight: normal; }
.authors { margin: 0; color: #333; }
details { margin-top: 6px; }
summary { text-decoration: underline; }
.abstract { margin: 6px 0 0; }
ul.links { padding-left: 1.2em; }
ul.links li { margin: 6px 0; }
.pager { margin-top: 20px; }
.pager a, .pager b { margin-right: 10px; }
</style>"""


def esc(text):
    return (str(text or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;'))


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def lite_page(title, body, canonical=None):
    head = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{esc(title)} · 研究园简易版</title><meta name="robots" content="noindex">'
            f'{LITE_STYLE}</head><body>')
    nav = ('<p class="nav"><a href="/research/lite/">研究园简易版</a> · <a href="books.html">经典书籍</a> · <a href="papers.html">期刊文章</a> · '
           '<a href="fulltext.html">有原文</a> · '
           '<a href="/research/?full=1">完整版（可多选筛选、搜索）</a> · <a href="/">首页</a></p>')
    search = ('<form action="https://api.gamesyuan.com/search" method="get"><input type="search" name="q" '
              'placeholder="搜论文、作者、书里的内容" aria-label="搜索" style="font-size:18px;padding:4px;width:60%">'
              '<input type="hidden" name="in" value="research"> <button type="submit" style="font-size:18px">搜索</button></form>')
    return head + nav + search + body + '</body></html>\n'


def year_of(paper):
    return int(paper['date'][:4]) if paper.get('date') else 0


def anchor(paper):
    return 'p-' + re.sub(r'[^a-z0-9]+', '-', paper['id'].lower()).strip('-')[:60]


def lite_item(paper, page_of):
    """一篇文章。page_of(paper, kind, value) 给出这篇所在的简易版页面"""
    year = year_of(paper)
    topics = ' '.join(f'<a class="tag" href="y{year}-t-{slug(t)}.html">{esc(t)}</a>' for t in paper['topics'])
    kind = ' <span class="tag">讨论 / 评论</span>' if paper.get('discussion') else ''
    full = f' <a class="tag" href="{esc(paper["reader"])}"><b>有原文</b></a>' if paper.get('reader') else ''
    when = f'发表于 {esc(paper["date"] or "—")}' + (f'，收录于 {esc(paper["week"])}' if paper.get('week') and paper['week'] != paper['date'] else '')
    html = (f'<article id="{anchor(paper)}"><p class="meta"><a class="journal" href="y{year}-j-{slug(paper["journal"])}.html">{esc(paper["journal"])}</a> '
            f'{topics}{kind}{full} · {when}</p>'
            f'<h3><a href="{esc(paper["link"])}">{esc(paper["title"])}</a></h3>')
    if paper['authors']:
        html += f'<p class="authors">{esc(paper["authors"])}</p>'
    if paper.get('reader'):
        html += f'<p class="meta"><a href="{esc(paper["reader"])}">在本站读原文 →</a></p>'
    if paper['abstract']:
        label = '中文概述（非原文摘要）' if paper['abstractZh'] else '摘要'
        html += f'<details><summary>{label}</summary><p class="abstract">{esc(paper["abstract"])}</p></details>'
    return html + '</article>'


def lite_book(book, newest):
    first = (book.get('links') or [{}])[0].get('url')
    title = f'<a href="{esc(first)}">{esc(book["title"])}</a>' if first else esc(book['title'])
    by = ' · '.join(str(x) for x in [', '.join(book.get('authors', [])), book.get('publisher'), book.get('year')] if x)
    tags = ' '.join(f'<a class="tag" href="y{newest}-t-{slug(t)}.html">{esc(t)}</a>' for t in book.get('topics', []))
    extra = ' '.join(f'<span class="tag">{esc(x)}</span>' for x in
                     [book.get('level'), '可免费阅读' if book.get('free') else None, '有原文' if book.get('reader') else None] if x)
    links = ' · '.join(f'<a href="{esc(l["url"])}">{esc(l["label"])}</a>' for l in book.get('links', []))
    return (f'<article><p class="meta">{tags} {extra}</p><h3>{title}</h3><p class="authors">{esc(by)}</p>'
            f'<p class="abstract">{esc(book.get("intro", ""))}</p><p class="meta">{links}</p></article>')


def pager_html(name, pages, n):
    if pages <= 1:
        return ''
    links = []
    for m in range(pages):
        target = f'{name}.html' if m == 0 else f'{name}-{m + 1}.html'
        links.append(f'<b>{m + 1}</b>' if m == n else f'<a href="{target}">{m + 1}</a>')
    return '<p class="pager">第 ' + ' '.join(links) + ' 页</p>'


def write(folder, file, title, body):
    with open(os.path.join(folder, file), 'w', encoding='utf-8') as handle:
        handle.write(lite_page(title, body))


def write_lite(data, papers, folder, books):
    """简易版：期刊文章按「年份 → 期刊」分页，带摘要；「年份 → 主题」只列标题，链到期刊页里的那一篇。"""
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    os.makedirs(folder)
    zh_of = {t['code']: t['zh'] for t in data['topics']}
    full_of = {j['code']: j['name'] for j in data['journals']}
    years = sorted({year_of(p) for p in papers if year_of(p)}, reverse=True)
    newest = years[0] if years else 0
    where = {}  # 文章 id -> 期刊页文件名
    year_rows = []
    for year in years:
        in_year = [p for p in papers if year_of(p) == year]
        journal_rows, topic_rows = [], []
        for journal in data['journals']:
            chosen = [p for p in in_year if p['journal'] == journal['code']]
            if not chosen:
                continue
            name = f'y{year}-j-{slug(journal["code"])}'
            pages = -(-len(chosen) // LITE_PER_PAGE)
            for n in range(pages):
                file = f'{name}.html' if n == 0 else f'{name}-{n + 1}.html'
                chunk = chosen[n * LITE_PER_PAGE:(n + 1) * LITE_PER_PAGE]
                for p in chunk:
                    where[p['id']] = file
                pager = pager_html(name, pages, n)
                heading = f'{year} 年 · {journal["code"]}'
                body = (f'<h1>{esc(heading)}</h1><p class="note">{esc(journal["name"])}，{year} 年发表的 {len(chosen)} 篇，新的在前。'
                        f'{"这是第 " + str(n + 1) + " 页。" if pages > 1 else ""} <a href="y{year}.html">回到 {year} 年</a></p>'
                        + pager + ''.join(lite_item(p, None) for p in chunk) + pager)
                write(folder, file, heading, body)
            journal_rows.append(f'<li><a href="{name}.html">{esc(journal["code"])}</a> {esc(journal["name"])} · {len(chosen)} 篇</li>')
        for topic in data['topics']:
            chosen = [p for p in in_year if topic['code'] in p['topics']]
            if not chosen:
                continue
            name = f'y{year}-t-{slug(topic["code"])}'
            items = ''.join(f'<li><a href="{where[p["id"]]}#{anchor(p)}">{esc(p["title"])}</a> · {esc(p["journal"])}'
                            f'{" · <b>有原文</b>" if p.get("reader") else ""}</li>' for p in chosen)
            heading = f'{year} 年 · {topic["code"]}（{topic["zh"]}）'
            write(folder, f'{name}.html', heading,
                  f'<h1>{esc(heading)}</h1><p class="note">{len(chosen)} 篇，新的在前。点标题看作者和摘要。'
                  f'<a href="y{year}.html">回到 {year} 年</a></p><ul class="links">{items}</ul>')
            topic_rows.append(f'<li><a href="{name}.html">{esc(topic["code"])}</a> {esc(topic["zh"])} · {len(chosen)} 篇</li>')
        write(folder, f'y{year}.html', f'{year} 年',
              f'<h1>{year} 年的期刊文章</h1><p class="note">共 {len(in_year)} 篇。</p>'
              '<h2>按期刊（带摘要）</h2><ul class="links">' + ''.join(journal_rows) + '</ul>'
              '<h2>按主题（只列标题）</h2><ul class="links">' + ''.join(topic_rows) + '</ul>')
        year_rows.append(f'<li><a href="y{year}.html">{year} 年</a> · {len(in_year)} 篇</li>')
    with_text = [p for p in papers if p.get('reader')]
    text_books = [b for b in books if b.get('reader')]
    write(folder, 'fulltext.html', '有原文',
          '<h1>有原文</h1><p class="note">可以在本站直接读全文的书和文章。</p>'
          + ('<h2>书</h2>' + ''.join(lite_book(b, newest) for b in text_books) if text_books else '')
          + ('<h2>文章</h2>' + ''.join(lite_item(p, None) for p in with_text) if with_text else '<p class="note">文章还没有。</p>'))
    latest = [p for p in papers if p.get('week')][:20]
    body = ('<h1>研究园 · 期刊文章</h1>'
            f'<p class="note">统计学期刊 2016 年以来的文章，共 {len(papers)} 篇，按年份、期刊、主题看。'
            f'想跨年份找某个词，用上面的搜索框。</p>'
            f'<p><a href="fulltext.html"><b>有原文</b>：本站能直接读全文的（{len(with_text) + len(text_books)} 项）</a></p>'
            '<h2>按年份</h2><ul class="links">' + ''.join(year_rows) + '</ul>'
            + (f'<h2>最近收录的 {len(latest)} 篇（每周周报）</h2>' + ''.join(lite_item(p, None) for p in latest) if latest else ''))
    write(folder, 'papers.html', '期刊文章', body)
    write(folder, 'books.html', '经典书籍', '<h1>研究园 · 经典书籍</h1>'
          + (''.join(lite_book(b, newest) for b in books) if books else '<p>还没有书。</p>'))
    write(folder, 'index.html', '研究园', '<h1>研究园 · 简易版</h1>'
          '<p class="note">这个版本不用 JavaScript，适合 Kindle 和老浏览器。</p>'
          f'<h2><a href="books.html">经典书籍 →</a></h2><p>值得反复读的教材和专著，共 {len(books)} 本，有的可以在线分章读。</p>'
          f'<h2><a href="papers.html">期刊文章 →</a></h2><p>统计学期刊 2016 年以来的文章，共 {len(papers)} 篇，按年份、期刊、主题看。</p>'
          f'<h2><a href="fulltext.html">有原文 →</a></h2><p>可以在本站直接读全文的书和文章。</p>')
    return len(os.listdir(folder))


def write_data(data, papers, folder):
    """papers/index.json：每篇一行 [年, 期刊序号, 主题位掩码, 标记]，标记 1 = 讨论评论，2 = 有原文。
    papers/<年>.json：这一年的文章，新的在前。"""
    if os.path.isdir(folder):
        shutil.rmtree(folder)
    os.makedirs(folder)
    journal_index = {j['code']: i for i, j in enumerate(data['journals'])}
    topic_index = {t['code']: i for i, t in enumerate(data['topics'])}
    rows, years = [], {}
    for p in papers:
        year = year_of(p)
        mask = sum(1 << topic_index[t] for t in p['topics'] if t in topic_index)
        flags = (1 if p.get('discussion') else 0) | (2 if p.get('reader') else 0)
        rows.append([year, journal_index[p['journal']], mask, flags])
        years.setdefault(year, []).append(p)
    index = dict(data, years=[{'year': y, 'count': len(years[y])} for y in sorted(years, reverse=True)], rows=rows)
    with open(os.path.join(folder, 'index.json'), 'w', encoding='utf-8') as handle:
        json.dump(index, handle, ensure_ascii=False, separators=(',', ':'))
    for year, chosen in years.items():
        with open(os.path.join(folder, f'{year}.json'), 'w', encoding='utf-8') as handle:
            json.dump({'year': year, 'papers': chosen}, handle, ensure_ascii=False, separators=(',', ':'))
    return sum(os.path.getsize(os.path.join(folder, f)) for f in os.listdir(folder))


def main():
    folders = sys.argv[1:] or ['../journal', '../journal2']
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.join(here, '..')
    papers = build(folders)
    articles_file = os.path.join(root, 'articles.json')
    articles = json.load(open(articles_file, encoding='utf-8')).get('articles', []) if os.path.exists(articles_file) else []
    added = add_articles(papers, articles)
    journals = [{'code': short, 'name': full} for short, full in STAT_JOURNALS.values()]
    if any(p['journal'] == 'arXiv' for p in papers):
        journals.append({'code': 'arXiv', 'name': 'arXiv 预印本'})
    data = {
        'updated': max((p['week'] for p in papers if p.get('week')), default=None),
        'journals': [j for j in journals if any(p['journal'] == j['code'] for p in papers)],
        'topics': [{'code': name, 'zh': TOPIC_ZH[name]} for name, _ in TOPICS] + [{'code': 'Other', 'zh': TOPIC_ZH['Other']}],
    }
    size = write_data(data, papers, os.path.join(root, 'papers'))
    old = os.path.join(root, 'papers.json')
    if os.path.exists(old):
        os.remove(old)  # 以前一个文件装全部，现在按年分开了
    books_file = os.path.join(root, 'books.json')
    books = json.load(open(books_file, encoding='utf-8')).get('books', []) if os.path.exists(books_file) else []
    pages = write_lite(data, papers, os.path.join(root, 'lite'), books)
    print(f'{len(papers)} 篇 → research/papers/（{size // 1024} KB），有原文 {sum(1 for p in papers if p.get("reader"))} 篇（新加 {added} 篇）')
    print(f'经典书籍 {len(books)} 本；简易版 research/lite/：{pages} 个页面')
    counts, by_year = {}, {}
    for p in papers:
        counts[p['journal']] = counts.get(p['journal'], 0) + 1
        by_year[year_of(p)] = by_year.get(year_of(p), 0) + 1
    print('期刊：', ', '.join(f'{k} {v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    print('年份：', ', '.join(f'{k} {v}' for k, v in sorted(by_year.items(), reverse=True)))
    tc = {}
    for p in papers:
        for t in p['topics']:
            tc[t] = tc.get(t, 0) + 1
    print('主题：', ', '.join(f'{k} {v}' for k, v in sorted(tc.items(), key=lambda kv: -kv[1])))
    print('没有摘要：', sum(1 for p in papers if not p['abstract']), '；只有中文概述：', sum(1 for p in papers if p['abstractZh']))
    print('没有 DOI 链接：', sum(1 for p in papers if 'doi.org' not in p['link']))


if __name__ == '__main__':
    main()
