/* 메디보카 서비스 워커: 인터넷 없이 쓰기 + 안드로이드 공유로 백업 받기
 * 앱 파일을 고치면 CACHE 숫자를 올린다. 그래야 폰에 새 파일이 들어간다.
 * 앱 파일은 "네트워크 먼저(3초)": 올린 수정본이 바로 반영되고, 인터넷이 없거나 느리면 저장해 둔 파일로 열린다.
 */
const CACHE = 'medivoca-v3';
const DATA = Array.from({ length: 16 }, (_, i) => './data/terms-' + String(i + 1).padStart(2, '0') + '.js');
const SHELL = [
  './', './index.html', './app.css', './manifest.webmanifest',
  './src/app.js', './src/engine.js', './src/data.js', './src/backup.js', './src/text.js', './src/store.js', './src/guide.js', './src/themes.js', './vendor/fonts/gowun-dodum/gowun-dodum.css',
  './vendor/ts-fsrs.mjs', './data/index.js', './data/pairs.js', ...DATA,
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'medivoca-share').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 안드로이드: 카톡에서 파일 → 공유 → 메디보카. 파일을 잠시 맡아 두고 앱을 연다.
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const file = form.get('backup');
    if (file && typeof file.text === 'function') {
      const c = await caches.open('medivoca-share');
      await c.put('shared-backup', new Response(await file.text(), { headers: { 'Content-Type': 'application/json' } }));
    }
  } catch (e) { /* 앱에서 "찾지 못했어요"로 알린다 */ }
  return Response.redirect('./?shared=1', 303);
}

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share')) { e.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  const key = url.pathname.endsWith('/') || url.search ? new Request(url.origin + url.pathname) : req;
  const net = fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
    return res;
  });
  e.respondWith(
    Promise.race([net, timeout(3000)])
      .catch(() => caches.match(key, { ignoreSearch: true }).then(r => r || net))
      .catch(() => caches.match('./index.html'))
  );
  e.waitUntil(net.catch(() => {}));
});
