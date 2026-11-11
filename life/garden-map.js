// 旅行地图：按国界和中国省界画，去过的国家（在中国就是去过的省份）涂上颜色，红点是去过的地方。可以点地图选一个地方。
// gardenMap(root, { onPin(item), onPick(lat, lon) }) 返回 { setPins(items), setPick(lat, lon), picking(on) }
// setPins 返回 { countries, provinces }：去过多少个国家、中国的多少个省级行政区（含港澳台）
function gardenMap(root, { onPin, onPick } = {}) {
  const canvas = document.createElement('canvas');
  const layer = document.createElement('div');
  layer.className = 'pins';
  const mark = document.createElement('span');
  mark.className = 'pick-mark';
  mark.hidden = true;
  const tip = document.createElement('p');
  tip.className = 'map-tip';
  tip.hidden = true;
  root.append(canvas, layer, tip);
  layer.append(mark);
  const SAR = { HK: 'CN-HK', MO: 'CN-MO' };
  let pickable = false;
  let visited = new Set(); // 去过的国家和地区代码
  let visitedProvinces = new Set();

  function draw() {
    const { ctx, width, height } = Geo.canvasFor(root, canvas);
    const style = getComputedStyle(root);
    const land = style.getPropertyValue('--land').trim() || '#d8cbb8';
    const been = style.getPropertyValue('--heat-low').trim() || '#EDA27E';
    const line = style.getPropertyValue('--bg').trim() || '#fff';
    Geo.paint(ctx, width, height, {
      land,
      line,
      provinceLines: true,
      // 中国按省份涂色，整个国家不涂
      colorOf: code => (SAR[code] ? visitedProvinces.has(SAR[code]) : code !== 'CN' && visited.has(code)) ? been : null,
      provinceColor: code => (visitedProvinces.has(code) ? been : null),
    });
  }

  function place(node, lat, lon) {
    node.style.left = `${Geo.toX(lon) * 100}%`;
    node.style.top = `${Geo.toY(Math.max(Geo.BOTTOM, Math.min(Geo.TOP, lat))) * 100}%`;
  }

  function setPins(items) {
    layer.querySelectorAll('.pin').forEach(pin => pin.remove());
    visited = new Set();
    visitedProvinces = new Set();
    for (const item of items) {
      if (item.lat === null || item.lon === null || item.lat === undefined) continue;
      const spot = Geo.locate(item.lat, item.lon);
      // 港澳台算中国的省级行政区，不另算一个国家
      const sar = SAR[spot.country];
      if (spot.country) visited.add(sar ? 'CN' : spot.country);
      if (spot.province || sar) visitedProvinces.add(spot.province || sar);
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
    draw();
    return { countries: visited.size, provinces: visitedProvinces.size };
  }

  function setPick(lat, lon) {
    mark.hidden = lat === null || lat === undefined;
    if (!mark.hidden) place(mark, lat, lon);
  }

  function spotAt(event) {
    const box = root.getBoundingClientRect();
    const fx = (event.clientX - box.left) / box.width, fy = (event.clientY - box.top) / box.height;
    return { fx, fy, lat: Geo.toLat(fy), lon: Geo.toLon(fx) };
  }

  // 鼠标移上去显示地名
  root.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || event.target.closest('.pin')) {
      tip.hidden = true;
      return;
    }
    const { fx, fy, lat, lon } = spotAt(event);
    const spot = Geo.locate(lat, lon);
    tip.hidden = !spot.country;
    if (!spot.country) return;
    const region = Geo.regionOf(spot);
    const name = spot.province && region === 'CN' ? Geo.provinceName(spot.province) : Geo.countryName(region);
    const been = spot.province || SAR[region] ? visitedProvinces.has(spot.province || SAR[region]) : visited.has(region);
    tip.textContent = been ? `${name} · 去过` : name;
    tip.style.left = `${fx * 100}%`;
    tip.style.top = `${fy * 100}%`;
  });
  root.addEventListener('pointerleave', () => {
    tip.hidden = true;
  });

  root.addEventListener('click', e => {
    if (!pickable || !onPick) return;
    const { lat, lon } = spotAt(e);
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
