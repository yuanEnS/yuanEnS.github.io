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

// 空一行分段。支持：## 小标题、> 引用、--- 分隔线、**重点**、[文字](链接)、![说明](图片地址)
function renderBody(text) {
  return text.trim().split(/\n\s*\n/).map(block => {
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
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

// 列表页的一句话摘要：取第一个普通段落
function excerpt(text, size = 60) {
  const block = text.split(/\n\s*\n/).map(b => b.trim()).find(b => b && !/^(##|>|!\[|-{3,})/.test(b)) || '';
  const plain = block.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, '');
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
