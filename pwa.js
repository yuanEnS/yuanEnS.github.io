// 注册 service worker，让网站可以装到手机桌面。首页上有「装到手机」的按钮或提示。
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  var box = document.getElementById('install');
  if (!box) return;
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  var button = document.getElementById('install-button');
  var text = document.getElementById('install-text');
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  if (ios) {
    text.textContent = /CriOS|FxiOS|EdgiOS/.test(ua)
      ? '装到手机：点浏览器的分享按钮，选「添加到主屏幕」。'
      : '装到手机：在 Safari 里点下方的分享按钮，再点「添加到主屏幕」。';
    box.hidden = false;
    return;
  }

  // 安卓 Chrome、电脑上的 Chrome / Edge：浏览器准备好了才显示按钮
  var prompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    prompt = e;
    text.textContent = '可以装到手机或电脑上，像 app 一样从桌面打开。';
    button.hidden = false;
    box.hidden = false;
  });
  button.addEventListener('click', function () {
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.then(function () {
      prompt = null;
      box.hidden = true;
    });
  });
  window.addEventListener('appinstalled', function () {
    box.hidden = true;
  });
})();
