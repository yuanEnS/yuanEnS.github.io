// Kindle 等电子书阅读器的浏览器跑不动生活园的网页版，直接去服务器生成的简易版。
// 网址里带 full=1 时留在网页版。故意用老写法（ES5），老浏览器也能执行。
(function () {
  if (!/Kindle|Silk|PocketBook|Kobo|BOOX|Onyx/i.test(navigator.userAgent) || /[?&]full=1/.test(location.search)) return;
  var api = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://127.0.0.1:8787' : 'https://api.gamesyuan.com';
  var path = location.pathname, query = location.search;
  var id = (query.match(/[?&]id=(\d+)/) || [])[1];
  var author = (query.match(/[?&]author=([^&]+)/) || [])[1];
  var target = '/life/lite';
  if (/\/life\/post\/?$/.test(path) && id) target = '/life/lite/post?id=' + id;
  else if (/\/life\/personal\/?$/.test(path) && author) target = '/life/lite/author?name=' + author;
  location.replace(api + target);
})();
