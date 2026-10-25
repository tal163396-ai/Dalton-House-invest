// 앱 화면 파일만 저장 (자산 데이터는 저장하지 않음)
const CACHE = 'dalton-house-v59';
const SHELL = ['./', 'index.html', 'app.css?v=44', 'app.js?v=49', 'config.js?v=1', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 같은 주소의 화면 파일: 인터넷 먼저 → 실패하면 저장본. 데이터 요청(구글)은 건드리지 않음.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }) // 휴대폰에 남은 예전 파일 대신 항상 최신본 확인
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
