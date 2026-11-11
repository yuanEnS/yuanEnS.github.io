// 世界园地图：作者多的国家颜色深，时不时冒出一个气泡，随机挑一位作者。
// 按国界上色，数据来自 /api/life/map，国界在 geo.js，画法在 geo-draw.js。
(() => {
  const root = document.getElementById('globe');
  const canvas = root.querySelector('canvas');
  const layer = root.querySelector('.bubbles');
  const tip = root.querySelector('.map-tip');
  const summary = document.getElementById('globe-summary');
  const FULL_HEAT = 12; // 一个国家有这么多位作者时颜色最深，人少时不会一下子烧红
  const BUBBLE_EVERY = 2600;
  const BUBBLE_LIFE = 7000;

  const quiet = matchMedia('(prefers-reduced-motion: reduce)');

  let cells = [];
  let pool = [];
  let counts = new Map(); // 国家和地区代码 → 作者数
  let hovering = false;
  const live = new Set();

  const countryName = Geo.countryName;
  const toX = Geo.toX;
  const toY = Geo.toY;

  // 对数刻度：一位作者也看得见，几十位也分得出深浅
  function level(n) {
    return Math.min(1, Math.log1p(n) / Math.log1p(FULL_HEAT));
  }

  // 服务器给的 country 是作者所在地的代码；台湾的作者算在中国台湾，画在中国的版图里
  function countAuthors() {
    counts = new Map();
    for (const cell of cells) counts.set(cell.country, (counts.get(cell.country) || 0) + cell.authors);
  }

  function rgb(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  }

  function mix(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  }

  function draw() {
    const { ctx, width, height } = Geo.canvasFor(root, canvas);
    const style = getComputedStyle(root);
    const color = name => rgb(style.getPropertyValue(name).trim());
    const land = style.getPropertyValue('--land').trim();
    const low = color('--heat-low');
    const high = color('--heat-high');
    const heat = code => {
      const n = counts.get(code);
      if (!n) return null;
      const [r, g, b] = mix(low, high, level(n));
      return `rgb(${r},${g},${b})`;
    };
    Geo.paint(ctx, width, height, {
      land,
      line: style.getPropertyValue('--bg').trim(),
      colorOf: heat,
      provinceColor: code => (code === 'CN-TW' ? heat('TW') : null),
    });
  }

  function closeBubble(bubble) {
    live.delete(bubble);
    bubble.classList.add('leaving');
    setTimeout(() => bubble.remove(), quiet.matches ? 0 : 320);
  }

  function makeBubble(pick) {
    const x = toX(pick.lon), y = toY(pick.lat);
    const bubble = document.createElement('a');
    bubble.className = 'bubble';
    bubble.href = `/life/post/?id=${pick.id}`;
    bubble.style.left = `${x * 100}%`;
    bubble.style.top = `${y * 100}%`;
    if (x < 0.22) bubble.classList.add('from-left');
    if (x > 0.78) bubble.classList.add('from-right');
    if (y < 0.42) bubble.classList.add('below');
    const name = document.createElement('strong');
    name.textContent = pick.author;
    const title = document.createElement('span');
    title.textContent = pick.title;
    const place = document.createElement('small');
    place.textContent = countryName(pick.country);
    const card = document.createElement('span');
    card.className = 'bubble-card';
    card.append(name, title, place);
    bubble.append(card);
    bubble.pick = pick;
    bubble.place = { x, y };
    return bubble;
  }

  // 随机挑一位还没在屏幕上、也不会和现有气泡挤在一起的作者
  function popBubble() {
    if (hovering || document.hidden || !pool.length) return;
    const narrow = root.clientWidth < 560;
    if (live.size >= (narrow ? 1 : 3)) return;
    const shown = [...live];
    const free = pool.filter(pick => shown.every(b => b.pick !== pick
      && (Math.abs(b.place.x - toX(pick.lon)) > 0.26 || Math.abs(b.place.y - toY(pick.lat)) > 0.4)));
    if (!free.length) return;
    const bubble = makeBubble(free[Math.floor(Math.random() * free.length)]);
    live.add(bubble);
    layer.append(bubble);
    bubble.timer = setTimeout(() => closeBubble(bubble), BUBBLE_LIFE);
  }

  // 鼠标放在气泡上或键盘选中时，气泡不消失
  function hold(event) {
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    hovering = true;
    clearTimeout(bubble.timer);
  }

  function release(event) {
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    hovering = false;
    bubble.timer = setTimeout(() => closeBubble(bubble), 1500);
  }

  function showTip(event) {
    if (event.pointerType === 'touch' || event.target.closest('.bubble')) {
      tip.hidden = true;
      return;
    }
    const box = root.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width, fy = (event.clientY - box.top) / box.height;
    const spot = Geo.locate(Geo.toLat(fy), Geo.toLon(fx));
    tip.hidden = !spot.country;
    if (!spot.country) return;
    const code = Geo.regionOf(spot);
    const n = counts.get(code) || 0;
    tip.textContent = n ? `${countryName(code)} · ${n} 位作者` : countryName(code);
    tip.style.left = `${fx * 100}%`;
    tip.style.top = `${fy * 100}%`;
  }

  // 同样的信息用文字再写一遍，看不清颜色或用读屏软件的人也能知道
  function writeSummary() {
    const total = cells.reduce((sum, cell) => sum + cell.authors, 0);
    if (!total) {
      summary.textContent = '地图还是空的。发布一篇文章，这里就会亮起来。';
      canvas.setAttribute('aria-label', '世界地图，还没有作者');
      return;
    }
    const byCountry = counts;
    const top = [...byCountry].sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([code, n]) => `${countryName(code)} ${n}`).join('、');
    const more = byCountry.size > 5 ? ' 等' : '';
    const text = `${total} 位作者，来自 ${byCountry.size} 个国家和地区：${top}${more}`;
    summary.textContent = text;
    canvas.setAttribute('aria-label', `世界地图，${text}`);
  }

  layer.addEventListener('pointerover', hold);
  layer.addEventListener('pointerout', release);
  layer.addEventListener('focusin', hold);
  layer.addEventListener('focusout', release);
  root.addEventListener('pointermove', showTip);
  root.addEventListener('pointerleave', () => {
    tip.hidden = true;
  });

  draw();
  new ResizeObserver(draw).observe(root);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

  api('/life/map').then(data => {
    cells = data.cells;
    pool = data.bubbles;
    countAuthors();
    draw();
    writeSummary();
    popBubble();
    setInterval(popBubble, BUBBLE_EVERY);
  }).catch(() => {
    summary.textContent = '地图暂时打不开。';
  });
})();
