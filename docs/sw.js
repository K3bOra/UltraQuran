/* Ultra Quran service worker: app shell offline, data refreshed in the background,
   Mushaf pages and fonts cached after first view. Audio is not intercepted
   (offline audio is read from the "uq-audio" cache by the page itself). */
const VERSION = "uq-shell-38";
const SHELL = [
  "./", "index.html", "style.css?v=38", "app.js?v=38", "prayer-calc.js?v=38", "style.css", "app.js", "manifest.webmanifest",
  "img/lattice.svg", "img/bg.webp", "img/bg-m.webp", "fonts/Cairo-SemiBold.ttf", "img/star.svg", "icons/icon-192.png", "icons/icon-512.png",
  "prayer-calc.js", "data/meta.json", "data/reciters.json", "data/radios.json", "data/adhan.json",
];
const KEEP = [VERSION, "uq-data", "uq-pages", "uq-fonts", "uq-audio", "uq-img"];

self.addEventListener("install", (e) => {
  // cache: "reload" skips the browser's HTTP cache so a new version never stores old files
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const PAGE_HOSTS = ["cdn.jsdelivr.net", "raw.githubusercontent.com", "files.quran.app", "api.alquran.cloud"];

async function cacheFirst(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") c.put(req, res.clone());
  return res;
}
async function networkFirst(req, name) {
  const c = await caches.open(name);
  try {
    const res = await fetch(req, { cache: "no-cache" });
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    return (await c.match(req)) || (await caches.match(req)) || Response.error();
  }
}
async function staleWhileRevalidate(req, name) {
  const c = await caches.open(name);
  const hit = await c.match(req);
  const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || net;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes("/data/")) return e.respondWith(staleWhileRevalidate(req, "uq-data"));
    if (url.pathname.includes("/img/p/")) return e.respondWith(cacheFirst(req, "uq-img"));
    if (req.mode === "navigate") {
      return e.respondWith(fetch(req, { cache: "no-cache" }).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put("index.html", copy));
        return res;
      }).catch(() => caches.match("index.html")));
    }
    // the app's own code and styles: always the newest when online, the saved copy when offline
    if (/\.(js|css|html|webmanifest)$/.test(url.pathname)) return e.respondWith(networkFirst(req, VERSION));
    return e.respondWith(staleWhileRevalidate(req, VERSION));
  }
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com") return e.respondWith(cacheFirst(req, "uq-fonts"));
  if (PAGE_HOSTS.includes(url.host) && /\.(png|jpg)$|\/v1\/page\//.test(url.pathname)) return e.respondWith(cacheFirst(req, "uq-pages"));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("./#/prayer");
  }));
});
