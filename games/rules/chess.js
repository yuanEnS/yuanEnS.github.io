// 国际象棋规则：8×8 棋盘，白先。包括王车易位、吃过路兵、兵升变，
// 以及将死、逼和、三次重复、五十步、子力不足这几种结束方式。
// board[r][c]：'' 空；白方大写 PNBRQK，黑方小写 pnbrqk。第 0 行是第 8 横线（黑方底线），第 7 行是第 1 横线。
// 走法是 { from: [行, 列], to: [行, 列], promo: 'q' | 'r' | 'b' | 'n'（只有升变时有） }。
// 网页（yuanens.com/games/rules/）用这一份：改了要运行 node tools/copy-rules.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const FILES = 'abcdefgh';
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const LINE = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const NAMES = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
  // 五十步：双方合计 100 步（各 50 步）没有吃子、没有动兵
  const FIFTY_LIMIT = 100;

  const other = side => (side === 'w' ? 'b' : 'w');
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sideOf = p => (p ? (p === p.toUpperCase() ? 'w' : 'b') : '');
  const kindOf = p => p.toLowerCase();
  const square = (r, c) => FILES[c] + (8 - r); // [6, 4] → 'e2'
  const parseSquare = s => [8 - Number(s[1]), FILES.indexOf(s[0])];

  // (r, c) 是否被 by 方攻击（不管格子上有没有子）
  function attacked(board, r, c, by) {
    const up = by === 'w' ? 1 : -1; // 白兵从下往上走，所以攻击它上方的格子：兵在 (r+1, c±1)
    const pawn = by === 'w' ? 'P' : 'p';
    for (const dc of [-1, 1]) {
      const rr = r + up, cc = c + dc;
      if (inside(rr, cc) && board[rr][cc] === pawn) return true;
    }
    const knight = by === 'w' ? 'N' : 'n';
    for (const [dr, dc] of KNIGHT) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[rr][cc] === knight) return true;
    }
    const king = by === 'w' ? 'K' : 'k';
    for (const [dr, dc] of KING) {
      const rr = r + dr, cc = c + dc;
      if (inside(rr, cc) && board[rr][cc] === king) return true;
    }
    const slide = (dirs, kinds) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (inside(rr, cc)) {
          const p = board[rr][cc];
          if (p) {
            if (sideOf(p) === by && kinds.includes(kindOf(p))) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
      return false;
    };
    return slide(DIAG, 'bq') || slide(LINE, 'rq');
  }

  function findKing(board, side) {
    const king = side === 'w' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === king) return [r, c];
    return null;
  }

  function inCheck(board, side) {
    const k = findKing(board, side);
    return !!k && attacked(board, k[0], k[1], other(side));
  }

  // 局面：board、turn、castling（'KQkq' 的子集）、ep（可以吃过路兵的落点 [行, 列]，或 null）、
  // half（五十步计数）、full（回合数）
  function parseFen(fen) {
    const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
    const board = placement.split('/').map(row => {
      const cells = [];
      for (const ch of row) {
        if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push('');
        else cells.push(ch);
      }
      return cells;
    });
    if (board.length !== 8 || board.some(row => row.length !== 8)) throw new Error(`FEN 不对：${fen}`);
    return {
      board, turn, castling: castling === '-' ? '' : castling,
      ep: ep === '-' ? null : parseSquare(ep), half: Number(half), full: Number(full),
    };
  }

  function placementOf(board) {
    return board.map(row => {
      let out = '', empty = 0;
      for (const p of row) {
        if (!p) empty++;
        else {
          if (empty) out += empty;
          empty = 0;
          out += p;
        }
      }
      return out + (empty || '');
    }).join('/');
  }

  // 不考虑会不会送将的走法
  function pseudoMoves(pos, onlyFrom) {
    const { board, turn, castling, ep } = pos;
    const list = [];
    const forward = turn === 'w' ? -1 : 1;
    const startRow = turn === 'w' ? 6 : 1;
    const lastRow = turn === 'w' ? 0 : 7;
    const add = (r, c, rr, cc, extra) => {
      if (rr === lastRow && kindOf(board[r][c]) === 'p') {
        for (const promo of 'qrbn') list.push(Object.assign({ from: [r, c], to: [rr, cc], promo }, extra));
      } else {
        list.push(Object.assign({ from: [r, c], to: [rr, cc] }, extra));
      }
    };
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p || sideOf(p) !== turn) continue;
        if (onlyFrom && (onlyFrom[0] !== r || onlyFrom[1] !== c)) continue;
        const kind = kindOf(p);
        if (kind === 'p') {
          const r1 = r + forward;
          if (inside(r1, c) && !board[r1][c]) {
            add(r, c, r1, c);
            const r2 = r + 2 * forward;
            if (r === startRow && !board[r2][c]) add(r, c, r2, c, { double: true });
          }
          for (const dc of [-1, 1]) {
            const cc = c + dc;
            if (!inside(r1, cc)) continue;
            const target = board[r1][cc];
            if (target && sideOf(target) !== turn) add(r, c, r1, cc);
            else if (!target && ep && ep[0] === r1 && ep[1] === cc) add(r, c, r1, cc, { ep: true });
          }
        } else if (kind === 'n' || kind === 'k') {
          for (const [dr, dc] of kind === 'n' ? KNIGHT : KING) {
            const rr = r + dr, cc = c + dc;
            if (inside(rr, cc) && sideOf(board[rr][cc]) !== turn) add(r, c, rr, cc);
          }
          if (kind === 'k') {
            // 王车易位：王和车都没动过（还有易位权），中间是空的，王不在被将军、不经过也不停在被攻击的格子上
            const home = turn === 'w' ? 7 : 0;
            const enemy = other(turn);
            const [kingSide, queenSide] = turn === 'w' ? ['K', 'Q'] : ['k', 'q'];
            const rook = turn === 'w' ? 'R' : 'r';
            if (r === home && c === 4 && !attacked(board, home, 4, enemy)) {
              if (castling.includes(kingSide) && board[home][7] === rook && !board[home][5] && !board[home][6]
                && !attacked(board, home, 5, enemy) && !attacked(board, home, 6, enemy)) {
                add(r, c, home, 6, { castle: 'k' });
              }
              if (castling.includes(queenSide) && board[home][0] === rook && !board[home][1] && !board[home][2] && !board[home][3]
                && !attacked(board, home, 3, enemy) && !attacked(board, home, 2, enemy)) {
                add(r, c, home, 2, { castle: 'q' });
              }
            }
          }
        } else {
          const dirs = kind === 'b' ? DIAG : kind === 'r' ? LINE : DIAG.concat(LINE);
          for (const [dr, dc] of dirs) {
            let rr = r + dr, cc = c + dc;
            while (inside(rr, cc)) {
              const target = board[rr][cc];
              if (target) {
                if (sideOf(target) !== turn) add(r, c, rr, cc);
                break;
              }
              add(r, c, rr, cc);
              rr += dr;
              cc += dc;
            }
          }
        }
      }
    }
    return list;
  }

  // 在 pos 上走一步（改 pos），返回撤销用的信息
  function makeMove(pos, m) {
    const { board } = pos;
    const [r, c] = m.from, [rr, cc] = m.to;
    const piece = board[r][c];
    const undo = {
      move: m, piece, captured: board[rr][cc], castling: pos.castling, ep: pos.ep, half: pos.half, full: pos.full, epSquare: null,
    };
    board[rr][cc] = m.promo ? (pos.turn === 'w' ? m.promo.toUpperCase() : m.promo) : piece;
    board[r][c] = '';
    if (m.ep) {
      undo.epSquare = [r, cc];
      undo.captured = board[r][cc];
      board[r][cc] = '';
    }
    if (m.castle) {
      const [rookFrom, rookTo] = m.castle === 'k' ? [7, 5] : [0, 3];
      board[r][rookTo] = board[r][rookFrom];
      board[r][rookFrom] = '';
    }
    // 易位权：王动了两边都没了；车离开角落、或者角落上的车被吃掉，那一边就没了
    let rights = pos.castling;
    const drop = s => (rights = rights.replace(s, ''));
    if (piece === 'K') { drop('K'); drop('Q'); }
    if (piece === 'k') { drop('k'); drop('q'); }
    for (const [sr, sc] of [[r, c], [rr, cc]]) {
      if (sr === 7 && sc === 7) drop('K');
      if (sr === 7 && sc === 0) drop('Q');
      if (sr === 0 && sc === 7) drop('k');
      if (sr === 0 && sc === 0) drop('q');
    }
    pos.castling = rights;
    pos.ep = m.double ? [(r + rr) / 2, c] : null;
    pos.half = kindOf(piece) === 'p' || undo.captured ? 0 : pos.half + 1;
    if (pos.turn === 'b') pos.full++;
    pos.turn = other(pos.turn);
    return undo;
  }

  function unmakeMove(pos, undo) {
    const { board } = pos;
    const m = undo.move;
    const [r, c] = m.from, [rr, cc] = m.to;
    board[r][c] = undo.piece;
    board[rr][cc] = m.ep ? '' : undo.captured;
    if (m.ep) board[undo.epSquare[0]][undo.epSquare[1]] = undo.captured;
    if (m.castle) {
      const [rookFrom, rookTo] = m.castle === 'k' ? [7, 5] : [0, 3];
      board[r][rookFrom] = board[r][rookTo];
      board[r][rookTo] = '';
    }
    pos.castling = undo.castling;
    pos.ep = undo.ep;
    pos.half = undo.half;
    pos.full = undo.full;
    pos.turn = other(pos.turn);
  }

  function legalMoves(pos, onlyFrom) {
    const side = pos.turn;
    return pseudoMoves(pos, onlyFrom).filter(m => {
      const undo = makeMove(pos, m);
      const ok = !inCheck(pos.board, side);
      unmakeMove(pos, undo);
      return ok;
    });
  }

  // 走法计数（perft）：从局面往下走 depth 步，一共有多少种走法序列。用来和公认的数字对照，检查走法生成
  function perft(pos, depth) {
    if (depth === 0) return 1;
    const moves = legalMoves(pos);
    if (depth === 1) return moves.length;
    let total = 0;
    for (const m of moves) {
      const undo = makeMove(pos, m);
      total += perft(pos, depth - 1);
      unmakeMove(pos, undo);
    }
    return total;
  }

  // 子力不足，谁都不可能将死对方：王对王、王单象对王、王单马对王、双方只剩同色格的象
  function insufficient(board) {
    const minors = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || kindOf(p) === 'k') continue;
      if ('pqr'.includes(kindOf(p))) return false;
      minors.push({ kind: kindOf(p), shade: (r + c) % 2 });
    }
    if (minors.length <= 1) return true;
    return minors.every(m => m.kind === 'b') && minors.every(m => m.shade === minors[0].shade);
  }

  const sameMove = (a, b) => a.from[0] === b.from[0] && a.from[1] === b.from[1] && a.to[0] === b.to[0] && a.to[1] === b.to[1]
    && (a.promo || '') === (b.promo || '');

  // 'e2e4'、'e7e8q' 这种写法（UCI）
  function uci(m) {
    return square(m.from[0], m.from[1]) + square(m.to[0], m.to[1]) + (m.promo || '');
  }

  class Game {
    constructor(fen) {
      this.reset(fen);
    }

    reset(fen) {
      this.startFen = fen || START_FEN;
      this.pos = parseFen(this.startFen);
      this.history = []; // 每步：{ move, undo, san, key }
      this.keys = [this.positionKey()];
      this.winner = null; // 'w' / 'b' / 'draw'
      this.reason = null; // mate 将死 / stalemate 逼和 / repetition 三次重复 / fifty 五十步 / material 子力不足 / resign / left
      this.checkEnd();
    }

    get board() { return this.pos.board; }
    get turn() { return this.pos.turn; }
    get lastMove() {
      const last = this.history[this.history.length - 1];
      return last ? last.move : null;
    }

    fen() {
      const { pos } = this;
      return [placementOf(pos.board), pos.turn, pos.castling || '-', pos.ep ? square(pos.ep[0], pos.ep[1]) : '-', pos.half, pos.full].join(' ');
    }

    // 判断「同一局面」用：棋子位置、轮到谁、易位权，以及真的能吃过路兵时的那个格子
    positionKey() {
      const { pos } = this;
      let ep = '-';
      if (pos.ep && legalMoves(pos).some(m => m.ep)) ep = square(pos.ep[0], pos.ep[1]);
      return `${placementOf(pos.board)} ${pos.turn} ${pos.castling || '-'} ${ep}`;
    }

    legalMoves(from) {
      return this.winner ? [] : legalMoves(this.pos, from);
    }

    // 从 from 能走到的格子（升变的四种只算一个格子）
    targets(r, c) {
      const seen = new Set();
      const out = [];
      for (const m of this.legalMoves([r, c])) {
        const k = m.to[0] * 8 + m.to[1];
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(m.to);
      }
      return out;
    }

    // 把 { from, to, promo } 对应到一个合法走法（带上易位、过路兵等标记），不合法返回 null
    find(move) {
      if (!move || !move.from || !move.to || this.winner) return null;
      const promo = move.promo || '';
      return this.legalMoves(move.from).find(m => sameMove(m, { from: move.from, to: move.to, promo })) || null;
    }

    canMove(move) {
      return !!this.find(move);
    }

    inCheck() {
      return inCheck(this.pos.board, this.pos.turn);
    }

    move(move) {
      const m = typeof move === 'string' ? this.fromUci(move) : this.find(move);
      if (!m) return false;
      const san = this.san(m);
      const undo = makeMove(this.pos, m);
      this.history.push({ move: m, undo, san });
      this.keys.push(this.positionKey());
      this.checkEnd();
      if (this.reason === 'mate') this.history[this.history.length - 1].san = san.replace(/\+$/, '#');
      return true;
    }

    undo() {
      const last = this.history.pop();
      if (!last) return false;
      unmakeMove(this.pos, last.undo);
      this.keys.pop();
      this.winner = null;
      this.reason = null;
      return true;
    }

    end(winner, reason) {
      this.winner = winner;
      this.reason = reason;
    }

    fromUci(text) {
      const m = /^([a-h][1-8])([a-h][1-8])([qrbn]?)$/.exec(text);
      if (!m) return null;
      return this.find({ from: parseSquare(m[1]), to: parseSquare(m[2]), promo: m[3] || undefined });
    }

    // 现在这个局面已经出现过几次（包括现在）
    repetitions() {
      const key = this.keys[this.keys.length - 1];
      return this.keys.filter(k => k === key).length;
    }

    checkEnd() {
      const { pos } = this;
      if (!legalMoves(pos).length) {
        if (inCheck(pos.board, pos.turn)) this.end(other(pos.turn), 'mate');
        else this.end('draw', 'stalemate');
      } else if (insufficient(pos.board)) this.end('draw', 'material');
      else if (this.repetitions() >= 3) this.end('draw', 'repetition');
      else if (pos.half >= FIFTY_LIMIT) this.end('draw', 'fifty');
    }

    // 标准代数记谱（SAN），比如 Nf3、exd5、O-O、e8=Q+
    san(m) {
      const { pos } = this;
      const piece = pos.board[m.from[0]][m.from[1]];
      const kind = kindOf(piece);
      let text;
      if (m.castle) text = m.castle === 'k' ? 'O-O' : 'O-O-O';
      else {
        const capture = !!pos.board[m.to[0]][m.to[1]] || m.ep;
        const to = square(m.to[0], m.to[1]);
        if (kind === 'p') {
          text = (capture ? `${FILES[m.from[1]]}x` : '') + to + (m.promo ? `=${m.promo.toUpperCase()}` : '');
        } else {
          // 同种棋子也能走到这一格时，写上出发的列或行
          const rivals = legalMoves(pos).filter(o => o.to[0] === m.to[0] && o.to[1] === m.to[1]
            && pos.board[o.from[0]][o.from[1]] === piece && (o.from[0] !== m.from[0] || o.from[1] !== m.from[1]));
          let hint = '';
          if (rivals.length) {
            if (!rivals.some(o => o.from[1] === m.from[1])) hint = FILES[m.from[1]];
            else if (!rivals.some(o => o.from[0] === m.from[0])) hint = String(8 - m.from[0]);
            else hint = square(m.from[0], m.from[1]);
          }
          text = kind.toUpperCase() + hint + (capture ? 'x' : '') + to;
        }
      }
      const undo = makeMove(pos, m);
      if (inCheck(pos.board, pos.turn)) text += '+';
      unmakeMove(pos, undo);
      return text;
    }
  }

  return {
    START_FEN, FIFTY_LIMIT, NAMES, FILES, Game, other, sideOf, kindOf, square, parseSquare,
    parseFen, placementOf, legalMoves, makeMove, unmakeMove, perft, attacked, inCheck, insufficient, uci,
  };
});
