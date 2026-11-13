#!/usr/bin/env python3
"""研究园：把 journal 文件夹里的每周文献周报整理成 research/papers.json。

用法（在网站仓库根目录）：
    python3 research/tools/build.py ../journal

做的事：
  1. 读所有 .md 周报（几种写法都认：「- Journal:」「**Journal:**」「**Title**:」等）。
  2. 只留统计期刊（STAT_JOURNALS），Nature、Science、流行病学、生信、JMLR、Econometrica、预印本都不要。
  3. 同一篇文章在几份周报里重复出现时按 DOI（没有 DOI 时按标题）合并，保留最好的英文摘要。
  4. 按标题、摘要、关键词打主题标签（TOPICS），一篇最多三个。
  5. 链接只用 DOI 或出版社自己的网址；邮件里的点击跟踪链接（带个人标识）一律不用。
重复运行是安全的：每次从头生成，结果只取决于 journal 文件夹里的内容。
"""
import glob
import json
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
}

# DOI 前缀认期刊，最可靠
DOI_JOURNAL = [
    ('10.1080/01621459', 'JASA'), ('10.1214/', None), ('10.1093/jrsssb', 'JRSSB'), ('10.1111/rssb', 'JRSSB'),
    ('10.1093/jrsssa', 'JRSSA'), ('10.1111/rssa', 'JRSSA'), ('10.1093/jrsssc', 'JRSSC'), ('10.1111/rssc', 'JRSSC'),
    ('10.1093/biomet', 'BIOMETRIKA'), ('10.1093/biomtc', 'BIOMETRICS'), ('10.1111/biom', 'BIOMETRICS'),
    ('10.1002/sim', 'SIM'), ('10.1177/09622802', 'SMMR'), ('10.1093/jssam', 'JSSAM'), ('10.1080/00031305', 'TAS'),
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
    (r'\bbiometrika\b', 'BIOMETRIKA'),
    (r'\bbiometrics\b', 'BIOMETRICS'),
]
URL_JOURNAL = [
    ('academic.oup.com/biometrics', 'BIOMETRICS'), ('academic.oup.com/biomet', 'BIOMETRIKA'),
    ('academic.oup.com/jrsssa', 'JRSSA'), ('academic.oup.com/jrsssb', 'JRSSB'), ('academic.oup.com/jrsssc', 'JRSSC'),
    ('academic.oup.com/jssam', 'JSSAM'), ('/doi/10.1002/sim', 'SIM'),
]
# 统计期刊里的 Sage 只订了 SMMR，邮件提醒里的 Sage 链接都是它
SAGE_ALERT = 'sagepub.com/ls/click'

# 可以放到网页上的链接（出版社和公共索引）。其余的多半是邮件里的跟踪链接，不用
SAFE_HOSTS = ('doi.org', 'dx.doi.org', 'academic.oup.com', 'onlinelibrary.wiley.com', 'www.tandfonline.com',
              'tandfonline.com', 'projecteuclid.org', 'imstat.org', 'journals.sagepub.com', 'pubmed.ncbi.nlm.nih.gov',
              'arxiv.org')

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
    ('Diagnostics & Prediction', r'prediction model|risk prediction|diagnostic accuracy|biomarker|calibration|roc curve|\bauc\b|dynamic prediction'),
]
TOPIC_ZH = {
    'Causal Inference': '因果推断', 'Survival Analysis': '生存分析', 'Longitudinal Data': '纵向数据',
    'Clinical Trials': '临床试验', 'Bayesian Methods': '贝叶斯', 'High-Dimensional': '高维与变量选择',
    'Machine Learning': '机器学习', 'Testing & Uncertainty': '检验与不确定性', 'Missing Data & Measurement Error': '缺失与测量误差',
    'Spatial & Time Series': '空间与时间序列', 'Functional Data': '函数型数据', 'Networks & Graphs': '网络与图',
    'Latent Variables & Mixtures': '潜变量与混合模型', 'Survey & Sampling': '调查抽样', 'Genetics & Omics': '遗传与组学',
    'Meta-Analysis & Data Integration': 'Meta 分析与数据融合', 'Nonparametric & Semiparametric': '非参数与半参数',
    'Diagnostics & Prediction': '诊断与预测', 'Other': '其他',
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
    if re.search(r'\bnature\b|\bscience\b|epidemiology|bioinformatics|machine learning research|econometrica|arxiv', name):
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
    for url in URL_RE.findall(entry.get('link', '') or ''):
        host = url.split('/')[2].lower()
        if host in SAFE_HOSTS:
            return url.rstrip('.')
    return None


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


def build(folder):
    papers = {}
    by_title = {}
    files = sorted(glob.glob(os.path.join(folder, '*.md')))
    for path in files:
        name = os.path.basename(path)
        if name.lower().startswith('arxiv'):
            continue  # 预印本，不是期刊
        found = REPORT_DATE.search(name)
        week = found.group(1) if found else None
        with open(path, encoding='utf-8') as handle:
            first = handle.readline()
        default = 'SIM' if 'Statistics in Medicine' in first else None
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
                         'week': week, 'keywords': '', 'link': None}
                papers[key] = paper
            if tkey:
                by_title[tkey] = paper
            if doi and not paper['doi']:
                paper['doi'] = doi
            if week and (not paper['week'] or week < paper['week']):
                paper['week'] = week
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
            'week': paper['week'],
            'link': link,
            'abstract': paper['abstract'] if paper['_score'] >= 0 else '',
            'abstractZh': zh,  # 只有周报里的中文概述，不是原文
        })
        if DISCUSSION.search(paper['title']):
            out[-1]['discussion'] = True  # 讨论、评论、回应，不是研究论文
    out.sort(key=lambda p: (p['week'] or '', p['title']), reverse=True)
    return out


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else '../journal'
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, '..', 'papers.json')
    papers = build(folder)
    data = {
        'updated': max((p['week'] for p in papers if p['week']), default=None),
        'journals': [{'code': short, 'name': full} for short, full in STAT_JOURNALS.values()],
        'topics': [{'code': name, 'zh': TOPIC_ZH[name]} for name, _ in TOPICS] + [{'code': 'Other', 'zh': TOPIC_ZH['Other']}],
        'papers': papers,
    }
    with open(target, 'w', encoding='utf-8') as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(',', ':'))
    counts = {}
    for p in papers:
        counts[p['journal']] = counts.get(p['journal'], 0) + 1
    print(f'{len(papers)} 篇 → {os.path.relpath(target)}（{os.path.getsize(target) // 1024} KB）')
    print('期刊：', ', '.join(f'{k} {v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    tc = {}
    for p in papers:
        for t in p['topics']:
            tc[t] = tc.get(t, 0) + 1
    print('主题：', ', '.join(f'{k} {v}' for k, v in sorted(tc.items(), key=lambda kv: -kv[1])))
    print('没有摘要：', sum(1 for p in papers if not p['abstract']), '；只有中文概述：', sum(1 for p in papers if p['abstractZh']))
    print('没有 DOI 链接：', sum(1 for p in papers if 'doi.org' not in p['link']))


if __name__ == '__main__':
    main()
