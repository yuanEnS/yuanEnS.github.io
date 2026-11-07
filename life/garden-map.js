// 旅行地图：陆地点阵（land.js）上标出去过的地方。可以点地图选一个地方。
// gardenMap(root, { onPin(item), onPick(lat, lon) }) 返回 { setPins(items), setPick(lat, lon), picking(on) }
function gardenMap(root, { onPin, onPick } = {}) {
  const COLS = LAND.rows[0].length;
  const ROWS = LAND.rows.length;
  const BOTTOM = LAND.top - ROWS * LAND.step;
  const canvas = document.createElement('canvas');
  const layer = document.createElement('div');
  layer.className = 'pins';
  const mark = document.createElement('span');
  mark.className = 'pick-mark';
  mark.hidden = true;
  root.append(canvas, layer);
  layer.append(mark);
  const ctx = canvas.getContext('2d');
  let pickable = false;

  const x = lon => (lon + 180) / (COLS * LAND.step) * 100;
  const y = lat => (LAND.top - lat) / (ROWS * LAND.step) * 100;

  function draw() {
    const box = root.getBoundingClientRect();
    const scale = devicePixelRatio || 1;
    canvas.width = Math.round(box.width * scale);
    canvas.height = Math.round(box.height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.fillStyle = getComputedStyle(root).getPropertyValue('--land').trim() || '#d8cbb8';
    const gap = box.width / COLS;
    LAND.rows.forEach((row, r) => {
      for (let c = 0; c < COLS; c++) {
        if (row[c] !== '1') continue;
        ctx.beginPath();
        ctx.arc((c + 0.5) * gap, (r + 0.5) / ROWS * box.height, gap * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function place(node, lat, lon) {
    node.style.left = `${x(lon)}%`;
    node.style.top = `${y(Math.max(BOTTOM, Math.min(LAND.top, lat)))}%`;
  }

  function setPins(items) {
    layer.querySelectorAll('.pin').forEach(pin => pin.remove());
    for (const item of items) {
      if (item.lat === null || item.lon === null) continue;
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pin';
      pin.title = item.title;
      pin.setAttribute('aria-label', item.title);
      place(pin, item.lat, item.lon);
      pin.addEventListener('click', e => {
        e.stopPropagation();
        if (onPin) onPin(item);
      });
      layer.insertBefore(pin, mark);
    }
  }

  function setPick(lat, lon) {
    mark.hidden = lat === null || lat === undefined;
    if (!mark.hidden) place(mark, lat, lon);
  }

  root.addEventListener('click', e => {
    if (!pickable || !onPick) return;
    const box = root.getBoundingClientRect();
    const lon = (e.clientX - box.left) / box.width * COLS * LAND.step - 180;
    const lat = LAND.top - (e.clientY - box.top) / box.height * ROWS * LAND.step;
    setPick(lat, lon);
    onPick(Math.round(lat * 100) / 100, Math.round(lon * 100) / 100);
  });

  new ResizeObserver(draw).observe(root);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
  draw();
  return {
    setPins,
    setPick,
    picking(on) {
      pickable = on;
      root.classList.toggle('picking', on);
    },
  };
}
