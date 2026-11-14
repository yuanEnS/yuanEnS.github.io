// 游戏园网页小游戏共用的代码：规则弹窗、提示、存储，以及两人对弈的「人机 / 双人 / 联网」流程。
// 联网和象棋、五子棋连同一个服务器（xiangqi 仓库的 server/lobby.js），走法由服务器用同一份规则检查。
(function () {
  // 老浏览器（比如 Kindle）：CSS 变量 var()、min()、aspect-ratio、vw 有一样算不对，棋盘就换一种算法。
  // 不问浏览器「支不支持」，直接放几个看不见的小方块量一量，量出来不对就算不支持。
  // 这时由脚本量好页面宽度，把每个棋盘的尺寸算成具体的像素，写成一段样式加到页面上（不用 var()，Kindle 不认）。
  // 页面宽度变了（转屏）就重算。?legacy=1 可以在电脑上强制打开。
  const KIT_VERSION = 6; // 和页面里 kit.js?v= 的数字一致，?debug=1 时显示，看得出是不是拿到了新文件
  const root = document.documentElement;
  function measure(style) {
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;${style}`;
    root.appendChild(box);
    const size = [box.offsetWidth, box.offsetHeight];
    root.removeChild(box);
    return size;
  }
  const cssCheck = {
    vars: measure('--t:50px;width:var(--t)')[0] === 50,
    min: measure('width:min(100px, 50px)')[0] === 50,
    aspect: measure('width:40px;aspect-ratio:1')[1] === 40,
    vw: Math.abs(measure('width:50vw')[0] - window.innerWidth / 2) < 20,
  };
  const legacy = { on: false, hrdCell: 0, width: 0 };
  // 页面宽度：Kindle 刚打开页面时有时还没排好，量出来的数不准，取几种量法里最小的正数，宁可小一点也不要超出屏幕
  function pageWidth() {
    const list = [root.clientWidth, window.innerWidth, document.body && document.body.clientWidth].filter(n => n > 100);
    return list.length ? Math.min(...list) : 360;
  }
  function legacyStyle() {
    const W = pageWidth();
    legacy.width = W;
    const B = Math.floor(W * 0.96); // 棋盘宽度
    const px = n => `${Math.floor(n)}px`;
    const tiles = Math.min(B, 400);
    const hrd = Math.min(Math.floor(W * 0.22), 92);
    legacy.hrdCell = hrd;
    let css = `
      .legacy dialog.rules { width: ${px(W - 24)}; }
      .legacy .othello { width: ${px(B)}; height: ${px(B)}; }
      .legacy .c4 { width: ${px(B)}; }
      .legacy .c4 .hole { height: ${px((B - 16) / 7)}; }
      .legacy .jungle { width: ${px(B)}; }
      .legacy .jungle button { height: ${px((B - 22) / 7)}; }
      .legacy .jungle .piece { font-size: ${px(B / 13)}; }
      .legacy .hrd { width: ${px(hrd * 4 + 16)}; height: ${px(hrd * 5 + 16)}; }
      .legacy .hrd .exit { left: ${px(8 + hrd)}; width: ${px(hrd * 2)}; }
      .legacy .piece { font-size: ${px(hrd * 0.3)}; }
      .legacy .piece.cao { font-size: ${px(hrd * 0.42)}; }
      .legacy .piece.bing { font-size: ${px(hrd * 0.34)}; }
      .legacy .sudoku { width: ${px(B)}; height: ${px(B)}; }
      .legacy .sudoku button { font-size: ${px(B / 15)}; }
      .legacy .notes span { font-size: ${px(B / 38)}; }
      .legacy .pad { width: ${px(B)}; }
      .legacy .cards, .legacy .ops { width: ${px(B)}; }
      .legacy .card { height: ${px((B - 30) / 4 * 1.4)}; font-size: ${px(B / 9)}; }
      .legacy .card.frac { font-size: ${px(B / 13)}; }
      .legacy .tiles { width: ${px(tiles)}; }
      .legacy .tiles button { height: ${px(Math.min((tiles - 30) / 4, 92))}; }
      .legacy .answer, .legacy .chain { width: ${px(Math.min(B, 420))}; }`;
    // 扫雷三档：9、16、30 列。格子最小 24px，放不下就左右滑
    for (const cols of [9, 16, 30]) {
      const cell = Math.max(24, Math.min(40 * 1.5, Math.floor((B - 8) / cols)));
      css += `
      .legacy .field[data-cols="${cols}"] { grid-template-columns: repeat(${cols}, ${px(cell)}); }
      .legacy .field[data-cols="${cols}"] button { width: ${px(cell)}; height: ${px(cell)}; font-size: ${px(cell * 0.55)}; }`;
    }
    let node = document.getElementById('legacy-style');
    if (!node) {
      node = document.createElement('style');
      node.id = 'legacy-style';
      document.head.appendChild(node);
    }
    node.textContent = css;
  }
  if (!cssCheck.vars || !cssCheck.min || !cssCheck.aspect || !cssCheck.vw || /[?&]legacy=1/.test(location.search)) {
    legacy.on = true;
    root.classList.add('legacy');
    legacyStyle();
    // 页面排好以后、从缓存恢复时、转屏时都再量一次，宽度变了就重算（华容道等用到像素的游戏会收到 legacyresize 重画）
    const recheck = () => {
      if (pageWidth() === legacy.width) return;
      legacyStyle();
      window.dispatchEvent(new Event('legacyresize'));
    };
    [0, 300, 1000, 2500].forEach(ms => setTimeout(recheck, ms));
    ['load', 'pageshow', 'resize', 'orientationchange'].forEach(name => window.addEventListener(name, recheck));
  }
  // ?debug=1：页面底部显示量出来的结果，Kindle 上显示不对时拍下来就知道原因
  if (/[?&]debug=1/.test(location.search)) {
    const show = () => {
      let line = document.getElementById('kit-debug');
      if (!line) {
        line = document.createElement('p');
        line.id = 'kit-debug';
        line.style.cssText = 'margin:12px 8px;padding:6px;border:2px solid #000;font:14px/1.5 monospace;background:#FFF;color:#000;';
        document.body.appendChild(line);
      }
      line.textContent = `kit ${KIT_VERSION} · legacy ${legacy.on} · width ${legacy.width} · client ${root.clientWidth} · inner ${window.innerWidth} · `
        + `var ${cssCheck.vars} · min ${cssCheck.min} · aspect ${cssCheck.aspect} · vw ${cssCheck.vw}`;
    };
    [0, 1000, 3000].forEach(ms => setTimeout(show, ms));
  }

  // 老浏览器（比如 Kindle）缺的几个方法，各个游戏页面会用到
  if (!Array.prototype.flat) {
    Array.prototype.flat = function (depth = 1) {
      return this.reduce((out, x) => out.concat(Array.isArray(x) && depth > 0 ? x.flat(depth - 1) : [x]), []);
    };
  }
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function (fn, self) {
      return this.map(fn, self).flat();
    };
  }
  if (!Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function (...nodes) {
      while (this.firstChild) this.removeChild(this.firstChild);
      this.append(...nodes);
    };
  }
  if (!Object.fromEntries) {
    Object.fromEntries = entries => {
      const out = {};
      for (const [k, v] of entries) out[k] = v;
      return out;
    };
  }

  const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
  const WS_URL = LOCAL ? 'ws://127.0.0.1:8787' : 'wss://api.gamesyuan.com';
  const TOKEN_KEY = 'xiangqi:token'; // 和象棋、五子棋、账号页共用

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'className') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  }

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`games:${key}`);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`games:${key}`, JSON.stringify(value));
      } catch (e) {}
    },
  };

  // ---------- 黑白屏 ----------
  // 自己选过就听自己的；没选过时，在象棋里选了「黑白」主题、或者屏幕本身是黑白的（墨水屏），就打开
  function inkPreferred() {
    const saved = store.get('ink', null);
    if (saved !== null) return saved;
    try {
      const settings = JSON.parse(localStorage.getItem('xiangqi:settings'));
      if (settings && settings.theme === 'pao') return true;
    } catch (e) {}
    return !!(window.matchMedia && matchMedia('(monochrome)').matches);
  }
  function applyInk(on) {
    if (on) document.documentElement.setAttribute('data-ink', '');
    else document.documentElement.removeAttribute('data-ink');
    document.querySelectorAll('.ink-btn').forEach(b => b.setAttribute('aria-pressed', String(on)));
  }
  applyInk(inkPreferred());
  // 标题栏「规则」按钮旁边放一个「黑白」开关
  document.querySelectorAll('.bar .rules-btn').forEach(rules => {
    const button = el('button', {
      type: 'button', className: 'btn small ink-btn', text: '黑白', title: '黑白屏（墨水屏）模式',
      'aria-pressed': String(document.documentElement.hasAttribute('data-ink')),
    });
    button.addEventListener('click', () => {
      const on = !document.documentElement.hasAttribute('data-ink');
      store.set('ink', on);
      applyInk(on);
    });
    rules.before(button);
  });

  let toastTimer = null;
  function toast(text) {
    let node = document.querySelector('.toast');
    if (!node) {
      node = el('div', { className: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(node);
    }
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2200);
  }

  // 规则说明：页面上 <dialog class="rules" id="rules">，标题栏的「规则」按钮打开；第一次来自动打开
  function setupRules(name) {
    const dialog = document.getElementById('rules');
    if (!dialog) return;
    const open = () => (dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', ''));
    const close = () => (dialog.close ? dialog.close() : dialog.removeAttribute('open'));
    document.querySelectorAll('.rules-btn').forEach(button => button.addEventListener('click', open));
    dialog.querySelectorAll('.close').forEach(button => button.addEventListener('click', close));
    dialog.addEventListener('click', e => {
      if (e.target === dialog) close();
    });
    if (!store.get(`seen:${name}`, false)) {
      store.set(`seen:${name}`, true);
      open();
    }
  }

  function shuffle(list, random = Math.random) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  // ---------- 每日一题 ----------
  // 北京时间的日期，所有人同一天拿到同一道题
  function today() {
    return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  }
  // 由一段文字得到固定的随机数序列（同样的种子，同样的题）
  function seeded(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function timeText(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- 联网 ----------

  class Online {
    constructor(onMessage, onClose) {
      this.onMessage = onMessage;
      this.onClose = onClose;
      this.socket = null;
      this.open = false;
      this.queue = [];
      this.ping = null;
    }

    connect() {
      if (this.socket) return;
      let token = '';
      try {
        token = JSON.parse(localStorage.getItem(TOKEN_KEY)) || '';
      } catch (e) {}
      const socket = new WebSocket(WS_URL);
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.open = true;
        socket.send(JSON.stringify({ t: 'auth', token }));
        for (const msg of this.queue) socket.send(JSON.stringify(msg));
        this.queue = [];
        this.ping = setInterval(() => this.send({ t: 'ping' }), 20000);
      });
      socket.addEventListener('message', event => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return;
        }
        if (msg.t === 'auth') {
          // 第一次联网时服务器建一个游客账号，令牌存下来，积分就记在这个账号上
          if (msg.token) {
            try {
              localStorage.setItem(TOKEN_KEY, JSON.stringify(msg.token));
            } catch (e) {}
          }
          this.name = msg.name;
          return;
        }
        this.onMessage(msg);
      });
      const closed = () => {
        if (this.socket !== socket) return;
        clearInterval(this.ping);
        this.socket = null;
        this.open = false;
        this.queue = [];
        this.onClose();
      };
      socket.addEventListener('close', closed);
      socket.addEventListener('error', closed);
    }

    send(msg) {
      if (this.open) this.socket.send(JSON.stringify(msg));
      else {
        this.queue.push(msg);
        this.connect();
      }
    }

    close() {
      const socket = this.socket;
      if (!socket) return;
      clearInterval(this.ping);
      this.socket = null;
      this.open = false;
      this.queue = [];
      try {
        socket.close();
      } catch (e) {}
    }
  }

  // ---------- 两人对弈 ----------
  //
  // o.kind      服务器上的棋种名（othello / connect4 / jungle）
  // o.Game      规则里的 Game
  // o.sides     [先手, 后手]，比如 ['b', 'w']
  // o.sideNames { b: '黑棋', w: '白棋' }
  // o.draw(game, view)  画棋盘。view.canPlay 是现在能不能点，view.play(move) 落子，
  //                     view.mySide 是我执哪一方（双人模式为 null），view.flip 表示要不要把棋盘倒过来
  // o.ai(game, level)   电脑选一步，level 0 入门 / 1 业余 / 2 大师
  // o.reasons   { four: '连成四子', ... } 对局结束的原因
  // o.note(game)        棋盘下面的小字（可不给），比如黑白棋的子数
  function duel(o) {
    const [FIRST, SECOND] = o.sides;
    const LEVELS = ['入门', '业余', '大师'];
    const $ = id => document.getElementById(id);
    const state = {
      mode: store.get(`${o.kind}:mode`, 'ai'),
      level: store.get(`${o.kind}:level`, 0),
      humanFirst: store.get(`${o.kind}:first`, true),
      game: new o.Game(),
      mySide: null,
      thinking: false,
      aiToken: 0,
      // 联网：idle 没在联网 / matching 匹配中 / waiting 建好房间等人 / playing 对局中 / over 一局结束
      phase: 'idle',
      room: null,
      matched: false,
      me: null,
      opponent: null,
      pending: false, // 发出的走法还没等到服务器确认
      rematchAsked: false,
      rating: null,
    };
    if (state.mode === 'online') state.mode = 'ai'; // 联网要自己点，打开页面不自动连
    const net = new Online(onNet, onNetClose);

    // ----- 面板 -----
    const seg = (items, current, onPick) => {
      const box = el('div', { className: 'seg', role: 'group' });
      items.forEach(([value, label]) => {
        const button = el('button', { type: 'button', 'aria-pressed': String(value === current), text: label });
        button.addEventListener('click', () => {
          box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
          onPick(value);
        });
        box.append(button);
      });
      return box;
    };
    const modeSeg = seg([['ai', '人机'], ['local', '双人'], ['online', '联网']], state.mode, setMode);
    const aiRow = el('div', { className: 'row' },
      el('span', { className: 'label', text: '难度' }),
      seg(LEVELS.map((name, i) => [i, name]), state.level, level => {
        state.level = level;
        store.set(`${o.kind}:level`, level);
        newGame();
      }),
      el('span', { className: 'label', text: '先后' }),
      seg([[true, '我先走'], [false, '电脑先走']], state.humanFirst, first => {
        state.humanFirst = first;
        store.set(`${o.kind}:first`, first);
        newGame();
      }),
    );
    const roomInput = el('input', {
      className: 'room-input', inputmode: 'numeric', maxlength: '4', placeholder: '房间号', 'aria-label': '房间号', autocomplete: 'off',
    });
    const joinButton = el('button', { type: 'button', className: 'btn small', text: '加入', onclick: () => join(roomInput.value) });
    roomInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') join(roomInput.value);
    });
    const matchButton = el('button', { type: 'button', className: 'btn small primary', text: '快速匹配', onclick: match });
    const createButton = el('button', { type: 'button', className: 'btn small', text: '建房间', onclick: create });
    const onlineText = el('p', { className: 'sub', role: 'status' });
    const onlineCancel = el('button', { type: 'button', className: 'btn small', text: '取消', onclick: leaveOnline });
    const copyButton = el('button', { type: 'button', className: 'btn small', text: '复制邀请链接', onclick: copyLink });
    const onlineRow = el('div', { className: 'row' }, matchButton, createButton, roomInput, joinButton);
    const onlineInfo = el('div', { className: 'row' }, onlineText, copyButton, onlineCancel);
    const onlineHint = el('p', { className: 'sub' });
    onlineHint.append('快速匹配计积分，好友房间不计分。', el('a', { href: '/account/', text: '账号与排行榜' }));
    const panel = $('modes');
    panel.className = 'panel';
    panel.append(
      el('div', { className: 'row' }, el('span', { className: 'label', text: '模式' }), modeSeg),
      aiRow, onlineRow, onlineInfo, onlineHint,
    );

    const undoButton = el('button', { type: 'button', className: 'btn', text: '悔棋', onclick: undo });
    const resignButton = el('button', { type: 'button', className: 'btn', text: '认输', onclick: resign });
    const againButton = el('button', { type: 'button', className: 'btn primary', text: '重新开始', onclick: again });
    $('actions').append(undoButton, resignButton, againButton);

    // ----- 流程 -----
    function setMode(mode) {
      if (state.mode === 'online' && mode !== 'online') leaveOnline(true);
      state.mode = mode;
      if (mode !== 'online') store.set(`${o.kind}:mode`, mode);
      if (mode === 'online') {
        state.aiToken++;
        state.thinking = false;
        state.phase = 'idle';
        state.game = new o.Game();
        state.mySide = null;
        render();
      } else {
        newGame();
      }
    }

    function newGame() {
      state.aiToken++;
      state.thinking = false;
      state.game = new o.Game();
      state.mySide = state.mode === 'ai' ? (state.humanFirst ? FIRST : SECOND) : null;
      render();
      maybeAi();
    }

    function canPlay() {
      const { game } = state;
      if (game.winner || state.thinking) return false;
      if (state.mode === 'local') return true;
      if (state.mode === 'ai') return game.turn === state.mySide;
      return state.phase === 'playing' && !state.pending && game.turn === state.mySide;
    }

    function play(move) {
      if (!canPlay()) return false;
      if (state.mode === 'online') {
        if (!state.game.canMove(move)) return false;
        state.pending = true;
        net.send({ t: 'move', move });
        render();
        return true;
      }
      return apply(move);
    }

    function apply(move) {
      if (!state.game.move(move)) return false;
      render();
      maybeAi();
      return true;
    }

    function maybeAi() {
      const { game } = state;
      if (state.mode !== 'ai' || game.winner || game.turn === state.mySide) return;
      const token = ++state.aiToken;
      state.thinking = true;
      render();
      // 先让「电脑在想」显示出来，再算
      setTimeout(() => {
        if (token !== state.aiToken) return;
        const move = o.ai(game, state.level);
        state.thinking = false;
        if (move === null || move === undefined || !game.move(move)) {
          render();
          return;
        }
        render();
        maybeAi();
      }, 380);
    }

    function undo() {
      const { game } = state;
      if (state.mode === 'online' || !game.history.length) return;
      state.aiToken++;
      state.thinking = false;
      if (state.mode === 'local') {
        game.undo();
      } else {
        // 退回到轮到我走的时候
        game.undo();
        while (game.history.length && game.turn !== state.mySide) game.undo();
      }
      render();
      maybeAi();
    }

    function resign() {
      if (state.mode !== 'online' || state.phase !== 'playing') return;
      if (!confirm('认输这一局？')) return;
      net.send({ t: 'resign' });
    }

    function again() {
      if (state.mode !== 'online') return newGame();
      if (state.phase === 'over') {
        state.rematchAsked = true;
        net.send({ t: 'rematch' });
        render();
      }
    }

    // ----- 联网 -----
    function match() {
      state.phase = 'matching';
      state.room = null;
      net.send({ t: 'match', game: o.kind });
      render();
    }

    function create() {
      state.phase = 'waiting';
      state.room = null;
      net.send({ t: 'create', game: o.kind });
      render();
    }

    function join(code) {
      code = String(code || '').trim();
      if (!/^\d{4}$/.test(code)) return toast('房间号是 4 位数字');
      state.phase = 'waiting';
      state.room = code;
      net.send({ t: 'join', room: code, game: o.kind });
      render();
    }

    function leaveOnline(quiet) {
      if (state.phase === 'playing' && !state.game.winner && quiet !== true && !confirm('对局还没结束，离开算输。确定离开？')) return;
      net.send({ t: 'leave' });
      net.close();
      state.phase = 'idle';
      state.room = null;
      state.pending = false;
      if (quiet !== true) {
        state.game = new o.Game();
        state.mySide = null;
        render();
      }
    }

    async function copyLink() {
      const link = `${location.origin}${location.pathname}?room=${state.room}`;
      try {
        await navigator.clipboard.writeText(link);
        toast('邀请链接已复制，发给朋友');
      } catch (e) {
        prompt('复制这个链接发给朋友', link);
      }
    }

    function onNet(msg) {
      switch (msg.t) {
        case 'matching':
          state.phase = 'matching';
          state.online = msg.online;
          break;
        case 'created':
          state.phase = 'waiting';
          state.room = msg.room;
          break;
        case 'start':
          state.game = new o.Game();
          state.mySide = msg.color;
          state.room = msg.room;
          state.matched = msg.matched;
          state.me = msg.me;
          state.opponent = msg.opponent;
          state.phase = 'playing';
          state.pending = false;
          state.rematchAsked = false;
          state.rematchWanted = false;
          toast(`开始了，你执${o.sideNames[msg.color]}`);
          break;
        case 'move':
          state.pending = false;
          state.game.move(msg.move);
          break;
        case 'over':
          if (!state.game.winner) state.game.end(msg.winner, msg.reason);
          state.phase = 'over';
          state.pending = false;
          break;
        case 'rating':
          state.rating = msg;
          toast(`积分 ${msg.rating}（${msg.delta >= 0 ? '+' : ''}${msg.delta}）`);
          break;
        case 'rematch_request':
          state.rematchWanted = true;
          toast('对手想再来一局');
          break;
        case 'opponent_left':
          if (!state.game.winner && state.phase === 'playing') state.game.end(state.mySide, 'left');
          state.phase = 'left';
          state.pending = false;
          toast('对手离开了');
          break;
        case 'error':
          state.pending = false;
          if (state.phase === 'waiting' && !state.mySide) state.phase = 'idle';
          toast(msg.msg || '出错了');
          break;
        default:
          return;
      }
      render();
    }

    function onNetClose() {
      if (state.mode !== 'online') return;
      if (state.phase !== 'idle') toast('连接断开了');
      if (state.phase === 'playing') state.phase = 'left';
      else if (state.phase !== 'over' && state.phase !== 'left') state.phase = 'idle';
      state.pending = false;
      render();
    }

    // ----- 显示 -----
    function resultText() {
      const { game } = state;
      const why = o.reasons[game.reason] || '';
      if (game.winner === 'draw') return `和棋${why ? `（${why}）` : ''}`;
      const mine = state.mode === 'local' ? null : game.winner === state.mySide;
      let head;
      if (state.mode === 'local') head = `${o.sideNames[game.winner]}赢了`;
      else if (state.mode === 'ai') head = mine ? '你赢了！' : '电脑赢了';
      else head = mine ? '你赢了！' : '你输了';
      let tail = why;
      if (game.reason === 'resign') tail = mine ? '对手认输' : '你认输了';
      if (game.reason === 'left') tail = mine ? '对手离开了' : '你离开了';
      return `${head}${tail ? `（${tail}）` : ''}`;
    }

    function statusText() {
      const { game } = state;
      if (state.mode === 'online' && !['playing', 'over', 'left'].includes(state.phase)) return '选一种方式开始联网对弈';
      if (game.winner) return resultText();
      const side = o.sideNames[game.turn];
      if (state.mode === 'local') return `轮到${side}`;
      if (state.mode === 'ai') return state.thinking ? '电脑在想…' : `轮到你（${side}）`;
      if (state.pending) return '…';
      return game.turn === state.mySide ? `轮到你（${side}）` : '等对手走…';
    }

    function onlineDescription() {
      switch (state.phase) {
        case 'matching':
          return `正在找对手…${state.online ? `（在线 ${state.online} 人）` : ''}`;
        case 'waiting':
          return state.room ? `房间号 ${state.room}，发给朋友，对方输入房间号就能加入` : '正在连接…';
        case 'playing':
        case 'over':
        case 'left': {
          const who = p => (p ? `${p.name}${state.matched && p.rating ? `（${p.rating}）` : ''}` : '游客');
          const head = state.matched ? '快速匹配' : `房间 ${state.room}`;
          const extra = state.phase === 'over' && state.rematchWanted && !state.rematchAsked ? ' · 对手想再来一局' : '';
          return `${head} · 你执${o.sideNames[state.mySide]} · 对手 ${who(state.opponent)}${extra}`;
        }
        default:
          return '';
      }
    }

    function render() {
      const { game } = state;
      const online = state.mode === 'online';
      aiRow.hidden = state.mode !== 'ai';
      onlineRow.hidden = !online || ['matching', 'waiting', 'playing'].includes(state.phase);
      onlineInfo.hidden = !online || state.phase === 'idle';
      onlineHint.hidden = !online;
      onlineText.textContent = onlineDescription();
      copyButton.hidden = !(state.phase === 'waiting' && state.room);
      onlineCancel.textContent = state.phase === 'matching' || state.phase === 'waiting' ? '取消' : '离开';
      $('status').textContent = statusText();
      const note = o.note ? o.note(game, state) : '';
      $('sub').textContent = note || '';
      $('sub').hidden = !note;

      undoButton.hidden = online;
      undoButton.disabled = !game.history.length || (state.mode === 'ai' && state.thinking);
      resignButton.hidden = !online || state.phase !== 'playing' || !!game.winner;
      againButton.hidden = online && state.phase !== 'over';
      againButton.textContent = online ? (state.rematchAsked ? '等对手同意…' : '再来一局') : '重新开始';
      againButton.disabled = online && state.rematchAsked;

      const showBoard = !online || ['playing', 'over', 'left'].includes(state.phase);
      o.draw(game, {
        canPlay: canPlay(),
        play,
        mySide: state.mode === 'local' ? null : state.mySide,
        flip: state.mode !== 'local' && state.mySide === SECOND,
        idle: !showBoard,
        thinking: state.thinking,
      });
    }

    // 打开带 ?room=1234 的邀请链接，直接进房间
    const invited = new URLSearchParams(location.search).get('room');
    if (invited && /^\d{4}$/.test(invited)) {
      state.mode = 'online';
      modeSeg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === 2)));
      history.replaceState(null, '', location.pathname);
      render();
      join(invited);
    } else {
      newGame();
    }
    window.addEventListener('pagehide', () => net.close());
    return { state, render };
  }

  window.Kit = { el, store, toast, setupRules, shuffle, duel, Online, today, seeded, timeText, cssCheck, legacy };
})();
