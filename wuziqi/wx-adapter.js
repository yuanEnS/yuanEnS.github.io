// 网页适配层：用浏览器 API 实现小游戏用到的 wx 接口，让同一份游戏代码直接在网页里运行。
(function () {
  const frame = document.getElementById('frame');
  const screen = document.getElementById('screen');
  const loadedFonts = {};
  let screenCreated = false;
  let toastTimer;

  function frameSize() {
    return { width: frame.clientWidth, height: frame.clientHeight };
  }

  function toast(text, loading) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      frame.appendChild(el);
    }
    el.textContent = text;
    el.className = loading ? 'show loading' : 'show';
    clearTimeout(toastTimer);
    if (!loading) toastTimer = setTimeout(() => { el.className = ''; }, 1500);
  }

  function openDialog(sheet) {
    closeDialog();
    const mask = document.createElement('div');
    mask.id = 'dialog';
    mask.className = sheet ? 'mask sheet' : 'mask';
    const box = document.createElement('div');
    box.className = 'dlg';
    mask.appendChild(box);
    frame.appendChild(mask);
    return { mask, box };
  }

  function closeDialog() {
    const old = document.getElementById('dialog');
    if (old) old.remove();
  }

  window.wx = {
    getWindowInfo() {
      const { width, height } = frameSize();
      return { windowWidth: width, windowHeight: height, pixelRatio: window.devicePixelRatio || 1, statusBarHeight: 12 };
    },

    createCanvas() {
      if (screenCreated) return document.createElement('canvas');
      screenCreated = true;
      const { width, height } = frameSize();
      screen.style.width = width + 'px';
      screen.style.height = height + 'px';
      return screen;
    },

    // 小游戏的触摸坐标相对屏幕左上角；网页里画布可能居中，要减去画布的偏移
    onTouchStart(cb) {
      screen.addEventListener('pointerdown', e => {
        const rect = screen.getBoundingClientRect();
        const t = { clientX: e.clientX - rect.left, clientY: e.clientY - rect.top };
        cb({ touches: [t], changedTouches: [t] });
      });
    },

    showToast({ title, icon }) {
      toast(title, icon === 'loading');
    },

    hideToast() {
      const el = document.getElementById('toast');
      if (el) el.className = '';
    },

    showModal({ title, content, editable, placeholderText, success }) {
      const { box } = openDialog(false);
      box.innerHTML = '<div class="dlg-title"></div><div class="dlg-text"></div>' +
        (editable ? '<input class="dlg-input" inputmode="numeric">' : '') +
        '<div class="dlg-row"><button data-ok="0">取消</button><button data-ok="1" class="primary">确定</button></div>';
      box.querySelector('.dlg-title').textContent = title || '';
      box.querySelector('.dlg-text').textContent = content || '';
      const input = box.querySelector('.dlg-input');
      if (input) {
        input.placeholder = placeholderText || '';
        setTimeout(() => input.focus());
      }
      box.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
        closeDialog();
        const confirm = btn.dataset.ok === '1';
        if (success) success({ confirm, cancel: !confirm, content: input ? input.value : '' });
      }));
    },

    showActionSheet({ itemList, success }) {
      const { mask, box } = openDialog(true);
      mask.addEventListener('click', e => { if (e.target === mask) closeDialog(); });
      itemList.concat('取消').forEach((label, i) => {
        const btn = document.createElement('button');
        btn.className = i < itemList.length ? 'sheet-item' : 'sheet-item cancel';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          closeDialog();
          if (i < itemList.length && success) success({ tapIndex: i });
        });
        box.appendChild(btn);
      });
    },

    getStorageSync(key) {
      try {
        const raw = localStorage.getItem('xiangqi:' + key);
        return raw ? JSON.parse(raw) : '';
      } catch (e) {
        return '';
      }
    },

    setStorageSync(key, value) {
      try {
        localStorage.setItem('xiangqi:' + key, JSON.stringify(value));
      } catch (e) {}
    },

    // 小游戏里 loadFont 是同步的；网页里在启动游戏前先把字体加载好（见 boot）
    loadFont(path) {
      return loadedFonts[path] || null;
    },

    connectSocket({ url }) {
      const ws = new WebSocket(url);
      return {
        onOpen: cb => { ws.onopen = cb; },
        onMessage: cb => { ws.onmessage = e => cb({ data: e.data }); },
        onClose: cb => { ws.onclose = cb; },
        onError: cb => { ws.onerror = cb; },
        send: ({ data }) => ws.send(data),
        close: () => ws.close(),
      };
    },
  };

  // 先加载字体，再运行游戏；字体加载失败也照常启动（用系统字体）
  // fonts: { 小游戏里的字体路径: [网页上的字体地址, 字体名] }
  window.XQ = {
    boot(gameSrc, fonts) {
      const start = () => {
        const script = document.createElement('script');
        script.src = gameSrc;
        document.body.appendChild(script);
      };
      if (!window.FontFace) return start();
      Promise.all(Object.entries(fonts).map(([path, [url, name]]) =>
        new FontFace(name, `url(${url})`).load()
          .then(f => {
            document.fonts.add(f);
            loadedFonts[path] = name;
          })
          .catch(() => {})
      )).then(start);
    },
  };

  // 游戏按启动时的尺寸排版；宽度变了（转屏、拉伸窗口）就重新加载。
  // 只看宽度：手机浏览器地址栏收起时高度会变，不能因此刷新。
  let lastWidth = frame.clientWidth;
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(frame.clientWidth - lastWidth) > 30) location.reload();
      lastWidth = frame.clientWidth;
    }, 400);
  });
})();
