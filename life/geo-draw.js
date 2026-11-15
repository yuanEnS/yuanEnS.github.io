// 按行政区划画地图：国界（中国视角）和中国省级行政区，数据在 geo.js。
// 投影是最简单的经纬度直角网格，北到 85°、南到 -57.5°（不画南极），和 .globe 的 144 / 57 比例一致。
const Geo = (() => {
  const TOP = 85;
  const BOTTOM = -57.5;
  // 港澳台在列表和提示里按中国的叫法
  const NAME_FIX = { TW: '中国台湾', HK: '中国香港', MO: '中国澳门', CN: '中国' };

  const display = (() => {
    try {
      return new Intl.DisplayNames(['zh-CN'], { type: 'region' });
    } catch (e) {
      return null;
    }
  })();

  function countryName(code) {
    if (NAME_FIX[code]) return NAME_FIX[code];
    if (/^[A-Z]{2}$/.test(code)) {
      try {
        const name = display && display.of(code);
        if (name && name !== code) return name;
      } catch (e) { /* 不认识的代码，用数据里的名字 */ }
    }
    return GEO.names[code] || code;
  }

  // TopoJSON 的 arcs：量化后的增量整数，还原成经纬度
  function decode(layer) {
    const [kx, ky, tx, ty] = layer.k;
    const arcs = layer.a.map(arc => {
      let x = 0, y = 0;
      const points = new Float64Array(arc.length * 2);
      arc.forEach(([dx, dy], i) => {
        x += dx;
        y += dy;
        points[i * 2] = x * kx + tx;
        points[i * 2 + 1] = y * ky + ty;
      });
      return points;
    });
    const uses = new Array(arcs.length).fill(0);
    const shapes = layer.s.map(([code, polygons]) => {
      const rings = [];
      for (const polygon of polygons) {
        for (const ring of polygon) {
          const points = [];
          ring.forEach((index, n) => {
            const reversed = index < 0;
            const arc = arcs[reversed ? ~index : index];
            uses[reversed ? ~index : index]++;
            const count = arc.length / 2;
            for (let i = n ? 1 : 0; i < count; i++) {
              const j = reversed ? count - 1 - i : i;
              points.push(arc[j * 2], arc[j * 2 + 1]);
            }
          });
          rings.push(Float64Array.from(points));
        }
      }
      let west = 180, east = -180, south = 90, north = -90;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i += 2) {
          west = Math.min(west, ring[i]);
          east = Math.max(east, ring[i]);
          south = Math.min(south, ring[i + 1]);
          north = Math.max(north, ring[i + 1]);
        }
      }
      return { code, rings, box: [west, south, east, north] };
    });
    // 只被一个形状用到的是海岸线，被两个用到的是两地之间的界线
    return { arcs, shapes, inner: arcs.filter((_, i) => uses[i] > 1) };
  }

  const countries = decode(GEO.countries);
  const provinces = decode(GEO.provinces);
  const byCode = new Map([...countries.shapes, ...provinces.shapes].map(shape => [shape.code, shape]));
  // 小国家和地区（新加坡、香港这种，地图上不到一两个像素）另外画一个点，鼠标也容易指到
  const TINY = 1.2;
  const spots = [
    ...GEO.dots,
    ...countries.shapes.filter(({ box }) => box[2] - box[0] < TINY && box[3] - box[1] < TINY)
      .map(({ code, box }) => [code, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2]),
  ];

  const toX = lon => (lon + 180) / 360;
  const toY = lat => (TOP - lat) / (TOP - BOTTOM);
  const toLon = x => x * 360 - 180;
  const toLat = y => TOP - y * (TOP - BOTTOM);

  function trace(ctx, rings, width, height) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i += 2) {
        const x = toX(ring[i]) * width, y = toY(ring[i + 1]) * height;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
  }

  function fill(ctx, shape, color, width, height) {
    ctx.beginPath();
    trace(ctx, shape.rings, width, height);
    ctx.fillStyle = color;
    ctx.fill('evenodd');
  }

  function stroke(ctx, arcs, color, lineWidth, width, height) {
    ctx.beginPath();
    for (const arc of arcs) {
      for (let i = 0; i < arc.length; i += 2) {
        const x = toX(arc[i]) * width, y = toY(arc[i + 1]) * height;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function inside(shape, lon, lat) {
    const [west, south, east, north] = shape.box;
    if (lon < west || lon > east || lat < south || lat > north) return false;
    let hit = false;
    for (const ring of shape.rings) {
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const yi = ring[i + 1], yj = ring[j + 1];
        if ((yi > lat) !== (yj > lat) && lon < (ring[j] - ring[i]) * (lat - yi) / (yj - yi) + ring[i]) hit = !hit;
      }
    }
    return hit;
  }

  // 这个经纬度落在哪个国家；在中国境内的话再给出省份。没落在形状里的，找 1.5° 以内最近的小国家点
  function locate(lat, lon) {
    let country = countries.shapes.find(shape => inside(shape, lon, lat));
    let code = country ? country.code : null;
    if (!code) {
      let best = 1.5;
      for (const [dotCode, x, y] of spots) {
        const d = Math.hypot(x - lon, y - lat);
        if (d < best) {
          best = d;
          code = dotCode;
        }
      }
    }
    let province = null;
    if (code === 'CN') {
      const shape = provinces.shapes.find(p => inside(p, lon, lat));
      province = shape ? shape.code : null;
    }
    return { country: code, province };
  }

  // 统计、填色时用的地区代码：台湾单独算，但画在中国的版图里
  function regionOf(spot) {
    if (spot.province === 'CN-TW') return 'TW';
    return spot.country;
  }

  function provinceName(code) {
    return GEO.provNames[code] || code;
  }

  // 一张画布：按容器大小、屏幕像素比铺满
  function canvasFor(root, canvas) {
    const box = root.getBoundingClientRect();
    const scale = devicePixelRatio || 1;
    canvas.width = Math.round(box.width * scale);
    canvas.height = Math.round(box.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    return { ctx, width: box.width, height: box.height };
  }

  // 画底图：所有国家铺陆地色，colorOf(code) 返回颜色的地区换成那个颜色。
  // 中国省份：provinceColor(code) 返回颜色的省份单独上色；lines 为真时画出省界。
  // zoom：地图放大了几倍（画之前已经用 view.apply 设好了缩放），线条和小点按屏幕上的粗细画，不跟着变粗
  function paint(ctx, width, height, { colorOf = () => null, provinceColor = () => null, land, line, provinceLines = false, zoom = 1 }) {
    for (const shape of countries.shapes) fill(ctx, shape, colorOf(shape.code) || land, width, height);
    for (const shape of provinces.shapes) {
      const color = provinceColor(shape.code);
      if (color) fill(ctx, shape, color, width, height);
    }
    const thin = Math.max(0.5, width / 1400) / zoom;
    if (provinceLines) {
      ctx.setLineDash([2 / zoom, 2 / zoom]);
      stroke(ctx, provinces.inner, line, thin, width, height);
      ctx.setLineDash([]);
    }
    stroke(ctx, countries.inner, line, thin * 1.4, width, height);
    // 小到画不出形状的国家：一个小点
    for (const [code, lon, lat] of spots) {
      if (lat < BOTTOM || lat > TOP) continue;
      const color = colorOf(code);
      ctx.beginPath();
      ctx.arc(toX(lon) * width, toY(lat) * height, (color ? Math.max(2.5, width / 260) : Math.max(1.2, width / 700)) / Math.sqrt(zoom), 0, Math.PI * 2);
      ctx.fillStyle = color || land;
      ctx.fill();
    }
  }

  // ---------- 缩放和拖动 ----------
  // zoomable(root, onChange)：滚轮（按住 Ctrl，或已经放大时直接滚）、触控板双指、手机双指捏合缩放，按住拖动，双击放大，
  // 右上角有「+ − 复位」按钮。地图上的点用 view.place(node, fx, fy) 摆（fx、fy 是在整张地图上的比例）。
  // 画布每次按当前视野重画，放大了也清楚。没放大时单指上下滑照常滚页面。
  const MAX_ZOOM = 12;
  function zoomable(root, onChange) {
    const view = { z: 1, ox: 0, oy: 0, dragged: false };
    const size = () => ({ w: root.clientWidth, h: root.clientHeight });
    let frame = 0;
    const changed = () => {
      root.style.touchAction = view.z > 1 ? 'none' : 'pan-y';
      reset.hidden = view.z <= 1.01;
      out.disabled = view.z <= 1.01;
      zoomIn.disabled = view.z >= MAX_ZOOM - 0.01;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        onChange();
      });
    };
    function clamp() {
      const { w, h } = size();
      view.z = Math.max(1, Math.min(MAX_ZOOM, view.z));
      view.ox = Math.max(0, Math.min(w * (view.z - 1), view.ox));
      view.oy = Math.max(0, Math.min(h * (view.z - 1), view.oy));
    }
    // 以屏幕上的 (sx, sy) 为中心缩放
    function zoomAt(sx, sy, factor) {
      const { w, h } = size();
      const fx = (sx + view.ox) / (w * view.z), fy = (sy + view.oy) / (h * view.z);
      view.z = Math.max(1, Math.min(MAX_ZOOM, view.z * factor));
      view.ox = fx * w * view.z - sx;
      view.oy = fy * h * view.z - sy;
      clamp();
      changed();
    }
    view.zoomAt = zoomAt;
    // 画之前调用：把画布坐标换成当前视野
    view.apply = ctx => {
      ctx.translate(-view.ox, -view.oy);
      ctx.scale(view.z, view.z);
    };
    // 屏幕上一点 → 在整张地图上的比例
    view.unproject = event => {
      const box = root.getBoundingClientRect();
      const sx = event.clientX - box.left, sy = event.clientY - box.top;
      return { fx: (sx + view.ox) / (box.width * view.z), fy: (sy + view.oy) / (box.height * view.z), sx, sy };
    };
    // 把一个标记摆到地图上 (fx, fy) 的位置；跑出视野的藏起来
    view.place = (node, fx, fy) => {
      const { w, h } = size();
      const x = fx * w * view.z - view.ox, y = fy * h * view.z - view.oy;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.visibility = x < -2 || y < -2 || x > w + 2 || y > h + 2 ? 'hidden' : '';
      return { x, y };
    };

    // 按钮
    const controls = document.createElement('div');
    controls.className = 'map-zoom';
    const button = (text, label, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.addEventListener('click', e => {
        e.stopPropagation();
        onClick();
      });
      b.addEventListener('pointerdown', e => e.stopPropagation());
      controls.append(b);
      return b;
    };
    const center = () => ({ sx: root.clientWidth / 2, sy: root.clientHeight / 2 });
    const zoomIn = button('+', '放大', () => zoomAt(center().sx, center().sy, 2));
    const out = button('−', '缩小', () => zoomAt(center().sx, center().sy, 0.5));
    const reset = button('复位', '回到整张地图', () => {
      view.z = 1;
      view.ox = view.oy = 0;
      changed();
    });
    root.append(controls);

    // 滚轮：触控板双指捏合会带 ctrlKey；没放大时普通滚轮留给页面滚动
    root.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey && view.z <= 1) return;
      e.preventDefault();
      const { sx, sy } = view.unproject(e);
      zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
    }, { passive: false });
    root.addEventListener('dblclick', e => {
      if (e.target.closest('.map-zoom, .pin, .bubble')) return;
      const { sx, sy } = view.unproject(e);
      zoomAt(sx, sy, 2);
    });

    // 拖动、双指捏合
    const pointers = new Map();
    let start = null;
    root.addEventListener('pointerdown', e => {
      if (e.target.closest('.map-zoom, .bubble')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      view.dragged = false;
      start = { ox: view.ox, oy: view.oy, z: view.z, points: new Map(pointers) };
    });
    root.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId) || !start) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const list = [...pointers.values()];
      const begin = [...start.points.values()];
      if (list.length >= 2 && begin.length >= 2) {
        const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const box = root.getBoundingClientRect();
        const mid = { x: (list[0].x + list[1].x) / 2 - box.left, y: (list[0].y + list[1].y) / 2 - box.top };
        const { w, h } = size();
        // 回到开始捏的时候的视野，再按两指距离的比例缩放
        const startMid = { x: (begin[0].x + begin[1].x) / 2 - box.left, y: (begin[0].y + begin[1].y) / 2 - box.top };
        const fx = (startMid.x + start.ox) / (w * start.z), fy = (startMid.y + start.oy) / (h * start.z);
        view.z = Math.max(1, Math.min(MAX_ZOOM, start.z * dist(list[0], list[1]) / dist(begin[0], begin[1])));
        view.ox = fx * w * view.z - mid.x;
        view.oy = fy * h * view.z - mid.y;
        view.dragged = true;
        clamp();
        changed();
        return;
      }
      if (view.z <= 1) return;
      const first = begin[0], now = list[0];
      if (!first) return;
      const dx = now.x - first.x, dy = now.y - first.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) view.dragged = true;
      if (!view.dragged) return;
      view.ox = start.ox - dx;
      view.oy = start.oy - dy;
      clamp();
      changed();
      root.classList.add('dragging');
    });
    const end = e => {
      pointers.delete(e.pointerId);
      root.classList.remove('dragging');
      // 两指松开一指以后，从剩下那一指重新开始拖
      start = pointers.size ? { ox: view.ox, oy: view.oy, z: view.z, points: new Map(pointers) } : null;
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    // 拖完松手时浏览器还会发一个 click，地图上的点击（选地点、点红点）要忽略它
    root.addEventListener('click', e => {
      if (view.dragged) {
        e.stopPropagation();
        e.preventDefault();
        view.dragged = false;
      }
    }, true);
    // 容器大小变了（转屏）：视野按比例跟着变
    let last = size();
    new ResizeObserver(() => {
      const now = size();
      if (last.w && now.w) {
        view.ox *= now.w / last.w;
        view.oy *= now.h / last.h;
      }
      last = now;
      clamp();
    }).observe(root);
    changed();
    return view;
  }

  return { TOP, BOTTOM, toX, toY, toLon, toLat, locate, regionOf, countryName, provinceName, paint, canvasFor, byCode, zoomable };
})();
