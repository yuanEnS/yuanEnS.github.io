// 自动生成，请勿手改：改 minigame/ 下的代码后运行 node web/build.js
(function () {
var defs = {
"game.js": function (require, module, exports) {
// 小游戏入口
require('./js/main.js');

},
"js/main.js": function (require, module, exports) {
// 小游戏入口：有多个游戏时先显示游戏列表，只有一个游戏（网页版）就直接进去
const ui = require('./ui.js');
const { drawPiece, drawStone } = require('./draw.js');
const { GAMES } = require('./config.js');

const APPS = {
  xiangqi: {
    app: require('./xiangqi-app.js'),
    title: '中国象棋',
    sub: '人机对战 · 本地双人 · 五套主题',
    icon: (x, y, r) => drawPiece(ui.ctx, ui.theme(), 'K', x, y, r, ui.GLYPHS[ui.settings.glyphs].K, false),
  },
  gomoku: {
    app: require('./gomoku-app.js'),
    title: '五子棋',
    sub: '人机对战 · 本地双人 · 15 路棋盘',
    icon: (x, y, r) => drawStone(ui.ctx, ui.theme(), 'b', x, y, r * 0.9),
  },
};

const games = GAMES.filter(id => APPS[id]);

const hub = {
  render() {
    ui.drawDecor();
    ui.text('游戏园', 16, ui.titleY, 22, ui.theme().ui.primary, { bold: true, align: 'left' });
    ui.entryCards(games.map(id => ({ ...APPS[id], onTap: () => APPS[id].app.open(showHub) })));
  },
};

function showHub() {
  ui.show(hub);
}

if (games.length === 1) APPS[games[0]].app.open();
else showHub();

},
"js/ui.js": function (require, module, exports) {
// 各个游戏共用的界面：画布、布局、设置、按钮和卡片、主题页、点击分发
const { THEMES, GLYPHS, getTheme } = require('./themes.js');
const { fontFamily, useFont, usePieceFont, roundRect } = require('./draw.js');

// 界面用霞鹜文楷，象棋棋子用寒蝉正楷体（都只保留用到的字）
if (wx.loadFont) {
  const family = wx.loadFont('fonts/kai.ttf');
  if (family) useFont(family);
  const pieceFamily = wx.loadFont('fonts/piece.ttf');
  if (pieceFamily) usePieceFont(pieceFamily);
}

// ---------- 画布与布局 ----------
const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const W = info.windowWidth;
const H = info.windowHeight;
const dpr = info.pixelRatio || 2;
const safeTop = info.safeArea ? info.safeArea.top : info.statusBarHeight || 20;
const safeBottom = info.safeArea ? H - info.safeArea.bottom : 0;

const canvas = wx.createCanvas();
canvas.width = W * dpr;
canvas.height = H * dpr;
const ctx = canvas.getContext('2d');
ctx.scale(dpr, dpr);

// 右上角是微信的"胶囊"按钮：标题和它对齐，内容从它下方开始
const capsule = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
const titleY = capsule ? (capsule.top + capsule.bottom) / 2 : safeTop + 22;
const contentTop = capsule ? capsule.bottom + 14 : safeTop + 56;

// 对局画面从上到下：对手栏、棋盘、操作栏、我方栏
const BAR_H = 52;
const ACTION_H = 44;
const GAP = 10;
const FIXED_H = BAR_H * 2 + ACTION_H + GAP * 3;
const availH = H - contentTop - safeBottom - 12;

// 棋盘占 rows 行格子高时，算出格子大小和各栏的位置
function playLayout(cols, rows) {
  const cell = Math.min(W / cols, (availH - FIXED_H) / rows);
  const topBarY = contentTop + Math.max(0, (availH - FIXED_H - rows * cell) / 2);
  const boardTop = topBarY + BAR_H + GAP;
  const actionY = boardTop + rows * cell + GAP;
  return { cell, topBarY, boardTop, actionY, bottomBarY: actionY + ACTION_H + GAP };
}

// ---------- 设置（主题、字体、难度），存在本地 ----------
function loadSettings() {
  try {
    const saved = wx.getStorageSync('settings');
    if (saved && typeof saved === 'object') return saved;
  } catch (e) {}
  return {};
}

const settings = loadSettings();
settings.theme = getTheme(settings.theme).id;
settings.glyphs = settings.glyphs === 'simp' ? 'simp' : 'trad';

function saveSettings() {
  try {
    wx.setStorageSync('settings', settings);
  } catch (e) {}
}

function theme() {
  return getTheme(settings.theme);
}

// ---------- 当前画面 ----------
// 每个游戏是一个 app：{ render(), onTouch(x, y), animating(), drawThemePreview?, glyphOption? }
let current = null;
let buttons = [];
let themeOpen = false; // 主题页盖在当前画面上，不打断联网对局
let animTimer = null;

function show(app) {
  current = app;
  themeOpen = false;
  render();
}

function render() {
  buttons = [];
  ctx.fillStyle = theme().ui.bg;
  ctx.fillRect(0, 0, W, H);
  if (themeOpen) drawThemes();
  else current.render();
  // 有动画的画面（比如匹配中）定时重画
  const animating = !themeOpen && current.animating && current.animating();
  if (animating && !animTimer) {
    animTimer = setInterval(render, 100);
  } else if (!animating && animTimer) {
    clearInterval(animTimer);
    animTimer = null;
  }
}

// 弹出结算框等覆盖层时，先清掉下面那层的按钮
function clearButtons() {
  buttons = [];
}

wx.onTouchStart(e => {
  const touch = e.touches[0] || e.changedTouches[0];
  if (!touch) return;
  const x = touch.clientX, y = touch.clientY;
  for (const btn of buttons) {
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      btn.onTap();
      return;
    }
  }
  if (!themeOpen && current.onTouch) current.onTouch(x, y);
});

// ---------- 提示与弹窗 ----------
function toast(title) {
  wx.showToast({ title, icon: 'none' });
}

function confirmThen(content, action) {
  wx.showModal({
    title: '提示',
    content,
    success(res) {
      if (res.confirm) action();
    },
  });
}

function actionSheet(items) {
  wx.showActionSheet({
    itemList: items.map(item => item[0]),
    success(res) {
      items[res.tapIndex][1]();
    },
  });
}

// ---------- 界面元素 ----------
function text(str, x, y, size, color, opts) {
  const o = opts || {};
  ctx.fillStyle = color;
  ctx.font = `${o.bold ? 'bold ' : ''}${size}px ${fontFamily()}`;
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

function hit(x, y, w, h, onTap) {
  if (onTap) buttons.push({ x, y, w, h, onTap });
}

// 实心按钮或描边按钮；onTap 为空时显示为不可点
function button(label, x, y, w, h, onTap, outline) {
  const ui = theme().ui;
  ctx.save();
  if (!onTap) ctx.globalAlpha = 0.4;
  roundRect(ctx, x, y, w, h, 8);
  ctx.fillStyle = outline ? ui.card : ui.primary;
  ctx.fill();
  if (outline) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ui.primary;
    ctx.stroke();
  }
  text(label, x + w / 2, y + h / 2, 16, outline ? ui.primary : ui.onPrimary, { bold: true });
  ctx.restore();
  hit(x, y, w, h, onTap);
}

function buttonRow(items, x, y, w, h) {
  const gap = 10;
  const bw = (w - gap * (items.length - 1)) / items.length;
  items.forEach((item, i) => button(item.label, x + i * (bw + gap), y, bw, h, item.onTap, item.outline));
}

function pill(label, rightX, y) {
  const ui = theme().ui;
  ctx.font = `bold 13px ${fontFamily()}`;
  const w = ctx.measureText(label).width + 20;
  roundRect(ctx, rightX - w, y - 13, w, 26, 13);
  ctx.fillStyle = ui.primary;
  ctx.fill();
  text(label, rightX - w / 2, y, 13, ui.onPrimary, { bold: true });
}

function card(x, y, w, h) {
  const ui = theme().ui;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = ui.card;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ui.primary;
  ctx.stroke();
}

// 页面底部淡淡的远山
function drawDecor() {
  const decor = theme().ui.decor;
  if (!decor) return;
  ctx.fillStyle = decor;
  for (const [base, peak] of [[0.8, 0.7], [0.88, 0.8]]) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    ctx.lineTo(0, H * base);
    ctx.quadraticCurveTo(W * 0.14, H * peak, W * 0.3, H * (base - 0.01));
    ctx.quadraticCurveTo(W * 0.46, H * (peak - 0.02), W * 0.64, H * (base - 0.02));
    ctx.quadraticCurveTo(W * 0.82, H * (peak - 0.03), W, H * (base - 0.03));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

function header(title, onBack) {
  const ui = theme().ui;
  let x = 16;
  if (onBack) {
    text('‹', 22, titleY - 2, 34, ui.primary, { bold: true });
    hit(0, titleY - 22, 56, 44, onBack);
    x = 44;
  }
  text(title, x, titleY, 20, ui.primary, { bold: true, align: 'left' });
}

// 人机设置里的难度卡片，选中时整张填色
function levelCard(x, y, w, level, selected, onTap) {
  const ui = theme().ui;
  roundRect(ctx, x, y, w, 56, 10);
  ctx.fillStyle = selected ? ui.primary : ui.card;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ui.primary;
  ctx.stroke();
  text(level.name, x + 18, y + 28, 19, selected ? ui.onPrimary : ui.primary, { bold: true, align: 'left' });
  text(level.desc, x + 78, y + 28, 14, selected ? ui.onPrimary : ui.muted, { align: 'left' });
  hit(x, y, w, 56, onTap);
}

// 首页的一列入口卡片：{ icon(x, y, r), title, sub, onTap }
function entryCards(entries) {
  const ui = theme().ui;
  // 入口多的时候卡片矮一点，小屏手机也放得下
  const x = 16, w = W - 32;
  const h = Math.max(64, Math.min(80, (H - contentTop - 20) / entries.length - 14));
  let y = contentTop + 10;
  for (const entry of entries) {
    card(x, y, w, h);
    entry.icon(x + 40, y + h / 2, 22);
    text(entry.title, x + 76, y + h / 2 - 11, 20, ui.primary, { bold: true, align: 'left' });
    text(entry.sub, x + 76, y + h / 2 + 15, 13, ui.muted, { align: 'left' });
    hit(x, y, w, h, entry.onTap);
    y += h + 14;
  }
}

// 对局上下的玩家栏：icon(x, y, r) 画头像，active 时加圆圈和右侧标签
function playerBar(y, opts) {
  const ui = theme().ui;
  const x = 12, w = W - 24;
  roundRect(ctx, x, y, w, BAR_H, 10);
  ctx.fillStyle = ui.card;
  ctx.fill();
  // 卡片和背景同色时（黑白主题）加描边，否则看不出边界
  if (ui.card === ui.bg) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = ui.muted;
    ctx.stroke();
  }
  const kx = x + 28, ky = y + BAR_H / 2;
  if (opts.label) {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ui.primary;
    ctx.beginPath();
    ctx.arc(kx, ky, 21, 0, Math.PI * 2);
    ctx.stroke();
  }
  opts.icon(kx, ky, 17);
  text(opts.name, x + 58, ky - 9, 16, ui.text, { bold: true, align: 'left' });
  text(opts.sub, x + 58, ky + 12, 12, ui.muted, { align: 'left' });
  if (opts.label) pill(opts.label, x + w - 12, ky);
}

// 结算框：标题、说明、一排按钮
function resultBox(title, sub, actions) {
  clearButtons();
  const t = theme();
  ctx.fillStyle = t.id === 'pao' ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, W, H);
  const w = Math.min(320, W - 48), h = 200;
  const x = (W - w) / 2, y = (H - h) / 2;
  card(x, y, w, h);
  text(title, W / 2, y + 54, 30, t.ui.primary, { bold: true });
  text(sub, W / 2, y + 94, 15, t.ui.muted);
  const pad = actions.length > 2 ? 16 : 20;
  buttonRow(actions, x + pad, y + h - 68, w - pad * 2, 44);
}

// 结果框副标题后面加上这局的积分变化
function withRating(sub, change) {
  if (!change) return sub;
  const delta = `积分 ${change.delta >= 0 ? '+' : ''}${change.delta}（${change.rating}）`;
  return sub ? `${sub} · ${delta}` : delta;
}

// 首页右上角的账号入口，只有网页版有（账号和排行榜是单独的网页）
function accountButton() {
  if (!wx.openAccountPage) return;
  pill('账号 · 排行榜', W - 16, titleY);
  hit(W - 130, titleY - 22, 130, 44, () => wx.openAccountPage());
}

// ---------- 联网等待画面 ----------
// 匹配中：icon(x, y, r) 画在中间，外面一圈转动的弧线
function matchingScreen(startTime, online, icon, onCancel) {
  drawDecor();
  header('快速匹配', onCancel);
  const ui = theme().ui;
  const elapsed = (Date.now() - startTime) / 1000;
  const cx = W / 2, cy = contentTop + 130;
  ctx.lineWidth = 4;
  ctx.strokeStyle = ui.primary;
  ctx.beginPath();
  ctx.arc(cx, cy, 58, elapsed * 3, elapsed * 3 + Math.PI * 1.3);
  ctx.stroke();
  icon(cx, cy, 42);

  const dots = '.'.repeat(Math.floor(elapsed * 2) % 4);
  text(`正在寻找对手${dots}`, cx, cy + 100, 20, ui.text, { bold: true });
  text(`已等待 ${Math.floor(elapsed)} 秒`, cx, cy + 132, 15, ui.muted);
  if (online) text(`当前在线 ${online} 人`, cx, cy + 156, 15, ui.muted);
  text('人少的时候，可以把网址发给朋友一起点「快速匹配」', cx, cy + 196, 13, ui.muted);
  button('取消', (W - 160) / 2, cy + 230, 160, 44, onCancel, true);
}

function connectingScreen(onCancel) {
  drawDecor();
  header('联网对战', onCancel);
  text('正在连接服务器…', W / 2, H * 0.4, 18, theme().ui.text);
  button('取消', (W - 160) / 2, H * 0.4 + 50, 160, 44, onCancel, true);
}

function waitingScreen(roomCode, onCancel) {
  drawDecor();
  header('等待对手', onCancel);
  const ui = theme().ui;
  const x = 16, w = W - 32, y = contentTop + 20, h = 250;
  card(x, y, w, h);
  text('房间号', W / 2, y + 36, 15, ui.muted);
  text(roomCode, W / 2, y + 94, 60, ui.primary, { bold: true });
  text('把房间号发给好友', W / 2, y + 152, 15, ui.muted);
  text('对方点「加入房间」输入即可', W / 2, y + 176, 15, ui.muted);
  text('等待对手加入…', W / 2, y + 220, 17, ui.text, { bold: true });
  button('取消', (W - 160) / 2, y + h + 24, 160, 44, onCancel, true);
}

// 弹出输入框，输入房间号后回调
function askRoomCode(onCode) {
  wx.showModal({
    title: '加入房间',
    editable: true,
    placeholderText: '输入 4 位房间号',
    success(res) {
      const code = (res.content || '').trim();
      if (res.confirm && code) onCode(code);
    },
  });
}

// ---------- 主题页 ----------
function openThemes() {
  themeOpen = true;
  render();
}

function closeThemes() {
  themeOpen = false;
  render();
}

function drawThemes() {
  header('棋盘主题', closeThemes);
  const ui = theme().ui;
  let y = contentTop + 6;

  // 只有象棋有「繁體 / 简体」选项
  if (current.glyphOption) {
    text('棋子文字', 16, y + 10, 16, ui.text, { bold: true, align: 'left' });
    y += 28;
    const half = (W - 32 - 10) / 2;
    const pick = kind => () => {
      settings.glyphs = kind;
      saveSettings();
      render();
    };
    button('繁體', 16, y, half, 40, pick('trad'), settings.glyphs !== 'trad');
    button('简体', 16 + half + 10, y, half, 40, pick('simp'), settings.glyphs !== 'simp');
    y += 58;
    text('繁体字红黑双方用字都不同，黑白屏上也容易分清', 16, y, 12, ui.muted, { align: 'left' });
    y += 32;
  }

  text('选择主题', 16, y, 16, ui.text, { bold: true, align: 'left' });
  y += 22;
  const cols = 3, gap = 12;
  const cw = (W - 32 - gap * (cols - 1)) / cols, ch = cw * 0.85;
  THEMES.forEach((t, i) => {
    const cx = 16 + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + 42);
    const selected = t.id === settings.theme;
    current.drawThemePreview(t, cx, cy, cw, ch);
    if (selected) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = ui.primary;
      roundRect(ctx, cx - 4, cy - 4, cw + 8, ch + 8, 13);
      ctx.stroke();
    }
    text(`${t.name} · ${t.desc}`, cx + cw / 2, cy + ch + 18, 14, selected ? ui.primary : ui.text, { bold: selected });
    hit(cx, cy, cw, ch + 30, () => {
      settings.theme = t.id;
      saveSettings();
      render();
    });
  });
}

