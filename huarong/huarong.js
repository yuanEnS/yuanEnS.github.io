// 华容道：4 列 5 行。曹操是 2×2 的大块，从下面中间的出口出去就赢。
// 一个棋子不管挪了几格（中途可以拐弯），只要没换别的棋子，都算一步，和传统的算法一样。
// 关卡写成 5 行字符串，同一个字母是同一个棋子，「.」是空格。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Huarong = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 4, H = 5;
  const EXIT = { r: 3, c: 1 }; // 曹操左上角到这里就出去了

  // 关卡字符串 → 棋子列表 { id, r, c, w, h }
  function parse(rows) {
    const pieces = new Map();
    rows.forEach((row, r) => [...row].forEach((ch, c) => {
      if (ch === '.') return;
      const p = pieces.get(ch);
      if (!p) pieces.set(ch, { id: ch, r, c, r2: r, c2: c });
      else {
        p.r2 = Math.max(p.r2, r);
        p.c2 = Math.max(p.c2, c);
      }
    }));
    return [...pieces.values()].map(p => ({ id: p.id, r: p.r, c: p.c, w: p.c2 - p.c + 1, h: p.r2 - p.r + 1 }));
  }

  const kindOf = p => (p.w === 2 && p.h === 2 ? 'C' : p.w === 2 ? 'H' : p.h === 2 ? 'V' : 'S');

  function grid(pieces) {
    const g = Array.from({ length: H }, () => Array(W).fill(null));
    pieces.forEach((p, i) => {
      for (let r = p.r; r < p.r + p.h; r++) for (let c = p.c; c < p.c + p.w; c++) g[r][c] = i;
    });
    return g;
  }

  // 形状一样的棋子可以互换，所以只记形状：用来判断两个局面是不是同一个
  function key(pieces) {
    const cells = Array(W * H).fill('.');
    for (const p of pieces) {
      const k = kindOf(p);
      for (let r = p.r; r < p.r + p.h; r++) for (let c = p.c; c < p.c + p.w; c++) cells[r * W + c] = k;
    }
    return cells.join('');
  }

  const solved = pieces => pieces.some(p => kindOf(p) === 'C' && p.r === EXIT.r && p.c === EXIT.c);

  // 第 i 个棋子能不能往 (dr, dc) 挪一格
  function canSlide(g, p, i, dr, dc) {
    for (let r = p.r; r < p.r + p.h; r++) for (let c = p.c; c < p.c + p.w; c++) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= H || cc < 0 || cc >= W) return false;
      const cell = g[rr][cc];
      if (cell !== null && cell !== i) return false;
    }
    return true;
  }

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // 第 i 个棋子这一步能去的所有位置（可以连着挪几格、拐弯）
  function reach(pieces, i) {
    const g = grid(pieces);
    const p = pieces[i];
    for (let r = p.r; r < p.r + p.h; r++) for (let c = p.c; c < p.c + p.w; c++) g[r][c] = null;
    const free = (r, c) => {
      for (let rr = r; rr < r + p.h; rr++) for (let cc = c; cc < c + p.w; cc++) {
        if (rr < 0 || rr >= H || cc < 0 || cc >= W || g[rr][cc] !== null) return false;
      }
      return true;
    };
    const seen = new Set([`${p.r},${p.c}`]);
    const queue = [[p.r, p.c]];
    const list = [];
    while (queue.length) {
      const [r, c] = queue.shift();
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        const k = `${nr},${nc}`;
        if (seen.has(k) || !free(nr, nc)) continue;
        seen.add(k);
        queue.push([nr, nc]);
        list.push([nr, nc]);
      }
    }
    return list;
  }

  function moved(pieces, i, r, c) {
    return pieces.map((p, j) => (j === i ? { ...p, r, c } : p));
  }

  // 最少几步能出去，以及第一步怎么走。走不出去返回 null
  function solve(pieces, limit = 400000) {
    const start = key(pieces);
    if (solved(pieces)) return { steps: 0, first: null };
    const seen = new Map([[start, null]]);
    let frontier = [{ pieces, first: null }];
    let depth = 0;
    while (frontier.length && seen.size < limit) {
      depth++;
      const next = [];
      for (const node of frontier) {
        for (let i = 0; i < node.pieces.length; i++) {
          for (const [r, c] of reach(node.pieces, i)) {
            const after = moved(node.pieces, i, r, c);
            const k = key(after);
            if (seen.has(k)) continue;
            const first = node.first || { id: node.pieces[i].id, r, c };
            seen.set(k, true);
            if (solved(after)) return { steps: depth, first };
            next.push({ pieces: after, first });
          }
        }
      }
      frontier = next;
    }
    return null;
  }

  return { W, H, EXIT, parse, kindOf, grid, key, solved, canSlide, reach, moved, solve };
});
