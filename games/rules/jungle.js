// 斗兽棋规则：7 列 9 行。红方在下、蓝方在上，红先。每方八只动物，大的吃小的：
// 象 8 > 狮 7 > 虎 6 > 豹 5 > 狼 4 > 狗 3 > 猫 2 > 鼠 1，同级可以互吃；鼠能吃象，象不能吃鼠。
// 每次走一格（上下左右）。只有鼠能下河；鼠在河里不能吃岸上的子，岸上的子也吃不到河里的鼠。
// 狮、虎能横着或竖着跳过河，河里有鼠挡着就不能跳。
// 走进对方的陷阱，就谁都能吃它；不能走进自己的兽穴。走进对方兽穴、吃光对方、或对方无路可走就赢。
// 双方连续 100 步（各 50 步）都没吃子就算和棋。
// board[r][c]：null 或 { side: 'r' | 'b', rank: 1–8 }。走法是 [[行, 列], [行, 列]]。
// 服务器（server/lobby.js）和网页（gamesyuan.com/games/rules/）共用这一份：改了要运行 node tools/copy-rules.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Jungle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROWS = 9;
  const COLS = 7;
  const NAMES = ['', '鼠', '猫', '狗', '狼', '豹', '虎', '狮', '象'];
  const QUIET_LIMIT = 100;
  const other = side => (side === 'r' ? 'b' : 'r');
  const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const DEN = { r: [8, 3], b: [0, 3] }; // 各自的兽穴
  const TRAPS = { r: [[8, 2], [8, 4], [7, 3]], b: [[0, 2], [0, 4], [1, 3]] }; // 各自家门口的陷阱
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];

  function isWater(r, c) {
    return r >= 3 && r <= 5 && (c === 1 || c === 2 || c === 4 || c === 5);
  }
  function isDen(r, c) {
    return (r === 0 || r === 8) && c === 3;
  }
  // 这一格是哪一方的陷阱
  function trapOwner(r, c) {
    for (const side of ['r', 'b']) if (TRAPS[side].some(t => t[0] === r && t[1] === c)) return side;
    return null;
  }

  function startBoard() {
    const board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const put = (r, c, side, rank) => (board[r][c] = { side, rank });
    // 蓝方（上）
    put(0, 0, 'b', 7); put(0, 6, 'b', 6);
    put(1, 1, 'b', 3); put(1, 5, 'b', 2);
    put(2, 0, 'b', 1); put(2, 2, 'b', 5); put(2, 4, 'b', 4); put(2, 6, 'b', 8);
    // 红方（下），和蓝方中心对称
    put(8, 6, 'r', 7); put(8, 0, 'r', 6);
    put(7, 5, 'r', 3); put(7, 1, 'r', 2);
    put(6, 6, 'r', 1); put(6, 4, 'r', 5); put(6, 2, 'r', 4); put(6, 0, 'r', 8);
    return board;
  }

  // 站在 (r, c) 的这只动物现在算多大：掉进对方陷阱就是 0
  function power(piece, r, c) {
    const owner = trapOwner(r, c);
    return owner && owner !== piece.side ? 0 : piece.rank;
  }

  function canCapture(board, from, to) {
    const attacker = board[from[0]][from[1]];
    const target = board[to[0]][to[1]];
    if (!target || target.side === attacker.side) return false;
    const fromWater = isWater(from[0], from[1]);
    const toWater = isWater(to[0], to[1]);
    if (fromWater !== toWater) return false; // 河里和岸上互相吃不到
    if (power(target, to[0], to[1]) === 0) return true;
    if (attacker.rank === 1 && target.rank === 8) return !fromWater;
    if (attacker.rank === 8 && target.rank === 1) return false;
    return attacker.rank >= target.rank;
  }

  // 一只动物所有能到的格子
  function targets(board, r, c) {
    const piece = board[r][c];
    if (!piece) return [];
    const list = [];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      let rr = r + dr, cc = c + dc;
      if (!inside(rr, cc)) continue;
      if (isWater(rr, cc)) {
        if (piece.rank === 1) {
          // 鼠下河
        } else if (piece.rank === 6 || piece.rank === 7) {
          // 狮虎跳河：一路是水，中间不能有鼠
          let blocked = false;
          while (inside(rr, cc) && isWater(rr, cc)) {
            if (board[rr][cc]) blocked = true;
            rr += dr;
            cc += dc;
          }
          if (blocked || !inside(rr, cc)) continue;
        } else {
          continue;
        }
      }
      const [dr0, dc0] = DEN[piece.side];
      if (rr === dr0 && cc === dc0) continue; // 不进自己的兽穴
      const target = board[rr][cc];
      if (target && !canCapture(board, [r, c], [rr, cc])) continue;
      list.push([rr, cc]);
    }
    return list;
  }

  function movesFor(board, side) {
    const list = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const piece = board[r][c];
        if (piece && piece.side === side) for (const to of targets(board, r, c)) list.push([[r, c], to]);
      }
    }
    return list;
  }

  class Game {
    constructor() {
      this.reset();
    }

    reset() {
      this.board = startBoard();
      this.turn = 'r';
      this.history = []; // { from, to, captured, quiet }
      this.lastMove = null;
      this.quiet = 0; // 连续多少步没吃子
      this.winner = null; // 'r' | 'b' | 'draw'
      this.reason = null; // den | wipe | stuck | quiet | resign | left
    }

    legalMoves() {
      return this.winner ? [] : movesFor(this.board, this.turn);
    }

    canMove(move) {
      if (this.winner || !Array.isArray(move) || move.length !== 2) return false;
      const [from, to] = move;
      if (!Array.isArray(from) || !Array.isArray(to)) return false;
      if (![...from, ...to].every(Number.isInteger) || !inside(from[0], from[1])) return false;
      const piece = this.board[from[0]][from[1]];
      if (!piece || piece.side !== this.turn) return false;
      return targets(this.board, from[0], from[1]).some(t => same(t, to));
    }

    move(move) {
      if (!this.canMove(move)) return false;
      const [from, to] = move;
      const piece = this.board[from[0]][from[1]];
      const captured = this.board[to[0]][to[1]];
      this.history.push({ from: [from[0], from[1]], to: [to[0], to[1]], captured, quiet: this.quiet });
      this.board[to[0]][to[1]] = piece;
      this.board[from[0]][from[1]] = null;
      this.lastMove = [[from[0], from[1]], [to[0], to[1]]];
      this.quiet = captured ? 0 : this.quiet + 1;
      const side = this.turn;
      this.turn = other(side);
      if (isDen(to[0], to[1])) this.end(side, 'den');
      else if (!movesFor(this.board, this.turn).length) {
        const left = this.board.some(row => row.some(p => p && p.side === this.turn));
        this.end(side, left ? 'stuck' : 'wipe');
      } else if (this.quiet >= QUIET_LIMIT) this.end('draw', 'quiet');
      return true;
    }

    undo() {
      const last = this.history.pop();
      if (!last) return false;
      this.board[last.from[0]][last.from[1]] = this.board[last.to[0]][last.to[1]];
      this.board[last.to[0]][last.to[1]] = last.captured;
      this.quiet = last.quiet;
      this.turn = other(this.turn);
      this.winner = null;
      this.reason = null;
      const prev = this.history[this.history.length - 1];
      this.lastMove = prev ? [prev.from, prev.to] : null;
      return true;
    }

    end(winner, reason) {
      this.winner = winner;
      this.reason = reason;
    }
  }

  return { ROWS, COLS, NAMES, DEN, TRAPS, QUIET_LIMIT, Game, targets, movesFor, isWater, isDen, trapOwner, power, other };
});