module.exports = {
  W, H, ctx, titleY, contentTop, BAR_H, ACTION_H, playLayout,
  settings, saveSettings, theme, GLYPHS, THEMES,
  show, render, clearButtons, toast, confirmThen, actionSheet,
  text, hit, button, buttonRow, pill, card, drawDecor, header, levelCard, entryCards, playerBar, resultBox, withRating, accountButton,
  matchingScreen, connectingScreen, waitingScreen, askRoomCode,
  openThemes, closeThemes,
};

},
"js/themes.js": function (require, module, exports) {
// 主题：界面配色、棋盘、棋子
// 为了在黑白屏（墨水屏、灰度模式）上也能分清红黑：
//   1. 每个主题里红方和黑方棋子的明暗差都很大，转成灰度后依然一深一浅；
//   2. 默认用繁体字，红黑双方每个棋子的字都不一样（俥/車、傌/馬、炮/砲……）；
//   3. 选中、可走位置、上一步都用形状（圆环、圆点、角框）标出，不单靠颜色。

const THEMES = [
  {
    id: 'che',
    name: '车',
    desc: '檀木',
    ui: { bg: '#FAF3E8', card: '#FFFCF6', primary: '#B71C1C', onPrimary: '#FFFFFF', text: '#3A2618', muted: '#86705A', decor: 'rgba(110,70,40,0.07)' },
    board: { fill: ['#EBCB98', '#D2A86E'], grain: 'rgba(110,65,30,0.11)', frame: '#6A3E22', frameWidth: 7, frameStyle: 'wood', line: '#5E3D22', lineWidth: 1, river: '#7A4A24' },
    pieces: {
      r: { fill: '#B71C1C', light: '#E0584C', text: '#FFF4E4', ring: 'rgba(255,238,215,0.75)' },
      b: { fill: '#262019', light: '#5C5247', text: '#FFF4E4', ring: 'rgba(255,238,215,0.6)' },
      edge: 'rgba(0,0,0,0.35)', edgeWidth: 1, shadow: true, gradient: true,
    },
    stones: {
      b: { fill: '#1C1A17', light: '#5C574F', edge: null },
      w: { fill: '#E9E3D6', light: '#FFFFFF', edge: 'rgba(90,60,30,0.35)' },
    },
    mark: { select: '#1565C0', hint: 'rgba(21,101,192,0.9)', last: '#1565C0' },
  },
  {
    id: 'ma',
    name: '马',
    desc: '青瓷',
    ui: { bg: '#EDF2EC', card: '#FAFCF9', primary: '#2F6B4F', onPrimary: '#FFFFFF', text: '#22332A', muted: '#66796D', decor: 'rgba(47,107,79,0.08)' },
    board: { fill: ['#DCE8D6', '#C3D6BE'], frame: '#4E7A62', frameWidth: 6, frameStyle: 'plain', line: '#3F5E4C', lineWidth: 1, river: '#3F5E4C' },
    pieces: {
      // 米白底红字 vs 墨绿底白字，转成灰度后一浅一深
      r: { fill: '#FBF3E2', light: '#FFFDF6', text: '#B23A2E', ring: '#B23A2E' },
      b: { fill: '#1F2E27', light: '#44564C', text: '#E8F0E6', ring: 'rgba(232,240,230,0.6)' },
      edge: 'rgba(30,50,40,0.45)', edgeWidth: 1, shadow: true, gradient: true,
    },
    stones: {
      b: { fill: '#1F2622', light: '#55605A', edge: null },
      w: { fill: '#F2EFE6', light: '#FFFFFF', edge: 'rgba(40,70,55,0.35)' },
    },
    mark: { select: '#C77700', hint: 'rgba(199,119,0,0.9)', last: '#C77700' },
  },
  {
    id: 'xiang',
    name: '象',
    desc: '宣纸',
    ui: { bg: '#FBF8F2', card: '#FFFFFF', primary: '#C0392B', onPrimary: '#FFFFFF', text: '#2F2A24', muted: '#8A8072', decor: 'rgba(150,130,100,0.06)' },
    board: { fill: ['#FAF4E6', '#FAF4E6'], frame: '#A88B63', frameWidth: 2, frameStyle: 'plain', line: '#A8977E', lineWidth: 1, river: '#9A8466' },
    pieces: {
      r: { fill: '#C0392B', light: '#C0392B', text: '#FFFFFF', ring: 'rgba(255,255,255,0.7)' },
      b: { fill: '#2D2A26', light: '#2D2A26', text: '#FFFFFF', ring: 'rgba(255,255,255,0.55)' },
      edge: 'rgba(0,0,0,0.25)', edgeWidth: 1, shadow: true, gradient: false,
    },
    stones: {
      b: { fill: '#2D2A26', light: '#2D2A26', edge: null },
      w: { fill: '#FFFFFF', light: '#FFFFFF', edge: '#8A7A62' },
    },
    mark: { select: '#1565C0', hint: 'rgba(21,101,192,0.9)', last: '#1565C0' },
  },
  {
    id: 'shi',
    name: '士',
    desc: '墨夜',
    ui: { bg: '#141821', card: '#1E2430', primary: '#E5484D', onPrimary: '#FFFFFF', text: '#E6E9EF', muted: '#97A0B0', decor: 'rgba(255,255,255,0.04)' },
    board: { fill: ['#2C3446', '#232A39'], frame: '#0D1017', frameWidth: 5, frameStyle: 'plain', line: '#5A6580', lineWidth: 1, river: '#7C879C' },
    pieces: {
      r: { fill: '#E5484D', light: '#F37C80', text: '#FFFFFF', ring: 'rgba(255,255,255,0.7)' },
      // 黑方用浅色棋子，在深色棋盘上和红方一深一浅
      b: { fill: '#D6DBE4', light: '#FFFFFF', text: '#1A1E26', ring: 'rgba(26,30,38,0.45)' },
      edge: 'rgba(0,0,0,0.5)', edgeWidth: 1, shadow: true, gradient: true,
    },
    stones: {
      // 深色棋盘上黑子加一圈浅色描边
      b: { fill: '#0B0D12', light: '#3A4050', edge: 'rgba(230,233,239,0.45)' },
      w: { fill: '#D6DBE4', light: '#FFFFFF', edge: null },
    },
    mark: { select: '#FFC857', hint: 'rgba(255,200,87,0.95)', last: '#FFC857' },
  },
  {
    id: 'pao',
    name: '炮',
    desc: '黑白',
    ui: { bg: '#FFFFFF', card: '#FFFFFF', primary: '#000000', onPrimary: '#FFFFFF', text: '#000000', muted: '#444444', decor: null },
    board: { fill: ['#FFFFFF', '#FFFFFF'], frame: '#000000', frameWidth: 3, frameStyle: 'double', line: '#000000', lineWidth: 1.2, river: '#000000' },
    pieces: {
      r: { fill: '#FFFFFF', light: '#FFFFFF', text: '#000000', ring: '#000000' },
      b: { fill: '#000000', light: '#000000', text: '#FFFFFF', ring: '#FFFFFF' },
      edge: '#000000', edgeWidth: 2, shadow: false, gradient: false,
    },
    stones: {
      edgeWidth: 2,
      b: { fill: '#000000', light: '#000000', edge: '#000000' },
      w: { fill: '#FFFFFF', light: '#FFFFFF', edge: '#000000' },
    },
    mark: { select: '#000000', hint: '#000000', last: '#000000' },
  },
];

const GLYPHS = {
  // 繁体：红黑双方用字全部不同
  trad: {
    K: '帥', A: '仕', B: '相', N: '傌', R: '俥', C: '炮', P: '兵',
    k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒',
  },
  simp: {
    K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
  },
};

// 旧版本存下的主题 id，换成对应的新主题
const OLD_IDS = { wood: 'che', vietnam: 'ma', simple: 'xiang', night: 'shi', mono: 'pao' };

function getTheme(id) {
  id = OLD_IDS[id] || id;
  return THEMES.find(t => t.id === id) || THEMES[0];
}

module.exports = { THEMES, GLYPHS, getTheme };

},
"js/draw.js": function (require, module, exports) {
// 棋盘和棋子的绘制，颜色全部来自主题（themes.js）

// 楷体优先：打包的霞鹜文楷加载成功就用它，否则用系统自带的楷体，再不行退到宋体
const FALLBACK = '"Kaiti SC", "STKaiti", "KaiTi", "楷体", "Songti SC", "SimSun", serif';
let family = FALLBACK;
// 棋子上的字单独用寒蝉正楷体，没加载成功就和界面用同一种楷体
let pieceFamily = null;

function useFont(name) {
  family = `"${name}", ${FALLBACK}`;
}

function usePieceFont(name) {
  pieceFamily = name;
}

function fontFamily() {
  return family;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillBoardColor(ctx, board, x, y, w, h) {
  const grad = ctx.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, board.fill[0]);
  grad.addColorStop(1, board.fill[1]);
  ctx.fillStyle = grad;
}

// 木纹：几条起伏的细线
function drawGrain(ctx, color, x, y, w, h) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const lines = 16;
  for (let i = 0; i < lines; i++) {
    const ly = y + ((i + 0.5) * h) / lines;
    const amp = h / lines / 3;
    ctx.beginPath();
    ctx.moveTo(x, ly);
    for (let sx = 0; sx <= w; sx += 12) {
      ctx.lineTo(x + sx, ly + Math.sin(sx / (40 + i * 7) + i * 1.7) * amp);
    }
    ctx.stroke();
  }
}

