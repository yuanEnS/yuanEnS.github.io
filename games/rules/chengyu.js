// 成语接龙规则：用上一个成语的最后一个字开头，接下一个成语。三种接法：
//   zi   同一个字：第一个字要和上一个成语的最后一个字完全相同
//   yin  同音：读音相同就行，声调不限（「意」后面可以接「义」「一」开头的）
//   diao 同音同调：读音和声调都要相同（「意 yì」后面可以接「义 yì」，不能接「一 yī」）
// 词库在 chengyu-words.js（由 tools/chengyu/build.py 生成），读音按成语里的读法，多音字不会读错。
// 联网对战时双方轮流接，接不上、超时或认输就输；接完以后对方在词库里已经无词可接，直接算赢。
// 联网时只认词库里的成语；网页上和电脑接、自己接的时候，词库外的词问一句也算数（同音接法按这个字常见的读音算）。
// 服务器（server/lobby.js）和网页（gamesyuan.com/games/rules/）共用这一份：改了要运行 node tools/copy-rules.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./chengyu-words.js'));
  else root.Chengyu = factory(root.ChengyuWords);
})(typeof self !== 'undefined' ? self : this, function (Words) {
  const RULES = { zi: '同一个字', yin: '同音', diao: '同音同调' };

  // 每个成语第一个字、最后一个字的读音，比如 勃然大怒 -> ['bo2', 'nu4']
  const SOUND = new Map();
  // 每个字在成语开头 / 结尾出现过的读音，词库外的词用
  const CHAR_SOUNDS = new Map();
  for (const item of Words.ALL.trim().split(/\s+/)) {
    const word = item.slice(0, 4);
    const [first, last] = item.slice(4).match(/[a-z]+\d/g);
    SOUND.set(word, [first, last]);
    for (const [ch, s] of [[word[0], first], [word[3], last]]) {
      if (!CHAR_SOUNDS.has(ch)) CHAR_SOUNDS.set(ch, new Set());
      CHAR_SOUNDS.get(ch).add(s);
    }
  }
  const LIST = [...SOUND.keys()];
  const SET = new Set(LIST);
  const COMMON = Words.COMMON.trim().split(/\s+/).filter(w => SET.has(w));
  const COMMON_SET = new Set(COMMON);

  const toneless = s => s.replace(/\d$/, '');
  // 一个成语开头（end = 0）或结尾（end = 3）的接龙键：同字接法是字本身，同音是读音
  function keys(word, end, rule) {
    if (rule === 'zi') return [word[end]];
    const known = SOUND.get(word);
    const sounds = known ? [known[end ? 1 : 0]] : [...(CHAR_SOUNDS.get(word[end]) || [])];
    const list = rule === 'yin' ? sounds.map(toneless) : sounds;
    return list.length ? [...new Set(list)] : [word[end]];
  }

  // 每种接法、每个词表的「开头键 -> 成语」索引，用到时才建
  const indexes = new Map();
  function index(rule, common) {
    const name = rule + (common ? ':common' : '');
    if (!indexes.has(name)) {
      const map = new Map();
      for (const word of common ? COMMON : LIST) {
        for (const key of keys(word, 0, rule)) {
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(word);
        }
      }
      indexes.set(name, map);
    }
    return indexes.get(name);
  }

  // 接在 prev 后面、还没用过的成语。common 为真时只在常用成语里找
  function options(prev, used, rule = 'zi', common = false) {
    const map = index(rule, common);
    const out = [];
    for (const key of keys(prev, 3, rule)) {
      for (const word of map.get(key) || []) if (!used.has(word) && !out.includes(word)) out.push(word);
    }
    return out;
  }

  function linked(prev, word, rule) {
    const want = keys(prev, 3, rule);
    return keys(word, 0, rule).some(k => want.includes(k));
  }

  // 带声调数字的拼音改成声调符号：yi4 -> yì，nv3 -> nǚ
  const MARKS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', ü: 'ǖǘǚǜ' };
  function pretty(sound) {
    const tone = Number(sound.slice(-1));
    let base = sound.replace(/\d$/, '').replace(/v/g, 'ü');
    if (!(tone >= 1 && tone <= 4)) return base;
    let at = base.search(/[ae]/);
    if (at < 0) at = base.indexOf('ou');
    if (at < 0) {
      const vowels = [...base].map((c, i) => (MARKS[c] ? i : -1)).filter(i => i >= 0);
      at = vowels[vowels.length - 1];
    }
    if (at === undefined || at < 0) return base;
    return base.slice(0, at) + MARKS[base[at]][tone - 1] + base.slice(at + 1);
  }

  // 下一个成语要怎么开头，给人看的：{ char, sound, text }
  function need(prev, rule) {
    const char = prev[3];
    if (rule === 'zi') return { char, sound: '', text: `要用「${char}」开头` };
    const sounds = keys(prev, 3, rule).map(s => (rule === 'yin' ? s : pretty(s)));
    const sound = sounds.join(' / ');
    return { char, sound, text: `要用读 ${sound} 的字开头` };
  }

  const pick = list => list[Math.floor(Math.random() * list.length)];
  const other = side => (side === 'a' ? 'b' : 'a');

  // 开局挑一个常用、后面也好接的成语
  function pickStart(rule = 'zi') {
    const none = new Set();
    return pick(COMMON.filter(w => options(w, none, rule, true).length >= 2));
  }

  // 两人轮流接：a 先接，b 后接。走法就是成语本身
  class Game {
    constructor(setup) {
      this.reset(setup);
    }

    reset(setup) {
      this.rule = setup && RULES[setup.rule] ? setup.rule : 'zi';
      this.start = setup && SET.has(setup.start) ? setup.start : pickStart(this.rule);
      this.used = new Set([this.start]);
      this.history = []; // 双方接的成语
      this.turn = 'a';
      this.winner = null; // 'a' | 'b'
      this.reason = null; // stuck 对方无词可接 | timeout 超时 | resign 认输 | left 离开
    }

    // 联网开局时发给双方，保证两边开头的成语和接法一样
    setup() {
      return { start: this.start, rule: this.rule };
    }

    last() {
      return this.history.length ? this.history[this.history.length - 1] : this.start;
    }

    need() {
      return need(this.last(), this.rule);
    }

    options() {
      return options(this.last(), this.used, this.rule);
    }

    // 不能接时返回原因，能接返回空字符串
    problem(word) {
      if (this.winner) return '这一局已经结束了';
      if (typeof word !== 'string' || [...word].length !== 4) return '要四个字的成语';
      if (!SET.has(word)) return `「${word}」不在词库里`;
      if (!linked(this.last(), word, this.rule)) return this.need().text;
      if (this.used.has(word)) return '这个成语这一局用过了';
      return '';
    }

    move(word) {
      if (this.problem(word)) return false;
      const mover = this.turn;
      this.history.push(word);
      this.used.add(word);
      this.turn = other(mover);
      if (!this.options().length) this.end(mover, 'stuck');
      return true;
    }

    end(winner, reason) {
      this.winner = winner;
      this.reason = reason;
    }
  }

  return { Game, RULES, LIST, SET, COMMON, COMMON_SET, SOUND, keys, options, linked, need, pretty, pickStart };
});
