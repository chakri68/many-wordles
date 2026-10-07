// Offline cache. Navigations: network-first (fresh deploys win), fall back to
// cache. Everything else, incl. fonts + hosted tokens: stale-while-revalidate.
// Word lists + the semantic table are frozen per version, so stale is always
// correct. The embedding tables (2-4 MB) are cached on first use, not precached.
const CACHE = 'many-wordles-v3';
const CORE = ['./', './index.html', './manifest.webmanifest', './favicon.svg',
  './words/answers.v1.txt', './words/allowed.v1.txt', './words/denylist.txt', './words/extra.v1.txt',
  './reverse/openers.v1.json'];
// The hashed bundle. The first visit fetched it before this worker existed, so
// without precaching it, offline only worked from the second visit.
// Filled in at build time (vite.config.ts); every deploy changes it, which is
// also what makes the browser pick up a new sw.js at all.
const ASSETS = [];
// Off-site stylesheets. The tokens hold every colour, so going offline without
// them is a blank page in a trench coat. Best effort: a CDN hiccup shouldn't fail install.
const EXTERNAL = ['https://theme.chakri.me/tokens.css',
  'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=block',
  'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap'];

/** fetch + cache an off-site stylesheet, plus any font files it points at */
async function stash(c, url) {
  const res = await fetch(url);
  if (!res.ok) return;
  await c.put(url, res.clone());
  const fonts = [...(await res.text()).matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
  await Promise.all(fonts.map((f) => fetch(f).then((r) => r.ok && c.put(f, r))));
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll([...CORE, ...ASSETS]).then(() => Promise.all(EXTERNAL.map((u) => stash(c, u).catch(() => {})))))
      .then(() => self.skipWaiting()),
  );
});

/** drop bundles from older deploys; one cache name means they'd pile up forever */
async function prune() {
  const c = await caches.open(CACHE);
  const keep = new Set(ASSETS.map((a) => new URL(a, self.registration.scope).href));
  const old = (await c.keys()).filter((r) => new URL(r.url).pathname.includes('/assets/') && !keep.has(r.url));
  await Promise.all(old.map((r) => c.delete(r)));
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(prune)
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    // per-URL: /decay/ is its own page (own <base>, own social card)
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) || caches.match('./index.html')),
    );
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      // Google Fonts varies on Sec-Fetch-*, so a copy this worker fetched would never match the page's own request
      const hit = await c.match(req, { ignoreVary: true });
      const net = fetch(req)
        .then((res) => {
          if (res.ok || res.type === 'opaque') c.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