function drawFrame(ctx, board, x, y, w, h) {
  const fw = board.frameWidth;
  ctx.strokeStyle = board.frame;
  ctx.lineWidth = fw;
  ctx.strokeRect(x + fw / 2, y + fw / 2, w - fw, h - fw);

  if (board.frameStyle === 'wood') {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + fw + 0.5, y + fw + 0.5, w - 2 * fw - 1, h - 2 * fw - 1);
  } else if (board.frameStyle === 'double') {
    ctx.lineWidth = 1;
    ctx.strokeRect(x + fw + 3.5, y + fw + 3.5, w - 2 * fw - 7, h - 2 * fw - 7);
  }
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// 炮位、兵位上的小十字标记（显示坐标，dc 为 0 或 8 时只画朝内的一半）
function positionMark(ctx, x, y, cell, dc) {
  const g = cell * 0.08, l = cell * 0.17;
  for (const sx of [-1, 1]) {
    if ((dc === 0 && sx === -1) || (dc === 8 && sx === 1)) continue;
    for (const sy of [-1, 1]) {
      line(ctx, x + sx * g, y + sy * g, x + sx * (g + l), y + sy * g);
      line(ctx, x + sx * g, y + sy * g, x + sx * g, y + sy * (g + l));
    }
  }
}

