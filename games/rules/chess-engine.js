// 国际象棋电脑：网页 yuanens.com/guoxiang/ 用，在 Web Worker 里运行，不卡页面；
// 浏览器不支持 Worker（比如有的电子书阅读器）时，页面直接加载这个文件，在主线程上少算一会儿。
//
//   - 0x88 一维棋盘、整数编码走法，走法生成和判断将军都很快
//   - 估值：子力 + 逐子位置分（开局、残局两套，按剩下的子力过渡）、通路兵、叠兵孤兵、双象、
//     车占开放线、棋子灵活度、王前兵
//   - 搜索：迭代加深 + PVS、置换表、空着裁剪、后期走法减深（LMR）、将军延伸、杀手走法和历史表、
//     静态搜索（吃子；被将军时搜全部应将）、识别重复局面和五十步
//   - 按时间停：到时间就用最后一层搜完（或已证明更好）的走法
//   - 五档难度见 LEVELS；低两档按固定深度算出每步的分数，再加随机偏差挑，会犯错
//
// 用法：
//   Node：const E = require('./chess-engine.js'); E.think({ fen, moves: ['e2e4', ...], level: 3 })
//   Worker：postMessage({ id, fen, moves, level })，回复 { type: 'info' | 'done', id, move: 'e7e5', score, depth, nodes, ms }
//   页面直接加载：window.ChessEngine.think(...)
//   fen 省略就是标准开局；moves 是从 fen 开始走过的每一步（UCI 写法），用来识别重复局面和查开局库。
(function () {
  'use strict';

  // ---------- 棋子和棋盘 ----------
  // 棋子：白 1 兵 2 马 3 象 4 车 5 后 6 王；黑方加 8。格子 sq = 行 * 16 + 列，第 0 行是第 8 横线
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const WHITE = 0, BLACK = 1;
  const MATE = 30000, MATE_IN_MAX = MATE - 1000, INF = 32000;
  const MAX_PLY = 100;
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const N_DIRS = [-33, -31, -18, -14, 14, 18, 31, 33];
  const K_DIRS = [-17, -16, -15, -1, 1, 15, 16, 17];
  const B_DIRS = [-17, -15, 15, 17];
  const R_DIRS = [-16, -1, 1, 16];
  // 易位权：1 白短 2 白长 4 黑短 8 黑长；走了或吃了这个格子上的子以后要保留的权利
  const CASTLE_MASK = new Uint8Array(128).fill(15);
  CASTLE_MASK[0x74] = 15 & ~3; // e1
  CASTLE_MASK[0x77] = 15 & ~1; // h1
  CASTLE_MASK[0x70] = 15 & ~2; // a1
  CASTLE_MASK[0x04] = 15 & ~12; // e8
  CASTLE_MASK[0x07] = 15 & ~4; // h8
  CASTLE_MASK[0x00] = 15 & ~8; // a8

  // 走法：from | to << 7 | 升变的棋子种类 << 14 | 标记 << 17
  const F_DOUBLE = 1, F_EP = 2, F_CASTLE = 4;
  const FROM = m => m & 127;
  const TO = m => (m >> 7) & 127;
  const PROMO = m => (m >> 14) & 7;
  const FLAGS = m => m >> 17;
  const MOVE = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);

  // ---------- 估值表 ----------
  const MG_VALUE = [0, 100, 320, 330, 500, 900, 0];
  const EG_VALUE = [0, 120, 300, 320, 530, 940, 0];
  const PHASE_INC = [0, 0, 1, 1, 2, 4, 0];
  // 位置分（白方视角，第一行是第 8 横线）
  const PST_MG = [
    null,
    [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  ];
  const PST_EG = PST_MG.slice();
  PST_EG[PAWN] = [0, 0, 0, 0, 0, 0, 0, 0, 60, 60, 60, 60, 60, 60, 60, 60, 35, 35, 35, 35, 35, 35, 35, 35, 20, 20, 20, 20, 20, 20, 20, 20,
    10, 10, 10, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 0, 0, 0, -5, -5, -5, -5, -5, -5, -5, -5, 0, 0, 0, 0, 0, 0, 0, 0];
  PST_EG[KING] = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
  // 子力 + 位置分合在一起，按棋子编号和格子查（白方为正、黑方为负）
  const MG = [], EG = [];
  for (let p = 0; p < 16; p++) {
    MG.push(new Int16Array(128));
    EG.push(new Int16Array(128));
    const type = p & 7, color = p >> 3;
    if (type < 1 || type > 6) continue;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const idx = color === WHITE ? r * 8 + c : (7 - r) * 8 + c;
      const sign = color === WHITE ? 1 : -1;
      MG[p][r * 16 + c] = sign * (MG_VALUE[type] + PST_MG[type][idx]);
      EG[p][r * 16 + c] = sign * (EG_VALUE[type] + PST_EG[type][idx]);
    }
  }
  const PASSED_MG = [0, 5, 10, 15, 25, 40, 60, 0];
  const PASSED_EG = [0, 10, 20, 35, 60, 90, 130, 0];

  // ---------- 局面哈希（两个 32 位数） ----------
  let seed = 0x2545F491;
  const rand32 = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed | 0;
  };
  const Z_LO = new Int32Array(16 * 128), Z_HI = new Int32Array(16 * 128);
  for (let i = 0; i < Z_LO.length; i++) { Z_LO[i] = rand32(); Z_HI[i] = rand32(); }
  const Z_SIDE_LO = rand32(), Z_SIDE_HI = rand32();
  const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
  for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = rand32(); Z_CASTLE_HI[i] = rand32(); }
  const Z_EP_LO = new Int32Array(8), Z_EP_HI = new Int32Array(8);
  for (let i = 0; i < 8; i++) { Z_EP_LO[i] = rand32(); Z_EP_HI[i] = rand32(); }

  // ---------- 局面状态 ----------
  const board = new Uint8Array(128);
  const kingSq = new Int32Array(2);
  let side = WHITE, castle = 0, ep = -1, half = 0, hashLo = 0, hashHi = 0, mg = 0, eg = 0, phase = 0;
  // 走过的局面（游戏里的加上搜索里的），撤销用的信息也存在这里
  const STACK = 1200;
  const stMove = new Int32Array(STACK), stCap = new Uint8Array(STACK), stCastle = new Uint8Array(STACK), stEp = new Int16Array(STACK);
  const stHalf = new Int16Array(STACK), stLo = new Int32Array(STACK), stHi = new Int32Array(STACK);
  const stMg = new Int32Array(STACK), stEg = new Int32Array(STACK), stPhase = new Int8Array(STACK);
  let sp = 0;

  function put(sq, p) {
    board[sq] = p;
    hashLo ^= Z_LO[p * 128 + sq]; hashHi ^= Z_HI[p * 128 + sq];
    mg += MG[p][sq]; eg += EG[p][sq]; phase += PHASE_INC[p & 7];
    if ((p & 7) === KING) kingSq[p >> 3] = sq;
  }
  function take(sq) {
    const p = board[sq];
    board[sq] = 0;
    hashLo ^= Z_LO[p * 128 + sq]; hashHi ^= Z_HI[p * 128 + sq];
    mg -= MG[p][sq]; eg -= EG[p][sq]; phase -= PHASE_INC[p & 7];
  }
  function stateHash() {
    let lo = hashLo ^ Z_CASTLE_LO[castle], hi = hashHi ^ Z_CASTLE_HI[castle];
    if (ep >= 0) { lo ^= Z_EP_LO[ep & 7]; hi ^= Z_EP_HI[ep & 7]; }
    if (side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    return [lo, hi];
  }
  let curLo = 0, curHi = 0; // 含轮到谁、易位权、过路兵的完整哈希
  function refreshHash() {
    const h = stateHash();
    curLo = h[0]; curHi = h[1];
  }

  const LETTER = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };
  function setFen(fen) {
    const [placement, turn = 'w', rights = '-', epText = '-', halfText = '0'] = fen.trim().split(/\s+/);
    board.fill(0);
    hashLo = hashHi = mg = eg = phase = 0;
    placement.split('/').forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) c += Number(ch);
        else {
          const type = LETTER[ch.toLowerCase()];
          put(r * 16 + c, type | (ch === ch.toLowerCase() ? 8 : 0));
          c++;
        }
      }
    });
    side = turn === 'b' ? BLACK : WHITE;
    castle = (rights.includes('K') ? 1 : 0) | (rights.includes('Q') ? 2 : 0) | (rights.includes('k') ? 4 : 0) | (rights.includes('q') ? 8 : 0);
    ep = epText === '-' ? -1 : (8 - Number(epText[1])) * 16 + 'abcdefgh'.indexOf(epText[0]);
    half = Number(halfText) || 0;
    sp = 0;
    refreshHash();
  }

  // ---------- 攻击和走法生成 ----------
  function attacked(sq, by) {
    // 兵：白兵在 sq 的下方（行号大 1）斜着
    if (by === WHITE) {
      if (!((sq + 15) & 0x88) && board[sq + 15] === PAWN) return true;
      if (!((sq + 17) & 0x88) && board[sq + 17] === PAWN) return true;
    } else {
      if (!((sq - 15) & 0x88) && board[sq - 15] === (PAWN | 8)) return true;
      if (!((sq - 17) & 0x88) && board[sq - 17] === (PAWN | 8)) return true;
    }
    const c = by << 3;
    for (let i = 0; i < 8; i++) {
      const t = sq + N_DIRS[i];
      if (!(t & 0x88) && board[t] === (KNIGHT | c)) return true;
    }
    for (let i = 0; i < 8; i++) {
      const t = sq + K_DIRS[i];
      if (!(t & 0x88) && board[t] === (KING | c)) return true;
    }
    for (let i = 0; i < 4; i++) {
      const d = B_DIRS[i];
      let t = sq + d;
      while (!(t & 0x88)) {
        const p = board[t];
        if (p) {
          if (p === (BISHOP | c) || p === (QUEEN | c)) return true;
          break;
        }
        t += d;
      }
    }
    for (let i = 0; i < 4; i++) {
      const d = R_DIRS[i];
      let t = sq + d;
      while (!(t & 0x88)) {
        const p = board[t];
        if (p) {
          if (p === (ROOK | c) || p === (QUEEN | c)) return true;
          break;
        }
        t += d;
      }
    }
    return false;
  }

  const inCheck = () => attacked(kingSq[side], side ^ 1);

  // 生成不考虑送将的走法，写进 list[n..]，返回新的 n。noisy：只要吃子和升变
  function gen(list, n, noisy) {
    const us = side, them = us ^ 1, mine = us << 3;
    const up = us === WHITE ? -16 : 16;
    const startRow = us === WHITE ? 6 : 1, promoRow = us === WHITE ? 0 : 7;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = board[sq];
      if (!p || (p >> 3) !== us) continue;
      const type = p & 7;
      if (type === PAWN) {
        const t = sq + up;
        const row = t >> 4;
        if (!board[t]) {
          if (row === promoRow) {
            list[n++] = MOVE(sq, t, QUEEN, 0);
            if (!noisy) { list[n++] = MOVE(sq, t, KNIGHT, 0); list[n++] = MOVE(sq, t, ROOK, 0); list[n++] = MOVE(sq, t, BISHOP, 0); }
          } else if (!noisy) {
            list[n++] = MOVE(sq, t, 0, 0);
            if ((sq >> 4) === startRow && !board[t + up]) list[n++] = MOVE(sq, t + up, 0, F_DOUBLE);
          }
        }
        for (let k = -1; k <= 1; k += 2) {
          const x = t + k;
          if (x & 0x88) continue;
          const q = board[x];
          if (q && (q >> 3) === them) {
            if (row === promoRow) {
              list[n++] = MOVE(sq, x, QUEEN, 0);
              if (!noisy) { list[n++] = MOVE(sq, x, KNIGHT, 0); list[n++] = MOVE(sq, x, ROOK, 0); list[n++] = MOVE(sq, x, BISHOP, 0); }
            } else list[n++] = MOVE(sq, x, 0, 0);
          } else if (x === ep) list[n++] = MOVE(sq, x, 0, F_EP);
        }
      } else if (type === KNIGHT || type === KING) {
        const dirs = type === KNIGHT ? N_DIRS : K_DIRS;
        for (let i = 0; i < 8; i++) {
          const t = sq + dirs[i];
          if (t & 0x88) continue;
          const q = board[t];
          if (q ? (q >> 3) === them : !noisy) list[n++] = MOVE(sq, t, 0, 0);
        }
        if (type === KING && !noisy) {
          if (us === WHITE && sq === 0x74) {
            if ((castle & 1) && !board[0x75] && !board[0x76] && board[0x77] === ROOK
              && !attacked(0x74, them) && !attacked(0x75, them) && !attacked(0x76, them)) list[n++] = MOVE(0x74, 0x76, 0, F_CASTLE);
            if ((castle & 2) && !board[0x73] && !board[0x72] && !board[0x71] && board[0x70] === ROOK
              && !attacked(0x74, them) && !attacked(0x73, them) && !attacked(0x72, them)) list[n++] = MOVE(0x74, 0x72, 0, F_CASTLE);
          } else if (us === BLACK && sq === 0x04) {
            if ((castle & 4) && !board[0x05] && !board[0x06] && board[0x07] === (ROOK | 8)
              && !attacked(0x04, them) && !attacked(0x05, them) && !attacked(0x06, them)) list[n++] = MOVE(0x04, 0x06, 0, F_CASTLE);
            if ((castle & 8) && !board[0x03] && !board[0x02] && !board[0x01] && board[0x00] === (ROOK | 8)
              && !attacked(0x04, them) && !attacked(0x03, them) && !attacked(0x02, them)) list[n++] = MOVE(0x04, 0x02, 0, F_CASTLE);
          }
        }
      } else {
        const start = type === ROOK ? 4 : 0, end = type === BISHOP ? 4 : 8;
        for (let i = start; i < end; i++) {
          const d = i < 4 ? B_DIRS[i] : R_DIRS[i - 4];
          let t = sq + d;
          while (!(t & 0x88)) {
            const q = board[t];
            if (q) {
              if ((q >> 3) === them) list[n++] = MOVE(sq, t, 0, 0);
              break;
            }
            if (!noisy) list[n++] = MOVE(sq, t, 0, 0);
            t += d;
          }
        }
      }
    }
    return n;
  }

  // 走一步；送将的走法会自动撤回并返回 false
  function make(m) {
    const from = FROM(m), to = TO(m), flags = FLAGS(m), promo = PROMO(m);
    stMove[sp] = m; stCastle[sp] = castle; stEp[sp] = ep; stHalf[sp] = half;
    stLo[sp] = hashLo; stHi[sp] = hashHi; stMg[sp] = mg; stEg[sp] = eg; stPhase[sp] = phase;
    const p = board[from];
    let cap = board[to];
    if (flags & F_EP) {
      const capSq = side === WHITE ? to + 16 : to - 16;
      cap = board[capSq];
      take(capSq);
    } else if (cap) take(to);
    stCap[sp] = cap;
    take(from);
    put(to, promo ? (promo | (side << 3)) : p);
    if (flags & F_CASTLE) {
      if (to === 0x76) { take(0x77); put(0x75, ROOK); }
      else if (to === 0x72) { take(0x70); put(0x73, ROOK); }
      else if (to === 0x06) { take(0x07); put(0x05, ROOK | 8); }
      else { take(0x00); put(0x03, ROOK | 8); }
    }
    castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
    ep = flags & F_DOUBLE ? (from + to) >> 1 : -1;
    half = (p & 7) === PAWN || cap ? 0 : half + 1;
    side ^= 1;
    sp++;
    if (attacked(kingSq[side ^ 1], side)) {
      unmake();
      return false;
    }
    refreshHash();
    repLo[sp] = curLo; repHi[sp] = curHi;
    return true;
  }
  // 每一层的完整局面哈希，查重复局面用
  const repLo = new Int32Array(STACK), repHi = new Int32Array(STACK);

  function unmake() {
    sp--;
    const m = stMove[sp];
    const from = FROM(m), to = TO(m), flags = FLAGS(m);
    side ^= 1;
    const moved = PROMO(m) ? (PAWN | (side << 3)) : board[to];
    board[from] = moved;
    board[to] = 0;
    if ((moved & 7) === KING) kingSq[side] = from;
    const cap = stCap[sp];
    if (flags & F_EP) board[side === WHITE ? to + 16 : to - 16] = cap;
    else if (cap) board[to] = cap;
    if (flags & F_CASTLE) {
      if (to === 0x76) { board[0x77] = ROOK; board[0x75] = 0; }
      else if (to === 0x72) { board[0x70] = ROOK; board[0x73] = 0; }
      else if (to === 0x06) { board[0x07] = ROOK | 8; board[0x05] = 0; }
      else { board[0x00] = ROOK | 8; board[0x03] = 0; }
    }
    castle = stCastle[sp]; ep = stEp[sp]; half = stHalf[sp];
    hashLo = stLo[sp]; hashHi = stHi[sp]; mg = stMg[sp]; eg = stEg[sp]; phase = stPhase[sp];
    curLo = repLo[sp]; curHi = repHi[sp];
  }

  function makeNull() {
    stMove[sp] = 0; stCastle[sp] = castle; stEp[sp] = ep; stHalf[sp] = half;
    stLo[sp] = hashLo; stHi[sp] = hashHi; stMg[sp] = mg; stEg[sp] = eg; stPhase[sp] = phase;
    stCap[sp] = 0;
    ep = -1;
    half++;
    side ^= 1;
    sp++;
    refreshHash();
    repLo[sp] = curLo; repHi[sp] = curHi;
  }
  function unmakeNull() {
    sp--;
    side ^= 1;
    castle = stCastle[sp]; ep = stEp[sp]; half = stHalf[sp];
    curLo = repLo[sp]; curHi = repHi[sp];
  }

  // 现在的局面在之前出现过（只往回看到上一次吃子或动兵）
  function repeated() {
    const limit = Math.max(0, sp - half);
    for (let i = sp - 4; i >= limit; i -= 2) {
      if (repLo[i] === curLo && repHi[i] === curHi) return true;
    }
    return false;
  }

  // ---------- 估值（返回轮到走的一方的分数） ----------
  const wMax = new Int8Array(10), bMin = new Int8Array(10), wCount = new Int8Array(10), bCount = new Int8Array(10);
  function evaluate() {
    let m = mg, e = eg;
    wMax.fill(-1); bMin.fill(8); wCount.fill(0); bCount.fill(0);
    let wBishops = 0, bBishops = 0;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = board[sq];
      if (p === PAWN) {
        const f = (sq & 7) + 1, r = sq >> 4;
        wCount[f]++;
        if (r > wMax[f]) wMax[f] = r;
      } else if (p === (PAWN | 8)) {
        const f = (sq & 7) + 1, r = sq >> 4;
        bCount[f]++;
        if (r < bMin[f]) bMin[f] = r;
      } else if (p === BISHOP) wBishops++;
      else if (p === (BISHOP | 8)) bBishops++;
    }
    if (wBishops >= 2) { m += 30; e += 50; }
    if (bBishops >= 2) { m -= 30; e -= 50; }
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = board[sq];
      if (!p) continue;
      const type = p & 7, color = p >> 3, f = (sq & 7) + 1, r = sq >> 4;
      const sign = color === WHITE ? 1 : -1;
      if (type === PAWN) {
        const own = color === WHITE ? wCount : bCount;
        if (own[f - 1] === 0 && own[f + 1] === 0) { m -= 12 * sign; e -= 15 * sign; } // 孤兵
        if (own[f] > 1) { m -= 8 * sign; e -= 15 * sign; } // 叠兵（每个都扣一点）
        // 通路兵：前方和两边的列上没有对方的兵
        if (color === WHITE) {
          if (bMin[f - 1] >= r && bMin[f] >= r && bMin[f + 1] >= r) {
            const adv = 7 - r;
            m += PASSED_MG[adv]; e += PASSED_EG[adv];
          }
        } else if (wMax[f - 1] <= r && wMax[f] <= r && wMax[f + 1] <= r) {
          const adv = r;
          m -= PASSED_MG[adv]; e -= PASSED_EG[adv];
        }
      } else if (type === KNIGHT || type === BISHOP || type === ROOK || type === QUEEN) {
        // 灵活度：能走到的格子数
        let count = 0;
        if (type === KNIGHT) {
          for (let i = 0; i < 8; i++) {
            const t = sq + N_DIRS[i];
            if (!(t & 0x88) && (!board[t] || (board[t] >> 3) !== color)) count++;
          }
          m += sign * 4 * (count - 4); e += sign * 4 * (count - 4);
        } else {
          const start = type === ROOK ? 4 : 0, end = type === BISHOP ? 4 : 8;
          for (let i = start; i < end; i++) {
            const d = i < 4 ? B_DIRS[i] : R_DIRS[i - 4];
            let t = sq + d;
            while (!(t & 0x88)) {
              const q = board[t];
              if (q) {
                if ((q >> 3) !== color) count++;
                break;
              }
              count++;
              t += d;
            }
          }
          if (type === BISHOP) { m += sign * 5 * (count - 6); e += sign * 5 * (count - 6); }
          else if (type === ROOK) {
            m += sign * 2 * (count - 7); e += sign * 4 * (count - 7);
            const own = color === WHITE ? wCount : bCount, opp = color === WHITE ? bCount : wCount;
            if (!own[f]) { m += sign * (opp[f] ? 10 : 22); e += sign * (opp[f] ? 5 : 10); }
          } else { m += sign * (count - 13); e += sign * 2 * (count - 13); }
        }
      } else if (type === KING) {
        // 王前的兵（只在开局中局有用）
        let shield = 0;
        const dir = color === WHITE ? -16 : 16;
        const own = PAWN | (color << 3);
        for (let k = -1; k <= 1; k++) {
          const a = sq + dir + k, b = sq + 2 * dir + k;
          if (!(a & 0x88) && board[a] === own) shield += 12;
          else if (!(b & 0x88) && board[b] === own) shield += 6;
        }
        m += sign * shield;
      }
    }
    const ph = phase > 24 ? 24 : phase;
    let score = ((m * ph + e * (24 - ph)) / 24) | 0;
    // 残局：子力占优的一方把对方的王往边上赶，自己的王靠过去，好将杀
    if (ph <= 6) {
      const lead = score;
      if (Math.abs(lead) > 300) {
        const winner = lead > 0 ? WHITE : BLACK;
        const lk = kingSq[winner ^ 1], wk = kingSq[winner];
        const lr = lk >> 4, lc = lk & 7;
        const edge = Math.max(3 - lr, lr - 4) + Math.max(3 - lc, lc - 4);
        const dist = Math.abs((wk >> 4) - lr) + Math.abs((wk & 7) - lc);
        const bonus = edge * 12 + (14 - dist) * 4;
        score += winner === WHITE ? bonus : -bonus;
      }
    }
    score += side === WHITE ? 10 : -10; // 先手
    return side === WHITE ? score : -score;
  }

  function hasPieces(color) {
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = board[sq];
      if (p && (p >> 3) === color && (p & 7) !== PAWN && (p & 7) !== KING) return true;
    }
    return false;
  }

  // ---------- 置换表 ----------
  const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int16Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Uint8Array(TT_SIZE);
  const EXACT = 1, LOWER = 2, UPPER = 3;
  function ttStore(depth, flag, score, move, ply) {
    const i = curLo & TT_MASK;
    if (ttFlag[i] && ttKey[i] === curHi && ttDepth[i] > depth && flag !== EXACT) return;
    if (score > MATE_IN_MAX) score += ply;
    else if (score < -MATE_IN_MAX) score -= ply;
    ttKey[i] = curHi; ttMove[i] = move; ttScore[i] = score; ttDepth[i] = depth; ttFlag[i] = flag;
  }

  // ---------- 搜索 ----------
  const moveBuf = new Int32Array(MAX_PLY * 256);
  const scoreBuf = new Int32Array(MAX_PLY * 256);
  const killers = new Int32Array(MAX_PLY * 2);
  const historyTable = new Int32Array(16 * 128);
  let nodes = 0, deadline = 0, stopped = false;

  function orderMoves(base, n, ttm, ply) {
    const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    for (let i = base; i < n; i++) {
      const m = moveBuf[i];
      let s;
      if (m === ttm) s = 2000000;
      else {
        const victim = FLAGS(m) & F_EP ? PAWN : board[TO(m)] & 7;
        if (victim) s = 1000000 + victim * 16 - (board[FROM(m)] & 7);
        else if (PROMO(m) === QUEEN) s = 990000;
        else if (m === k1) s = 900000;
        else if (m === k2) s = 890000;
        else s = historyTable[board[FROM(m)] * 128 + TO(m)];
        if (PROMO(m) && PROMO(m) !== QUEEN) s = -100000;
      }
      scoreBuf[i] = s;
    }
  }
  // 从 i 到 n 里挑分最高的换到 i
  function pick(i, n) {
    let best = i;
    for (let j = i + 1; j < n; j++) if (scoreBuf[j] > scoreBuf[best]) best = j;
    if (best !== i) {
      const m = moveBuf[i]; moveBuf[i] = moveBuf[best]; moveBuf[best] = m;
      const s = scoreBuf[i]; scoreBuf[i] = scoreBuf[best]; scoreBuf[best] = s;
    }
    return moveBuf[i];
  }

  function tick() {
    if ((++nodes & 2047) === 0 && Date.now() >= deadline) stopped = true;
  }

  function quiesce(alpha, beta, ply) {
    tick();
    if (stopped) return 0;
    if (ply >= MAX_PLY - 1) return evaluate();
    const checked = inCheck();
    if (!checked) {
      const stand = evaluate();
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;
    }
    const base = ply * 256;
    const n = gen(moveBuf, base, !checked);
    orderMoves(base, n, 0, ply);
    let legal = 0;
    for (let i = base; i < n; i++) {
      const m = pick(i, n);
      if (!make(m)) continue;
      legal++;
      const score = -quiesce(-beta, -alpha, ply + 1);
      unmake();
      if (stopped) return 0;
      if (score > alpha) {
        alpha = score;
        if (score >= beta) return score;
      }
    }
    if (checked && !legal) return -MATE + ply;
    return alpha;
  }

  function search(depth, alpha, beta, ply, allowNull) {
    if (ply && (half >= 100 || repeated())) return 0;
    const checked = inCheck();
    if (checked) depth++;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    tick();
    if (stopped) return 0;
    if (ply >= MAX_PLY - 2) return evaluate();
    // 杀棋距离裁剪
    if (ply) {
      alpha = Math.max(alpha, -MATE + ply);
      beta = Math.min(beta, MATE - ply - 1);
      if (alpha >= beta) return alpha;
    }
    const pv = beta - alpha > 1;
    const ti = curLo & TT_MASK;
    let ttm = 0;
    if (ttFlag[ti] && ttKey[ti] === curHi) {
      ttm = ttMove[ti];
      if (!pv && ttDepth[ti] >= depth) {
        let s = ttScore[ti];
        if (s > MATE_IN_MAX) s -= ply;
        else if (s < -MATE_IN_MAX) s += ply;
        const f = ttFlag[ti];
        if (f === EXACT || (f === LOWER && s >= beta) || (f === UPPER && s <= alpha)) return s;
      }
    }
    // 空着裁剪：让对方连走两步还压不住，就不用细算了
    if (allowNull && !pv && !checked && depth >= 3 && hasPieces(side) && evaluate() >= beta) {
      makeNull();
      const score = -search(depth - 1 - (depth > 6 ? 3 : 2), -beta, -beta + 1, ply + 1, false);
      unmakeNull();
      if (stopped) return 0;
      if (score >= beta) return score > MATE_IN_MAX ? beta : score;
    }
    const base = ply * 256;
    const n = gen(moveBuf, base, false);
    orderMoves(base, n, ttm, ply);
    let best = -INF, bestMove = 0, legal = 0;
    const alpha0 = alpha;
    for (let i = base; i < n; i++) {
      const m = pick(i, n);
      const quiet = !board[TO(m)] && !(FLAGS(m) & F_EP) && !PROMO(m);
      if (!make(m)) continue;
      legal++;
      let score;
      if (legal === 1) score = -search(depth - 1, -beta, -alpha, ply + 1, true);
      else {
        let reduce = 0;
        if (depth >= 3 && legal > 3 && quiet && !checked && !inCheck()) {
          reduce = legal > 8 ? 2 : 1;
          if (pv) reduce--;
        }
        score = -search(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && reduce) score = -search(depth - 1, -alpha - 1, -alpha, ply + 1, true);
        if (score > alpha && score < beta) score = -search(depth - 1, -beta, -alpha, ply + 1, true);
      }
      unmake();
      if (stopped) return 0;
      if (score > best) {
        best = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (score >= beta) {
            if (quiet) {
              if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
              const h = board[FROM(m)] * 128 + TO(m);
              historyTable[h] += depth * depth;
              if (historyTable[h] > 800000) for (let j = 0; j < historyTable.length; j++) historyTable[j] >>= 1;
            }
            break;
          }
        }
      }
    }
    if (!legal) return checked ? -MATE + ply : 0;
    ttStore(depth, best >= beta ? LOWER : best > alpha0 ? EXACT : UPPER, best, bestMove, ply);
    return best;
  }

  // ---------- 和外面打交道 ----------
  const SQ_NAME = sq => 'abcdefgh'[sq & 7] + (8 - (sq >> 4));
  const PROMO_LETTER = ['', '', 'n', 'b', 'r', 'q'];
  function uci(m) {
    return SQ_NAME(FROM(m)) + SQ_NAME(TO(m)) + PROMO_LETTER[PROMO(m)];
  }
  function legalList() {
    const n = gen(moveBuf, 0, false);
    const out = [];
    for (let i = 0; i < n; i++) {
      const m = moveBuf[i];
      if (make(m)) { unmake(); out.push(m); }
    }
    return out;
  }
  function playUci(text) {
    const m = legalList().find(x => uci(x) === text);
    if (m === undefined || !make(m)) throw new Error(`走法不合法：${text}`);
  }
  function setup(fen, moves) {
    setFen(fen || START_FEN);
    repLo[0] = curLo; repHi[0] = curHi;
    for (const text of moves || []) {
      playUci(text);
      if (sp >= STACK - MAX_PLY - 10) {
        // 很长的对局：只保留最近的局面（重复局面只看到上一次吃子或动兵为止）
        const keep = Math.min(sp, 200);
        repLo.copyWithin(0, sp - keep, sp + 1); repHi.copyWithin(0, sp - keep, sp + 1);
        sp = keep;
      }
    }
  }

  // 开局库：几条常见的主线，前几步随机挑一条走，每盘不一样
  const BOOK = [
    'e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1 f8e7 f1e1 b7b5 a4b3 d7d6 c2c3 e8g8',
    'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6 d4e5 d6f5',
    'e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8',
    'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d3 f8e7 e1g1 e8g8 f1e1 d7d6',
    'e2e4 e7e5 g1f3 b8c6 d2d4 e5d4 f3d4 g8f6 d4c6 b7c6 e4e5 d8e7',
    'e2e4 e7e5 g1f3 g8f6 f3e5 d7d6 e5f3 f6e4 d2d4 d6d5 f1d3 b8c6',
    'e2e4 c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6 c1e3 e7e5 d4b3 c8e6',
    'e2e4 c7c5 g1f3 b8c6 d2d4 c5d4 f3d4 g8f6 b1c3 e7e5 d4b5 d7d6',
    'e2e4 c7c5 g1f3 e7e6 d2d4 c5d4 f3d4 b8c6 b1c3 d8c7',
    'e2e4 c7c5 b1c3 b8c6 g2g3 g7g6 f1g2 f8g7 d2d3 d7d6',
    'e2e4 e7e6 d2d4 d7d5 b1c3 g8f6 c1g5 f8e7 e4e5 f6d7 g5e7 d8e7',
    'e2e4 e7e6 d2d4 d7d5 e4e5 c7c5 c2c3 b8c6 g1f3 d8b6',
    'e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 c8f5 e4g3 f5g6 h2h4 h7h6',
    'e2e4 c7c6 d2d4 d7d5 e4e5 c8f5 g1f3 e7e6 f1e2 c6c5',
    'e2e4 d7d5 e4d5 d8d5 b1c3 d5a5 d2d4 g8f6 g1f3 c7c6',
    'e2e4 d7d6 d2d4 g8f6 b1c3 g7g6 g1f3 f8g7 f1e2 e8g8 e1g1',
    'd2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7 e2e3 e8g8 g1f3 h7h6',
    'd2d4 d7d5 c2c4 c7c6 g1f3 g8f6 b1c3 d5c4 a2a4 c8f5 e2e3 e7e6',
    'd2d4 d7d5 c2c4 d5c4 g1f3 g8f6 e2e3 e7e6 f1c4 c7c5 e1g1 a7a6',
    'd2d4 g8f6 c2c4 g7g6 b1c3 f8g7 e2e4 d7d6 g1f3 e8g8 f1e2 e7e5',
    'd2d4 g8f6 c2c4 e7e6 b1c3 f8b4 e2e3 e8g8 f1d3 d7d5 g1f3 c7c5',
    'd2d4 g8f6 c2c4 e7e6 g1f3 b7b6 g2g3 c8b7 f1g2 f8e7 e1g1 e8g8',
    'd2d4 g8f6 c2c4 g7g6 b1c3 d7d5 c4d5 f6d5 e2e4 d5c3 b2c3 f8g7',
    'd2d4 d7d5 g1f3 g8f6 c1f4 e7e6 e2e3 c7c5 c2c3 b8c6',
    'c2c4 e7e5 b1c3 g8f6 g1f3 b8c6 g2g3 d7d5 c4d5 f6d5 f1g2 d5b6',
    'c2c4 g8f6 b1c3 e7e6 e2e4 d7d5 e4e5 d5d4',
    'g1f3 d7d5 g2g3 g8f6 f1g2 e7e6 e1g1 f8e7 d2d3 e8g8',
  ].map(line => line.split(' '));

  function bookMove(fen, moves, random) {
    if (fen && fen.split(' ')[0] !== START_FEN.split(' ')[0]) return null;
    const done = moves || [];
    const options = [];
    for (const line of BOOK) {
      if (line.length <= done.length) continue;
      if (done.every((m, i) => line[i] === m)) options.push(line[done.length]);
    }
    if (!options.length) return null;
    return options[Math.floor(random() * options.length)];
  }

  // 五档难度：
  //   入门：只看一步（再把吃子吃完），分数加很大的随机偏差，三成走法是随手走的
  //   业余：看两步，随机偏差小一些
  //   高手：最多算 4 层，每步不超过 0.4 秒
  //   大师：最多算 6 层，每步不超过 1 秒
  //   特级大师：每步 4 秒
  const LEVELS = [
    { name: '入门', depth: 1, noise: 220, careless: 0.3, book: false },
    { name: '业余', depth: 2, noise: 70, careless: 0, book: true },
    { name: '高手', maxDepth: 4, timeMs: 400, book: true },
    { name: '大师', maxDepth: 6, timeMs: 1000, book: true },
    { name: '特级大师', timeMs: 4000, book: true },
  ];

  // 固定深度，算出每一步的准确分数，加随机偏差挑一步（低档用）
  function noisyPick(depth, noise, careless, random) {
    const moves = legalList();
    if (!moves.length) return null;
    if (careless && random() < careless) {
      const m = moves[Math.floor(random() * moves.length)];
      return { move: m, score: 0, depth: 0 };
    }
    deadline = Infinity;
    stopped = false;
    let best = null, bestNoisy = -Infinity, bestScore = 0;
    for (const m of moves) {
      make(m);
      const score = depth <= 1 ? -quiesce(-INF, INF, 1) : -search(depth - 1, -INF, INF, 1, true);
      unmake();
      const noisy = score + (random() * 2 - 1) * noise;
      if (noisy > bestNoisy) { bestNoisy = noisy; best = m; bestScore = score; }
    }
    return { move: best, score: bestScore, depth };
  }

  // 按时间迭代加深
  function deepen(timeMs, maxDepth, onInfo) {
    const start = Date.now();
    deadline = start + timeMs;
    stopped = false;
    const rootMoves = legalList();
    if (!rootMoves.length) return null;
    // 先按吃子粗排，作为保底
    const order = rootMoves.map(m => ({ m, s: board[TO(m)] ? 100 * (board[TO(m)] & 7) - (board[FROM(m)] & 7) : 0 }));
    order.sort((a, b) => b.s - a.s);
    let bestMove = order[0].m, bestScore = 0, depthDone = 0;
    if (rootMoves.length === 1) return { move: bestMove, score: 0, depth: 0 };
    killers.fill(0);
    for (let i = 0; i < historyTable.length; i++) historyTable[i] >>= 3;
    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -INF, iterBest = 0, iterScore = -INF;
      for (let k = 0; k < order.length; k++) {
        const m = order[k].m;
        make(m);
        let score;
        if (k === 0) score = -search(depth - 1, -INF, -alpha, 1, true);
        else {
          score = -search(depth - 1, -alpha - 1, -alpha, 1, true);
          if (score > alpha && !stopped) score = -search(depth - 1, -INF, -alpha, 1, true);
        }
        unmake();
        if (stopped) break;
        order[k].s = score;
        if (score > alpha) {
          alpha = score;
          iterBest = m;
          iterScore = score;
          // 一层没搜完就到时间了：已经证明比上一层的最好走法更好的，也可以用
          if (k > 0) { bestMove = m; bestScore = score; }
        }
      }
      if (stopped) break;
      bestMove = iterBest;
      bestScore = iterScore;
      depthDone = depth;
      // 下一层先搜最好的，其余按这一层的分数排
      for (const o of order) if (o.m !== iterBest) o.s = Math.min(o.s, iterScore - 1);
      order.sort((a, b) => b.s - a.s);
      if (onInfo) onInfo({ move: uci(bestMove), score: bestScore, depth, nodes, ms: Date.now() - start });
      if (Math.abs(bestScore) > MATE_IN_MAX && depth >= MATE - Math.abs(bestScore)) break; // 找到最快的杀了
      if (Date.now() - start > timeMs * 0.55) break; // 下一层多半搜不完，省下时间
    }
    return { move: bestMove, score: bestScore, depth: depthDone };
  }

  // o: { fen, moves, level (0–4) 或 timeMs / maxDepth / depth / noise，random, onInfo, book }
  function think(o) {
    const start = Date.now();
    const random = o.random || Math.random;
    const level = typeof o.level === 'number' ? LEVELS[Math.max(0, Math.min(LEVELS.length - 1, o.level))] : {};
    const cfg = Object.assign({}, level);
    for (const key of Object.keys(o)) if (o[key] !== undefined) cfg[key] = o[key];
    setup(cfg.fen, cfg.moves);
    nodes = 0;
    const useBook = cfg.book !== false && (cfg.book || level.book);
    if (useBook) {
      const book = bookMove(cfg.fen, cfg.moves, random);
      if (book) return { move: book, score: 0, depth: 0, nodes: 0, ms: Date.now() - start, book: true };
    }
    let result;
    if (cfg.noise !== undefined || (cfg.depth && !cfg.timeMs)) result = noisyPick(cfg.depth || 1, cfg.noise || 0, cfg.careless || 0, random);
    else result = deepen(cfg.timeMs || 1000, cfg.maxDepth || 60, cfg.onInfo);
    if (!result) return null;
    return { move: uci(result.move), score: result.score, depth: result.depth, nodes, ms: Date.now() - start };
  }

  // 走法计数，测试走法生成用
  function perft(fen, depth) {
    setup(fen, []);
    const walk = d => {
      if (d === 0) return 1;
      const base = d * 256;
      const n = gen(moveBuf, base, false);
      let total = 0;
      for (let i = base; i < n; i++) {
        if (!make(moveBuf[i])) continue;
        total += walk(d - 1);
        unmake();
      }
      return total;
    };
    return walk(depth);
  }

  function legalMoves(fen, moves) {
    setup(fen, moves);
    return legalList().map(uci);
  }

  function evaluateFen(fen) {
    setup(fen, []);
    return evaluate();
  }

  const api = { think, perft, legalMoves, evaluate: evaluateFen, LEVELS, BOOK, START_FEN };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.ChessEngine = api;
  } else if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = e => {
      const d = e.data;
      let result = null;
      try {
        result = think({
          fen: d.fen, moves: d.moves, level: d.level, timeMs: d.timeMs,
          onInfo: info => self.postMessage(Object.assign({ type: 'info', id: d.id }, info)),
        });
      } catch (err) {
        result = null;
      }
      self.postMessage(Object.assign({ type: 'done', id: d.id }, result || { move: null }));
    };
  }
})();
