/* 끝말잇기 오프라인 앱 — 처음 한 번 열면 전부 저장돼서 인터넷 없이도 열려요.
   게임 파일을 고쳐서 다시 올릴 때는 아래 VERSION 숫자를 하나 올려주세요 (그래야 폰이 새 파일로 바뀌어요). */
const VERSION='v116';
const CACHE = 'jd-wordchain-' + VERSION;
const CORE = ['./', 'index.html', 'dict-pack.json', 'manifest.json', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'favicon.png'];
const OPTIONAL = ['ranks.json.gz', 'dict1.json.gz', 'dict2.json.gz',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Jua&display=swap',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css'];
const CDN_OK = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    await Promise.all(OPTIONAL.map(u => c.add(u).catch(() => {})));   // 없거나 못 받아도 괜찮은 것들
    self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if ((k.startsWith('jd-wordchain-') && k !== CACHE) || k === 'jd-dlx-1' || k === 'jd-dlx-2') await caches.delete(k);   // [v80] 예전 그림 저장소 정리
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const same = u.origin === self.location.origin;
  if (!same && !CDN_OK.includes(u.hostname)) return;   // 실시간 대전 등 인터넷 기능은 그대로 인터넷으로
  /* [v70] 캐릭터 그림(dlx 폴더)은 버전이 바뀌어도 지우지 않는 따로 저장소에 (한 번 받으면 계속 씀) */
  if (same && (u.pathname.indexOf('/dlx/') >= 0 || /\/(dlx|mo)-[^\/]*$/.test(u.pathname))) {
    e.respondWith((async () => {
      const c = await caches.open('jd-dlx-3');
      if (/index\.json$/.test(u.pathname)) { try { const res = await fetch(r); if (res && res.ok) { c.put(r, res.clone()); return res; } } catch (err) {} }   // 목록은 새 것 먼저
      const hit = await c.match(r, { ignoreSearch: true }); if (hit) return hit;
      try { const res = await fetch(r); if (res && res.ok) c.put(r, res.clone()); return res; } catch (err) { return new Response('', { status: 504, statusText: 'offline' }); }
    })());
    return;
  }
  if (same && /\/baram[-_][^\/]*\.json$/.test(u.pathname)) {   // [v108] 장비표 목록·조각은 항상 새 것 먼저 (옛 사본을 따라가지 않게)
    e.respondWith((async () => {
      try { const res = await fetch(r, { cache: 'no-store' }); if (res && res.ok) return res; return res; } catch (err) {}
      const hit = await caches.match(r, { ignoreSearch: true }); return hit || new Response('', { status: 504, statusText: 'offline' });
    })());
    return;
  }
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(r, { ignoreSearch: same });
    if (hit) {
      if (!same) e.waitUntil(fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); }).catch(() => {}));   // 폰트·라이브러리는 몰래 최신으로
      return hit;
    }
    try {
      const res = await fetch(r);
      if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone());
      return res;
    } catch (err) {
      if (r.mode === 'navigate') { const idx = await c.match('index.html'); if (idx) return idx; }
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