// g = { ox, oy, cell }：棋盘左上角交叉点的屏幕坐标和格子大小。棋盘本身左右对称，翻转不影响画法。
function drawBoard(ctx, theme, g) {
  const b = theme.board;
  const { ox, oy, cell } = g;
  const px = ox - cell * 0.5, py = oy - cell * 0.5, pw = cell * 9, ph = cell * 10;

  fillBoardColor(ctx, b, px, py, pw, ph);
  ctx.fillRect(px, py, pw, ph);
  if (b.grain) drawGrain(ctx, b.grain, px, py, pw, ph);
  drawFrame(ctx, b, px, py, pw, ph);

  ctx.strokeStyle = b.line;
  ctx.lineWidth = b.lineWidth;
  for (let r = 0; r < 10; r++) line(ctx, ox, oy + r * cell, ox + 8 * cell, oy + r * cell);
  for (let c = 1; c < 8; c++) {
    const x = ox + c * cell;
    // 中间的竖线在"楚河漢界"断开
    line(ctx, x, oy, x, oy + 4 * cell);
    line(ctx, x, oy + 5 * cell, x, oy + 9 * cell);
  }
  for (const top of [0, 7]) {
    line(ctx, ox + 3 * cell, oy + top * cell, ox + 5 * cell, oy + (top + 2) * cell);
    line(ctx, ox + 5 * cell, oy + top * cell, ox + 3 * cell, oy + (top + 2) * cell);
  }
  for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7]]) positionMark(ctx, ox + c * cell, oy + r * cell, cell, c);
  for (const r of [3, 6]) {
    for (const c of [0, 2, 4, 6, 8]) positionMark(ctx, ox + c * cell, oy + r * cell, cell, c);
  }
  ctx.lineWidth = b.lineWidth * 2;
  ctx.strokeRect(ox, oy, 8 * cell, 9 * cell);

  ctx.fillStyle = b.river;
  ctx.font = `${Math.round(cell * 0.55)}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('楚 河', ox + 2 * cell, oy + 4.5 * cell);
  ctx.fillText('漢 界', ox + 6 * cell, oy + 4.5 * cell);
}

function drawPiece(ctx, theme, piece, x, y, radius, glyph, lifted) {
  const P = theme.pieces;
  const s = P[piece === piece.toUpperCase() ? 'r' : 'b'];

  ctx.save();
  if (P.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = lifted ? radius * 0.5 : radius * 0.15;
    ctx.shadowOffsetY = lifted ? radius * 0.25 : radius * 0.08;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (P.gradient) {
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    grad.addColorStop(0, s.light);
    grad.addColorStop(1, s.fill);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = s.fill;
  }
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = P.edgeWidth;
  ctx.strokeStyle = P.edge;
  ctx.beginPath();
  ctx.arc(x, y, radius - P.edgeWidth / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = Math.max(1, radius * 0.05);
  ctx.strokeStyle = s.ring;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = s.text;
  ctx.font = pieceFamily ? `${Math.round(radius * 1.3)}px "${pieceFamily}", ${family}` : `${Math.round(radius * 1.15)}px ${family}`;
  ctx.textAlign = 'center';
  // 按字的实际轮廓上下居中；不支持轮廓测量的环境退回按基线居中
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(glyph);
  if (m.actualBoundingBoxAscent !== undefined) {
    ctx.fillText(glyph, x, y + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2);
  } else {
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y + radius * 0.05);
  }
}

// 主题页缩略图的底：一角棋盘
function previewBoard(ctx, theme, x, y, w, h) {
  const b = theme.board;
  ctx.save();
  roundRect(ctx, x, y, w, h, 10);
  ctx.clip();
  fillBoardColor(ctx, b, x, y, w, h);
  ctx.fillRect(x, y, w, h);
  if (b.grain) drawGrain(ctx, b.grain, x, y, w, h);
  ctx.strokeStyle = b.line;
  ctx.lineWidth = b.lineWidth;
  const step = w / 4;
  for (let i = 1; i < 4; i++) {
    line(ctx, x + i * step, y, x + i * step, y + h);
    line(ctx, x, y + i * step, x + w, y + i * step);
  }
  ctx.restore();

  ctx.strokeStyle = b.frame;
  ctx.lineWidth = Math.min(4, b.frameWidth);
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();
}

// 象棋主题缩略图：一红一黑两枚兵卒
function drawThemePreview(ctx, theme, glyphs, x, y, w, h) {
  previewBoard(ctx, theme, x, y, w, h);
  const radius = w * 0.2;
  drawPiece(ctx, theme, 'P', x + w * 0.38, y + h * 0.56, radius, glyphs.P, false);
  drawPiece(ctx, theme, 'p', x + w * 0.63, y + h * 0.44, radius, glyphs.p, false);
}

// ---------- 五子棋 ----------
// g = { ox, oy, cell, size }：左上角交叉点坐标、格子大小、每边几路
function drawGoBoard(ctx, theme, g) {
  const b = theme.board;
  const { ox, oy, cell, size } = g;
  const span = (size - 1) * cell;
  const px = ox - cell * 0.6, py = oy - cell * 0.6, pw = span + cell * 1.2;

  fillBoardColor(ctx, b, px, py, pw, pw);
  ctx.fillRect(px, py, pw, pw);
  if (b.grain) drawGrain(ctx, b.grain, px, py, pw, pw);
  drawFrame(ctx, b, px, py, pw, pw);

  ctx.strokeStyle = b.line;
  ctx.lineWidth = b.lineWidth;
  for (let i = 0; i < size; i++) {
    line(ctx, ox, oy + i * cell, ox + span, oy + i * cell);
    line(ctx, ox + i * cell, oy, ox + i * cell, oy + span);
  }
  ctx.lineWidth = b.lineWidth * 2;
  ctx.strokeRect(ox, oy, span, span);

  // 天元和四个星位
  ctx.fillStyle = b.line;
  const mid = (size - 1) / 2, q = 3;
  for (const [r, c] of [[mid, mid], [q, q], [q, size - 1 - q], [size - 1 - q, q], [size - 1 - q, size - 1 - q]]) {
    ctx.beginPath();
    ctx.arc(ox + c * cell, oy + r * cell, Math.max(2, cell * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
}

// side：'b' 黑子 | 'w' 白子；颜色来自主题的 stones
function drawStone(ctx, theme, side, x, y, radius) {
  const P = theme.pieces;
  const s = theme.stones[side];
  ctx.save();
  if (P.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = radius * 0.25;
    ctx.shadowOffsetY = radius * 0.12;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (P.gradient) {
    const grad = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    grad.addColorStop(0, s.light);
    grad.addColorStop(1, s.fill);
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = s.fill;
  }
  ctx.fill();
  ctx.restore();
  if (s.edge) {
    ctx.lineWidth = theme.stones.edgeWidth || 1;
    ctx.strokeStyle = s.edge;
    ctx.beginPath();
    ctx.arc(x, y, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// 五子棋主题缩略图：一黑一白两枚棋子
function drawGoPreview(ctx, theme, x, y, w, h) {
  previewBoard(ctx, theme, x, y, w, h);
  // 棋子放在缩略图的格线交叉点上（格子边长 w / 4）
  const step = w / 4, radius = step * 0.44;
  drawStone(ctx, theme, 'b', x + step * 2, y + step * 2, radius);
  drawStone(ctx, theme, 'w', x + step * 3, y + step, radius);
  drawStone(ctx, theme, 'b', x + step, y + step, radius);
  drawStone(ctx, theme, 'w', x + step * 3, y + step * 2, radius);
}

module.exports = {
  fontFamily, useFont, usePieceFont, roundRect,
  drawBoard, drawPiece, drawThemePreview, drawGoBoard, drawStone, drawGoPreview,
};

},
"js/config.js": function (require, module, exports) {
module.exports = {"SERVER_URL":"wss://api.gamesyuan.com","GAMES":["gomoku"]};
},
"js/xiangqi-app.js": function (require, module, exports) {
// 中国象棋：首页、人机设置、联网流程、对局画面
const { Game, sideOf, legalMoves } = require('./xiangqi.js');
const { drawBoard, drawPiece, drawThemePreview } = require('./draw.js');
const { LEVELS, findBestMove } = require('./ai.js');
const Net = require('./net.js');
const { SERVER_URL } = require('./config.js');
const ui = require('./ui.js');

const { W, ctx, contentTop, ACTION_H, settings, saveSettings, theme, text, button, buttonRow, header } = ui;
const render = ui.render;

// 棋盘 9 列 10 行（棋子在交叉点上，四周各留半格）
const L = ui.playLayout(9, 10);
const cell = L.cell;
const boardX = W / 2 - 4 * cell; // 左上角交叉点
const boardY = L.boardTop + cell / 2;

if (!LEVELS[settings.aiLevel]) settings.aiLevel = 'medium';
if (!['r', 'b', 'random'].includes(settings.aiSide)) settings.aiSide = 'r';

function glyph(piece) {
  return ui.GLYPHS[settings.glyphs][piece];
}

function pieceIcon(piece) {
  return (x, y, r) => drawPiece(ctx, theme(), piece, x, y, r, glyph(piece), false);
}

// ---------- 状态 ----------
const net = new Net();
let onExit = null; // 小游戏里有多个游戏时，首页左上角可以返回游戏列表
const state = {
  scene: 'menu', // menu | aiSetup | matching | connecting | waiting | playing
  mode: null, // online | ai | local
  aiThinking: false,
  aiToken: 0, // 每次开局、悔棋、离开都加一，丢弃过时的电脑走法
  roomCode: '',
  matched: false, // 这一局是自动匹配来的（不是好友房间）
  matchStart: 0,
  matchOnline: 0,
  myColor: 'r',
  game: new Game(),
  selected: null,
  hints: [],
  awaitingServer: false, // 已发出走法，等服务器确认
  rematchSent: false,
  opponentWantsRematch: false,
  opponentLeft: false,
};

function colorName(color) {
  return color === 'r' ? '红' : '黑';
}

function clearSelection() {
  state.selected = null;
  state.hints = [];
}

function cancelAi() {
  state.aiToken++;
  state.aiThinking = false;
}

function goMenu() {
  net.close();
  cancelAi();
  state.scene = 'menu';
  state.mode = null;
  clearSelection();
  render();
}

// ---------- 联网 ----------
net.onMessage = msg => {
  switch (msg.t) {
    case 'created':
      state.scene = 'waiting';
      state.roomCode = msg.room;
      break;
    case 'matching':
      state.scene = 'matching';
      state.matchOnline = msg.online;
      break;
    case 'start':
      state.mode = 'online';
      state.scene = 'playing';
      state.roomCode = msg.room;
      state.matched = !!msg.matched;
      state.myColor = msg.color;
      state.game = new Game();
      state.awaitingServer = false;
      state.rematchSent = false;
      state.opponentWantsRematch = false;
      state.opponentLeft = false;
      state.me = msg.me;
      state.opponent = msg.opponent;
      state.ratingChange = null;
      clearSelection();
      ui.toast(`${msg.matched ? '匹配成功' : '开局'}！你执${colorName(msg.color)}`);
      break;
    case 'move':
      state.game.move(msg.from, msg.to);
      state.awaitingServer = false;
      clearSelection();
      break;
    case 'over':
      if (!state.game.winner) state.game.end(msg.winner, msg.reason);
      clearSelection();
      break;
    case 'rating':
      state.ratingChange = msg;
      if (state.me) state.me.rating = msg.rating;
      break;
    case 'rematch_request':
      state.opponentWantsRematch = true;
      ui.toast('对方想再来一局');
      break;
    case 'opponent_left':
      state.opponentLeft = true;
      if (state.scene === 'playing' && !state.game.winner) state.game.end(state.myColor, 'left');
      ui.toast('对方已离开');
      break;
    case 'error':
      state.awaitingServer = false;
      ui.toast(msg.msg);
      // 加入房间失败，回到首页
      if (state.scene === 'connecting') {
        goMenu();
        return;
      }
      break;
  }
  render();
};

net.onClose = () => {
  if (state.mode === 'local' || state.scene === 'menu') return;
  if (state.scene === 'playing' && state.game.winner) {
    state.opponentLeft = true;
    render();
    return;
  }
  ui.toast('连接服务器失败或已断开');
  goMenu();
};

function startMatch() {
  state.scene = 'matching';
  state.matchStart = Date.now();
  state.matchOnline = 0;
  net.send({ t: 'match', game: 'xiangqi' });
  render();
}

function createRoom() {
  state.scene = 'connecting';
  net.send({ t: 'create', game: 'xiangqi' });
  render();
}

function joinRoom() {
  ui.askRoomCode(code => {
    state.scene = 'connecting';
    net.send({ t: 'join', room: code, game: 'xiangqi' });
    render();
  });
}

function startLocal() {
  state.mode = 'local';
  state.scene = 'playing';
  state.game = new Game();
  clearSelection();
  render();
}

// ---------- 人机对战 ----------
function openAiSetup() {
  state.scene = 'aiSetup';
  render();
}

function startAi() {
  cancelAi();
  state.mode = 'ai';
  state.scene = 'playing';
  state.myColor = settings.aiSide === 'random' ? (Math.random() < 0.5 ? 'r' : 'b') : settings.aiSide;
  state.game = new Game();
  clearSelection();
  render();
  maybeAiMove();
}

// 轮到电脑时，先把"思考中"画出来，再开始计算（计算期间画面不会刷新）
function maybeAiMove() {
  const game = state.game;
  if (state.mode !== 'ai' || game.winner || game.turn === state.myColor) return;
  state.aiThinking = true;
  const token = ++state.aiToken;
  render();
  setTimeout(() => {
    if (token !== state.aiToken) return;
    const m = findBestMove(game.board, game.turn, settings.aiLevel);
    if (m) game.move(m.from, m.to);
    state.aiThinking = false;
    clearSelection();
    render();
  }, 60);
}

// 悔棋退回到轮到自己走：一般要退两步（电脑一步、自己一步）
function undoAi() {
  const game = state.game;
  cancelAi();
  do {
    if (!game.undo()) break;
  } while (game.turn !== state.myColor);
  clearSelection();
  render();
  maybeAiMove();
}

function showHint() {
  const game = state.game;
  wx.showToast({ title: '计算中…', icon: 'loading' });
  setTimeout(() => {
    const m = findBestMove(game.board, state.myColor, 'medium');
    wx.hideToast();
    if (!m || game.turn !== state.myColor || game.winner) return;
    state.selected = m.from;
    state.hints = [m.to];
    render();
  }, 60);
}

function openMenu() {
  const game = state.game;
  if (state.mode === 'local' || state.mode === 'ai') {
    ui.actionSheet([
      ['重新开始', () => ui.confirmThen('重新开始这一局？', state.mode === 'ai' ? startAi : startLocal)],
      ['返回首页', goMenu],
    ]);
  } else if (game.winner) {
    ui.actionSheet([['返回首页', goMenu]]);
  } else {
    ui.actionSheet([
      ['认输', () => ui.confirmThen('确定认输吗？', () => net.send({ t: 'resign' }))],
      ['离开房间', () => ui.confirmThen('现在离开会判负，确定吗？', goMenu)],
    ]);
  }
}

// ---------- 坐标换算 ----------
// 执黑时把棋盘倒过来，让自己的棋子在下方
function flipped() {
  return state.mode !== 'local' && state.myColor === 'b';
}

function toScreen(r, c) {
  const dr = flipped() ? 9 - r : r;
  const dc = flipped() ? 8 - c : c;
  return [boardX + dc * cell, boardY + dr * cell];
}

function fromScreen(x, y) {
  const dc = Math.round((x - boardX) / cell);
  const dr = Math.round((y - boardY) / cell);
  if (dr < 0 || dr > 9 || dc < 0 || dc > 8) return null;
  if (Math.hypot(x - (boardX + dc * cell), y - (boardY + dr * cell)) > cell * 0.5) return null;
  return flipped() ? [9 - dr, 8 - dc] : [dr, dc];
}

// ---------- 点击 ----------
function onBoardTap(r, c) {
  const game = state.game;
  if (game.winner || state.awaitingServer || state.aiThinking) return;
  if (state.mode !== 'local' && game.turn !== state.myColor) return;

  const piece = game.board[r][c];
  if (sideOf(piece) === game.turn) {
    state.selected = [r, c];
    state.hints = legalMoves(game.board, r, c);
  } else if (state.selected && state.hints.some(([hr, hc]) => hr === r && hc === c)) {
    const from = state.selected;
    if (state.mode === 'online') {
      state.awaitingServer = true;
      net.send({ t: 'move', from, to: [r, c] });
    } else {
      game.move(from, [r, c]);
      clearSelection();
      maybeAiMove();
    }
  } else {
    clearSelection();
  }
  render();
}

// ---------- 首页 ----------
function drawHome() {
  ui.drawDecor();
  if (onExit) {
    header('中国象棋', onExit);
  } else {
    pieceIcon('B')(33, ui.titleY, 17);
    text('象棋对战', 60, ui.titleY, 22, theme().ui.primary, { bold: true, align: 'left' });
  }

  ui.accountButton();
  const entries = [
    { piece: 'P', title: '快速匹配', sub: '自动匹配正在找棋友的人', onTap: startMatch, online: true },
    { piece: 'K', title: '创建房间', sub: '生成房间号，邀请好友联网对战', onTap: createRoom, online: true },
    { piece: 'n', title: '加入房间', sub: '输入好友发来的房间号', onTap: joinRoom, online: true },
    { piece: 'R', title: '人机对战', sub: '和电脑下棋 · 入门 / 业余 / 大师', onTap: openAiSetup },
    { piece: 'C', title: '本地双人', sub: '同一台设备，轮流走棋', onTap: startLocal },
    { piece: 'b', title: '棋盘主题', sub: ui.THEMES.map(t => t.name).join(' · '), onTap: ui.openThemes },
  ].filter(entry => SERVER_URL || !entry.online); // 没配服务器（比如小游戏版）就不显示联网入口
  ui.entryCards(entries.map(entry => ({ ...entry, icon: pieceIcon(entry.piece) })));
}

function drawAiSetup() {
  ui.drawDecor();
  header('人机对战', goMenu);
  const colors = theme().ui;
  const x = 16, w = W - 32;
  let y = contentTop + 6;

  text('难度', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  for (const id of Object.keys(LEVELS)) {
    const level = LEVELS[id];
    const selected = settings.aiLevel === id;
    ui.levelCard(x, y, w, level, selected, () => {
      settings.aiLevel = id;
      saveSettings();
      render();
    });
    y += 66;
  }

  y += 8;
  text('执子', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  const sides = [['r', '执红先走'], ['random', '随机'], ['b', '执黑后走']];
  const bw = (w - 20) / 3;
  sides.forEach(([id, label], i) => {
    button(label, x + i * (bw + 10), y, bw, 42, () => {
      settings.aiSide = id;
      saveSettings();
      render();
    }, settings.aiSide !== id);
  });

  y += 72;
  button('开始对局', x, y, w, 50, startAi);
}

// ---------- 对局 ----------
function playerBar(y, side) {
  const game = state.game;
  let name, sub;
  const mine = side === state.myColor;
  if (state.mode === 'ai') {
    name = mine ? '我' : `电脑 · ${LEVELS[settings.aiLevel].name}`;
    sub = `执${colorName(side)}`;
  } else if (state.mode === 'online') {
    const player = mine ? state.me : state.opponent;
    name = mine ? '我' : (player ? player.name : '对手');
    sub = `执${colorName(side)}${player ? ` · 积分 ${player.rating}` : ''}${mine ? '' : state.matched ? ' · 随机匹配' : ` · 房间 ${state.roomCode}`}`;
  } else {
    name = `${colorName(side)}方`;
    sub = '本地双人';
  }
  let label = null;
  if (game.turn === side && !game.winner) {
    label = '走棋中';
    if (game.inCheck()) label = '将军！';
    else if (state.mode !== 'local' && !mine) label = '思考中';
  }
  ui.playerBar(y, { icon: pieceIcon(side === 'r' ? 'K' : 'k'), name, sub, label });
}

// 上一步的起点和终点画四个角框
function cornerMarks(x, y) {
  const s = cell * 0.48, l = s * 0.32;
  ctx.strokeStyle = theme().mark.last;
  ctx.lineWidth = 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sx * s, y + sy * (s - l));
      ctx.lineTo(x + sx * s, y + sy * s);
      ctx.lineTo(x + sx * (s - l), y + sy * s);
      ctx.stroke();
    }
  }
}

function drawPieces() {
  const t = theme();
  const { board, lastMove } = state.game;
  const radius = cell * 0.46;

  if (lastMove) {
    for (const sq of [lastMove.from, lastMove.to]) {
      const [x, y] = toScreen(sq[0], sq[1]);
      cornerMarks(x, y);
    }
  }

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const isSelected = state.selected && state.selected[0] === r && state.selected[1] === c;
      const [x, y0] = toScreen(r, c);
      const y = isSelected ? y0 - 3 : y0;
      drawPiece(ctx, t, piece, x, y, radius, glyph(piece), isSelected);
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = t.mark.select;
        ctx.beginPath();
        ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  for (const [r, c] of state.hints) {
    const [x, y] = toScreen(r, c);
    ctx.beginPath();
    if (board[r][c]) {
      // 能吃的子画虚线圈，和"选中"的实线圈区分开
      ctx.save();
      if (ctx.setLineDash) ctx.setLineDash([5, 4]);
      ctx.lineWidth = 3;
      ctx.strokeStyle = t.mark.hint;
      ctx.arc(x, y, radius + 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.fillStyle = t.mark.hint;
      ctx.arc(x, y, cell * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function overText() {
  const { winner, reason } = state.game;
  const reasons = {
    checkmate: '绝杀',
    stalemate: '困毙（无子可走）',
    left: '对方离开了房间',
  };
  if (state.mode === 'local') return [`${colorName(winner)}方胜`, reasons[reason] || ''];
  const iWin = winner === state.myColor;
  const why = reason === 'resign' ? (iWin ? '对方认输' : '你认输了') : reasons[reason];
  return [iWin ? '你赢了！' : '你输了', why];
}

function drawOverlay() {
  const [title, sub] = overText();
  if (state.mode === 'local') {
    ui.resultBox(title, sub, [{ label: '再来一局', onTap: startLocal }, { label: '返回首页', onTap: goMenu, outline: true }]);
  } else if (state.mode === 'ai') {
    // 输给电脑可以悔棋接着下
    ui.resultBox(title, sub, [
      { label: '悔棋', onTap: undoAi, outline: true },
      { label: '再来一局', onTap: startAi },
      { label: '返回首页', onTap: goMenu, outline: true },
    ]);
  } else {
    ui.resultBox(title, ui.withRating(sub, state.ratingChange), [rematchButton(), { label: '返回首页', onTap: goMenu, outline: true }]);
  }
}

function rematchButton() {
  if (state.opponentLeft) return { label: '对方已离开', onTap: null };
  if (state.rematchSent) return { label: '等待对方…', onTap: null };
  return {
    label: state.opponentWantsRematch ? '同意再战' : '再来一局',
    onTap() {
      state.rematchSent = true;
      net.send({ t: 'rematch' });
      render();
    },
  };
}

function drawPlaying() {
  const game = state.game;
  const bottomSide = flipped() ? 'b' : 'r';
  const topSide = bottomSide === 'r' ? 'b' : 'r';
  playerBar(L.topBarY, topSide);
  drawBoard(ctx, theme(), { ox: boardX, oy: boardY, cell });
  drawPieces();

  const actions = [{ label: '菜单', onTap: openMenu, outline: true }];
  if (state.mode === 'local') {
    actions.push({
      label: '悔棋',
      outline: true,
      onTap: game.history.length && !game.winner ? () => { game.undo(); clearSelection(); render(); } : null,
    });
  } else if (state.mode === 'ai') {
    const myTurn = game.turn === state.myColor && !game.winner && !state.aiThinking;
    actions.push({ label: '悔棋', outline: true, onTap: game.history.length && !state.aiThinking ? undoAi : null });
    actions.push({ label: '提示', outline: true, onTap: myTurn ? showHint : null });
  }
  actions.push({ label: '主题', onTap: ui.openThemes, outline: true });
  buttonRow(actions, 12, L.actionY, W - 24, ACTION_H);

  playerBar(L.bottomBarY, bottomSide);
  if (game.winner) drawOverlay();
}

const app = {
  glyphOption: true,
  render() {
    if (state.scene === 'menu') drawHome();
    else if (state.scene === 'aiSetup') drawAiSetup();
    else if (state.scene === 'matching') ui.matchingScreen(state.matchStart, state.matchOnline, pieceIcon('K'), goMenu);
    else if (state.scene === 'connecting') ui.connectingScreen(goMenu);
    else if (state.scene === 'waiting') ui.waitingScreen(state.roomCode, goMenu);
    else drawPlaying();
  },
  onTouch(x, y) {
    if (state.scene !== 'playing') return;
    const sq = fromScreen(x, y);
    if (sq) onBoardTap(sq[0], sq[1]);
  },
  // 匹配画面有动画，需要定时重画
  animating() {
    return state.scene === 'matching';
  },
  drawThemePreview(t, x, y, w, h) {
    drawThemePreview(ctx, t, ui.GLYPHS[settings.glyphs], x, y, w, h);
  },
};

// exit：返回游戏列表的回调；只有一个游戏时（网页版）不传
function open(exit) {
  onExit = exit || null;
  state.scene = 'menu';
  ui.show(app);
}

module.exports = { open };

},
"js/xiangqi.js": function (require, module, exports) {
// 中国象棋规则引擎（小游戏客户端和服务器共用同一份代码）
// 棋盘 10 行 × 9 列：第 0 行在黑方一侧，第 9 行在红方一侧。
// 棋子用一个字母表示，大写为红方，小写为黑方：
//   K 帅/将  A 仕/士  B 相/象  N 马  R 车  C 炮  P 兵/卒

const ROWS = 10;
const COLS = 9;
const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function initialBoard() {
  return [
    'rnbakabnr',
    '.........',
    '.c.....c.',
    'p.p.p.p.p',
    '.........',
    '.........',
    'P.P.P.P.P',
    '.C.....C.',
    '.........',
    'RNBAKABNR',
  ].map(row => row.split('').map(ch => (ch === '.' ? null : ch)));
}

function sideOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? 'r' : 'b';
}

function opponent(side) {
  return side === 'r' ? 'b' : 'r';
}

function inBoard(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

function inPalace(side, r, c) {
  return c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
}

function onOwnHalf(side, r) {
  return side === 'r' ? r >= 5 : r <= 4;
}

// 不考虑"走完后自己被将军"的走法
function pseudoMoves(board, r, c) {
  const piece = board[r][c];
  if (!piece) return [];
  const side = sideOf(piece);
  const moves = [];
  const tryAdd = (nr, nc) => {
    if (!inBoard(nr, nc)) return;
    const target = board[nr][nc];
    if (!target || sideOf(target) !== side) moves.push([nr, nc]);
  };

  switch (piece.toUpperCase()) {
    case 'K':
      for (const [dr, dc] of ORTH) {
        if (inPalace(side, r + dr, c + dc)) tryAdd(r + dr, c + dc);
      }
      break;
    case 'A':
      for (const [dr, dc] of DIAG) {
        if (inPalace(side, r + dr, c + dc)) tryAdd(r + dr, c + dc);
      }
      break;
    case 'B':
      for (const [dr, dc] of DIAG) {
        const nr = r + 2 * dr, nc = c + 2 * dc;
        // 象不能过河，且"象眼"不能被堵
        if (inBoard(nr, nc) && onOwnHalf(side, nr) && !board[r + dr][c + dc]) tryAdd(nr, nc);
      }
      break;
    case 'N':
      for (const [dr, dc] of ORTH) {
        const lr = r + dr, lc = c + dc;
        // "蹩马腿"
        if (!inBoard(lr, lc) || board[lr][lc]) continue;
        if (dr !== 0) {
          tryAdd(r + 2 * dr, c - 1);
          tryAdd(r + 2 * dr, c + 1);
        } else {
          tryAdd(r - 1, c + 2 * dc);
          tryAdd(r + 1, c + 2 * dc);
        }
      }
      break;
    case 'R':
      for (const [dr, dc] of ORTH) {
        let nr = r + dr, nc = c + dc;
        while (inBoard(nr, nc)) {
          if (!board[nr][nc]) {
            moves.push([nr, nc]);
          } else {
            if (sideOf(board[nr][nc]) !== side) moves.push([nr, nc]);
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;
    case 'C':
      for (const [dr, dc] of ORTH) {
        let nr = r + dr, nc = c + dc;
        let jumped = false;
        while (inBoard(nr, nc)) {
          const target = board[nr][nc];
          if (!jumped) {
            if (!target) moves.push([nr, nc]);
            else jumped = true;
          } else if (target) {
            // 炮隔一个子吃子
            if (sideOf(target) !== side) moves.push([nr, nc]);
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;
    case 'P': {
      const forward = side === 'r' ? -1 : 1;
      tryAdd(r + forward, c);
      // 过河后可以横走
      if (!onOwnHalf(side, r)) {
        tryAdd(r, c - 1);
        tryAdd(r, c + 1);
      }
      break;
    }
  }
  return moves;
}

function findKing(board, side) {
  const king = side === 'r' ? 'K' : 'k';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === king) return [r, c];
    }
  }
  return null;
}

// side 的帅/将是否被攻击（包括"将帅照面"）
function isInCheck(board, side) {
  const king = findKing(board, side);
  if (!king) return true;
  const [kr, kc] = king;

  const enemyKing = findKing(board, opponent(side));
  if (enemyKing && enemyKing[1] === kc) {
    const lo = Math.min(kr, enemyKing[0]), hi = Math.max(kr, enemyKing[0]);
    let blocked = false;
    for (let r = lo + 1; r < hi; r++) {
      if (board[r][kc]) { blocked = true; break; }
    }
    if (!blocked) return true;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (!piece || sideOf(piece) === side || piece.toUpperCase() === 'K') continue;
      if (pseudoMoves(board, r, c).some(([mr, mc]) => mr === kr && mc === kc)) return true;
    }
  }
  return false;
}

function applyMove(board, from, to) {
  const next = board.map(row => row.slice());
  next[to[0]][to[1]] = next[from[0]][from[1]];
  next[from[0]][from[1]] = null;
  return next;
}

function legalMoves(board, r, c) {
  const side = sideOf(board[r][c]);
  if (!side) return [];
  return pseudoMoves(board, r, c).filter(to => !isInCheck(applyMove(board, [r, c], to), side));
}

function allLegalMoves(board, side) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (sideOf(board[r][c]) !== side) continue;
      for (const to of legalMoves(board, r, c)) moves.push({ from: [r, c], to });
    }
  }
  return moves;
}

function isValidSquare(sq) {
  return Array.isArray(sq) && sq.length === 2 &&
    Number.isInteger(sq[0]) && Number.isInteger(sq[1]) && inBoard(sq[0], sq[1]);
}

// 一盘棋的状态：轮到谁、胜负、悔棋记录
class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = initialBoard();
    this.turn = 'r';
    this.history = [];
    this.lastMove = null;
    this.winner = null;
    this.reason = null; // checkmate 绝杀 / stalemate 困毙 / resign 认输 / left 对方离开
  }

  canMove(from, to) {
    if (this.winner || !isValidSquare(from) || !isValidSquare(to)) return false;
    if (sideOf(this.board[from[0]][from[1]]) !== this.turn) return false;
    return legalMoves(this.board, from[0], from[1]).some(([r, c]) => r === to[0] && c === to[1]);
  }

  move(from, to) {
    if (!this.canMove(from, to)) return false;
    this.history.push({ board: this.board, lastMove: this.lastMove });
    this.board = applyMove(this.board, from, to);
    this.lastMove = { from, to };
    this.turn = opponent(this.turn);
    // 象棋里无子可走就算输（被将死或困毙）
    if (allLegalMoves(this.board, this.turn).length === 0) {
      this.winner = opponent(this.turn);
      this.reason = isInCheck(this.board, this.turn) ? 'checkmate' : 'stalemate';
    }
    return true;
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.board = prev.board;
    this.lastMove = prev.lastMove;
    this.turn = opponent(this.turn);
    this.winner = null;
    this.reason = null;
    return true;
  }

  end(winner, reason) {
    this.winner = winner;
    this.reason = reason;
  }

  inCheck() {
    return isInCheck(this.board, this.turn);
  }
}

module.exports = {
  ROWS,
  COLS,
  Game,
  initialBoard,
  sideOf,
  opponent,
  pseudoMoves,
  legalMoves,
  allLegalMoves,
  applyMove,
  isInCheck,
};

},
"js/ai.js": function (require, module, exports) {
// 人机对战：迭代加深的 Alpha-Beta 搜索 + 吃子静态搜索
// 搜索内部用"伪合法走法 + 吃掉将帅即胜"，省去每步检查是否送将，速度快很多；
// 根节点只从真正合法的走法里选，所以电脑不会走出违规的棋。
const { ROWS, COLS, pseudoMoves, allLegalMoves, opponent, sideOf } = require('./xiangqi.js');

const LEVELS = {
  easy: { name: '入门', desc: '只算两步，常有失误', maxDepth: 2, timeMs: 300, noise: 100 },
  medium: { name: '业余', desc: '会算两三步', maxDepth: 3, timeMs: 800, noise: 15 },
  hard: { name: '大师', desc: '全力计算，限时 2.5 秒', maxDepth: 20, timeMs: 2500, noise: 0 },
};

const VALUE = { K: 10000, R: 600, C: 300, N: 280, B: 120, A: 120, P: 40 };
const MATE = 100000;

// 位置分。adv 是棋子离本方底线前进了几行（0~9）
function positional(type, side, r, c) {
  const adv = side === 'r' ? 9 - r : r;
  const center = 4 - Math.abs(c - 4);
  switch (type) {
    case 'P':
      if (adv < 5) return 0;
      // 过河兵越靠近九宫越值钱，沉到底线就没什么用了
      if (adv === 9) return 20;
      return 40 + (adv - 5) * 12 + (c >= 3 && c <= 5 ? 20 : 0);
    case 'N':
      return center * 6 + Math.min(adv, 6) * 4 - (c === 0 || c === 8 ? 15 : 0);
    case 'C':
      return (c === 4 ? 15 : 0) + center * 2;
    case 'R':
      return center * 3 + (adv >= 5 ? 15 : 0);
    default:
      return 0;
  }
}

// 站在 side 一方看的局面分
function evaluate(board, side) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const type = piece.toUpperCase();
      const s = sideOf(piece);
      const v = VALUE[type] + positional(type, s, r, c);
      score += s === 'r' ? v : -v;
    }
  }
  return side === 'r' ? score : -score;
}

function genMoves(board, side, capturesOnly) {
  const moves = [];
  const king = side === 'r' ? 'K' : 'k';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const piece = board[r][c];
      if (sideOf(piece) !== side) continue;
      const attacker = VALUE[piece.toUpperCase()];
      for (const [tr, tc] of pseudoMoves(board, r, c)) {
        const target = board[tr][tc];
        if (capturesOnly && !target) continue;
        // 先搜吃大子、用小子吃的走法，剪枝效率高
        const score = target ? VALUE[target.toUpperCase()] * 10 - attacker / 10 : 0;
        moves.push({ fr: r, fc: c, tr, tc, score, capture: !!target });
      }
      // 将帅照面：当成可以"飞将"吃掉对方的将，这样送将照面的走法会被立刻惩罚
      if (piece === king) {
        const dir = side === 'r' ? -1 : 1;
        for (let rr = r + dir; rr >= 0 && rr < ROWS; rr += dir) {
          const p = board[rr][c];
          if (!p) continue;
          if (p.toUpperCase() === 'K') moves.push({ fr: r, fc: c, tr: rr, tc: c, score: VALUE.K * 10, capture: true });
          break;
        }
      }
    }
  }
  return moves;
}

function byScore(a, b) {
  return b.score - a.score;
}

// Zobrist 哈希：每种棋子在每个位置一个随机数，局面哈希 = 所有棋子的随机数异或
const PIECE_INDEX = {};
'KABNRCPkabnrcp'.split('').forEach((p, i) => { PIECE_INDEX[p] = i; });
const ZOBRIST = [];
for (let i = 0; i < 14 * 90; i++) ZOBRIST.push((Math.random() * 0x7fffffff) | 0);
const SIDE_KEY = (Math.random() * 0x7fffffff) | 0;

function zobrist(piece, r, c) {
  return ZOBRIST[PIECE_INDEX[piece] * 90 + r * 9 + c];
}

const EXACT = 0, LOWER = 1, UPPER = 2;

class Search {
  constructor(board, deadline) {
    this.board = board.map(row => row.slice());
    this.deadline = deadline;
    this.nodes = 0;
    this.stopped = false;
    this.tt = new Map(); // 置换表：同一局面不重复搜索
    this.killers = []; // 每层引发剪枝的安静走法
    this.history = new Int32Array(90 * 90); // 历史上常引发剪枝的走法
    this.hash = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.board[r][c]) this.hash ^= zobrist(this.board[r][c], r, c);
      }
    }
  }

  timeUp() {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }

  make(m) {
    const piece = this.board[m.fr][m.fc];
    const captured = this.board[m.tr][m.tc];
    this.hash ^= zobrist(piece, m.fr, m.fc) ^ zobrist(piece, m.tr, m.tc);
    if (captured) this.hash ^= zobrist(captured, m.tr, m.tc);
    this.board[m.tr][m.tc] = piece;
    this.board[m.fr][m.fc] = null;
    return captured;
  }

  unmake(m, captured) {
    const piece = this.board[m.tr][m.tc];
    this.hash ^= zobrist(piece, m.fr, m.fc) ^ zobrist(piece, m.tr, m.tc);
    if (captured) this.hash ^= zobrist(captured, m.tr, m.tc);
    this.board[m.fr][m.fc] = piece;
    this.board[m.tr][m.tc] = captured;
  }

  // 走法排序：置换表里的最佳走法 > 吃子 > 杀手走法 > 历史分
  order(moves, ttMove, ply) {
    const killers = this.killers[ply] || [];
    for (const m of moves) {
      if (ttMove && m.fr === ttMove.fr && m.fc === ttMove.fc && m.tr === ttMove.tr && m.tc === ttMove.tc) {
        m.score = 1e7;
      } else if (!m.capture) {
        const isKiller = killers.some(k => k.fr === m.fr && k.fc === m.fc && k.tr === m.tr && k.tc === m.tc);
        m.score = isKiller ? 300 : Math.min(250, this.history[(m.fr * 9 + m.fc) * 90 + m.tr * 9 + m.tc]);
      }
    }
    moves.sort(byScore);
  }

  negamax(depth, alpha, beta, side, ply) {
    if (this.timeUp()) return 0;
    if (depth <= 0) return this.quiesce(alpha, beta, side, ply, 0);

    const key = side === 'r' ? this.hash : this.hash ^ SIDE_KEY;
    const entry = this.tt.get(key);
    // 杀棋分和步数有关，不从置换表直接取用
    if (entry && entry.depth >= depth && Math.abs(entry.score) < MATE - 1000) {
      if (entry.flag === EXACT) return entry.score;
      if (entry.flag === LOWER && entry.score >= beta) return entry.score;
      if (entry.flag === UPPER && entry.score <= alpha) return entry.score;
    }

    const moves = genMoves(this.board, side, false);
    if (!moves.length) return -MATE + ply;
    this.order(moves, entry && entry.move, ply);

    const alphaOrig = alpha;
    let best = -Infinity, bestMove = null, first = true;
    for (const m of moves) {
      const target = this.board[m.tr][m.tc];
      if (target && target.toUpperCase() === 'K') return MATE - ply;
      const captured = this.make(m);
      let score;
      if (first) {
        score = -this.negamax(depth - 1, -beta, -alpha, opponent(side), ply + 1);
      } else {
        // 主变搜索：先用零窗口快速证明这步不如已有最佳，证明失败再完整搜索
        score = -this.negamax(depth - 1, -alpha - 1, -alpha, opponent(side), ply + 1);
        if (score > alpha && score < beta) score = -this.negamax(depth - 1, -beta, -alpha, opponent(side), ply + 1);
      }
      this.unmake(m, captured);
      if (this.stopped) return 0;
      first = false;
      if (score > best) {
        best = score;
        bestMove = m;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!m.capture) {
          const killers = this.killers[ply] || (this.killers[ply] = []);
          killers.unshift(m);
          if (killers.length > 2) killers.pop();
          this.history[(m.fr * 9 + m.fc) * 90 + m.tr * 9 + m.tc] += depth * depth;
        }
        break;
      }
    }

    if (this.tt.size > 400000) this.tt.clear();
    const flag = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    this.tt.set(key, { depth, score: best, flag, move: bestMove });
    return best;
  }

  // 只看吃子，避免在双方正在兑子时停下来误判
  quiesce(alpha, beta, side, ply, qdepth) {
    if (this.timeUp()) return 0;
    const standPat = evaluate(this.board, side);
    if (standPat >= beta) return standPat;
    if (standPat > alpha) alpha = standPat;
    if (qdepth >= 6) return standPat;
    const moves = genMoves(this.board, side, true);
    moves.sort(byScore);
    for (const m of moves) {
      if (this.board[m.tr][m.tc].toUpperCase() === 'K') return MATE - ply;
      const captured = this.make(m);
      const score = -this.quiesce(-beta, -alpha, opponent(side), ply + 1, qdepth + 1);
      this.unmake(m, captured);
      if (this.stopped) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }
}

// 返回 { from, to, score, depth } ；无棋可走时返回 null
function findBestMove(board, side, levelId) {
  const level = LEVELS[levelId] || LEVELS.medium;
  const legal = allLegalMoves(board, side);
  if (!legal.length) return null;

  const search = new Search(board, Date.now() + level.timeMs);
  let rootMoves = legal.map(m => ({ fr: m.from[0], fc: m.from[1], tr: m.to[0], tc: m.to[1], score: 0 }));
  let completed = rootMoves;
  let depthDone = 0;

  for (let depth = 1; depth <= level.maxDepth; depth++) {
    let alpha = -Infinity;
    for (const m of rootMoves) {
      const captured = search.make(m);
      // 带随机扰动的难度需要每个走法的准确分数，所以不收窄窗口
      const window = level.noise ? -Infinity : alpha;
      const score = -search.negamax(depth - 1, -Infinity, -window, opponent(side), 1);
      search.unmake(m, captured);
      if (search.stopped) break;
      m.score = score;
      if (score > alpha) alpha = score;
    }
    // 这一层没算完就用上一层的结果
    if (search.stopped) break;
    rootMoves.sort((a, b) => b.score - a.score);
    completed = rootMoves.map(m => Object.assign({}, m));
    depthDone = depth;
    if (Math.abs(completed[0].score) >= MATE - 100) break; // 已经算出杀棋或被杀
  }

  let best = completed[0];
  if (level.noise) {
    let bestNoisy = -Infinity;
    for (const m of completed) {
      const noisy = m.score + Math.random() * level.noise;
      if (noisy > bestNoisy) {
        bestNoisy = noisy;
        best = m;
      }
    }
  }
  return { from: [best.fr, best.fc], to: [best.tr, best.tc], score: best.score, depth: depthDone, nodes: search.nodes };
}

module.exports = { LEVELS, findBestMove };

},
"js/net.js": function (require, module, exports) {
// WebSocket 封装：收发 JSON 消息
const { SERVER_URL } = require('./config.js');

class Net {
  constructor() {
    this.socket = null;
    this.open = false;
    this.queue = [];
    this.pingTimer = null;
    this.onMessage = () => {};
    this.onClose = () => {};
  }

  // 定时发心跳：服务器据此判断谁还在线，排队匹配时不会配到已经掉线的人
  startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 20000);
  }

  stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  connect() {
    if (this.socket) return;
    const socket = wx.connectSocket({ url: SERVER_URL });
    this.socket = socket;
    socket.onOpen(() => {
      this.open = true;
      this.startPing();
      // 服务器据此记积分；第一次联网没有令牌，服务器会建一个游客账号并发回令牌
      socket.send({ data: JSON.stringify({ t: 'auth', token: wx.getStorageSync('token') || '' }) });
      for (const msg of this.queue) socket.send({ data: JSON.stringify(msg) });
      this.queue = [];
    });
    socket.onMessage(res => {
      let msg;
      try {
        msg = JSON.parse(res.data);
      } catch (e) {
        return;
      }
      if (msg.t === 'auth') {
        if (msg.token) wx.setStorageSync('token', msg.token);
        return;
      }
      this.onMessage(msg);
    });
    const closed = () => {
      if (this.socket !== socket) return;
      this.stopPing();
      this.socket = null;
      this.open = false;
      this.queue = [];
      this.onClose();
    };
    socket.onClose(closed);
    socket.onError(closed);
  }

  // 还没连上时先排队，连上后一起发
  send(msg) {
    this.connect();
    if (this.open) this.socket.send({ data: JSON.stringify(msg) });
    else this.queue.push(msg);
  }

  close() {
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    this.open = false;
    this.queue = [];
    if (socket) socket.close({});
  }
}

module.exports = Net;

},
"js/gomoku-app.js": function (require, module, exports) {
// 五子棋：首页、人机设置、联网流程、对局画面
// 手机上格子小，落子要点两下：第一下放一枚半透明的预览子，再点同一处才落下。
const { SIZE, Game } = require('./gomoku.js');
const { drawGoBoard, drawStone, drawGoPreview } = require('./draw.js');
const { LEVELS, findBestMove } = require('./gomoku-ai.js');
const Net = require('./net.js');
const { SERVER_URL } = require('./config.js');
const ui = require('./ui.js');

const { W, ctx, contentTop, ACTION_H, settings, saveSettings, theme, text, button, buttonRow, header } = ui;
const render = ui.render;

// 15 路棋盘，四周各留 0.6 格放边框
const L = ui.playLayout(SIZE + 0.2, SIZE + 0.2);
const cell = L.cell;
const boardX = W / 2 - ((SIZE - 1) / 2) * cell; // 左上角交叉点
const boardY = L.boardTop + cell * 0.6;

if (!LEVELS[settings.gomokuLevel]) settings.gomokuLevel = 'medium';
if (!['b', 'w', 'random'].includes(settings.gomokuSide)) settings.gomokuSide = 'b';

function stoneIcon(side) {
  return (x, y, r) => drawStone(ctx, theme(), side, x, y, r * 0.9);
}

// ---------- 状态 ----------
const net = new Net();
let onExit = null;
const state = {
  scene: 'menu', // menu | aiSetup | matching | connecting | waiting | playing
  mode: null, // online | ai | local
  aiThinking: false,
  aiToken: 0,
  roomCode: '',
  matched: false,
  matchStart: 0,
  matchOnline: 0,
  myColor: 'b',
  game: new Game(),
  pending: null, // 点了一下、还没确认的落点
  resultAt: 0, // 分出胜负后过一会儿再弹结算框，先让人看清连成的五子
  awaitingServer: false,
  rematchSent: false,
  opponentWantsRematch: false,
  opponentLeft: false,
};

function colorName(color) {
  return color === 'b' ? '黑' : '白';
}

function cancelAi() {
  state.aiToken++;
  state.aiThinking = false;
}

function goMenu() {
  net.close();
  cancelAi();
  state.scene = 'menu';
  state.mode = null;
  state.pending = null;
  render();
}

// ---------- 联网 ----------
net.onMessage = msg => {
  switch (msg.t) {
    case 'created':
      state.scene = 'waiting';
      state.roomCode = msg.room;
      break;
    case 'matching':
      state.scene = 'matching';
      state.matchOnline = msg.online;
      break;
    case 'start':
      state.mode = 'online';
      state.scene = 'playing';
      state.roomCode = msg.room;
      state.matched = !!msg.matched;
      state.myColor = msg.color;
      state.game = new Game();
      state.pending = null;
      state.awaitingServer = false;
      state.rematchSent = false;
      state.opponentWantsRematch = false;
      state.opponentLeft = false;
      state.me = msg.me;
      state.opponent = msg.opponent;
      state.ratingChange = null;
      ui.toast(`${msg.matched ? '匹配成功' : '开局'}！你执${colorName(msg.color)}`);
      break;
    case 'move':
      state.game.move(msg.at);
      state.awaitingServer = false;
      state.pending = null;
      break;
    case 'over':
      if (!state.game.winner) state.game.end(msg.winner, msg.reason);
      state.pending = null;
      break;
    case 'rating':
      state.ratingChange = msg;
      if (state.me) state.me.rating = msg.rating;
      break;
    case 'rematch_request':
      state.opponentWantsRematch = true;
      ui.toast('对方想再来一局');
      break;
    case 'opponent_left':
      state.opponentLeft = true;
      if (state.scene === 'playing' && !state.game.winner) state.game.end(state.myColor, 'left');
      ui.toast('对方已离开');
      break;
    case 'error':
      state.awaitingServer = false;
      ui.toast(msg.msg);
      if (state.scene === 'connecting') {
        goMenu();
        return;
      }
      break;
  }
  render();
};

net.onClose = () => {
  if (state.mode === 'local' || state.scene === 'menu') return;
  if (state.scene === 'playing' && state.game.winner) {
    state.opponentLeft = true;
    render();
    return;
  }
  ui.toast('连接服务器失败或已断开');
  goMenu();
};

function startMatch() {
  state.scene = 'matching';
  state.matchStart = Date.now();
  state.matchOnline = 0;
  net.send({ t: 'match', game: 'gomoku' });
  render();
}

function createRoom() {
  state.scene = 'connecting';
  net.send({ t: 'create', game: 'gomoku' });
  render();
}

function joinRoom() {
  ui.askRoomCode(code => {
    state.scene = 'connecting';
    net.send({ t: 'join', room: code, game: 'gomoku' });
    render();
  });
}

function startLocal() {
  state.mode = 'local';
  state.scene = 'playing';
  state.game = new Game();
  state.pending = null;
  render();
}

// ---------- 人机对战 ----------
function startAi() {
  cancelAi();
  state.mode = 'ai';
  state.scene = 'playing';
  state.myColor = settings.gomokuSide === 'random' ? (Math.random() < 0.5 ? 'b' : 'w') : settings.gomokuSide;
  state.game = new Game();
  state.pending = null;
  render();
  maybeAiMove();
}

function maybeAiMove() {
  const game = state.game;
  if (state.mode !== 'ai' || game.winner || game.turn === state.myColor) return;
  state.aiThinking = true;
  const token = ++state.aiToken;
  render();
  setTimeout(() => {
    if (token !== state.aiToken) return;
    const m = findBestMove(game.board, game.turn, settings.gomokuLevel);
    game.move(m.at);
    state.aiThinking = false;
    state.pending = null;
    render();
  }, 60);
}

function undoAi() {
  const game = state.game;
  cancelAi();
  do {
    if (!game.undo()) break;
  } while (game.turn !== state.myColor);
  state.pending = null;
  render();
  maybeAiMove();
}

// 提示：把建议的落点放成预览子，再点一下就落下
function showHint() {
  const game = state.game;
  const m = findBestMove(game.board, state.myColor, 'medium');
  state.pending = m.at;
  render();
}

function openMenu() {
  const game = state.game;
  if (state.mode === 'local' || state.mode === 'ai') {
    ui.actionSheet([
      ['重新开始', () => ui.confirmThen('重新开始这一局？', state.mode === 'ai' ? startAi : startLocal)],
      ['返回首页', goMenu],
    ]);
  } else if (game.winner) {
    ui.actionSheet([['返回首页', goMenu]]);
  } else {
    ui.actionSheet([
      ['认输', () => ui.confirmThen('确定认输吗？', () => net.send({ t: 'resign' }))],
      ['离开房间', () => ui.confirmThen('现在离开会判负，确定吗？', goMenu)],
    ]);
  }
}

// ---------- 点击 ----------
function toScreen(r, c) {
  return [boardX + c * cell, boardY + r * cell];
}

function fromScreen(x, y) {
  const c = Math.round((x - boardX) / cell);
  const r = Math.round((y - boardY) / cell);
  if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
  return [r, c];
}

function onBoardTap(r, c) {
  const game = state.game;
  if (game.winner || state.awaitingServer || state.aiThinking) return;
  if (state.mode !== 'local' && game.turn !== state.myColor) return;
  if (game.board[r][c]) return;

  const p = state.pending;
  if (!p || p[0] !== r || p[1] !== c) {
    state.pending = [r, c];
  } else if (state.mode === 'online') {
    state.awaitingServer = true;
    net.send({ t: 'move', at: [r, c] });
  } else {
    game.move([r, c]);
    state.pending = null;
    maybeAiMove();
  }
  render();
}

// ---------- 首页 ----------
function drawHome() {
  ui.drawDecor();
  if (onExit) {
    header('五子棋', onExit);
  } else {
    stoneIcon('b')(33, ui.titleY, 17);
    text('五子棋', 60, ui.titleY, 22, theme().ui.primary, { bold: true, align: 'left' });
  }
  ui.accountButton();
  const entries = [
    { side: 'b', title: '快速匹配', sub: '自动匹配正在找棋友的人', onTap: startMatch, online: true },
    { side: 'w', title: '创建房间', sub: '生成房间号，邀请好友联网对战', onTap: createRoom, online: true },
    { side: 'b', title: '加入房间', sub: '输入好友发来的房间号', onTap: joinRoom, online: true },
    { side: 'w', title: '人机对战', sub: '和电脑下棋 · 入门 / 业余 / 大师', onTap: () => { state.scene = 'aiSetup'; render(); } },
    { side: 'b', title: '本地双人', sub: '同一台设备，轮流落子', onTap: startLocal },
    { side: 'w', title: '棋盘主题', sub: ui.THEMES.map(t => t.name).join(' · '), onTap: ui.openThemes },
  ].filter(entry => SERVER_URL || !entry.online);
  ui.entryCards(entries.map(entry => ({ ...entry, icon: stoneIcon(entry.side) })));
}

function drawAiSetup() {
  ui.drawDecor();
  header('人机对战', goMenu);
  const colors = theme().ui;
  const x = 16, w = W - 32;
  let y = contentTop + 6;

  text('难度', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  for (const id of Object.keys(LEVELS)) {
    ui.levelCard(x, y, w, LEVELS[id], settings.gomokuLevel === id, () => {
      settings.gomokuLevel = id;
      saveSettings();
      render();
    });
    y += 66;
  }

  y += 8;
  text('执子', x, y + 10, 16, colors.text, { bold: true, align: 'left' });
  y += 28;
  const sides = [['b', '执黑先手'], ['random', '随机'], ['w', '执白后手']];
  const bw = (w - 20) / 3;
  sides.forEach(([id, label], i) => {
    button(label, x + i * (bw + 10), y, bw, 42, () => {
      settings.gomokuSide = id;
      saveSettings();
      render();
    }, settings.gomokuSide !== id);
  });

  y += 72;
  button('开始对局', x, y, w, 50, startAi);
}

// ---------- 对局 ----------
function playerBar(y, side) {
  const game = state.game;
  const mine = side === state.myColor;
  let name, sub;
  if (state.mode === 'ai') {
    name = mine ? '我' : `电脑 · ${LEVELS[settings.gomokuLevel].name}`;
    sub = `执${colorName(side)}`;
  } else if (state.mode === 'online') {
    const player = mine ? state.me : state.opponent;
    name = mine ? '我' : (player ? player.name : '对手');
    sub = `执${colorName(side)}${player ? ` · 积分 ${player.rating}` : ''}${mine ? '' : state.matched ? ' · 随机匹配' : ` · 房间 ${state.roomCode}`}`;
  } else {
    name = `${colorName(side)}方`;
    sub = '本地双人';
  }
  let label = null;
  if (game.turn === side && !game.winner) {
    if (state.mode !== 'local' && !mine) label = '思考中';
    else label = state.pending ? '再点一次落子' : '落子中';
  }
  ui.playerBar(y, { icon: stoneIcon(side), name, sub, label });
}

function drawStones() {
  const t = theme();
  const game = state.game;
  const radius = cell * 0.45;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const side = game.board[r][c];
      if (!side) continue;
      const [x, y] = toScreen(r, c);
      drawStone(ctx, t, side, x, y, radius);
    }
  }

  // 上一手：棋子中间一个和它反色的小点
  if (game.lastMove) {
    const [r, c] = game.lastMove;
    const [x, y] = toScreen(r, c);
    ctx.fillStyle = t.stones[game.board[r][c] === 'b' ? 'w' : 'b'].fill;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2.5, cell * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }

  // 连成五的那几颗子外面画圈
  if (game.winLine) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = t.mark.select;
    for (const [r, c] of game.winLine) {
      const [x, y] = toScreen(r, c);
      ctx.beginPath();
      ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 预览子：半透明，外面一圈虚线
  if (state.pending && !game.winner) {
    const [r, c] = state.pending;
    const [x, y] = toScreen(r, c);
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawStone(ctx, t, game.turn, x, y, radius);
    ctx.restore();
    ctx.save();
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = t.mark.hint;
    ctx.beginPath();
    ctx.arc(x, y, radius + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function overText() {
  const { winner, reason } = state.game;
  if (winner === 'draw') return ['平局', '棋盘下满了'];
  const reasons = { five: '五子连珠', left: '对方离开了房间' };
  if (state.mode === 'local') return [`${colorName(winner)}方胜`, reasons[reason] || ''];
  const iWin = winner === state.myColor;
  const why = reason === 'resign' ? (iWin ? '对方认输' : '你认输了') : reasons[reason];
  return [iWin ? '你赢了！' : '你输了', why];
}

function rematchButton() {
  if (state.opponentLeft) return { label: '对方已离开', onTap: null };
  if (state.rematchSent) return { label: '等待对方…', onTap: null };
  return {
    label: state.opponentWantsRematch ? '同意再战' : '再来一局',
    onTap() {
      state.rematchSent = true;
      net.send({ t: 'rematch' });
      render();
    },
  };
}

function drawOverlay() {
  const [title, sub] = overText();
  if (state.mode === 'local') {
    ui.resultBox(title, sub, [{ label: '再来一局', onTap: startLocal }, { label: '返回首页', onTap: goMenu, outline: true }]);
  } else if (state.mode === 'ai') {
    ui.resultBox(title, sub, [
      { label: '悔棋', onTap: undoAi, outline: true },
      { label: '再来一局', onTap: startAi },
      { label: '返回首页', onTap: goMenu, outline: true },
    ]);
  } else {
    ui.resultBox(title, ui.withRating(sub, state.ratingChange), [rematchButton(), { label: '返回首页', onTap: goMenu, outline: true }]);
  }
}

function drawPlaying() {
  const game = state.game;
  // 自己的一方放在下面；本地双人黑方在下
  const bottomSide = state.mode === 'local' ? 'b' : state.myColor;
  const topSide = bottomSide === 'b' ? 'w' : 'b';
  playerBar(L.topBarY, topSide);
  drawGoBoard(ctx, theme(), { ox: boardX, oy: boardY, cell, size: SIZE });
  drawStones();

  const actions = [{ label: '菜单', onTap: openMenu, outline: true }];
  if (state.mode === 'local') {
    actions.push({
      label: '悔棋',
      outline: true,
      onTap: game.history.length && !game.winner ? () => { game.undo(); state.pending = null; render(); } : null,
    });
  } else if (state.mode === 'ai') {
    const myTurn = game.turn === state.myColor && !game.winner && !state.aiThinking;
    actions.push({ label: '悔棋', outline: true, onTap: game.history.length && !state.aiThinking ? undoAi : null });
    actions.push({ label: '提示', outline: true, onTap: myTurn ? showHint : null });
  }
  actions.push({ label: '主题', onTap: ui.openThemes, outline: true });
  buttonRow(actions, 12, L.actionY, W - 24, ACTION_H);

  playerBar(L.bottomBarY, bottomSide);
  // 平局 game.winner 是 'draw'，也弹结算框
  if (!game.winner) {
    state.resultAt = 0;
  } else if (!state.resultAt) {
    state.resultAt = Date.now() + 1000;
    setTimeout(render, 1000);
  } else if (Date.now() >= state.resultAt) {
    drawOverlay();
  }
}

const app = {
  render() {
    if (state.scene === 'menu') drawHome();
    else if (state.scene === 'aiSetup') drawAiSetup();
    else if (state.scene === 'matching') ui.matchingScreen(state.matchStart, state.matchOnline, stoneIcon('b'), goMenu);
    else if (state.scene === 'connecting') ui.connectingScreen(goMenu);
    else if (state.scene === 'waiting') ui.waitingScreen(state.roomCode, goMenu);
    else drawPlaying();
  },
  onTouch(x, y) {
    if (state.scene !== 'playing') return;
    const sq = fromScreen(x, y);
    if (sq) onBoardTap(sq[0], sq[1]);
  },
  animating() {
    return state.scene === 'matching';
  },
  drawThemePreview(t, x, y, w, h) {
    drawGoPreview(ctx, t, x, y, w, h);
  },
};

function open(exit) {
  onExit = exit || null;
  state.scene = 'menu';
  ui.show(app);
}

module.exports = { open };

},
"js/gomoku.js": function (require, module, exports) {
// 五子棋规则：15×15 棋盘，黑先白后，横竖斜连成五子（或更多）获胜，不设禁手。
// 棋盘 board[r][c]：'' 空，'b' 黑子，'w' 白子。

const SIZE = 15;
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

function opponent(side) {
  return side === 'b' ? 'w' : 'b';
}

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
}

function inside(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

// 在 (r, c) 落子后，这一方有没有连成五子；有就返回这条线上的所有棋子
function fiveAt(board, r, c) {
  const side = board[r][c];
  if (!side) return null;
  for (const [dr, dc] of DIRS) {
    const line = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (inside(rr, cc) && board[rr][cc] === side) {
        line.push([rr, cc]);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= 5) return line;
  }
  return null;
}

class Game {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = emptyBoard();
    this.turn = 'b';
    this.history = [];
    this.lastMove = null;
    this.winner = null; // 'b' | 'w' | 'draw'
    this.reason = null; // five | full | resign | left
    this.winLine = null;
  }

  canMove(at) {
    if (this.winner || !Array.isArray(at)) return false;
    const [r, c] = at;
    return Number.isInteger(r) && Number.isInteger(c) && inside(r, c) && !this.board[r][c];
  }

  move(at) {
    if (!this.canMove(at)) return false;
    const [r, c] = at;
    this.board[r][c] = this.turn;
    this.history.push([r, c]);
    this.lastMove = [r, c];
    const line = fiveAt(this.board, r, c);
    if (line) {
      this.end(this.turn, 'five');
      this.winLine = line;
    } else if (this.history.length === SIZE * SIZE) {
      this.end('draw', 'full');
    }
    this.turn = opponent(this.turn);
    return true;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return false;
    this.board[last[0]][last[1]] = '';
    this.turn = opponent(this.turn);
    this.lastMove = this.history[this.history.length - 1] || null;
    this.winner = null;
    this.reason = null;
    this.winLine = null;
    return true;
  }

  end(winner, reason) {
    this.winner = winner;
    this.reason = reason;
  }
}

module.exports = { SIZE, DIRS, Game, opponent, emptyBoard, inside, fiveAt };

},
"js/gomoku-ai.js": function (require, module, exports) {
// 五子棋电脑：按棋形（连五、活四、冲四、活三……）给每个空点打分。
// 入门、业余只看一步；大师在分数最高的几个点里做 α-β 搜索，限时计算。

const { SIZE, DIRS, inside, opponent } = require('./gomoku.js');

const LEVELS = {
  easy: { name: '入门', desc: '只顾自己，常漏看对方', depth: 0, defend: 0.4, pick: 4, timeMs: 0 },
  medium: { name: '业余', desc: '会攻会守，看一步', depth: 0, defend: 0.9, pick: 1, timeMs: 0 },
  hard: { name: '大师', desc: '往后多算几步，限时 1.5 秒', depth: 6, defend: 0.9, pick: 1, timeMs: 1500 },
};

// 棋形和分数：x 己方，o 对方或棋盘外，. 空
const FIVE = 1000000;
const SHAPES = [
  [FIVE, ['xxxxx']],
  [50000, ['.xxxx.']], // 活四：两头都能成五，挡不住
  [6000, ['xxxx.', '.xxxx', 'xxx.x', 'x.xxx', 'xx.xx']], // 冲四
  [5000, ['.xxx..', '..xxx.', '.xx.x.', '.x.xx.']], // 活三
  [600, ['xxx..', '..xxx', '.xxx.', 'xx.x.', '.x.xx', 'x.xx.', '.xx.x', 'xx..x', 'x..xx', 'x.x.x']], // 眠三
  [400, ['..xx..', '.x.x..', '..x.x.', '.x..x.']], // 活二
  [60, ['xx...', '...xx', '.xx..', '..xx.', 'x.x..', '..x.x', '.x.x.', 'x..x.', '.x..x']], // 眠二
];

// 一条线（字符串）里所有棋形的总分，用来给整盘棋打分
function lineValue(str) {
  let total = 0;
  for (const [score, patterns] of SHAPES) {
    for (const p of patterns) {
      let i = str.indexOf(p);
      while (i >= 0) {
        total += score;
        i = str.indexOf(p, i + 1);
      }
    }
  }
  return total;
}

// 只看经过中心点的棋形，取最大的那个
function centerShape(str) {
  for (const [score, patterns] of SHAPES) {
    for (const p of patterns) {
      let i = str.indexOf(p);
      while (i >= 0) {
        if (i <= 4 && i + p.length > 4) return score;
        i = str.indexOf(p, i + 1);
      }
    }
  }
  return 0;
}

// 在 (r, c) 下 side 方的子，四个方向能形成什么棋形；两个冲四、冲四加活三、双活三都算必胜
function pointValue(board, r, c, side) {
  let total = 0, fours = 0, threes = 0;
  for (const [dr, dc] of DIRS) {
    let str = '';
    for (let k = -4; k <= 4; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (k === 0) str += 'x';
      else if (!inside(rr, cc)) str += 'o';
      else str += board[rr][cc] === side ? 'x' : board[rr][cc] ? 'o' : '.';
    }
    const v = centerShape(str);
    if (v >= FIVE) return FIVE;
    if (v >= 6000) fours++;
    else if (v >= 5000) threes++;
    total += v;
  }
  if (fours >= 2 || (fours && threes)) total += 40000;
  else if (threes >= 2) total += 20000;
  return total;
}

// 已有棋子周围两格内的空点；空棋盘下天元
function candidates(board) {
  const seen = new Set();
  const out = [];
  let any = false;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!board[r][c]) continue;
      any = true;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr, cc = c + dc;
          const key = rr * SIZE + cc;
          if (inside(rr, cc) && !board[rr][cc] && !seen.has(key)) {
            seen.add(key);
            out.push([rr, cc]);
          }
        }
      }
    }
  }
  if (!any) out.push([7, 7]);
  return out;
}

// 候选点按「进攻 + 防守」排序
function ranked(board, side, defend) {
  const opp = opponent(side);
  return candidates(board)
    .map(([r, c]) => {
      const attack = pointValue(board, r, c, side);
      const block = pointValue(board, r, c, opp);
      // 自己能成五最优先，其次是挡住对方的五
      const score = attack >= FIVE ? FIVE * 4 : block >= FIVE ? FIVE * 2 : attack + block * defend;
      return { at: [r, c], score };
    })
    .sort((a, b) => b.score - a.score);
}

// ---------- 大师：增量打分 + α-β 搜索 ----------
// 所有长度 ≥ 5 的横、竖、斜线，记下每个格子经过哪几条线
const LINES = [];
const CELL_LINES = Array.from({ length: SIZE * SIZE }, () => []);
(function buildLines() {
  const add = cells => {
    if (cells.length < 5) return;
    const id = LINES.length;
    LINES.push(cells);
    for (const [r, c] of cells) CELL_LINES[r * SIZE + c].push(id);
  };
  for (let i = 0; i < SIZE; i++) {
    add(Array.from({ length: SIZE }, (_, k) => [i, k]));
    add(Array.from({ length: SIZE }, (_, k) => [k, i]));
  }
  for (let d = -(SIZE - 1); d < SIZE; d++) {
    const diag = [], anti = [];
    for (let r = 0; r < SIZE; r++) {
      const c = r - d;
      if (c >= 0 && c < SIZE) diag.push([r, c]);
      const c2 = d + SIZE - 1 - r;
      if (c2 >= 0 && c2 < SIZE) anti.push([r, c2]);
    }
    add(diag);
    add(anti);
  }
})();

class Searcher {
  constructor(board, deadline) {
    this.board = board.map(row => row.slice());
    this.deadline = deadline;
    this.nodes = 0;
    this.timeUp = false;
    this.score = { b: 0, w: 0 };
    this.lineScore = LINES.map(() => ({ b: 0, w: 0 }));
    for (let id = 0; id < LINES.length; id++) this.rescore(id);
  }

  lineString(id, side) {
    let s = 'o';
    for (const [r, c] of LINES[id]) {
      const v = this.board[r][c];
      s += v === side ? 'x' : v ? 'o' : '.';
    }
    return s + 'o';
  }

  rescore(id) {
    const old = this.lineScore[id];
    const next = { b: lineValue(this.lineString(id, 'b')), w: lineValue(this.lineString(id, 'w')) };
    this.score.b += next.b - old.b;
    this.score.w += next.w - old.w;
    this.lineScore[id] = next;
  }

  play(r, c, side) {
    this.board[r][c] = side;
    for (const id of CELL_LINES[r * SIZE + c]) this.rescore(id);
  }

  unplay(r, c) {
    this.board[r][c] = '';
    for (const id of CELL_LINES[r * SIZE + c]) this.rescore(id);
  }

  // 轮到 side 走时的局面分：先手方的棋形更值钱
  evaluate(side) {
    return this.score[side] * 1.2 - this.score[opponent(side)];
  }

  negamax(depth, alpha, beta, side) {
    if (++this.nodes % 256 === 0 && Date.now() > this.deadline) this.timeUp = true;
    if (this.timeUp) return 0;
    // 对方上一步已经连成五：这一方输了
    if (this.score[opponent(side)] >= FIVE) return -(FIVE * 10 + depth);
    if (depth === 0) return this.evaluate(side);

    const moves = ranked(this.board, side, 0.9).slice(0, depth >= 4 ? 10 : 7);
    if (!moves.length) return 0;
    // 能直接成五就不用再算了
    if (moves[0].score >= FIVE * 4) return FIVE * 10 + depth;

    let best = -Infinity;
    for (const { at: [r, c] } of moves) {
      this.play(r, c, side);
      const v = -this.negamax(depth - 1, -beta, -alpha, opponent(side));
      this.unplay(r, c);
      if (this.timeUp) return 0;
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }
}

function searchBest(board, side, level) {
  const deadline = Date.now() + level.timeMs;
  const root = ranked(board, side, level.defend).slice(0, 12);
  // 成五、挡五不用搜
  if (root[0].score >= FIVE * 2) return { at: root[0].at, depth: 0 };
  let best = root[0].at, bestDepth = 0;
  for (let depth = 2; depth <= level.depth; depth += 2) {
    const s = new Searcher(board, deadline);
    let alpha = -Infinity, choice = null;
    for (const { at: [r, c] } of root) {
      s.play(r, c, side);
      const v = -s.negamax(depth - 1, -Infinity, -alpha, opponent(side));
      s.unplay(r, c);
      if (s.timeUp) break;
      if (v > alpha) {
        alpha = v;
        choice = [r, c];
      }
    }
    if (s.timeUp) break;
    best = choice || best;
    bestDepth = depth;
  }
  return { at: best, depth: bestDepth };
}

function findBestMove(board, side, levelId) {
  const level = LEVELS[levelId] || LEVELS.medium;
  if (level.depth) return searchBest(board, side, level);
  const list = ranked(board, side, level.defend);
  // 入门在前几名里随机挑一个，但看到能成五一定会下
  if (level.pick > 1 && list[0].score < FIVE * 4) {
    const top = list.slice(0, level.pick);
    return { at: top[Math.floor(Math.random() * top.length)].at, depth: 0 };
  }
  return { at: list[0].at, depth: 0 };
}

module.exports = { LEVELS, findBestMove, pointValue, FIVE };

}
};
var cache = {};
function resolve(from, request) {
  var parts = from.split('/').slice(0, -1);
  request.split('/').forEach(function (seg) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  });
  var id = parts.join('/');
  return /\.js$/.test(id) ? id : id + '.js';
}
function load(id) {
  if (cache[id]) return cache[id].exports;
  var module = { exports: {} };
  cache[id] = module;
  defs[id](function (request) { return load(resolve(id, request)); }, module, module.exports);
  return module.exports;
}
load('game.js');
})();
