// 黑白棋规则：8×8 棋盘，黑先。落子要夹住对方至少一枚棋子，被夹住的翻成自己的颜色。
// 一方无处可下就由对方接着下；双方都无处可下时数子，多的赢。
// board[r][c]：'' 空，'b' 黑，'w' 白。走法是 [行, 列]。
// 服务器（server/lobby.js）和网页（gamesyuan.com/games/rules/）共用这一份：改了要运行 node tools/copy-rules.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Othello = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 8;
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const other = side => (side === 'b' ? 'w' : 'b');
  const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

  function startBoard() {
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
    board[3][3] = board[4][4] = 'w';
    board[3][4] = board[4][3] = 'b';
    return board;
  }

  // 在 (r, c) 落 side 的子能翻转哪些棋子
  function flips(board, r, c, side) {
    if (!inside(r, c) || board[r][c]) return [];
    const result = [];
    for (const [dr, dc] of DIRS) {
      const line = [];
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc) && board[rr][cc] === other(side)) {
        line.push([rr, cc]);
        rr += dr;
        cc += dc;
      }
      if (line.length && inside(rr, cc) && board[rr][cc] === side) result.push(...line);
    }
    return result;
  }

  function movesFor(board, side) {
    const list = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (flips(board, r, c, side).length) list.push([r, c]);
      }
    }
    return list;
  }

  function count(board) {
    let b = 0, w = 0;
    for (const row of board) for (const cell of row) {
      if (cell === 'b') b++;
      else if (cell === 'w') w++;
    }
    return { b, w };
  }

  class Game {
    constructor() {
      this.reset();
    }

    reset() {
      this.board = startBoard();
      this.turn = 'b';
      this.history = []; // { at, side, flipped, passed }
      this.lastMove = null;
      this.lastFlips = [];
      this.passed = null; // 刚才哪一方没处下、被跳过
      this.winner = null; // 'b' | 'w' | 'draw'
      this.reason = null; // count | resign | left
    }

    legalMoves() {
      return this.winner ? [] : movesFor(this.board, this.turn);
    }

    canMove(at) {
      if (this.winner || !Array.isArray(at)) return false;
      const [r, c] = at;
      return Number.isInteger(r) && Number.isInteger(c) && flips(this.board, r, c, this.turn).length > 0;
    }

    move(at) {
      if (!this.canMove(at)) return false;
      const [r, c] = at;
      const side = this.turn;
      const flipped = flips(this.board, r, c, side);
      this.board[r][c] = side;
      for (const [fr, fc] of flipped) this.board[fr][fc] = side;
      this.lastMove = [r, c];
      this.lastFlips = flipped;
      // 对方有处下就轮到对方；对方没处下而自己还有，就自己接着下；都没有就结束
      let next = other(side);
      let passed = null;
      if (!movesFor(this.board, next).length) {
        if (movesFor(this.board, side).length) {
          passed = next;
          next = side;
        } else {
          next = null;
        }
      }
      this.history.push({ at: [r, c], side, flipped, passed });
      this.passed = passed;
      if (next) {
        this.turn = next;
      } else {
        const { b, w } = count(this.board);
        this.turn = other(side);
        this.end(b > w ? 'b' : w > b ? 'w' : 'draw', 'count');
      }
      return true;
    }

    undo() {
      const last = this.history.pop();
      if (!last) return false;
      const [r, c] = last.at;
      this.board[r][c] = '';
      for (const [fr, fc] of last.flipped) this.board[fr][fc] = other(last.side);
      this.turn = last.side;
      this.winner = null;
      this.reason = null;
      const prev = this.history[this.history.length - 1];
      this.lastMove = prev ? prev.at : null;
      this.lastFlips = prev ? prev.flipped : [];
      this.passed = prev ? prev.passed : null;
      return true;
    }

    end(winner, reason) {
      this.winner = winner;
      this.reason = reason;
    }

    count() {
      return count(this.board);
    }
  }

  return { SIZE, Game, flips, movesFor, count, other };
});
