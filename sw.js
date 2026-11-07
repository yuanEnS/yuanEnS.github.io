// 让网站能装到手机上（PWA），没网时也能打开看过的页面、玩人机对战。
// 网页、脚本、样式先上网拿最新的，拿不到再用存着的；字体和图片很少变，先用存着的。
// 接口（api.gamesyuan.com）不经过这里，文章和账号总是最新的。
const VERSION = 'v1';
const CACHE = `gamesyuan-${VERSION}`;
const SHELL = ['/', '/offline.html', '/life/life.css', '/life/life.js', '/favicon.svg', '/icon-192.png'];
const SLOW_MS = 5000; // 网太慢时，有存着的就先用存着的

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('gamesyuan-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

const LONG_LIVED = /\.(woff2?|png|jpe?g|gif|webp|svg|ico|mp3|ogg|wav)$/i;

async function save(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(event) {
  const { request } = event;
  const cached = caches.match(request, { ignoreSearch: request.mode === 'navigate' ? false : true });
  const fresh = fetch(request).then(response => save(request, response));
  event.waitUntil(fresh.then(() => {}, () => {}));
  const slow = new Promise(resolve => setTimeout(resolve, SLOW_MS)).then(() => cached);
  try {
    const response = await Promise.race([fresh, slow]);
    if (response) return response;
    return await fresh;
  } catch (err) {
    const fallback = await cached;
    if (fallback) return fallback;
    if (request.mode === 'navigate') {
      // 带参数的页面（比如 /life/post/?id=3）没存过时，退回到不带参数的那一页
      const plain = await caches.match(request, { ignoreSearch: true });
      return plain || caches.match('/offline.html');
    }
    throw err;
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const cached = await caches.match(request);
  if (cached) return cached;
  return save(request, await fetch(request));
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(LONG_LIVED.test(url.pathname) ? cacheFirst(event) : networkFirst(event));
});
