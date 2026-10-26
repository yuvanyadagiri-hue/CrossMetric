/*
 * CrossMetric service worker: an offline shell for the installed app.
 *
 * - Pages: network first (fresh whenever online; a 4 s wait falls back to the last copy),
 *   so an update is never hidden behind a cached page. Offline, a page opens from its own last
 *   copy ("/" is the whole client-side app, so shared-trip links open too); a page never
 *   visited gets a short offline page.
 * - Next.js build files (/_next/static, content-hashed) and icons: cache first.
 * - Campus bundles (/api/commute/campus): stale while revalidate, so campus maps open offline.
 * - Every other request (routes, places, transit, reports, map tiles, other sites) goes
 *   straight to the network and is never stored: plans are computed fresh, and the app's own
 *   offline copy of the last result lives in the browser's storage, labelled with its date.
 *
 * Registered only by production builds (components/pwa/PwaBoot.tsx). Bump VERSION when this
 * file changes; old caches are removed on activation.
 */
const VERSION = "cm-sw-4.0.0";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const DATA = `${VERSION}-data`;
const MAX_PAGES = 12;
const NAV_TIMEOUT_MS = 4000;

const PRECACHE = ["/", "/manifest.webmanifest", "/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS);
      await Promise.all(PRECACHE.filter((u) => u !== "/").map((u) => cache.add(u).catch(() => undefined)));
      const pages = await caches.open(PAGES);
      await pages.add("/").catch(() => undefined);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("cm-sw-") && !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// The page tells the worker which build files it loaded before the worker took control.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS);
      for (const raw of data.urls.slice(0, 200)) {
        try {
          const url = new URL(raw, self.location.origin);
          if (url.origin !== self.location.origin || !isAsset(url)) continue;
          if (await cache.match(url.href)) continue;
          const res = await fetch(url.href, { credentials: "same-origin" });
          if (res.ok) await cache.put(url.href, res);
        } catch {
          // Skip anything that cannot be fetched now.
        }
      }
    })(),
  );
});

function isAsset(url) {
  return url.pathname.startsWith("/_next/static/") || /^\/(icons\/|icon\.svg|apple-icon|manifest\.webmanifest|maplibre\/|brand\/)/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) {
    if (url.pathname === "/api/commute/campus") event.respondWith(staleWhileRevalidate(req, DATA));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(page(req, url));
    return;
  }
  // Client-side navigation data (React Server Components) is never cached.
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, ASSETS));
    return;
  }
  if (isAsset(url)) event.respondWith(staleWhileRevalidate(req, ASSETS));
});

async function page(req, url) {
  const cache = await caches.open(PAGES);
  // One copy per path: shared-trip links (/?to=…) open from the copy of "/".
  const key = url.origin + url.pathname;
  try {
    const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS);
    if (res.ok && res.type === "basic") {
      await cache.put(key, res.clone());
      void trim(cache, MAX_PAGES);
    }
    return res;
  } catch {
    // Only the page's own saved copy: another page's HTML would load the wrong screen.
    return (await cache.match(key)) || offlinePage();
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then(async (res) => {
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) {
    void fresh;
    return hit;
  }
  return (await fresh) || new Response(JSON.stringify({ error: "You're offline.", kind: "unavailable" }), { status: 503, headers: { "content-type": "application/json" } });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) {
    if (new URL(k.url).pathname !== "/") await cache.delete(k);
  }
}

function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · CrossMetric</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#07111f;color:#f5f8fc}main{max-width:340px;padding:24px;text-align:center}h1{font-size:20px;margin:0 0 6px}p{color:#9baabd;margin:0 0 16px}a{display:inline-block;padding:12px 18px;border-radius:12px;background:#91f24d;color:#07111f;text-decoration:none;font-weight:600}</style></head>
<body><main><h1>You're offline</h1><p>This page hasn't been saved on this device yet. Your saved places and settings are still in the app.</p><a href="/">Open CrossMetric</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}
