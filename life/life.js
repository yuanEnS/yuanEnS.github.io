// 生活园共用的代码：接口、排版、日期
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const API = LOCAL ? 'http://127.0.0.1:8787/api' : 'https://api.gamesyuan.com/api';
const TOKEN_KEY = 'xiangqi:token'; // 和游戏、账号页共用
const DIGITS = '〇一二三四五六七八九';

function getToken() {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY)) || '';
  } catch (e) {
    return '';
  }
}

async function api(path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, { method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || '请求失败'), { status: res.status });
  return data;
}

function errorText(err) {
  return err instanceof TypeError ? '连不上服务器，请稍后再试' : err.message;
}

function escapeHtml(text) {
  return text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function safeUrl(url) {
  return /^(https?:\/\/|\/)/.test(url) ? url : '#';
}

function inline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}" rel="noopener nofollow ugc">${label}</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

// 数学公式：$$...$$ 单独成行居中，$...$ 嵌在句子里，用 LaTeX 写法。\$ 是普通的美元符号。
// 「花了 $5，又花了 $6」这种不算公式：结束的 $ 后面紧跟数字、或者两头挨着空格的都不算。
const MATH_MARK = '\u0000';
function takeMath(text) {
  const formulas = [];
  const keep = (tex, display) => {
    formulas.push({ tex: tex.trim(), display });
    return `${MATH_MARK}${formulas.length - 1}${MATH_MARK}`;
  };
  const out = text
    .replace(/\\\$/g, '\u0001')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => keep(tex, true))
    .replace(/\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, tex) => keep(tex, false));
  return { text: out, formulas };
}
function putMath(html, formulas) {
  return html
    .replace(new RegExp(`${MATH_MARK}(\\d+)${MATH_MARK}`, 'g'), (_, i) => {
      const { tex, display } = formulas[i];
      return `<span class="math${display ? ' display' : ''}" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</span>`;
    })
    .replace(/\u0001/g, '$');
}

