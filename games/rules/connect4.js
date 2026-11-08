// 四子连珠规则：7 列 6 行竖着放的棋盘，红先黄后。每次选一列放子，子落到这一列最下面的空位。
// 横、竖、斜连成四子就赢；放满还没人连成就是和棋。
// board[r][c]：r = 0 是最上面一行。'' 空，'r' 红，'y' 黄。走法是列号 0–6。
// 服务器（server/lobby.js）和网页（gamesyuan.com/games/rules/）共用这一份：改了要运行 node tools/copy-rules.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Connect4 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROWS = 6;
  const COLS = 7;
  const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  const other = side => (side === 'r' ? 'y' : 'r');
  const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

  function fourAt(board, r, c) {
    const side = board[r][c];
    if (!side) return null;
    for (const [dr, dc] of DIRS) {
      const line = [[r, c]];
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (inside(rr, cc) && board[rr][cc] === side) {
          line.push([rr, cc]);
          rr += dr * s;
          cc += dc * s;
        }
      }
      if (line.length >= 4) return line;
    }
    return null;
  }

  // 这一列下一枚子会落在哪一行，满了返回 -1
  function dropRow(board, col) {
    for (let r = ROWS - 1; r >= 0; r--) if (!board[r][col]) return r;
    return -1;
  }

  class Game {
    constructor() {
      this.reset();
    }

    reset() {
      this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
      this.turn = 'r';
      this.history = []; // [行, 列]
      this.lastMove = null;
      this.winner = null; // 'r' | 'y' | 'draw'
      this.reason = null; // four | full | resign | left
      this.winLine = null;
    }

    legalMoves() {
      if (this.winner) return [];
      const list = [];
      for (let c = 0; c < COLS; c++) if (!this.board[0][c]) list.push(c);
      return list;
    }

    canMove(col) {
      return !this.winner && Number.isInteger(col) && col >= 0 && col < COLS && !this.board[0][col];
    }

    move(col) {
      if (!this.canMove(col)) return false;
      const r = dropRow(this.board, col);
      this.board[r][col] = this.turn;
      this.history.push([r, col]);
      this.lastMove = [r, col];
      const line = fourAt(this.board, r, col);
      if (line) {
        this.end(this.turn, 'four');
        this.winLine = line;
      } else if (this.history.length === ROWS * COLS) {
        this.end('draw', 'full');
      }
      this.turn = other(this.turn);
      return true;
    }

    undo() {
      const last = this.history.pop();
      if (!last) return false;
      this.board[last[0]][last[1]] = '';
      this.turn = other(this.turn);
      this.winner = null;
      this.reason = null;
      this.winLine = null;
      this.lastMove = this.history[this.history.length - 1] || null;
      return true;
    }

    end(winner, reason) {
      this.winner = winner;
      this.reason = reason;
    }
  }

  return { ROWS, COLS, Game, fourAt, dropRow, other };
});
