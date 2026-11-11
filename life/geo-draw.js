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
  function paint(ctx, width, height, { colorOf = () => null, provinceColor = () => null, land, line, provinceLines = false }) {
    for (const shape of countries.shapes) fill(ctx, shape, colorOf(shape.code) || land, width, height);
    for (const shape of provinces.shapes) {
      const color = provinceColor(shape.code);
      if (color) fill(ctx, shape, color, width, height);
    }
    const thin = Math.max(0.5, width / 1400);
    if (provinceLines) {
      ctx.setLineDash([2, 2]);
      stroke(ctx, provinces.inner, line, thin, width, height);
      ctx.setLineDash([]);
    }
    stroke(ctx, countries.inner, line, thin * 1.4, width, height);
    // 小到画不出形状的国家：一个小点
    for (const [code, lon, lat] of spots) {
      if (lat < BOTTOM || lat > TOP) continue;
      const color = colorOf(code);
      ctx.beginPath();
      ctx.arc(toX(lon) * width, toY(lat) * height, color ? Math.max(2.5, width / 260) : Math.max(1.2, width / 700), 0, Math.PI * 2);
      ctx.fillStyle = color || land;
      ctx.fill();
    }
  }

  return { TOP, BOTTOM, toX, toY, toLon, toLat, locate, regionOf, countryName, provinceName, paint, canvasFor, byCode };
})();