// 空一行分段。支持：## 小标题、> 引用、--- 分隔线、**重点**、[文字](链接)、![说明](图片地址)、$公式$
function renderBody(source) {
  const { text, formulas } = takeMath(source);
  const html = text.trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    const first = lines[0] || '';
    const image = first.match(/^!\[(.*?)\]\((\S+?)\)$/);
    if (first.startsWith('## ')) return `<h2>${inline(first.slice(3))}</h2>`;
    if (/^-{3,}$/.test(first)) return '<hr>';
    if (image) {
      const caption = image[1] ? `<p class="caption">${inline(image[1])}</p>` : '';
      return `<img src="${escapeHtml(safeUrl(image[2]))}" alt="${escapeHtml(image[1])}" loading="lazy" referrerpolicy="no-referrer">${caption}`;
    }
    if (first.startsWith('>')) {
      return `<blockquote><p>${lines.map(line => inline(line.replace(/^>\s*/, ''))).join('<br>')}</p></blockquote>`;
    }
    // 一段里只有一个 $$ 公式，就不用再包一层段落
    if (lines.length === 1 && new RegExp(`^${MATH_MARK}\\d+${MATH_MARK}$`).test(first) && formulas[Number(first.slice(1, -1))].display) {
      return first;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
  return putMath(html, formulas);
}

// 把页面上的公式排版。KaTeX 只在有公式时才加载
const KATEX = 'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11';
let katexReady = null;
function loadKatex() {
  if (window.katex) return Promise.resolve();
  if (!katexReady) {
    katexReady = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${KATEX}/katex.min.css`;
      document.head.append(css);
      const script = document.createElement('script');
      script.src = `${KATEX}/katex.min.js`;
      script.onload = resolve;
      script.onerror = () => {
        katexReady = null;
        reject(new Error('公式排版没加载出来'));
      };
      document.head.append(script);
    });
  }
  return katexReady;
}
async function renderMath(root) {
  const nodes = [...root.querySelectorAll('.math[data-tex]')];
  if (!nodes.length) return;
  try {
    await loadKatex();
  } catch (e) {
    return; // 加载不了就显示公式原文
  }
  for (const node of nodes) {
    window.katex.render(node.dataset.tex, node, { displayMode: node.classList.contains('display'), throwOnError: false, output: 'htmlAndMathml' });
  }
}

// 列表页的一句话摘要：取第一个普通段落
function excerpt(text, size = 60) {
  const block = text.split(/\n\s*\n/).map(b => b.trim()).find(b => b && !/^(##|>|!\[|-{3,})/.test(b)) || '';
  const plain = block.replace(/\\\$/g, '$').replace(/\$\$?([^$]+?)\$\$?/g, '$1').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, '');
  return plain.length > size ? `${plain.slice(0, size)}…` : plain;
}

function cnNumber(n) {
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10), ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

function cnYear(year) {
  return [...String(year)].map(c => DIGITS[c]).join('');
}

function dateParts(date) {
  const [year, month, day] = date.split('-').map(Number);
  return { year, monthDay: `${cnNumber(month)}月${cnNumber(day)}日` };
}

function cnDate(date) {
  const { year, monthDay } = dateParts(date);
  return `${cnYear(year)}年${monthDay}`;
}

function authorUrl(name) {
  return `/life/personal/?author=${encodeURIComponent(name)}`;
}

function showMessage(target, text) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  target.replaceChildren(p);
}

function postEntry(post, showAuthor) {
  const article = document.createElement('article');
  article.className = 'entry';
  const time = document.createElement('time');
  time.dateTime = post.date;
  time.textContent = `${dateParts(post.date).monthDay}${post.draft ? ' · 草稿' : ''}`;
  if (showAuthor) {
    const link = document.createElement('a');
    link.href = authorUrl(post.author);
    link.textContent = post.author;
    time.append(' · ', link);
  }
  const title = document.createElement('h2');
  const link = document.createElement('a');
  link.href = `/life/post/?id=${post.id}`;
  link.textContent = post.title;
  title.append(link);
  const summary = document.createElement('p');
  summary.textContent = excerpt(post.head);
  article.append(time, title, summary);
  return article;
}

// 按年份分组的文章列表
function showPosts(target, posts, { empty, author = true }) {
  if (!posts.length) return showMessage(target, empty);
  const nodes = [];
  let year = null;
  for (const post of posts) {
    const y = dateParts(post.date).year;
    if (y !== year) {
      year = y;
      const heading = document.createElement('h2');
      heading.className = 'year';
      heading.textContent = cnYear(y);
      nodes.push(heading);
    }
    nodes.push(postEntry(post, author));
  }
  target.replaceChildren(...nodes);
}

// 搜索引擎用的信息：每篇文章、每位作者页有自己的正式地址、标题和简介；不该被搜到的页面标 noindex
function setMeta({ title, description, canonical, noindex, data }) {
  const head = document.head;
  const tag = (selector, create) => head.querySelector(selector) || head.appendChild(create());
  const meta = (attr, key, value) => {
    const node = tag(`meta[${attr}="${key}"]`, () => Object.assign(document.createElement('meta'), { [attr === 'name' ? 'name' : 'content']: '' }));
    node.setAttribute(attr, key);
    node.setAttribute('content', value);
  };
  if (title) {
    document.title = title;
    meta('property', 'og:title', title);
  }
  if (description) {
    meta('name', 'description', description);
    meta('property', 'og:description', description);
  }
  if (canonical) {
    tag('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' })).href = canonical;
    meta('property', 'og:url', canonical);
  }
  if (noindex) meta('name', 'robots', 'noindex');
  if (data) {
    const script = tag('script[type="application/ld+json"]', () => Object.assign(document.createElement('script'), { type: 'application/ld+json' }));
    script.textContent = JSON.stringify(data);
  }
}
