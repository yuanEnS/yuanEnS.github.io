// 旅行地图：按国界和中国省界画。去过的国家涂上颜色，去过的地方越多颜色越深（热力图）；
// 在中国境内按省份分别算（港澳台算省级行政区）。红点是去过的地方，那一条里有图片的就显示第一张图片的小图；
// 可以点地图选一个地方。可以缩放、拖动。
// gardenMap(root, { onPin(item), onPick(lat, lon) }) 返回 { setPins(items), setPick(lat, lon), picking(on) }
// setPins 返回 { countries, provinces, places }：去过多少个国家、中国的多少个省级行政区、多少个不同的地方
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
  const SAR = { HK: 'CN-HK', MO: 'CN-MO', TW: 'CN-TW' }; // 按中国的省级行政区算
  const FULL_HEAT = 8; // 一个国家（或省份）去过这么多个地方时颜色最深
  let pickable = false;
  let pickAt = null;
  // 地区代码（国家，或中国的省份代码）→ 去过的不同地方（经纬度取到 0.1°，约十公里以内算同一个地方）
  let places = new Map();
  const view = Geo.zoomable(root, () => {
    draw();
    placeAll();
  });

  const count = code => (places.get(code) || new Set()).size;
  // 对数刻度：去过一个地方也看得出来，十几个也分得出深浅
  const level = n => Math.min(1, Math.log1p(n) / Math.log1p(FULL_HEAT));
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

  function draw() {
    const { ctx, width, height } = Geo.canvasFor(root, canvas);
    const style = getComputedStyle(root);
    const land = style.getPropertyValue('--land').trim() || '#d8cbb8';
    const low = rgb(style.getPropertyValue('--heat-low').trim() || '#EDA27E');
    const high = rgb(style.getPropertyValue('--heat-high').trim() || '#8E1410');
    const line = style.getPropertyValue('--bg').trim() || '#fff';
    const heat = code => {
      const n = count(code);
      if (!n) return null;
      const [r, g, b] = mix(low, high, level(n));
      return `rgb(${r},${g},${b})`;
    };
    ctx.save();
    view.apply(ctx);
    Geo.paint(ctx, width, height, {
      land,
      line,
      provinceLines: true,
      zoom: view.z,
      // 中国按省份涂色，整个国家不涂；港澳按所在的省级行政区
      colorOf: code => (code === 'CN' ? null : heat(SAR[code] || code)),
      provinceColor: heat,
    });
    ctx.restore();
  }

  function placeAll() {
    layer.querySelectorAll('.pin').forEach(pin => view.place(pin, Geo.toX(pin.lon), Geo.toY(pin.latClamped)));
    if (pickAt) view.place(mark, Geo.toX(pickAt.lon), Geo.toY(pickAt.lat));
  }

  const clampLat = lat => Math.max(Geo.BOTTOM, Math.min(Geo.TOP, lat));

  // 正文里第一张图片（单独一段的 ![说明](地址)）
  function firstPhoto(body) {
    const m = String(body || '').match(/^\s*!\[[^\]]*\]\((https?:\/\/\S+?|\/\S+?)\)\s*$/m);
    return m ? m[1] : null;
  }

  function setPins(items) {
    layer.querySelectorAll('.pin').forEach(pin => pin.remove());
    places = new Map();
    const countries = new Set(), provinces = new Set(), all = new Set();
    for (const item of items) {
      if (item.lat === null || item.lon === null || item.lat === undefined) continue;
      const spot = Geo.locate(item.lat, item.lon);
      const key = `${Math.round(item.lat * 10)},${Math.round(item.lon * 10)}`;
      all.add(key);
      // 港澳台算中国的省级行政区，不另算一个国家；在中国境内的按省份记
      const sar = SAR[spot.country];
      const province = spot.province || sar;
      if (spot.country) countries.add(sar ? 'CN' : spot.country);
      if (province) provinces.add(province);
      const region = spot.country === 'CN' || sar ? province : spot.country;
      if (region) {
        if (!places.has(region)) places.set(region, new Set());
        places.get(region).add(key);
      }
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'pin';
      pin.title = item.title;
      pin.setAttribute('aria-label', item.title);
      pin.lon = item.lon;
      pin.latClamped = clampLat(item.lat);
      const photo = firstPhoto(item.body);
      if (photo) {
        pin.classList.add('photo');
        const img = document.createElement('img');
        img.src = photo;
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        // 图片打不开就还是红点
        img.addEventListener('error', () => {
          pin.classList.remove('photo');
          img.remove();
        });
        pin.append(img);
      }
      pin.addEventListener('click', e => {
        e.stopPropagation();
        if (onPin) onPin(item);
      });
      layer.insertBefore(pin, mark);
    }
    draw();
    placeAll();
    return { countries: countries.size, provinces: provinces.size, places: all.size };
  }

  function setPick(lat, lon) {
    mark.hidden = lat === null || lat === undefined;
    pickAt = mark.hidden ? null : { lat: clampLat(lat), lon };
    if (pickAt) placeAll();
  }

  function spotAt(event) {
    const { fx, fy, sx, sy } = view.unproject(event);
    return { sx, sy, lat: Geo.toLat(fy), lon: Geo.toLon(fx) };
  }

  // 鼠标移上去显示地名和去过几个地方
  root.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || event.target.closest('.pin, .map-zoom') || root.classList.contains('dragging')) {
      tip.hidden = true;
      return;
    }
    const { sx, sy, lat, lon } = spotAt(event);
    const spot = Geo.locate(lat, lon);
    tip.hidden = !spot.country;
    if (!spot.country) return;
    const region = Geo.regionOf(spot);
    const name = spot.province && region === 'CN' ? Geo.provinceName(spot.province) : Geo.countryName(region);
    const sar = SAR[spot.country];
    const n = count(spot.country === 'CN' || sar ? spot.province || sar : spot.country);
    tip.textContent = n ? `${name} · 去过 ${n} 个地方` : name;
    tip.style.left = `${sx}px`;
    tip.style.top = `${sy}px`;
  });
  root.addEventListener('pointerleave', () => {
    tip.hidden = true;
  });

  root.addEventListener('click', e => {
    if (!pickable || !onPick || e.target.closest('.map-zoom')) return;
    const { lat, lon } = spotAt(e);
    setPick(lat, lon);
    onPick(Math.round(lat * 100) / 100, Math.round(lon * 100) / 100);
  });

  new ResizeObserver(() => {
    draw();
    placeAll();
  }).observe(root);
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
