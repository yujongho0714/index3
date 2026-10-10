/* 정도 끝말잇기 서비스워커
   - 한 번 받은 화면 파일을 폰에 저장해 두고 다음부터 바로 열어요.
   - 열 때마다 새 버전이 있는지 조용히 확인하고, 바뀌었으면 다음 실행부터 새 화면이 보여요.
   - Firebase(클라우드 저장)와 구글 로그인은 항상 인터넷으로 연결해요. */
const CACHE = 'jd-wordchain-v14';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const NETWORK_ONLY = /firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com|accounts\.google\.com|apis\.google\.com|securetoken|identitytoolkit|youtube\.com|youtube-nocookie\.com/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('jd-wordchain-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (NETWORK_ONLY.test(url.hostname) || url.pathname.indexOf('/__/auth/') >= 0) return;
  if (req.headers.get('range') || req.destination === 'video' || req.destination === 'audio' || /\.(mp4|webm|mov|m4a|mp3)$/i.test(url.pathname)) return;
  e.respondWith(url.origin === location.origin ? sameSite(e, req) : cdn(req));
});

async function sameSite(e, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req.url, { cache: 'no-cache' }).then(async r => {
    if (r && r.ok && r.type === 'basic') {
      const old = hit && hit.headers.get('etag');
      const cur = r.headers.get('etag');
      if (!hit || !old || !cur || old !== cur) await cache.put(req.url.split('?')[0], r.clone());
    }
    return r;
  }).catch(() => null);
  if (hit) { e.waitUntil(net); return hit; }
  const r = await net;
  if (r) return r;
  return (await cache.match('./index.html')) || Response.error();
}

async function cdn(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    let r;
    try { r = await fetch(new Request(req.url, { mode: 'cors', credentials: 'omit' })); }
    catch (_) { r = await fetch(req); }
    if (r && (r.ok || r.type === 'opaque')) await cache.put(req, r.clone());
    return r;
  } catch (_) {
    return Response.error();
  }
}
