/* 点词查义：在英文书页上点一个单词，弹出音标和中文释义。
 * 词典是同目录 dict/ 下按前两个字母切开的 JSON（reading/tools/build_dict.py 生成，来自 ECDICT）。
 * 写成 ES5、用 XMLHttpRequest，老的阅读器浏览器也能跑；跑不了就什么都不做，页面照常读。 */
(function () {
  'use strict';
  var script = document.currentScript || document.querySelector('script[data-dict]');
  if (!script || !document.addEventListener || !window.XMLHttpRequest) return;
  var base = script.getAttribute('data-dict');
  var shards = {};
  var box = null, mark = null, current = 0;
  var SKIP = 'a, button, input, textarea, select, pre, code, kbd, samp, math, svg, img, .nav, .credit, .ltx_listing, .lookup-box';
  var LETTER = /[A-Za-z'’-]/;

  var css = document.createElement('style');
  css.textContent =
    '.lookup-box{position:absolute;z-index:50;max-width:340px;max-width:min(340px,calc(100vw - 24px));box-sizing:border-box;' +
    'background:#fff;color:#000;border:1px solid #000;border-radius:6px;padding:10px 12px 8px;' +
    'box-shadow:0 4px 18px rgba(0,0,0,.18);font:15px/1.55 -apple-system,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;text-indent:0;text-align:left}' +
    '.lookup-box .w{font-weight:600;font-size:17px;margin-right:6px}' +
    '.lookup-box .p{color:#555;font-size:14px}' +
    '.lookup-box .from{color:#555;font-size:13px;margin-top:1px}' +
    '.lookup-box .d{margin-top:4px;white-space:pre-line}' +
    '.lookup-box .none{color:#555;margin-top:4px}' +
    '.lookup-box .src{margin-top:6px;font-size:11px;color:#777}' +
    '.lookup-box .src a{color:#777}' +
    '.lookup-mark{position:absolute;z-index:49;pointer-events:none;background:rgba(255,214,0,.38);border-radius:2px}';
  document.head.appendChild(css);

  function closest(node, selector) {
    var el = node.nodeType === 1 ? node : node.parentNode;
    while (el && el.nodeType === 1) {
      if ((el.matches || el.webkitMatchesSelector || el.msMatchesSelector).call(el, selector)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function caretAt(x, y) {
    if (document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      return r && { node: r.startContainer, offset: r.startOffset };
    }
    if (document.caretPositionFromPoint) {
      var p = document.caretPositionFromPoint(x, y);
      return p && { node: p.offsetNode, offset: p.offset };
    }
    return null;
  }

  // 找到点中的那个词：整个带连字符的词，以及点中的那一段
  function wordAt(x, y) {
    var caret = caretAt(x, y);
    if (!caret || !caret.node || caret.node.nodeType !== 3) return null;
    var text = caret.node.data, start = caret.offset, end = caret.offset;
    while (start > 0 && LETTER.test(text.charAt(start - 1))) start--;
    while (end < text.length && LETTER.test(text.charAt(end))) end++;
    while (start < end && /['’-]/.test(text.charAt(start))) start++;
    while (end > start && /['’-]/.test(text.charAt(end - 1))) end--;
    if (end - start < 2 || !/[A-Za-z]/.test(text.slice(start, end))) return null;
    var range = document.createRange();
    range.setStart(caret.node, start);
    range.setEnd(caret.node, end);
    // 光标落在词尾以外很远（点在空白处）就不算
    var rect = range.getBoundingClientRect();
    if (x < rect.left - 4 || x > rect.right + 4 || y < rect.top - 4 || y > rect.bottom + 4) return null;
    var whole = text.slice(start, end);
    var pos = caret.offset - start, part = whole;
    if (whole.indexOf('-') > 0) {
      var a = whole.lastIndexOf('-', pos - 1) + 1, b = whole.indexOf('-', pos);
      part = whole.slice(a, b < 0 ? whole.length : b);
    }
    return { word: whole, part: part, range: range };
  }

  function candidates(word, part) {
    var list = [];
    function add(w) {
      w = w.toLowerCase().replace(/’/g, "'");
      if (w.length > 1 && list.indexOf(w) < 0) list.push(w);
    }
    var forms = [word];
    if (part !== word) forms.push(part);
    for (var i = 0; i < forms.length; i++) {
      var w = forms[i].replace(/['’]s$/i, '').replace(/s['’]$/i, 's');
      add(forms[i]); add(w);
      var lower = w.toLowerCase();
      if (/ies$/.test(lower)) add(lower.slice(0, -3) + 'y');
      if (/es$/.test(lower)) add(lower.slice(0, -2));
      if (/s$/.test(lower)) add(lower.slice(0, -1));
      if (/ied$/.test(lower)) add(lower.slice(0, -3) + 'y');
      if (/ed$/.test(lower)) { add(lower.slice(0, -2)); add(lower.slice(0, -1)); }
      if (/ing$/.test(lower)) { add(lower.slice(0, -3)); add(lower.slice(0, -3) + 'e'); }
      if (/ly$/.test(lower)) add(lower.slice(0, -2));
    }
    return list;
  }

  function shardOf(word) {
    var head = word.replace(/[^a-z]/g, '').slice(0, 2);
    return head.length === 2 ? head : head ? head + '_' : '__';
  }

  function load(key, done) {
    if (shards[key]) {
      if (shards[key].data) done(shards[key].data); else shards[key].wait.push(done);
      return;
    }
    shards[key] = { data: null, wait: [done] };
    var xhr = new XMLHttpRequest();
    xhr.open('GET', base + key + '.json');
    xhr.onload = function () {
      var data = {};
      if (xhr.status === 200) { try { data = JSON.parse(xhr.responseText); } catch (e) { data = {}; } }
      else if (xhr.status !== 404) { delete shards[key]; }
      var wait = shards[key] ? shards[key].wait : [];
      if (shards[key]) { shards[key].data = data; shards[key].wait = []; }
      for (var i = 0; i < wait.length; i++) wait[i](data);
    };
    xhr.onerror = function () {
      var wait = shards[key].wait;
      delete shards[key];
      for (var i = 0; i < wait.length; i++) wait[i](null);
    };
    xhr.send();
  }

  // 依次试候选词；变形词条是字符串，指向原形
  function find(list, done, i, hops) {
    i = i || 0;
    if (i >= list.length) return done(null);
    var word = list[i];
    load(shardOf(word), function (data) {
      if (data === null) return done(false);
      var hit = data[word];
      if (typeof hit === 'string' && (hops || 0) < 2) {
        return find([hit], function (res) {
          if (res) res.from = res.from || word;
          done(res || null);
        }, 0, (hops || 0) + 1);
      }
      if (hit && typeof hit !== 'string') return done({ word: word, phonetic: hit[0], text: hit[1] });
      find(list, done, i + 1, hops);
    });
  }

  function close() {
    current++;
    if (box && box.parentNode) box.parentNode.removeChild(box);
    if (mark && mark.parentNode) mark.parentNode.removeChild(mark);
    box = mark = null;
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }

  function show(hit, tapped, rect) {
    var sx = window.pageXOffset, sy = window.pageYOffset;
    mark = el('div', 'lookup-mark');
    mark.style.left = rect.left + sx - 1 + 'px';
    mark.style.top = rect.top + sy + 'px';
    mark.style.width = rect.width + 2 + 'px';
    mark.style.height = rect.height + 'px';
    document.body.appendChild(mark);

    box = el('div', 'lookup-box');
    box.setAttribute('role', 'dialog');
    var head = el('div');
    head.appendChild(el('span', 'w', hit ? hit.word : tapped));
    if (hit && hit.phonetic) head.appendChild(el('span', 'p', '/' + hit.phonetic + '/'));
    box.appendChild(head);
    if (hit) {
      if (hit.from && hit.from !== hit.word) box.appendChild(el('div', 'from', hit.from + ' → ' + hit.word));
      box.appendChild(el('div', 'd', hit.text));
      var src = el('div', 'src', '释义来自 ');
      var link = el('a', '', 'ECDICT');
      link.href = 'https://github.com/skywind3000/ECDICT';
      src.appendChild(link);
      box.appendChild(src);
    } else {
      box.appendChild(el('div', 'none', hit === false ? '词典没取到，检查一下网络再点一次。' : '词典里没有这个词（人名、地名或专有名词常常查不到）。'));
    }
    document.body.appendChild(box);

    var width = box.offsetWidth, height = box.offsetHeight;
    var view = document.documentElement.clientWidth;
    var left = Math.max(12, Math.min(rect.left, view - width - 12));
    var below = rect.bottom + 8, above = rect.top - height - 8;
    var top = below + height > window.innerHeight && above > 0 ? above : below;
    box.style.left = left + sx + 'px';
    box.style.top = top + sy + 'px';
  }

  document.addEventListener('click', function (event) {
    if (box && closest(event.target, '.lookup-box')) return;
    close();
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    if (closest(event.target, SKIP)) return;
    var hitWord = wordAt(event.clientX, event.clientY);
    if (!hitWord || closest(hitWord.range.startContainer, SKIP)) return;
    var rect = hitWord.range.getBoundingClientRect();
    var ticket = current;
    find(candidates(hitWord.word, hitWord.part), function (hit) {
      if (ticket !== current) return;
      show(hit, hitWord.part, rect);
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' || event.keyCode === 27) close();
  });
  window.addEventListener('resize', close);
})();
