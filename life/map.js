// 世界园地图：作者多的地方颜色深，时不时冒出一个气泡，随机挑一位作者。
// 数据来自 /api/life/map，陆地点阵在 land.js。
(() => {
  const root = document.getElementById('globe');
  const canvas = root.querySelector('canvas');
  const layer = root.querySelector('.bubbles');
  const tip = root.querySelector('.map-tip');
  const summary = document.getElementById('globe-summary');
  const ctx = canvas.getContext('2d');

  const COLS = LAND.rows[0].length;
  const ROWS = LAND.rows.length;
  const SPREAD = 7; // 一位作者的热度向外扩散多少度
  const FULL_HEAT = 12; // 这么多位作者挤在一起时颜色最深，人少时不会一下子烧红
  const BUBBLE_EVERY = 2600;
  const BUBBLE_LIFE = 7000;

  const quiet = matchMedia('(prefers-reduced-motion: reduce)');
  const names = (() => {
    try {
      return new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    } catch (e) {
      return null;
    }
  })();

  let cells = [];
  let pool = [];
  let dots = [];
  let hovering = false;
  const live = new Set();

  function countryName(code) {
    try {
      return (names && names.of(code)) || code;
    } catch (e) {
      return code;
    }
  }

  function toX(lon) {
    return (lon + 180) / (COLS * LAND.step);
  }

  function toY(lat) {
    return (LAND.top - lat) / (ROWS * LAND.step);
  }

  function heatAt(lat, lon) {
    let sum = 0;
    for (const cell of cells) {
      const dLat = lat - cell.lat;
      let dLon = Math.abs(lon - cell.lon);
      if (dLon > 180) dLon = 360 - dLon;
      dLon *= Math.cos(lat * Math.PI / 180);
      sum += cell.authors * Math.exp(-(dLat * dLat + dLon * dLon) / (2 * SPREAD * SPREAD));
    }
    return sum;
  }

  // 对数刻度：一位作者也看得见，几十位也分得出深浅
  function level(heat) {
    return Math.min(1, Math.log1p(heat) / Math.log1p(FULL_HEAT));
  }

  function computeDots() {
    dots = [];
    LAND.rows.forEach((row, r) => {
      for (let c = 0; c < COLS; c++) {
        if (row[c] !== '1') continue;
        const lat = LAND.top - (r + 0.5) * LAND.step;
        const lon = -180 + (c + 0.5) * LAND.step;
        dots.push({ x: (c + 0.5) / COLS, y: (r + 0.5) / ROWS, t: level(heatAt(lat, lon)) });
      }
    });
  }

  function rgb(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  }

  function mix(a, b, t) {
    return a.map((v, i) => Math.round(v + (b[i] - v) * t));
  }

  function draw() {
    const box = root.getBoundingClientRect();
    const scale = devicePixelRatio || 1;
    canvas.width = Math.round(box.width * scale);
    canvas.height = Math.round(box.height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);

    const style = getComputedStyle(root);
    const color = name => rgb(style.getPropertyValue(name).trim());
    const land = color('--land');
    const low = color('--heat-low');
    const high = color('--heat-high');

    // 先铺一层晕染，海上的小岛没有陆地点也看得见
    for (const cell of cells) {
      const x = toX(cell.lon) * box.width, y = toY(cell.lat) * box.height;
      const radius = box.width * (0.035 + 0.03 * level(cell.authors));
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const [r, g, b] = mix(low, high, level(cell.authors));
      glow.addColorStop(0, `rgba(${r},${g},${b},0.34)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    const gap = box.width / COLS;
    for (const dot of dots) {
      const hot = dot.t > 0.04;
      const [r, g, b] = hot ? mix(low, high, dot.t) : land;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(dot.x * box.width, dot.y * box.height, gap * (hot ? 0.3 + 0.16 * dot.t : 0.26), 0, Math.PI * 2);
      ctx.fill();
    }
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

  function nearestCell(event) {
    const box = root.getBoundingClientRect();
    const px = event.clientX - box.left, py = event.clientY - box.top;
    let best = null, bestDistance = 26;
    for (const cell of cells) {
      const d = Math.hypot(toX(cell.lon) * box.width - px, toY(cell.lat) * box.height - py);
      if (d < bestDistance) {
        best = cell;
        bestDistance = d;
      }
    }
    return best;
  }

  function showTip(event) {
    const cell = nearestCell(event);
    tip.hidden = !cell;
    if (!cell) return;
    tip.textContent = `${countryName(cell.country)} · ${cell.authors} 位作者`;
    tip.style.left = `${toX(cell.lon) * 100}%`;
    tip.style.top = `${toY(cell.lat) * 100}%`;
  }

  // 同样的信息用文字再写一遍，看不清颜色或用读屏软件的人也能知道
  function writeSummary() {
    const total = cells.reduce((sum, cell) => sum + cell.authors, 0);
    if (!total) {
      summary.textContent = '地图还是空的。发布一篇文章，这里就会亮起来。';
      canvas.setAttribute('aria-label', '世界地图，还没有作者');
      return;
    }
    const byCountry = new Map();
    for (const cell of cells) byCountry.set(cell.country, (byCountry.get(cell.country) || 0) + cell.authors);
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

  computeDots();
  draw();
  new ResizeObserver(draw).observe(root);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

  api('/life/map').then(data => {
    cells = data.cells;
    pool = data.bubbles;
    computeDots();
    draw();
    writeSummary();
    popBubble();
    setInterval(popBubble, BUBBLE_EVERY);
  }).catch(() => {
    summary.textContent = '地图暂时打不开。';
  });
})();
