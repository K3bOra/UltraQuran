/* Ultra Quran — web edition. Plain JS, no build step. */
(() => {
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ic = (n) => `<svg class="icon" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const AR = new Intl.NumberFormat("ar-EG-u-nu-latn");
const n2a = (n) => AR.format(n);

/* ---------------- storage ---------------- */
const KEY = "uq.v1";
const S = Object.assign(
  { fav: [], saved: {}, last: null, riwaya: "hafs", page: 1, mode: "img", tafsir: true, quizBest: 0 },
  (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })()
);
let saveT = 0;
function save(now) {
  clearTimeout(saveT);
  const w = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  now ? w() : (saveT = setTimeout(w, 400));
}

/* ---------------- data ---------------- */
const memo = new Map();
function getJSON(path) {
  if (!memo.has(path)) {
    memo.set(path, fetch(path).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch((e) => { memo.delete(path); throw e; }));
  }
  return memo.get(path);
}
let META, RECITERS, RIDX = {};
const portrait = (id) => (META && META.portraits.includes(+id) ? `img/p/${id}.webp` : null);
const initial = (name) => (String(name || "").replace(/^(الشيخ|الشيخة|القارئ)\s+/, "").trim()[0] || "ق");
function avatar(id, name, extra = "") {
  const src = portrait(id);
  return `<span class="avatar" ${extra}>${src ? `<img src="${src}" alt="" loading="lazy" decoding="async">` : esc(initial(name))}</span>`;
}

/* ---------------- toast ---------------- */
let toastT = 0;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove("show"), ms);
}

/* ---------------- tracks ---------------- */
// track: {t: title, s: who, d: detail, u: url, img, live, v: isVideo}
let LISTS = {}, listN = 0;
function reg(tracks) { const id = "L" + listN++; LISTS[id] = tracks; return id; }
const isFav = (u) => S.fav.some((f) => f.u === u);

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "--:--";
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const p = (x) => String(x).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
function audioUrl(rec, ch) {
  if (rec.urls) return rec.urls[ch] || rec.urls[String(ch)] || "";
  const src = rec.src.replace("%%20", "%20");
  if (src.includes("%03d")) return src.replace("%03d", String(ch).padStart(3, "0"));
  if (src.includes("%d")) return src.replace("%d", String(ch));
  return src.replace(/\/+$/, "") + "/" + String(ch).padStart(3, "0") + ".mp3";
}

/* ======================================================================
   PLAYER
   ====================================================================== */
const A = new Audio();
A.preload = "metadata";
const P = { q: [], i: -1, repeat: 0, rate: 1, sleepT: 0, sleepEnd: false, obj: null, resumeAt: 0 };
const RATES = [1, 1.25, 1.5, 0.75];

function cur() { return P.q[P.i]; }

async function playList(tracks, i = 0, startAt = 0) {
  if (!tracks.length) return;
  const t = tracks[i];
  if (t.v) return openVideo(t);
  P.q = tracks; P.i = i; P.resumeAt = startAt;
  await loadCur(true);
}

async function loadCur(autoplay) {
  const t = cur();
  if (!t) return;
  if (P.obj) { URL.revokeObjectURL(P.obj); P.obj = null; }
  let src = t.u;
  // Only touch the cache for tracks saved offline: an await here would make iOS
  // drop the tap that allows playback to start.
  if (S.saved[t.u] && "caches" in window) {
    try {
      const hit = await (await caches.open("uq-audio")).match(t.u);
      if (hit) { P.obj = URL.createObjectURL(await hit.blob()); src = P.obj; }
    } catch {}
  }
  A.preload = "metadata";
  A.src = src;
  A.playbackRate = t.live ? 1 : P.rate;
  if (autoplay) A.play().catch(() => {});
  if (!t.adhan) S.last = { q: P.q.length > 400 ? P.q.slice(Math.max(0, P.i - 150), P.i + 250) : P.q, i: P.q.length > 400 ? Math.min(P.i, 150) : P.i, time: P.resumeAt || 0 };
  save();
  setMedia(t);
  updatePlayerUI(true);
}

A.addEventListener("loadedmetadata", () => {
  if (P.resumeAt) { try { A.currentTime = P.resumeAt; } catch {} P.resumeAt = 0; }
});
let lastPersist = 0;
A.addEventListener("timeupdate", () => {
  updateProgress();
  const now = Date.now();
  if (S.last && !cur()?.live && !cur()?.adhan && now - lastPersist > 5000) { lastPersist = now; S.last.time = A.currentTime; save(); }
});
A.addEventListener("play", () => updatePlayerUI());
A.addEventListener("pause", () => { updatePlayerUI(); if (S.last && !cur()?.adhan) { S.last.time = A.currentTime; save(); } });
A.addEventListener("ended", () => {
  if (P.sleepEnd) { P.sleepEnd = false; updatePlayerUI(); return; }
  if (P.repeat === 2) { A.currentTime = 0; A.play(); return; }
  next(true);
});
A.addEventListener("error", () => {
  if (!A.getAttribute("src")) return;
  const t = cur();
  toast(t?.live ? "الإذاعة لا تستجيب الآن، جرّب إذاعة أخرى" : "تعذّر تشغيل هذا المقطع من المصدر، جرّب مقطعاً آخر");
  updatePlayerUI();
});

function closePlayer() {
  if (S.last && cur() && !cur().adhan && !cur().live) { S.last.time = A.currentTime || S.last.time; save(true); }
  A.pause();
  A.removeAttribute("src"); A.load();
  if (P.obj) { URL.revokeObjectURL(P.obj); P.obj = null; }
  P.q = []; P.i = -1;
  clearTimeout(P.sleepT); P.sleepT = 0; P.sleepEnd = false;
  closeSheet();
  if ("mediaSession" in navigator) { try { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = "none"; } catch {} }
  updatePlayerUI();
  if (location.hash === "" || location.hash === "#/") { sessionStorage.setItem("keep-scroll", "1"); route(); }
}
function toggle() { if (!cur()) return; A.paused ? A.play().catch(() => {}) : A.pause(); }
function next(auto) {
  if (P.i < P.q.length - 1) { P.i++; loadCur(true); }
  else if (P.repeat === 1 && P.q.length) { P.i = 0; loadCur(true); }
  else if (!auto) toast("هذا آخر مقطع في القائمة");
}
function prev() {
  if (A.currentTime > 5 || P.i === 0) { A.currentTime = 0; return; }
  P.i--; loadCur(true);
}
function seekBy(s) { if (isFinite(A.duration)) A.currentTime = Math.max(0, Math.min(A.duration, A.currentTime + s)); }

function setMedia(t) {
  if (!("mediaSession" in navigator)) return;
  const art = t.img ? [{ src: new URL(t.img, location.href).href, sizes: "220x240", type: "image/webp" }]
    : [{ src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.t, artist: t.s || "", album: t.d || "ألترا قرآن", artwork: art });
  const ms = navigator.mediaSession;
  const h = { play: () => A.play(), pause: () => A.pause(), previoustrack: prev, nexttrack: () => next(), seekbackward: () => seekBy(-15), seekforward: () => seekBy(15) };
  for (const k in h) { try { ms.setActionHandler(k, h[k]); } catch {} }
  try { ms.setActionHandler("seekto", (e) => { A.currentTime = e.seekTime; }); } catch {}
}

/* ---- mini player & sheet UI ---- */
function artHTML(t) {
  if (t.img) return `<img src="${esc(t.img)}" alt="">`;
  return `<svg class="icon" aria-hidden="true" style="width:46%;height:46%"><use href="#i-${t.live ? "radio" : "star"}"/></svg>`;
}
function updatePlayerUI(full) {
  const t = cur();
  const mini = $("#mini");
  if (!t) { mini.classList.remove("show"); document.body.style.setProperty("--mini", "0px"); return; }
  mini.classList.add("show");
  document.body.style.setProperty("--mini", "70px");
  if (full) {
    $("#miniArt").innerHTML = artHTML(t);
    $("#miniT").textContent = t.t;
    $("#miniS").textContent = t.s || "";
  }
  const playing = !A.paused;
  $("#miniPP").innerHTML = ic(playing ? "pause" : "play");
  $("#miniPP").setAttribute("aria-label", playing ? "إيقاف مؤقت" : "تشغيل");
  if ($("#sheet").classList.contains("open")) renderSheet(full);
  $$(".row[data-u]").forEach((r) => r.classList.toggle("now", r.dataset.u === t.u));
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}
function updateProgress() {
  const d = A.duration, c = A.currentTime;
  const pct = isFinite(d) && d > 0 ? (c / d) * 100 : 0;
  $("#miniProg").style.width = pct + "%";
  const sk = $("#seek");
  if (sk && !sk.dataset.drag) {
    sk.max = isFinite(d) ? d : 0; sk.value = c;
    $("#tCur").textContent = fmtTime(c);
    $("#tDur").textContent = isFinite(d) ? fmtTime(d) : (cur()?.live ? "مباشر" : "--:--");
  }
}

function renderSheet(full) {
  const sh = $("#sheet"), t = cur();
  if (!t) return;
  if (!full && $("#bigPP")) {
    $("#bigPP").innerHTML = ic(A.paused ? "play" : "pause");
    $("#bigPP").setAttribute("aria-label", A.paused ? "تشغيل" : "إيقاف مؤقت");
    return;
  }
  const rep = ["التكرار مغلق", "تكرار القائمة", "تكرار المقطع"][P.repeat];
  const sleepOn = P.sleepT || P.sleepEnd;
  const qStart = Math.max(0, P.i - 2), qEnd = Math.min(P.q.length, P.i + 30);
  const queue = P.q.length > 1 ? `<div class="queue"><h3>قائمة التشغيل · ${n2a(P.i + 1)} من ${n2a(P.q.length)}</h3><ul class="list">${
    P.q.slice(qStart, qEnd).map((x, k) => `<li><button class="row ${qStart + k === P.i ? "now" : ""}" data-qi="${qStart + k}"><span class="num">${n2a(qStart + k + 1)}</span><span class="grow"><span class="t">${esc(x.t)}</span><span class="s">${esc(x.d || x.s || "")}</span></span></button></li>`).join("")
  }</ul></div>` : "";
  sh.innerHTML = `
    <div class="grab"><button data-act="closeSheet" aria-label="إغلاق المشغّل">${ic("down")}</button>
      ${t.live ? `<span class="live-badge">بث مباشر</span>` : `<span></span>`}
      <span style="display:flex"><button data-act="share" aria-label="مشاركة">${ic("share")}</button><button data-act="stopPlayer" aria-label="إيقاف وإغلاق المشغّل">${ic("x")}</button></span></div>
    <div class="cover">${artHTML(t)}</div>
    <h2>${esc(t.t)}</h2>
    <div class="who">${esc(t.s || "")}</div>
    <div class="det">${esc(t.d || "")}</div>
    <div class="seek"><input id="seek" type="range" min="0" step="1" value="0" aria-label="موضع التشغيل" ${t.live ? "disabled" : ""}>
      <div class="times"><span id="tCur">0:00</span><span id="tDur">--:--</span></div></div>
    <div class="controls">
      <button data-act="prev" aria-label="السابق">${ic("prev")}</button>
      <button data-act="rew" aria-label="رجوع 15 ثانية" ${t.live ? "disabled" : ""}>${ic("rew")}</button>
      <button class="big-pp" id="bigPP" data-act="toggle" aria-label="تشغيل">${ic(A.paused ? "play" : "pause")}</button>
      <button data-act="fwd" aria-label="تقديم 15 ثانية" ${t.live ? "disabled" : ""}>${ic("fwd")}</button>
      <button data-act="next" aria-label="التالي">${ic("next")}</button>
    </div>
    <div class="extras">
      <button data-act="fav" class="${isFav(t.u) ? "on" : ""}">${ic("heart")}${isFav(t.u) ? "في المفضلة" : "المفضلة"}</button>
      <button data-act="rate" ${t.live ? "disabled" : ""}>${ic("speed")}${n2a(P.rate)}×</button>
      <button data-act="repeat" class="${P.repeat ? "on" : ""}">${ic("repeat")}${rep}</button>
      <button data-act="sleep" class="${sleepOn ? "on" : ""}">${ic("moon")}${sleepOn ? "مؤقت مفعّل" : "مؤقت النوم"}</button>
      <button data-act="offline" class="${S.saved[t.u] ? "on" : ""}" ${t.live ? "disabled" : ""}>${ic(S.saved[t.u] ? "check" : "dl")}${S.saved[t.u] ? "محفوظ" : "بدون نت"}</button>
    </div>
    <div id="sleepBox"></div>
    ${queue}`;
  const sk = $("#seek");
  sk.addEventListener("input", () => { sk.dataset.drag = 1; $("#tCur").textContent = fmtTime(+sk.value); });
  sk.addEventListener("change", () => { A.currentTime = +sk.value; delete sk.dataset.drag; });
  updateProgress();
}
function openSheet() {
  if (!cur()) return;
  const sh = $("#sheet");
  sh.classList.add("open"); sh.setAttribute("aria-hidden", "false");
  renderSheet(true);
  history.pushState({ sheet: 1 }, "");
}
function closeSheet(fromPop) {
  const sh = $("#sheet");
  if (!sh.classList.contains("open")) return;
  sh.classList.remove("open"); sh.setAttribute("aria-hidden", "true");
  if (!fromPop && history.state?.sheet) history.back();
}

function setSleep(min) {
  clearTimeout(P.sleepT); P.sleepT = 0; P.sleepEnd = false;
  if (min === -1) { P.sleepEnd = true; toast("سيتوقف التشغيل بنهاية المقطع الحالي"); }
  else if (min > 0) { P.sleepT = setTimeout(() => { A.pause(); P.sleepT = 0; renderSheet(true); }, min * 60000); toast(`سيتوقف التشغيل بعد ${n2a(min)} دقيقة`); }
  else toast("تم إلغاء مؤقت النوم");
  renderSheet(true);
}

async function saveOffline(t) {
  if (S.saved[t.u]) {
    try { await (await caches.open("uq-audio")).delete(t.u); } catch {}
    delete S.saved[t.u]; save(true); toast("تم حذف المقطع من الحفظ بدون نت"); return;
  }
  if (!("caches" in window)) { toast("المتصفح ده مبيدعمش الحفظ بدون نت"); return; }
  try {
    if (navigator.storage?.persist) navigator.storage.persist();
    toast("جاري حفظ المقطع…", 60000);
    const r = await fetch(t.u, { mode: "cors" });
    if (!r.ok) throw new Error(r.status);
    const total = +r.headers.get("content-length") || 0;
    const reader = r.body.getReader(); const parts = []; let got = 0, lastShow = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (total && Date.now() - lastShow > 500) { lastShow = Date.now(); toast(`جاري الحفظ ${n2a(Math.round((got / total) * 100))}٪`, 60000); }
    }
    const blob = new Blob(parts, { type: r.headers.get("content-type") || "audio/mpeg" });
    await (await caches.open("uq-audio")).put(t.u, new Response(blob, { headers: { "Content-Type": blob.type, "Content-Length": String(blob.size) } }));
    S.saved[t.u] = { ...t, size: blob.size, at: Date.now() }; save(true);
    toast("اتحفظ ✓ تقدر تسمعه من غير نت من «محفوظاتي»");
  } catch {
    toast("الحفظ مكملش، اتأكد من النت وجرّب تاني");
  }
  if ($("#sheet").classList.contains("open")) renderSheet(true);
}

function toggleFav(t) {
  const k = S.fav.findIndex((f) => f.u === t.u);
  if (k >= 0) { S.fav.splice(k, 1); toast("اتشال من المفضلة"); }
  else { S.fav.unshift({ t: t.t, s: t.s, d: t.d, u: t.u, img: t.img, live: t.live, v: t.v }); toast("اتضاف للمفضلة"); }
  save(true);
}

/* ---- video ---- */
function openVideo(t) {
  A.pause();
  const v = $("#video");
  $("#vTitle").textContent = t.t;
  $("#vEl").src = t.u;
  v.classList.add("open"); v.setAttribute("aria-hidden", "false");
  $("#vEl").play().catch(() => {});
  history.pushState({ video: 1 }, "");
}
function closeVideo(fromPop) {
  const v = $("#video");
  if (!v.classList.contains("open")) return;
  $("#vEl").pause(); $("#vEl").removeAttribute("src"); $("#vEl").load();
  v.classList.remove("open"); v.setAttribute("aria-hidden", "true");
  if (!fromPop && history.state?.video) history.back();
}

/* ======================================================================
   ROUTER
   ====================================================================== */
const TILES = [
  { t: "الشيخ الشعراوي", m: "خواطر التفسير صوتاً وصورة", ic: "mic", go: "#/lib/1", p: 999 },
  { t: "المصحف والتفسير", m: "604 صفحة بروايتي حفص وورش", ic: "book", go: "#/mushaf" },
  { t: "الشيخ كشك", m: "383 خطبة في 10 أقسام", ic: "mic", go: "#/r/950", p: 950 },
  { t: "المبتهلون", m: "14 من أعلام الابتهال", ic: "star", go: "#/quran/m", p: 951 },
  { t: "التفسير وعلومه", m: "الطبري وابن كثير · 1155 درساً", ic: "tafsir", go: "#/lib/2" },
  { t: "الحديث الشريف", m: "شروح صوتية كاملة · 681 مادة", ic: "quote", go: "#/lib/3" },
  { t: "السنة والشمائل", m: "الشمائل والطب النبوي", ic: "lantern", go: "#/lib/4" },
  { t: "السيرة النبوية", m: "من المولد إلى الوفاة · 167 حلقة", ic: "palm", go: "#/lib/5" },
  { t: "قصص الأنبياء", m: "كما وردت في القرآن · 108 حلقة", ic: "ship", go: "#/lib/6" },
  { t: "العقيدة والفقه", m: "التوحيد وفقه العبادات", ic: "dome", go: "#/lib/7" },
  { t: "الأذكار والرقية", m: "حصن المسلم والمسبحة", ic: "beads", go: "#/lib/8" },
  { t: "أسماء الله الحسنى", m: "الأسماء الـ 99 ومعانيها", ic: "star", go: "#/lib/9" },
  { t: "إذاعات القرآن", m: "173 إذاعة بث مباشر", ic: "radio", go: "#/radio" },
  { t: "المكتبة الإسلامية", m: "زاد المعاد والمتون", ic: "books", go: "#/lib/11" },
  { t: "عالم الأطفال", m: "المصحف المعلم وجزء عمّ", ic: "kid", go: "#/lib/12" },
  { t: "التقويم الإسلامي", m: "التاريخ الهجري والمواسم", ic: "moon", go: "#/lib/13" },
  { t: "المسابقات", m: "70 سؤالاً بالنتيجة", ic: "q", go: "#/quiz" },
  { t: "البحث في القرآن", m: "ابحث بكلمة من أي آية", ic: "search", go: "#/search?in=quran" },
];

function setTop(title, opts = {}) {
  const top = $("#top");
  if (opts.home) {
    top.innerHTML = `<span class="brand"><svg aria-hidden="true"><use href="#i-star"/></svg><h1>ألترا قرآن</h1></span>
      <span class="credit"><small>تصميم وتطوير</small><b>أحمد الحضري</b></span>
      <button class="btn-icon" data-go="#/search" aria-label="بحث">${ic("search")}</button>`;
  } else {
    top.innerHTML = `<button class="btn-icon" data-act="back" aria-label="رجوع">${ic("back")}</button><h1>${esc(title)}</h1>
      <button class="btn-icon" data-go="#/search" aria-label="بحث">${ic("search")}</button>`;
  }
  document.title = opts.home ? "ألترا قرآن" : `${title} · ألترا قرآن`;
}
function setTab(root) {
  const h = location.hash || "#/";
  root = { r: "quran", index: "mushaf" }[root] || root;
  const links = $$("#tabs a:not(.rail-brand)");
  // the most specific link that matches the current address wins
  let best = null;
  for (const a of links) {
    const href = a.getAttribute("href");
    const hit = href === "#/" ? (h === "#/" || h === "#" || h === "") : (h === href || h.startsWith(href + "/") || h.startsWith(href + "?"));
    const fallback = href.slice(2).split("/")[0] === root && !href.includes("/", 2);
    if ((hit || fallback) && (!best || href.length > best.getAttribute("href").length)) best = a;
  }
  links.forEach((a) => { if (a === best) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
}

let renderToken = 0;
async function route() {
  if (history.state?.sheet || history.state?.video) return;
  closeSheet(true); closeVideo(true); stopCompass();
  if (!location.hash.startsWith("#/mushaf")) { document.body.classList.remove("immersive"); BOOK = null; }
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, qs] = hash.split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const view = $("#view");
  const tok = ++renderToken;
  LISTS = {}; listN = 0;
  setTab(parts[0] || "");
  const R = {
    "": home, quran: quranGallery, r: reciter, mushaf, index: mushafIndex, radio, lib, quiz, saved, search, prayer,
  }[parts[0] || ""] || home;
  try {
    const html = await R(parts.slice(1), new URLSearchParams(qs || ""));
    if (tok !== renderToken) return;
    if (typeof html === "string") {
      view.innerHTML = html;
      view.classList.remove("view-enter"); void view.offsetWidth; view.classList.add("view-enter");
    }
    const after = view.__after; view.__after = null;
    if (after) after();
    if (!sessionStorage.getItem("keep-scroll")) window.scrollTo(0, 0);
    sessionStorage.removeItem("keep-scroll");
    updatePlayerUI(false);
  } catch (e) {
    if (tok !== renderToken) return;
    console.error(e);
    view.innerHTML = `<div class="empty"><b>الصفحة دي مفتحتش</b>غالباً النت فصل. اتأكد من الاتصال وجرّب تاني.<div class="btn-row" style="justify-content:center"><button class="btn" data-act="reload">جرّب تاني</button></div></div>`;
  }
}
function after(fn) { $("#view").__after = fn; }

/* ---------------- HOME ---------------- */
async function home() {
  setTop("", { home: true });
  const today = new Date();
  let hijri = "";
  try { hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(today); } catch {}
  const greg = new Intl.DateTimeFormat("ar-EG-u-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(today);
  const day = Math.floor((today - new Date(today.getFullYear(), 0, 0)) / 864e5);
  const ayah = META.ayat[day % META.ayat.length];
  // compact "pick up where you left off" cards
  const cont = [];
  const card = (o) => `<${o.href ? `a href="${o.href}"` : "button"} class="cont k-${o.k}" ${o.act ? `data-act="${o.act}"` : ""}>
      <span class="cont-top"><span class="cont-art">${o.art}</span><span class="cont-btn">${icSm(o.btn || "play", 16)}</span></span>
      <span class="cont-cap">${esc(o.cap)}</span><b class="cont-t">${esc(o.t)}</b><span class="cont-s">${esc(o.s || "")}</span>
      ${o.pct != null ? `<span class="cont-bar"><i style="width:${Math.max(3, Math.min(100, o.pct))}%"></i></span>` : ""}${o.extra || ""}
    </${o.href ? "a" : "button"}>`;
  if (S.last?.q?.length) {
    const t = S.last.q[S.last.i];
    if (t && !t.adhan) {
      const dur = typeof t.dur === "number" ? t.dur : 0;
      cont.push(card({ k: t.live ? "radio" : "listen", act: "resume", cap: t.live ? "ارجع للإذاعة" : "كمّل الاستماع",
        t: t.t, s: t.live ? "بث مباشر" : `${t.s || ""}${S.last.time > 5 ? ` · ${fmtTime(S.last.time)}` : ""}`,
        art: t.img ? `<img src="${esc(t.img)}" alt="">` : icSm(t.live ? "radio" : "mic", 22),
        pct: !t.live && dur ? (S.last.time / dur) * 100 : null }));
    }
  }
  if (S.readAt) {
    cont.push(card({ k: "read", href: `#/mushaf/${S.page}`, btn: "book", cap: "تابع القراءة",
      t: `سورة ${META.chapters[surahOfPage(S.page)]}`, s: `صفحة ${n2a(S.page)} · الجزء ${n2a(juzOfPage(S.page))}`,
      art: `<span class="cont-num">${n2a(S.page)}</span>`, pct: (S.page / 604) * 100 }));
  }
  if (S.bookmark && S.bookmark !== S.page) {
    cont.push(card({ k: "mark", href: `#/mushaf/${S.bookmark}`, btn: "bookmark", cap: "العلامة",
      t: `سورة ${META.chapters[surahOfPage(S.bookmark)]}`, s: `صفحة ${n2a(S.bookmark)}`, art: icSm("bookmark", 22) }));
  }
  if (S.fav?.length) {
    cont.push(card({ k: "fav", href: "#/saved", btn: "chev", cap: "المفضلة", t: `${n2a(S.fav.length)} ${S.fav.length === 1 ? "مادة" : "مواد"}`,
      s: S.fav[0].t, art: S.fav[0].img ? `<img src="${esc(S.fav[0].img)}" alt="">` : icSm("heart", 22) }));
  }
  if (!isStandalone() && !S.installHidden) {
    cont.push(card({ k: "install", act: "install", btn: "dl", cap: "على موبايلك", t: "ثبّت التطبيق", s: "أيقونة على الشاشة الرئيسية",
      art: `<img src="icons/icon-192.png" alt="">`, extra: `<span class="cont-x" data-act="installHide" role="button" aria-label="إخفاء">${icSm("x", 13)}</span>` }));
  }
  const tile = (x) => `<a class="tile ${x.p ? "has-p" : ""}" href="${x.go}">${x.p && portrait(x.p) ? `<span class="tile-bg" style="background-image:url('${portrait(x.p)}')"></span>` : ""}<span class="ic">${ic(x.ic)}</span><b>${esc(x.t)}</b><small>${esc(x.m)}</small></a>`;
  const faces = RECITERS.filter((r) => r[5] && (r[2] === "q" || r[2] === "k")).slice(0, 72).map((r) => r[0]);
  return `<div class="home">
  <div class="home-top">
    <section class="hero">
      <div class="date">${esc(greg)}${hijri ? ` · <b>${esc(hijri)}</b>` : ""}</div>
      <blockquote>﴿${esc(ayah[0])}﴾</blockquote>
      <cite>سورة ${esc(ayah[1])} · الآية ${n2a(ayah[2])}</cite>
    </section>
    ${homePrayerPanel()}
  </div>
  ${cont.length ? `<div class="cont-row">${cont.join("")}</div>` : ""}
  <div class="sec-h"><h2>الأقسام</h2></div>
  <div class="tiles">
    <a class="tile feature" href="#/quran">
      <span class="feature-wall" aria-hidden="true">${faces.map((id) => `<img src="${portrait(id)}" alt="" loading="lazy" decoding="async">`).join("")}</span>
      <span class="ic">${ic("book")}</span><b>القرآن الكريم</b><small>المصاحف المرتلة لـ 260 قارئاً بكل الروايات، وتسجيلات نادرة لأعلام التلاوة</small>
      <span class="feature-go">تصفح القراء ${icSm("chev", 16).replace('class="icon"', 'class="icon flip"')}</span></a>
    ${TILES.map(tile).join("")}
  </div></div>`;
}

/* ---------------- RECITERS ---------------- */
async function quranGallery(parts) {
  const g = parts[0] === "m" ? "m" : "q";
  setTop(g === "m" ? "المبتهلون" : "القرآن الكريم");
  const people = RECITERS.filter((r) => r[2] === g);
  const chips = `<div class="chips" role="group" aria-label="التصنيف">
    <a class="chip" href="#/quran" aria-pressed="${g === "q"}">القراء · ${n2a(RECITERS.filter((r) => r[2] === "q").length)}</a>
    <a class="chip" href="#/quran/m" aria-pressed="${g === "m"}">المبتهلون · ${n2a(RECITERS.filter((r) => r[2] === "m").length)}</a>
    <a class="chip" href="#/r/950" aria-pressed="false">الشيخ كشك</a>
    <a class="chip" href="#/mushaf" aria-pressed="false">المصحف المصوّر</a></div>`;
  after(() => {
    const inp = $("#q");
    inp.addEventListener("input", () => {
      const v = norm(inp.value);
      let shown = 0;
      $$(".person").forEach((p) => { const ok = !v || norm(p.dataset.name).includes(v); p.hidden = !ok; shown += ok; });
      $("#none").hidden = shown > 0;
    });
  });
  return `${chips}
  <label class="search">${ic("search")}<input id="q" type="search" placeholder="${g === "m" ? "ابحث باسم المبتهل" : "ابحث باسم القارئ"}" autocomplete="off"></label>
  <div class="gallery">${people.map((r) => `<a class="person" href="#/r/${r[0]}" data-name="${esc(r[1])}">${avatar(r[0], r[1])}<b>${esc(r[1])}</b><small>${r[3] > 1 ? `${n2a(r[3])} تسجيلات` : `${n2a(r[4])} ${g === "m" ? "ابتهال" : "سورة"}`}</small></a>`).join("")}</div>
  <div class="empty" id="none" hidden><b>مفيش نتيجة</b>جرّب تكتب جزء من الاسم بس.</div>`;
}

function norm(s) {
  return String(s || "").replace(/[ً-ٰٟ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/^ال|\sال/g, " ").toLowerCase().trim();
}

/* ---------------- shared card helpers ---------------- */
const RIWAYAT = [
  ["حفص", "حفص"], ["شعبة", "شعبة"], ["ورش", "ورش"], ["قالون", "قالون"], ["الدوري", "الدوري"], ["دوري", "الدوري"],
  ["السوسي", "السوسي"], ["البزي", "البزي"], ["قنبل", "قنبل"], ["خلف", "خلف"], ["خلاد", "خلاد"],
  ["ابن ذكوان", "ابن ذكوان"], ["هشام", "هشام"], ["الكسائي", "الكسائي"], ["يعقوب", "يعقوب"], ["رويس", "رويس"], ["روح", "روح"],
];
function riwayaOf(name) {
  for (const [k, v] of RIWAYAT) if (name.includes(k)) return v;
  return "حفص";
}
const REC_KINDS = {
  murattal: { label: "المصاحف المرتلة", one: "مرتل", ic: "book" },
  mujawwad: { label: "المصاحف المجودة", one: "مجود", ic: "mic" },
  muallim: { label: "المصحف المعلم", one: "معلم", ic: "kid" },
  rare: { label: "تسجيلات نادرة ومحافل", one: "نادر", ic: "star" },
  alt: { label: "مصادر بديلة", one: "مصدر بديل", ic: "radio" },
};
function kindOf(rec) {
  const n = rec.name;
  if (/مصدر بديل|QuranicAudio/.test(n)) return "alt";
  if (rec.urls || /المكتبة الكاملة|نادر|محافل|حفلات|تسجيلات/.test(n)) return "rare";
  if (/معلم|المعلم/.test(n)) return "muallim";
  if (/مجود/.test(n)) return "mujawwad";
  return "murattal";
}
function recTitle(rec) {
  return rec.name.replace(/^المكتبة الكاملة\s*·\s*/, "").replace(/\s*·\s*(مصدر بديل\s*\(QuranicAudio\)|QuranicAudio)\s*$/, " · QuranicAudio");
}
const archiveId = (u) => (String(u).match(/^https:\/\/archive\.org\/download\/([^/]+)\//) || [])[1] || "";
const thumbOf = (id) => (id ? `https://archive.org/services/img/${encodeURIComponent(id)}` : "");
const icSm = (n, px = 18) => `<svg class="icon" aria-hidden="true" style="width:${px}px;height:${px}px"><use href="#i-${n}"/></svg>`;

function heroHTML({ id, name, facts, stats, bg }) {
  const src = portrait(id);
  return `<section class="phero">
    ${src ? `<div class="phero-bg" style="background-image:url('${src}')"></div>` : ""}
    <div class="phero-in">
      ${avatar(id, name)}
      <h2>${esc(name)}</h2>
      ${facts ? `<p class="facts">${esc(facts)}</p>` : ""}
      ${stats?.length ? `<div class="stats">${stats.map(([v, l]) => `<span><b>${esc(v)}</b>${esc(l)}</span>`).join("")}</div>` : ""}
    </div></section>`;
}
function bioHTML(bio) {
  if (!bio || !bio.summary) return "";
  return `<div class="bio clamp" id="bio"><p>${esc(bio.summary)}</p>
    <button class="more" data-act="bio">اقرأ السيرة كاملة</button>
    ${bio.source ? `<div class="src">المصدر: ${esc(bio.source)}</div>` : ""}</div>`;
}
function bioBlock(bio) {
  if (!bio || !bio.summary) return "";
  return `<div class="sec-h"><h2>السيرة الذاتية</h2></div>${bioHTML(bio)}`;
}
function videoCard(t, L, i, opts = {}) {
  const th = opts.thumb;
  return `<button class="vcard ${th ? "" : "nothumb"}" data-play="${L}:${i}">
    <span class="vthumb">${th ? `<img src="${esc(th)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : `<span class="vnum">${esc(opts.label || n2a(i + 1))}</span>`}
      <span class="vplay">${icSm("play", 20)}</span>${t.dur ? `<span class="vdur">${esc(t.dur)}</span>` : ""}</span>
    <span class="vt">${esc(t.t)}</span></button>`;
}

/* ---------------- RECITER ---------------- */
async function reciter(parts) {
  const id = +parts[0];
  const d = await getJSON(`data/r/${id}.json`);
  const sub = parts[1];
  if (sub === "v") return reciterVideos(d);
  if (sub) return recordingView(d, d.recs.find((r) => String(r.id) === sub) || d.recs[0]);
  setTop(d.name);
  const word = d.group === "k" ? "خطبة" : d.group === "m" ? "ابتهال" : "سورة";
  const total = d.recs.reduce((a, r) => a + r.ch.length, 0);
  const facts = d.bio ? [d.bio.born, d.bio.died].filter(Boolean).join(" · ") : "";
  const stats = [[n2a(d.recs.length), d.recs.length === 1 ? "تسجيل" : "تسجيلات"], [n2a(total), word]];
  if (d.videos.length) stats.push([n2a(d.videos.length), "فيديو"]);
  const img = portrait(id);

  // one queue per recording so the play buttons on the cards start it straight away
  const playable = (rec) => recTracks(d, rec, img);
  let body = "";
  if (d.recs.length === 1 && !d.videos.length) {
    return heroHTML({ id, name: d.name, facts, stats }) + trackList(playable(d.recs[0]), d.recs[0], word) + bioBlock(d.bio);
  }
  const cardFor = (rec) => {
    const kind = d.group === "q" ? kindOf(rec) : "rare";
    const L = reg(playable(rec));
    const riw = d.group === "q" ? riwayaOf(rec.name) : "";
    return `<article class="rcard k-${kind}" data-riw="${esc(riw)}">
      <a class="rcard-link" href="#/r/${id}/${rec.id}" aria-label="${esc(recTitle(rec))}"></a>
      <div class="rcard-top"><span class="rcard-ic">${icSm(REC_KINDS[kind].ic, 20)}</span>${riw ? `<span class="pill">${esc(riw)}</span>` : ""}</div>
      <h3>${esc(recTitle(rec))}</h3>
      <div class="rcard-foot"><span>${n2a(rec.ch.length)} ${word}</span>
        <button class="rplay" data-play="${L}:0" aria-label="تشغيل ${esc(recTitle(rec))}">${icSm("play", 20)}</button></div>
    </article>`;
  };
  if (d.group === "q") {
    const groups = {};
    d.recs.forEach((r) => (groups[kindOf(r)] ||= []).push(r));
    const riws = [...new Set(d.recs.map((r) => riwayaOf(r.name)))];
    if (riws.length > 1) {
      body += `<div class="chips sticky-chips" role="group" aria-label="الرواية" id="riwF">
        <button class="chip" aria-pressed="true" data-riwf="">كل الروايات</button>
        ${riws.map((r) => `<button class="chip" aria-pressed="false" data-riwf="${esc(r)}">${esc(r)}</button>`).join("")}</div>`;
    }
    for (const k of Object.keys(REC_KINDS)) {
      if (!groups[k]) continue;
      body += `<section class="rgroup" data-kind="${k}"><div class="sec-h"><h2>${REC_KINDS[k].label}</h2><span class="count">${n2a(groups[k].length)}</span></div>
        <div class="rgrid">${groups[k].map(cardFor).join("")}</div></section>`;
    }
  } else {
    body += `<div class="sec-h"><h2>${d.group === "k" ? "أقسام الخطب" : "المجلدات"}</h2><span class="count">${n2a(d.recs.length)}</span></div>
      <div class="rgrid">${d.recs.map(cardFor).join("")}</div>`;
  }
  if (d.videos.length) {
    const vt = d.videos.map((v) => ({ t: v[0], s: d.name, d: "فيديو", u: v[1], dur: v[2], img, v: true, th: thumbOf(v[3] || archiveId(v[1])) }));
    const VL = reg(vt);
    body += `<section><div class="sec-h"><h2>الفيديوهات</h2>${vt.length > 6 ? `<a href="#/r/${id}/v">عرض الكل · ${n2a(vt.length)}</a>` : ""}</div>
      <div class="vrow">${vt.slice(0, 12).map((t, i) => videoCard(t, VL, i, { thumb: t.th })).join("")}</div></section>`;
  }
  after(() => {
    const f = $("#riwF");
    if (!f) return;
    f.addEventListener("click", (e) => {
      const b = e.target.closest("[data-riwf]");
      if (!b) return;
      const r = b.dataset.riwf;
      $$("[data-riwf]", f).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      $$(".rcard").forEach((c) => { c.hidden = r && c.dataset.riw !== r; });
      $$(".rgroup").forEach((g) => { g.hidden = !$$(".rcard", g).some((c) => !c.hidden); });
    });
  });
  return heroHTML({ id, name: d.name, facts, stats }) + body + bioBlock(d.bio);
}

function recTracks(d, rec, img) {
  const custom = !!rec.urls;
  const word = d.group === "k" ? "خطبة" : d.group === "m" ? "ابتهال" : "تلاوة";
  return rec.ch.map((ch) => {
    const title = rec.titles?.[ch] || (custom ? `${word} رقم ${n2a(ch)}` : `سورة ${META.chapters[ch - 1]}`);
    let dur = rec.dur?.[ch];
    if (!dur && !custom) {
      dur = META.durations[ch - 1];
      if (/مجود/.test(rec.name)) dur *= 1.45; else if (/المعلم/.test(rec.name)) dur *= 1.6;
    }
    const info = custom ? `${word} ${n2a(ch)} من ${n2a(rec.ch.length)}` : `${META.madani.includes(ch) ? "مدنية" : "مكية"} · ${n2a(META.verses[ch - 1])} آية`;
    return { t: title, s: d.name, d: recTitle(rec), u: audioUrl(rec, ch), img, info, dur, ch, custom };
  });
}

function trackList(tracks, rec, word) {
  const L = reg(tracks);
  const searchable = tracks.length > 12;
  if (searchable) {
    after(() => {
      const inp = $("#tq");
      inp.addEventListener("input", () => {
        const v = norm(inp.value);
        $$("#tracks li").forEach((li) => { li.hidden = v && !norm(li.dataset.n).includes(v); });
      });
    });
  }
  return `<div class="btn-row"><button class="btn" data-play="${L}:0">${ic("play")}تشغيل الكل</button>
    ${tracks.length > 1 ? `<button class="btn ghost" data-act="shuffle" data-list="${L}">عشوائي</button>` : ""}</div>
    ${searchable ? `<label class="search">${ic("search")}<input id="tq" type="search" placeholder="ابحث في القائمة" autocomplete="off"></label>` : ""}
    <ul class="list" id="tracks">${tracks.map((t, i) => `<li data-n="${esc(t.t)}"><div class="row" data-u="${esc(t.u)}">
      <button class="num" data-play="${L}:${i}" aria-label="تشغيل ${esc(t.t)}">${t.custom || !t.ch ? n2a(i + 1) : n2a(t.ch)}</button>
      <button class="grow" data-play="${L}:${i}" style="text-align:start"><span class="t">${esc(t.t)}</span><span class="s">${esc(t.info || "")}${t.dur ? ` · ${typeof t.dur === "number" ? fmtTime(t.dur) : esc(t.dur)}` : ""}</span></button>
      <span class="end"><button data-fav="${L}:${i}" class="${isFav(t.u) ? "on" : ""}" aria-label="المفضلة">${ic("heart")}</button></span></div></li>`).join("")}</ul>`;
}

function recordingView(d, rec) {
  setTop(d.name);
  const img = portrait(d.id);
  const kind = d.group === "q" ? kindOf(rec) : "rare";
  const word = d.group === "k" ? "خطبة" : d.group === "m" ? "ابتهال" : "سورة";
  const riw = d.group === "q" ? riwayaOf(rec.name) : "";
  const head = `<section class="rhead k-${kind}">
    ${avatar(d.id, d.name)}
    <div><span class="kind">${esc(d.group === "q" ? REC_KINDS[kind].one : d.name)}${riw ? ` · رواية ${esc(riw)}` : ""}</span>
    <h2>${esc(recTitle(rec))}</h2><p>${esc(d.name)} · ${n2a(rec.ch.length)} ${word}</p></div></section>`;
  const others = d.recs.length > 1 ? `<div class="chips" aria-label="تسجيلات أخرى">${d.recs.map((r) => `<a class="chip" href="#/r/${d.id}/${r.id}" aria-pressed="${r === rec}">${esc(recTitle(r))}</a>`).join("")}</div>` : "";
  after(() => { const on = $('.chips .chip[aria-pressed="true"]'); if (on) on.scrollIntoView({ inline: "center", block: "nearest" }); });
  return head + others + trackList(recTracks(d, rec, img), rec, word);
}

function reciterVideos(d) {
  setTop(`فيديوهات ${d.name}`);
  const img = portrait(d.id);
  const vt = d.videos.map((v) => ({ t: v[0], s: d.name, d: "فيديو", u: v[1], dur: v[2], img, v: true, th: thumbOf(v[3] || archiveId(v[1])) }));
  const L = reg(vt);
  after(() => {
    const inp = $("#vq");
    inp?.addEventListener("input", () => {
      const v = norm(inp.value);
      $$(".vgrid .vcard").forEach((c) => { c.hidden = v && !norm(c.textContent).includes(v); });
    });
  });
  return `${vt.length > 8 ? `<label class="search">${ic("search")}<input id="vq" type="search" placeholder="ابحث في الفيديوهات" autocomplete="off"></label>` : ""}
    <div class="vgrid">${vt.map((t, i) => videoCard(t, L, i, { thumb: t.th })).join("")}</div>`;
}

/* ---------------- RADIO ---------------- */
async function radio() {
  setTop("إذاعات القرآن");
  const rs = await getJSON("data/radios.json");
  const byName = {};
  RECITERS.forEach((x) => { byName[norm(x[1])] = x[0]; });
  const tracks = rs.map((r) => ({ t: r[0], s: "إذاعة القرآن الكريم", d: "بث مباشر على مدار الساعة", u: r[1], live: true, img: portrait(byName[norm(r[0])]) }));
  const L = reg(tracks);
  after(() => {
    const inp = $("#q");
    inp.addEventListener("input", () => {
      const v = norm(inp.value);
      $$("#radios li").forEach((li) => { li.hidden = v && !norm(li.dataset.name).includes(v); });
    });
  });
  return `<p class="note">${n2a(rs.length)} إذاعة بث مباشر. الإذاعة بتشتغل في الخلفية حتى لو قفلت الشاشة.</p>
  <label class="search">${ic("search")}<input id="q" type="search" placeholder="ابحث باسم القارئ أو الإذاعة" autocomplete="off"></label>
  <ul class="list" id="radios">${tracks.map((t, i) => `<li data-name="${esc(t.t)}"><div class="row" data-u="${esc(t.u)}">
    <button class="num" data-play="${L}:${i}" aria-label="تشغيل">${ic("radio").replace('class="icon"', 'class="icon" style="width:18px;height:18px"')}</button>
    <button class="grow" data-play="${L}:${i}" style="text-align:start"><span class="t">${esc(t.t)}</span><span class="s"><span class="live-badge">مباشر</span></span></button>
    <span class="end"><button data-fav="${L}:${i}" class="${isFav(t.u) ? "on" : ""}" aria-label="المفضلة">${ic("heart")}</button></span></div></li>`).join("")}</ul>`;
}

/* ---------------- LIBRARY ---------------- */
const kidsOf = (n) => n && (n.folders || n.items || n.children || null);
const nodeTitle = (n) => n.title || "";
const SEC_ICON = { 1: "mic", 2: "tafsir", 3: "quote", 4: "lantern", 5: "palm", 6: "ship", 7: "dome", 8: "beads", 9: "star", 11: "books", 12: "kid", 13: "moon" };

function countLeaves(n) {
  const k = kidsOf(n);
  if (!k) return { a: typeof n.audio === "string" && !n.video ? 1 : 0, v: n.video ? 1 : 0, t: !n.audio && n.body ? 1 : 0 };
  return k.reduce((acc, c) => { const x = countLeaves(c); acc.a += x.a; acc.v += x.v; acc.t += x.t; return acc; }, { a: 0, v: 0, t: 0 });
}
function folderKind(n) {
  const c = countLeaves(n);
  if (c.v && !c.a) return "video";
  if (c.a) return "audio";
  return "text";
}
const KIND_IC = { video: "video", audio: "mic", text: "text" };

async function lib(parts) {
  const sec = parts[0];
  if (sec === "14") { location.replace("#/quiz"); return null; }
  const root = await getJSON(`data/lib/${sec}.json`);
  let node = root; const trail = [];
  for (const p of parts.slice(1)) { const k = kidsOf(node); if (!k || !k[+p]) break; node = k[+p]; trail.push(+p); }
  const kids = kidsOf(node);
  setTop(nodeTitle(node));
  const base = `#/lib/${sec}${trail.length ? "/" + trail.join("/") : ""}`;
  if (!kids) return leafView(node, base, root);

  const posterId = node.poster_id || (root.bio ? 999 : null);
  const img = portrait(posterId);
  const c = countLeaves(node);
  const stats = [];
  if (c.a) stats.push([n2a(c.a), "صوتية"]);
  if (c.v) stats.push([n2a(c.v), "فيديو"]);
  if (c.t) stats.push([n2a(c.t), "موضوع"]);

  // ---- header
  let head;
  if (node === root) {
    if (root.bio) {
      head = heroHTML({ id: 999, name: root.bio.name, facts: [root.bio.born, root.bio.died].filter(Boolean).join(" · "), stats });
    } else {
      head = `<section class="shero"><span class="medal">${icSm(SEC_ICON[sec] || "star", 34)}</span>
        <h2>${esc(root.title)}</h2>${root.sub ? `<p>${esc(root.sub)}</p>` : ""}
        ${stats.length ? `<div class="stats">${stats.map(([v, l]) => `<span><b>${esc(v)}</b>${esc(l)}</span>`).join("")}</div>` : ""}</section>`;
    }
  } else {
    const kind = folderKind(node);
    head = `<section class="rhead k-${kind === "video" ? "mujawwad" : kind === "audio" ? "murattal" : "muallim"}">
      ${img ? avatar(posterId, "") : `<span class="avatar">${icSm(KIND_IC[kind], 34)}</span>`}
      <div><span class="kind">${esc(node.type_label || root.title)}</span><h2>${esc(node.title)}</h2>
      <p>${esc(node.badge || node.count_label || "")}</p></div></section>
      ${node.summary || node.body ? `<p class="lead">${esc(node.summary || node.body)}</p>` : ""}`;
  }

  // ---- body: folders as cards, leaves as list or video grid
  const folders = [], leaves = [];
  kids.forEach((k, i) => (kidsOf(k) ? folders : leaves).push([k, i]));
  let body = "";
  if (folders.length) {
    const compact = folders.length > 10;
    const big = folders.length <= 3 && node === root && root.bio;
    body += `<div class="sec-h"><h2>${compact ? "الفولدرات" : "الأقسام"}</h2><span class="count">${n2a(folders.length)}</span></div>`;
    if (big) {
      body += `<div class="poster-grid">${folders.map(([k, i]) => {
        const kind = folderKind(k);
        return `<a class="poster k-${kind}" href="${base}/${i}">
          ${img ? `<span class="poster-bg" style="background-image:url('${img}')"></span>` : ""}
          <span class="poster-ic">${icSm(KIND_IC[kind], 30)}</span>
          <span class="poster-t">${esc(k.title)}</span>
          <span class="poster-m">${esc(k.badge || "")}</span>
          <span class="poster-s">${esc(k.subtitle || "")}</span>
          <span class="poster-go">افتح ${icSm("chev", 16).replace('class="icon"', 'class="icon flip"')}</span></a>`;
      }).join("")}</div>`;
    } else if (compact) {
      body += `<label class="search">${ic("search")}<input id="fq" type="search" placeholder="ابحث في الفولدرات" autocomplete="off"></label>
        <div class="ftiles" id="ftiles">${folders.map(([k, i], n) => `<a class="ftile" href="${base}/${i}" data-n="${esc(k.title)}">
          <span class="fnum">${n2a(n + 1)}</span><b>${esc(k.title.replace(/^(خواطر|تفسير)\s+/, ""))}</b><small>${esc(k.count_label || k.badge || "")}${k.riwayas_label && k.riwayas_label !== k.count_label ? ` · ${esc(k.riwayas_label)}` : ""}</small></a>`).join("")}</div>`;
      after(() => {
        const inp = $("#fq");
        inp.addEventListener("input", () => {
          const v = norm(inp.value);
          $$("#ftiles .ftile").forEach((t) => { t.hidden = v && !norm(t.dataset.n).includes(v); });
        });
      });
    } else {
      body += `<div class="fgrid">${folders.map(([k, i]) => {
        const kind = folderKind(k);
        return `<a class="fcard k-${kind}" href="${base}/${i}">
          <span class="fcard-top"><span class="rcard-ic">${icSm(KIND_IC[kind], 20)}</span>${k.type_label ? `<span class="pill">${esc(k.type_label)}</span>` : ""}</span>
          <b>${esc(k.title)}</b>
          ${k.subtitle ? `<small class="fsub">${esc(k.subtitle)}</small>` : ""}
          <span class="fmeta">${esc(k.count_label || k.badge || "")}${k.riwayas_label && k.count_label ? `<i>${esc(k.riwayas_label)}</i>` : ""}</span></a>`;
      }).join("")}</div>`;
    }
  }
  if (leaves.length) {
    const videos = leaves.filter(([k]) => k.video && typeof k.audio === "string");
    const audios = leaves.filter(([k]) => typeof k.audio === "string" && !k.video);
    const others = leaves.filter(([k]) => typeof k.audio !== "string");
    if (others.length) {
      body += `<div class="sec-h"><h2>${others.some(([k]) => k.counter) ? "المسبحة والأذكار" : "المواضيع"}</h2><span class="count">${n2a(others.length)}</span></div>
        <div class="fgrid">${others.map(([k, i]) => {
          const go = k.edition ? `#/r/${META.edmap[k.edition] || ""}/${k.edition}` : `${base}/${i}`;
          const icon = k.counter ? "beads" : k.edition ? "play" : "text";
          return `<a class="fcard k-${k.counter ? "mujawwad" : k.edition ? "audio" : "text"}" href="${go}">
            <span class="fcard-top"><span class="rcard-ic">${icSm(icon, 20)}</span>${k.counter ? `<span class="pill">${n2a(k.counter)} مرة</span>` : ""}</span>
            <b>${esc(k.title)}</b>${k.subtitle || k.badge ? `<small class="fsub">${esc(k.badge || k.subtitle)}</small>` : ""}</a>`;
        }).join("")}</div>`;
    }
    if (audios.length) {
      const tracks = audios.map(([k, i]) => ({ t: k.title, s: root.bio ? root.bio.name : root.title, d: k.subtitle || "", u: k.audio, img, live: !!k.live, dur: k.duration || "", info: k.subtitle && k.subtitle !== k.title ? k.subtitle : (k.badge || ""), bodyHref: k.body ? `${base}/${i}` : "" }));
      body += `${folders.length || others.length ? `<div class="sec-h"><h2>الصوتيات</h2><span class="count">${n2a(tracks.length)}</span></div>` : ""}` + trackListLib(tracks);
    }
    if (videos.length) {
      const vt = videos.map(([k]) => ({ t: k.title, s: root.bio ? root.bio.name : root.title, d: "فيديو", u: k.audio, img, v: true, dur: k.duration || "", id: archiveId(k.audio) }));
      const unique = new Set(vt.map((x) => x.id)).size === vt.length;
      const L = reg(vt);
      body += `${audios.length || folders.length ? `<div class="sec-h"><h2>الفيديو</h2><span class="count">${n2a(vt.length)}</span></div>` : ""}
        <div class="vgrid">${vt.map((t, n) => videoCard(t, L, n, { thumb: unique ? thumbOf(t.id) : "", label: (t.t.match(/الآيا?ت?\s*([\d–\-]+)/) || [])[1] || n2a(n + 1) })).join("")}</div>`;
    }
  }
  return head + body + (node === root && root.bio ? bioBlock(root.bio) : "");
}

function trackListLib(tracks) {
  const L = reg(tracks);
  if (tracks.length > 12) {
    after(() => {
      const inp = $("#tq");
      inp?.addEventListener("input", () => {
        const v = norm(inp.value);
        $$("#tracks li").forEach((li) => { li.hidden = v && !norm(li.dataset.n).includes(v); });
      });
    });
  }
  return `<div class="btn-row">${tracks.length > 1 ? `<button class="btn" data-play="${L}:0">${ic("play")}تشغيل الكل</button><button class="btn ghost" data-act="shuffle" data-list="${L}">عشوائي</button>` : `<button class="btn" data-play="${L}:0">${ic("play")}استمع</button>`}</div>
    ${tracks.length > 12 ? `<label class="search">${ic("search")}<input id="tq" type="search" placeholder="ابحث في القائمة" autocomplete="off"></label>` : ""}
    <ul class="list" id="tracks">${tracks.map((t, i) => `<li data-n="${esc(t.t)}"><div class="row" data-u="${esc(t.u)}">
      <button class="num" data-play="${L}:${i}" aria-label="تشغيل ${esc(t.t)}">${t.live ? icSm("radio") : n2a(i + 1)}</button>
      <button class="grow" data-play="${L}:${i}" style="text-align:start"><span class="t">${esc(t.t)}</span><span class="s">${t.live ? `<span class="live-badge">مباشر</span>` : esc([t.info !== t.t ? t.info : "", t.dur].filter(Boolean).join(" · "))}</span></button>
      <span class="end">${t.bodyHref ? `<a href="${t.bodyHref}" aria-label="اقرأ النص" style="width:38px;height:38px;display:grid;place-items:center">${ic("text")}</a>` : ""}
      <button data-fav="${L}:${i}" class="${isFav(t.u) ? "on" : ""}" aria-label="المفضلة">${ic("heart")}</button></span></div></li>`).join("")}</ul>`;
}

function leafView(node, base, root) {
  // swipeable cards: every readable sibling of this item (Names of Allah, adhkar, tasbih, articles…)
  const parentPath = base.split("/").slice(0, -1).join("/");
  const myIndex = +base.split("/").pop();
  let parent = root;
  const trail = parentPath.replace(/^#\/lib\/\d+\/?/, "").split("/").filter(Boolean).map(Number);
  for (const i of trail) parent = kidsOf(parent)[i];
  const sibs = (kidsOf(parent) || []).map((k, i) => [k, i]).filter(([k]) => !kidsOf(k) && (k.body || k.counter || (k.audio && k.body)));
  if (!sibs.some(([, i]) => i === myIndex)) sibs.splice(0, sibs.length, [node, myIndex]);
  const start = Math.max(0, sibs.findIndex(([, i]) => i === myIndex));
  const total = sibs.length;
  const slide = ([k, i], n) => {
    let track = "";
    if (typeof k.audio === "string") {
      const t = { t: k.title, s: root.title, d: k.subtitle || k.badge || "", u: k.audio, live: !!k.live, v: !!k.video };
      track = `<div class="btn-row"><button class="btn" data-play="${reg([t])}:0">${ic(t.v ? "video" : "play")}${t.v ? "شاهد الفيديو" : "استمع"}</button></div>`;
    }
    const tas = k.counter ? `<div class="tasbih"><button class="bead" data-bead="${k.counter}" aria-label="اضغط للتسبيح"><span><span class="cnt">0</span><small class="rounds">الهدف ${n2a(k.counter)}</small></span></button>
      <button class="btn ghost" data-act="beadReset">ابدأ من جديد</button></div>` : "";
    return `<div class="tslide" data-i="${i}" data-title="${esc(k.title)}"><div class="tslide-in">
      ${tas}<article class="reader"><span class="rnum">${n2a(n + 1)}</span><h2>${esc(k.title)}</h2>
      <div class="sub">${esc([k.subtitle, k.badge].filter(Boolean).join(" · "))}</div>${track}
      ${k.body ? `<div class="body">${esc(k.body)}</div>` : ""}</article></div></div>`;
  };
  after(() => {
    const deck = $("#deck");
    const go = (n, smooth) => { const el = deck.children[n]; if (el) deck.scrollTo({ left: el.offsetLeft - deck.offsetLeft, behavior: smooth ? "smooth" : "instant" }); };
    go(start, false);
    let cur = start, t = 0;
    deck.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!document.body.contains(deck)) return;
        const n = Math.round(Math.abs(deck.scrollLeft) / (deck.clientWidth || 1));
        if (n === cur || !deck.children[n]) return;
        cur = n;
        const el = deck.children[n];
        history.replaceState(history.state, "", `${parentPath}/${el.dataset.i}`);
        setTop(el.dataset.title);
        $("#dkPos").textContent = `${n2a(n + 1)} / ${n2a(total)}`;
        $("#dkBar").style.width = `${((n + 1) / total) * 100}%`;
      }, 80);
    }, { passive: true });
    $("#dkPrev").onclick = () => go(cur - 1, true);
    $("#dkNext").onclick = () => go(cur + 1, true);
    deck.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") go(cur + 1, true); if (e.key === "ArrowRight") go(cur - 1, true); });
    if (total > 1 && !S.deckHint) { S.deckHint = 1; save(); toast("اسحب يمين وشمال عشان تتنقل بينهم", 3000); }
  });
  return `<div class="deckbar">
      <button class="navbtn" id="dkPrev" aria-label="السابق">${ic("chev")}</button>
      <div class="grow"><b id="dkPos">${n2a(start + 1)} / ${n2a(total)}</b><span class="dkprog"><i id="dkBar" style="width:${((start + 1) / total) * 100}%"></i></span></div>
      <button class="chip fs" data-act="fs" data-d="-1" aria-label="تصغير الخط">أ-</button>
      <button class="chip fs" data-act="fs" data-d="1" aria-label="تكبير الخط">أ+</button>
      <button class="navbtn" id="dkNext" aria-label="التالي">${ic("chev").replace('class="icon"', 'class="icon flip"')}</button>
    </div>
    <div class="deck" id="deck" dir="rtl" tabindex="0" style="--rfs:${S.fs || 1}">${sibs.map(slide).join("")}</div>`;
}

/* ---------------- QUIZ ---------------- */
async function quiz() {
  setTop("المسابقات");
  const d = await getJSON("data/lib/14.json");
  const qs = d.questions.map((q, i) => i).sort(() => Math.random() - 0.5).slice(0, 10);
  let k = 0, score = 0;
  const draw = () => {
    const box = $("#quiz");
    if (k >= qs.length) {
      if (score > S.quizBest) { S.quizBest = score; save(true); }
      box.innerHTML = `<div class="empty"><b>نتيجتك ${n2a(score)} من ${n2a(qs.length)}</b>${score === qs.length ? "ما شاء الله! إجابات كاملة." : score >= 7 ? "نتيجة ممتازة، بارك الله فيك." : "حاول تاني، كل مرة أسئلة مختلفة."}<br>أفضل نتيجة ليك: ${n2a(S.quizBest)}
        <div class="btn-row" style="justify-content:center"><button class="btn" id="again">جولة جديدة</button></div></div>`;
      $("#again").onclick = () => route();
      return;
    }
    const q = d.questions[qs[k]];
    box.innerHTML = `<div class="bar"><i style="width:${(k / qs.length) * 100}%"></i></div>
      <div class="meta"><span>سؤال ${n2a(k + 1)} من ${n2a(qs.length)}</span><span>النتيجة ${n2a(score)}</span></div>
      <div class="q">${esc(q.q)}</div>
      ${q.options.map((o, i) => `<button class="opt" data-i="${i}">${esc(o)}</button>`).join("")}
      <div id="exp"></div>`;
    $$(".opt", box).forEach((b) => b.addEventListener("click", () => {
      if (box.dataset.done === "1") return;
      box.dataset.done = "1";
      const i = +b.dataset.i;
      if (i === q.answer) score++;
      $$(".opt", box).forEach((x) => { if (+x.dataset.i === q.answer) x.classList.add("right"); else if (x === b) x.classList.add("wrong"); });
      $("#exp").innerHTML = `<p class="note">${esc(q.explanation)}</p><div class="btn-row"><button class="btn" id="nx">${k + 1 < qs.length ? "السؤال التالي" : "شوف النتيجة"}</button></div>`;
      $("#nx").onclick = () => { k++; box.dataset.done = "0"; draw(); window.scrollTo(0, 0); };
    }));
  };
  after(draw);
  return `<p class="note">${esc(d.sub || "")} · ${n2a(d.questions.length)} سؤال، كل جولة 10 أسئلة عشوائية.</p><div class="quiz" id="quiz"></div>`;
}

/* ---------------- MUSHAF ---------------- */
const PAGE_SRC = {
  hafs: [
    (p) => `https://cdn.jsdelivr.net/gh/GovarJabbar/Quran-PNG@master/${String(p).padStart(3, "0")}.png`,
    (p) => `https://raw.githubusercontent.com/GovarJabbar/Quran-PNG/master/${String(p).padStart(3, "0")}.png`,
    (p) => `https://files.quran.app/hafs/madani/width_1920/page${String(p).padStart(3, "0")}.png`,
  ],
  warsh: [
    (p) => `https://raw.githubusercontent.com/samaneng2002/nurani-warsh-mushaf/main/pages/page_warsh_${String(p).padStart(3, "0")}.png`,
    (p) => `https://cdn.jsdelivr.net/gh/samaneng2002/nurani-warsh-mushaf@main/pages/page_warsh_${String(p).padStart(3, "0")}.png`,
  ],
};
const surahOfPage = (p) => { let s = 0; META.spages.forEach((sp, i) => { if (sp <= p) s = i; }); return s; };
const juzOfPage = (p) => { let j = 0; META.jpages.forEach((jp, i) => { if (jp <= p) j = i; }); return j + 1; };

async function mushaf(parts) {
  const page = Math.min(604, Math.max(1, +parts[0] || S.page || 1));
  S.page = page; S.readAt = Date.now(); save();
  setTop(`سورة ${META.chapters[surahOfPage(page)]}`);
  const riw = S.riwaya;
  const mr = MUSHAF_RECITERS.find((x) => x[0] === S.mReciter) || MUSHAF_RECITERS[0];
  const leaves = Array.from({ length: 604 }, (_, i) => `<div class="leaf" data-p="${i + 1}"><div class="leaf-in ${S.mode === "text" ? "txt" : ""}"></div></div>`).join("");
  after(() => setupBook(page));
  return `
  <div class="mushaf-bar">
    <button class="navbtn" data-act="pgPrev" aria-label="الصفحة السابقة">${ic("chev")}</button>
    <div class="grow"><b id="mbPage">صفحة ${n2a(page)}</b><span id="mbInfo">الجزء ${n2a(juzOfPage(page))} · ${riw === "hafs" ? "حفص عن عاصم" : "ورش عن نافع"}</span></div>
    <button class="navbtn" data-act="pgNext" aria-label="الصفحة التالية">${ic("chev").replace('class="icon"', 'class="icon flip"')}</button>
  </div>
  <div class="chips" role="group" aria-label="خيارات المصحف">
    <button class="chip" data-act="listenSurah" aria-pressed="false">${icSm("play", 15)} استمع · ${esc(mr[2])}</button>
    <button class="chip" data-act="pickMReciter" aria-pressed="false" aria-label="تغيير القارئ">${icSm("people", 15)}</button>
    <a class="chip" href="#/index" aria-pressed="false">${icSm("list", 15)} الفهرس</a>
    <a class="chip" href="#/search?in=quran" aria-pressed="false">${icSm("search", 15)} بحث في الآيات</a>
    <button class="chip" data-act="bookmark" id="bmChip" aria-pressed="${S.bookmark === page}">${icSm("bookmark", 15)} علامة</button>
    <button class="chip" data-act="immersive" aria-pressed="false">${icSm("expand", 15)} ملء الشاشة</button>
    <button class="chip" data-act="riwaya" aria-pressed="${riw === "warsh"}">رواية ورش</button>
    <button class="chip" data-act="mode" aria-pressed="${S.mode === "text"}">نص بدل الصورة</button>
    <button class="chip" data-act="tafsirT" aria-pressed="${S.tafsir}">التفسير الميسّر</button>
    <button class="chip" data-act="saveMushaf" aria-pressed="false">حفظ بدون نت</button>
  </div>
  <div class="book" id="book" dir="rtl" tabindex="0" aria-label="صفحات المصحف، اسحب يمين وشمال">${leaves}</div>
  <button class="imm-exit" data-act="immersive" aria-label="خروج من ملء الشاشة">${icSm("x", 20)}</button>
  <section class="tafsir" id="tafsir" ${S.tafsir ? "" : "hidden"}></section>`;
}

const MUSHAF_RECITERS = [
  [118, 118, "الحصري"], [112, 112, "المنشاوي"], [51, 53, "عبد الباسط"], [125, 125, "مصطفى إسماعيل"],
  [121, 121, "البنا"], [106, 106, "الطبلاوي"], [123, 123, "العفاسي"], [102, 102, "المعيقلي"],
  [54, 54, "السديس"], [31, 31, "الشريم"], [92, 92, "ياسر الدوسري"],
];
let BOOK = null;
function setupBook(page) {
  const book = $("#book");
  if (!book) return;
  BOOK = { el: book, page, loaded: new Set() };
  const leafOf = (p) => book.children[p - 1];
  const leafW = () => book.children[0].getBoundingClientRect().width || book.clientWidth || 1;
  const twoUp = () => leafW() < book.clientWidth * 0.75;
  const goTo = (p, smooth) => {
    p = Math.min(604, Math.max(1, p));
    if (twoUp() && p % 2 === 0) p -= 1;   // open book: the odd page sits on the right
    book.scrollTo({ left: -(p - 1) * leafW(), behavior: smooth ? "smooth" : "instant" });
  };
  BOOK.goTo = goTo;
  BOOK.step = () => (twoUp() ? 2 : 1);
  goTo(page, false);
  const ensure = (p) => { for (const q of [p, p + 1, p - 1, p + 2, p + 3]) if (q >= 1 && q <= 604) fillLeaf(leafOf(q), q); };
  ensure(page);
  if (S.tafsir) drawTafsir(page);
  let t = 0;
  const settle = () => {
    if (!document.body.contains(book)) return;
    const p = Math.min(604, Math.max(1, Math.round(Math.abs(book.scrollLeft) / leafW()) + 1));
    ensure(p);
    if (p === BOOK.page) return;
    BOOK.page = p;
    S.page = p; S.readAt = Date.now(); save();
    history.replaceState(history.state, "", `#/mushaf/${p}`);
    setTop(`سورة ${META.chapters[surahOfPage(p)]}`);
    $("#mbPage").textContent = `صفحة ${n2a(p)}`;
    $("#mbInfo").textContent = `الجزء ${n2a(juzOfPage(p))} · ${S.riwaya === "hafs" ? "حفص عن عاصم" : "ورش عن نافع"}`;
    $("#bmChip")?.setAttribute("aria-pressed", String(S.bookmark === p));
    if (S.tafsir) drawTafsir(p);
  };
  book.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(settle, 90); }, { passive: true });
  book.addEventListener("click", () => { if (document.body.classList.contains("immersive")) toggleImmersive(); });
  window.addEventListener("resize", () => { if (BOOK?.el === book) goTo(BOOK.page, false); });
  if (!S.swipeHint) { S.swipeHint = 1; save(); toast("اسحب الصفحة يمين وشمال عشان تقلّب زي المصحف", 3500); }
}
function fillLeaf(leaf, p) {
  if (!leaf || leaf.dataset.done) return;
  leaf.dataset.done = "1";
  const box = leaf.firstElementChild;
  box.innerHTML = `<div class="loading">صفحة ${n2a(p)}…</div>`;
  if (S.mode === "text") return fillText(box, p);
  const srcs = PAGE_SRC[S.riwaya];
  let k = 0;
  const img = new Image();
  img.alt = `صفحة ${p} من المصحف الشريف`;
  img.decoding = "async";
  img.draggable = false;
  img.onload = () => { box.innerHTML = ""; box.appendChild(img); };
  img.onerror = () => { k++; if (k < srcs.length) img.src = srcs[k](p); else fillText(box, p); };
  img.src = srcs[0](p);
}
async function fillText(box, p) {
  box.classList.add("txt");
  try {
    const d = await getJSON(`https://api.alquran.cloud/v1/page/${p}/quran-uthmani`);
    let html = "";
    for (const a of d.data.ayahs) {
      let txt = a.text;
      if (a.numberInSurah === 1) {
        html += `<span class="sh">سورة ${esc(META.chapters[a.surah.number - 1])}</span>`;
        if (a.surah.number !== 1 && a.surah.number !== 9) txt = txt.replace(/^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, "");
      }
      html += `${esc(txt)} <span class="an">﴿${n2a(a.numberInSurah)}﴾</span> `;
    }
    box.innerHTML = `<div class="page-text">${html}<div class="pfoot">${n2a(p)}</div></div>`;
  } catch {
    box.innerHTML = `<div class="loading">الصفحة دي محتاجة نت أول مرة</div>`;
    delete box.parentElement.dataset.done;
  }
}
function goPage(p) {
  if (p < 1 || p > 604) return;
  if (BOOK && document.body.contains(BOOK.el)) return BOOK.goTo(p, true);
  location.hash = `#/mushaf/${p}`;
}
function toggleImmersive() {
  const on = document.body.classList.toggle("immersive");
  if (on && !S.immHint) { S.immHint = 1; save(); toast("دوس على الصفحة عشان تخرج من ملء الشاشة", 3000); }
  if (BOOK) setTimeout(() => BOOK.goTo(BOOK.page, false), 60);
}
async function listenSurah() {
  const mr = MUSHAF_RECITERS.find((x) => x[0] === S.mReciter) || MUSHAF_RECITERS[0];
  const d = await getJSON(`data/r/${mr[0]}.json`);
  const rec = d.recs.find((r) => r.id === mr[1]) || d.recs[0];
  const s = surahOfPage(BOOK?.page || S.page) + 1;
  const tracks = recTracks(d, rec, portrait(mr[0]));
  const i = Math.max(0, tracks.findIndex((t) => t.ch === s));
  playList(tracks, i);
  toast(`سورة ${META.chapters[s - 1]} بصوت ${d.name}`);
}
function pickMReciter() {
  openModal(`<h2>قارئ المصحف</h2><p class="note" style="margin:0 0 10px">زرار «استمع» هيشغّل السورة اللي انت فيها بصوت القارئ ده، ويكمل اللي بعدها.</p>
    <div class="mpick">${MUSHAF_RECITERS.map((r) => `<button class="mpick-i ${r[0] === (S.mReciter || 118) ? "on" : ""}" data-act="setMReciter" data-id="${r[0]}">${avatar(r[0], r[2])}<span>${esc(r[2])}</span></button>`).join("")}</div>`);
}
async function drawTafsir(p) {
  const box = $("#tafsir");
  if (!box) return;
  try {
    const d = await getJSON(`data/tafsir/${Math.floor((p - 1) / 20)}.json`);
    const rows = d[String(p)] || [];
    box.innerHTML = `<div class="sec-h"><h2>التفسير الميسّر</h2></div>` + rows.map((r) => `<article><h3>${esc(r[0])} · الآية ${n2a(r[1])}</h3><p>${esc(r[2])}</p></article>`).join("");
  } catch { box.innerHTML = ""; }
}
async function saveMushaf() {
  if (!("caches" in window)) return toast("المتصفح ده مبيدعمش الحفظ بدون نت");
  if (navigator.storage?.persist) navigator.storage.persist();
  const cache = await caches.open("uq-pages");
  const riw = S.riwaya;
  let done = 0, fail = 0, i = 1;
  toast("جاري حفظ المصحف…", 600000);
  const worker = async () => {
    while (i <= 604) {
      const p = i++;
      const url = PAGE_SRC[riw][0](p);
      try {
        if (!(await cache.match(url))) { const r = await fetch(url, { mode: "cors" }); if (!r.ok) throw 0; await cache.put(url, r); }
        done++;
      } catch { fail++; }
      if ((done + fail) % 8 === 0) toast(`جاري حفظ المصحف ${n2a(done + fail)} / ${n2a(604)}`, 600000);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  toast(fail ? `اتحفظ ${n2a(done)} صفحة، و${n2a(fail)} ماتحفظوش. جرّب تاني لما النت يتحسن.` : "المصحف كله اتحفظ ✓ يفتح من غير نت", 5000);
}

async function mushafIndex() {
  setTop("فهرس المصحف");
  const sur = META.chapters.map((n, i) => `<li><a class="row" href="#/mushaf/${META.spages[i]}"><span class="num">${n2a(i + 1)}</span><span class="grow"><span class="t">سورة ${esc(n)}</span><span class="s">${META.madani.includes(i + 1) ? "مدنية" : "مكية"} · ${n2a(META.verses[i])} آية · ص ${n2a(META.spages[i])}</span></span></a></li>`).join("");
  const juz = META.jpages.map((p, i) => `<a class="chip" href="#/mushaf/${p}" aria-pressed="false">الجزء ${n2a(i + 1)}</a>`).join("");
  after(() => {
    const inp = $("#q");
    inp.addEventListener("input", () => {
      const v = norm(inp.value);
      $$("#surahs li").forEach((li) => { li.hidden = v && !norm(li.textContent).includes(v); });
    });
    $("#goPage").addEventListener("submit", (e) => { e.preventDefault(); const p = +$("#pg").value; if (p >= 1 && p <= 604) location.hash = `#/mushaf/${p}`; });
  });
  return `<div class="chips">${juz}</div>
    <form id="goPage" class="search"><input id="pg" type="number" inputmode="numeric" min="1" max="604" placeholder="اكتب رقم الصفحة (1 - 604)"><button class="btn" style="height:36px;padding:0 14px">افتح</button></form>
    <label class="search">${ic("search")}<input id="q" type="search" placeholder="ابحث باسم السورة" autocomplete="off"></label>
    <ul class="list" id="surahs">${sur}</ul>`;
}

/* ---------------- PRAYER TIMES & ADHAN ---------------- */
const PRAYERS = [
  ["fajr", "الفجر"], ["sunrise", "الشروق"], ["dhuhr", "الظهر"], ["asr", "العصر"], ["maghrib", "المغرب"], ["isha", "العشاء"],
];
const PNAME = Object.fromEntries(PRAYERS);
const CITIES = [
  ["القاهرة", 30.0444, 31.2357, "Africa/Cairo", "egypt"], ["الجيزة", 30.0131, 31.2089, "Africa/Cairo", "egypt"],
  ["الإسكندرية", 31.2001, 29.9187, "Africa/Cairo", "egypt"], ["المنصورة", 31.0409, 31.3785, "Africa/Cairo", "egypt"],
  ["طنطا", 30.7865, 31.0004, "Africa/Cairo", "egypt"], ["الزقازيق", 30.5877, 31.502, "Africa/Cairo", "egypt"],
  ["دمنهور", 31.0341, 30.4682, "Africa/Cairo", "egypt"], ["كفر الشيخ", 31.1107, 30.9388, "Africa/Cairo", "egypt"],
  ["شبين الكوم", 30.5585, 31.0101, "Africa/Cairo", "egypt"], ["بنها", 30.4659, 31.1848, "Africa/Cairo", "egypt"],
  ["دمياط", 31.4165, 31.8133, "Africa/Cairo", "egypt"], ["بورسعيد", 31.2653, 32.3019, "Africa/Cairo", "egypt"],
  ["الإسماعيلية", 30.5965, 32.2715, "Africa/Cairo", "egypt"], ["السويس", 29.9668, 32.5498, "Africa/Cairo", "egypt"],
  ["الفيوم", 29.3084, 30.8428, "Africa/Cairo", "egypt"], ["بني سويف", 29.0661, 31.0994, "Africa/Cairo", "egypt"],
  ["المنيا", 28.0871, 30.7618, "Africa/Cairo", "egypt"], ["أسيوط", 27.1783, 31.1859, "Africa/Cairo", "egypt"],
  ["سوهاج", 26.5591, 31.6957, "Africa/Cairo", "egypt"], ["قنا", 26.1551, 32.716, "Africa/Cairo", "egypt"],
  ["الأقصر", 25.6872, 32.6396, "Africa/Cairo", "egypt"], ["أسوان", 24.0889, 32.8998, "Africa/Cairo", "egypt"],
  ["الغردقة", 27.2579, 33.8116, "Africa/Cairo", "egypt"], ["شرم الشيخ", 27.9158, 34.33, "Africa/Cairo", "egypt"],
  ["العريش", 31.1316, 33.7984, "Africa/Cairo", "egypt"], ["مرسى مطروح", 31.3543, 27.2373, "Africa/Cairo", "egypt"],
  ["مكة المكرمة", 21.4225, 39.8262, "Asia/Riyadh", "makkah"], ["المدينة المنورة", 24.4672, 39.6111, "Asia/Riyadh", "makkah"],
  ["الرياض", 24.7136, 46.6753, "Asia/Riyadh", "makkah"], ["جدة", 21.4858, 39.1925, "Asia/Riyadh", "makkah"],
  ["الدمام", 26.4207, 50.0888, "Asia/Riyadh", "makkah"], ["الكويت", 29.3759, 47.9774, "Asia/Kuwait", "kuwait"],
  ["دبي", 25.2048, 55.2708, "Asia/Dubai", "dubai"], ["أبوظبي", 24.4539, 54.3773, "Asia/Dubai", "dubai"],
  ["الدوحة", 25.2854, 51.531, "Asia/Qatar", "qatar"], ["المنامة", 26.2285, 50.586, "Asia/Bahrain", "makkah"],
  ["مسقط", 23.588, 58.3829, "Asia/Muscat", "makkah"], ["عمّان", 31.9454, 35.9284, "Asia/Amman", "mwl"],
  ["القدس", 31.7683, 35.2137, "Asia/Jerusalem", "mwl"], ["بيروت", 33.8938, 35.5018, "Asia/Beirut", "mwl"],
  ["دمشق", 33.5138, 36.2765, "Asia/Damascus", "egypt"], ["بغداد", 33.3152, 44.3661, "Asia/Baghdad", "mwl"],
  ["الخرطوم", 15.5007, 32.5599, "Africa/Khartoum", "egypt"], ["طرابلس", 32.8872, 13.1913, "Africa/Tripoli", "egypt"],
  ["تونس", 36.8065, 10.1815, "Africa/Tunis", "tunisia"], ["الجزائر", 36.7538, 3.0588, "Africa/Algiers", "algeria"],
  ["الرباط", 34.0209, -6.8416, "Africa/Casablanca", "morocco"], ["الدار البيضاء", 33.5731, -7.5898, "Africa/Casablanca", "morocco"],
  ["إسطنبول", 41.0082, 28.9784, "Europe/Istanbul", "turkey"], ["لندن", 51.5074, -0.1278, "Europe/London", "mwl"],
  ["باريس", 48.8566, 2.3522, "Europe/Paris", "mwl"], ["برلين", 52.52, 13.405, "Europe/Berlin", "mwl"],
  ["نيويورك", 40.7128, -74.006, "America/New_York", "isna"],
];
const DEFAULT_MUEZZIN = { u: "", t: "الاذان الاول المشهور من التلفزيون المصرى الثمانينيات", pid: 241, n: "محمد رفعت" };

function prayerCfg() {
  S.pray ||= {};
  const c = S.pray;
  c.on ||= { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };
  c.method ||= "egypt";
  c.asr ||= 1;
  return c;
}
function ymdIn(tz, date = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date).split("-").map(Number);
  return p;
}
function dayTimes(offsetDays = 0) {
  const c = prayerCfg();
  if (c.lat == null) return null;
  const tz = c.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const d = new Date(Date.now() + offsetDays * 864e5);
  return PrayerCalc.times(ymdIn(tz, d), c.lat, c.lng, c.method, c.asr);
}
const fmtClock = (d) => {
  const c = prayerCfg();
  try { return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: c.tz || undefined }).format(d); }
  catch { return new Intl.DateTimeFormat("ar-EG-u-nu-latn", { hour: "numeric", minute: "2-digit" }).format(d); }
};
function nextPrayer() {
  const now = Date.now();
  const today = dayTimes(0);
  if (!today) return null;
  const order = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
  let prev = null;
  for (const k of order) {
    if (today[k].getTime() > now) {
      if (!prev) { const y = dayTimes(-1); prev = { k: "isha", t: y.isha }; }
      return { k, t: today[k], prev, today };
    }
    prev = { k, t: today[k] };
  }
  const tm = dayTimes(1);
  return { k: "fajr", t: tm.fajr, prev, today, tomorrow: true };
}
function countdown(ms) {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3), s = Math.floor((ms % 60e3) / 1000);
  const p = (x) => String(x).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}`;
}

/* --- adhan engine: runs while the app is open (or alive in the background) --- */
let ADHANS = null;
async function adhanList() { return ADHANS || (ADHANS = await getJSON("data/adhan.json")); }
function muezzinFor(key) {
  const c = prayerCfg();
  return (key === "fajr" && c.fajrMuezzin) || c.muezzin || null;
}
async function resolveMuezzin(key) {
  let m = muezzinFor(key);
  if (!m || !m.u) {
    const list = await adhanList();
    const a = list.find((x) => x[2] === DEFAULT_MUEZZIN.t) || list[0];
    m = { u: a[3], t: a[2], pid: a[0], n: a[1] };
  }
  return m;
}
async function playAdhan(key, test) {
  const m = await resolveMuezzin(key);
  const track = { t: `أذان ${PNAME[key] || ""}`.trim(), s: m.n, d: test ? "تجربة الأذان" : `حان الآن موعد صلاة ${PNAME[key]}`, u: m.u, img: portrait(m.pid), adhan: true };
  playList([track], 0);
}
function adhanTick() {
  if (!META) return;
  const c = prayerCfg();
  if (c.lat == null) return;
  const t = dayTimes(0);
  const now = Date.now();
  const stamp = ymdIn(c.tz || Intl.DateTimeFormat().resolvedOptions().timeZone).join("-");
  c.fired ||= {};
  for (const [k] of PRAYERS) {
    if (k === "sunrise" || !c.on[k] || c.auto) continue;
    const at = t[k].getTime();
    const id = stamp + k;
    if (now >= at && now - at < 4 * 60e3 && !c.fired[id]) {
      c.fired = { [id]: 1 };
      save(true);
      playAdhan(k);
      notifyPrayer(k, t[k]);
    }
  }
  if ($("#pcount")) refreshCountdown();
  if ($("#hcount")) refreshHomePrayer();
}
async function notifyPrayer(k, at) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !prayerCfg().notify) return;
  const body = `حان الآن موعد أذان ${PNAME[k]} · ${fmtClock(at)}`;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(`صلاة ${PNAME[k]}`, { body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "adhan", renotify: true, vibrate: [300, 120, 300] });
    else new Notification(`صلاة ${PNAME[k]}`, { body, icon: "icons/icon-192.png" });
  } catch {}
}
setInterval(adhanTick, 1000);

function refreshCountdown() {
  const n = nextPrayer();
  if (!n) return;
  const el = $("#pcount");
  el.textContent = countdown(n.t - Date.now());
  const span = n.t - n.prev.t, done = Date.now() - n.prev.t;
  const arc = $("#parc");
  if (arc) arc.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, (done / span) * 100)));
  if ($("#pnext").dataset.k !== n.k) route();
}
function refreshHomePrayer() {
  const n = nextPrayer();
  if (!n) return;
  $("#hcount").textContent = countdown(n.t - Date.now());
  const ring = $("#hring");
  if (ring) ring.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, ((Date.now() - n.prev.t) / (n.t - n.prev.t)) * 100)));
  if ($("#hnext").dataset.k !== n.k) route();
}
function autoCity() {
  const c = prayerCfg();
  if (c.lat != null) return;
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  const x = CITIES.find((y) => y[3] === tz);
  if (!x) return;
  Object.assign(c, { name: x[0], lat: x[1], lng: x[2], tz: x[3], method: x[4], auto: true });
  save(true);
}
const P_ICON = { fajr: "p-dawn", sunrise: "p-sunrise", dhuhr: "p-noon", asr: "p-asr", maghrib: "p-sunset", isha: "p-night" };
function homePrayerPanel() {
  autoCity();
  const c = prayerCfg();
  if (c.lat == null) {
    return `<a class="ppanel setup" href="#/prayer"><span class="pstrip-ic">${icSm("dome", 26)}</span>
      <b>مواقيت الصلاة والأذان</b><small>حدد مدينتك والأذان يشتغل بصوت الشيخ محمد رفعت أو مؤذنك المفضل</small><span class="btn" style="margin-top:8px">حدد مدينتك</span></a>`;
  }
  const n = nextPrayer();
  const t = n.today;
  const span = n.t - n.prev.t, done = Date.now() - n.prev.t;
  const pct = Math.max(0, Math.min(100, (done / span) * 100));
  const ampm = (d) => (fmtClock(d).match(/[صم]$/) || [""])[0];
  const clock = (d) => fmtClock(d).replace(/\s*[صم]$/, "");
  const cells = PRAYERS.map(([k, name]) => {
    const isNext = k === n.k && !n.tomorrow;
    const past = t[k] < Date.now() && !isNext;
    return `<span class="pq ${isNext ? "next" : ""} ${past ? "past" : ""} ${k === "sunrise" ? "sun" : ""}">
      <svg class="pq-ic" aria-hidden="true"><use href="#i-${P_ICON[k]}"/></svg>
      <span class="pq-n">${name}</span><span class="pq-t">${clock(t[k])}<i>${ampm(t[k])}</i></span></span>`;
  }).join("");
  let hijri = "";
  try { hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", timeZone: c.tz || undefined }).format(new Date()); } catch {}
  return `<section class="ppanel lux">
    <span class="pl-corner tl"></span><span class="pl-corner tr"></span><span class="pl-corner bl"></span><span class="pl-corner br"></span>
    <a class="pl-head" href="#/prayer">
      <span class="pl-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="trk" cx="60" cy="60" r="52"/><circle class="arc" id="hring" cx="60" cy="60" r="52" pathLength="100" style="stroke-dashoffset:${100 - pct}"/></svg>
        <svg class="pl-ring-ic" aria-hidden="true"><use href="#i-${P_ICON[n.k]}"/></svg>
      </span>
      <span class="pl-info">
        <small>${n.tomorrow ? "غداً" : "الصلاة القادمة"}</small>
        <b><span id="hnext" data-k="${n.k}">${PNAME[n.k]}</span></b>
        <span class="pl-count" id="hcount">${countdown(n.t - Date.now())}</span>
        <span class="pl-at">الأذان ${fmtClock(n.t)}</span>
      </span>
    </a>
    <div class="pq-row">${cells}</div>
    <div class="pl-foot">
      <a href="#/prayer">${icSm("pin", 14)} ${esc(c.name || "")}${c.auto ? " · أكّد مدينتك" : ""}${hijri ? ` · ${esc(hijri)}` : ""}</a>
      <a href="#/prayer/qibla">${icSm("dome", 14)} القبلة ${n2a(Math.round(qiblaBearing(c.lat, c.lng)))}°</a>
    </div>
  </section>`;
}

async function prayer(parts) {
  if (parts[0] === "muezzin") return muezzinPicker(parts[1]);
  if (parts[0] === "qibla") return qibla();
  setTop("مواقيت الصلاة");
  const c = prayerCfg();
  if (c.lat == null) return prayerSetup(true);
  const n = nextPrayer();
  const t = n.today;
  let hijri = "";
  try { hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric", timeZone: c.tz || undefined }).format(new Date()); } catch {}
  const m = await resolveMuezzin("dhuhr");
  const fm = c.fajrMuezzin;
  const rows = PRAYERS.map(([k, name]) => {
    const isNext = k === n.k && !n.tomorrow;
    const past = t[k] < Date.now() && !isNext;
    return `<li class="prow ${isNext ? "next" : ""} ${past ? "past" : ""}">
      <span class="pname">${name}</span><span class="ptime">${fmtClock(t[k])}</span>
      ${k === "sunrise" ? `<span class="pbell off" aria-hidden="true"></span>` :
        `<button class="pbell ${c.on[k] ? "on" : ""}" data-act="pbell" data-k="${k}" aria-pressed="${!!c.on[k]}" aria-label="أذان ${name}">${icSm(c.on[k] ? "bell" : "bell-off", 20)}</button>`}</li>`;
  }).join("");
  after(() => refreshCountdown());
  return `<section class="pnext">
      <svg class="parc" viewBox="0 0 200 110" aria-hidden="true"><path d="M10 100 A90 90 0 0 1 190 100" pathLength="100" class="track"/><path id="parc" d="M10 100 A90 90 0 0 1 190 100" pathLength="100" class="fill" style="stroke-dashoffset:100"/></svg>
      <div class="pnext-in"><small>${n.tomorrow ? "غداً" : "الصلاة القادمة"}</small>
        <b id="pnext" data-k="${n.k}">${PNAME[n.k]}</b>
        <span class="pcount" id="pcount">${countdown(n.t - Date.now())}</span>
        <span class="pat">الأذان ${fmtClock(n.t)}</span></div>
      <div class="ploc">${icSm("pin", 16)} ${esc(c.name || "موقعي")}${hijri ? ` · ${esc(hijri)}` : ""}</div>
    </section>
    ${c.auto ? `<div class="setting confirm"><span class="grow"><b>${esc(c.name)} · اتحددت تلقائي</b><small>أكّد مدينتك أو اختار غيرها من الإعدادات تحت، عشان الأذان يشتغل في وقته</small></span><button class="btn" style="height:38px;padding:0 16px" data-act="confirmCity">تأكيد</button></div>` : ""}
    <ul class="plist">${rows}</ul>
    <a class="mcard qcard" href="#/prayer/qibla"><span class="avatar">${icSm("pin", 28)}</span><span class="grow"><small>اتجاه القبلة</small><b>${n2a(Math.round(qiblaBearing(c.lat, c.lng)))}° من الشمال</b><span>بوصلة حية على الموبايل</span></span>${icSm("chev", 18).replace('class="icon"', 'class="icon flip"')}</a>
    <div class="sec-h"><h2>المؤذن</h2></div>
    <a class="mcard" href="#/prayer/muezzin">${avatar(m.pid, m.n)}<span class="grow"><small>أذان الصلوات</small><b>${esc(m.n)}</b><span>${esc(m.t)}</span></span>${icSm("chev", 18).replace('class="icon"', 'class="icon flip"')}</a>
    <a class="mcard" href="#/prayer/muezzin/fajr"><span class="avatar">${icSm("moon", 30)}</span><span class="grow"><small>أذان الفجر</small><b>${fm ? esc(fm.n) : "نفس مؤذن الصلوات"}</b>${fm ? `<span>${esc(fm.t)}</span>` : ""}</span>${icSm("chev", 18).replace('class="icon"', 'class="icon flip"')}</a>
    <div class="btn-row"><button class="btn ghost" data-act="testAdhan">${ic("play")}جرّب الأذان</button></div>

    <div class="sec-h"><h2>التنبيهات</h2></div>
    <div class="setting"><span class="grow"><b>إشعار وقت الصلاة</b><small>إشعار على الموبايل مع الأذان</small></span>
      <button class="switch" data-act="notify" aria-pressed="${!!c.notify && typeof Notification !== "undefined" && Notification.permission === "granted"}" aria-label="إشعار وقت الصلاة"><i></i></button></div>
    <div class="setting"><span class="grow"><b>تنبيه أكيد حتى والتطبيق مقفول</b><small>يضيف مواعيد الصلاة لتقويم الموبايل لمدة 30 يوم، والتقويم بينبهك في كل صلاة</small></span>
      <button class="btn" style="height:38px;padding:0 14px" data-act="ics">إضافة</button></div>
    <p class="note">الأذان بصوت الشيخ بيشتغل تلقائي طول ما التطبيق مفتوح أو شغال في الخلفية. المتصفحات مش بتسمح لأي موقع إنه يشغّل صوت لوحده وهو مقفول خالص، فلو هتقفله فعّل «تنبيه أكيد» عشان التقويم ينبهك.</p>

    <div class="sec-h"><h2>الإعدادات</h2></div>
    ${prayerSetup(false)}`;
}

function prayerSetup(first) {
  const c = prayerCfg();
  const opts = Object.entries(PrayerCalc.METHODS).map(([k, v]) => `<option value="${k}" ${c.method === k ? "selected" : ""}>${esc(v.name)}</option>`).join("");
  const cities = CITIES.map((x, i) => `<option value="${i}" ${c.name === x[0] ? "selected" : ""}>${esc(x[0])}</option>`).join("");
  const html = `${first ? `<section class="shero"><span class="medal">${icSm("dome", 34)}</span><h2>مواقيت الصلاة والأذان</h2><p>حدد مكانك عشان نحسب المواعيد بدقة، والأذان يشتغل في وقته.</p></section>` : ""}
    <div class="setting"><span class="grow"><b>موقعي الحالي</b><small>${c.lat != null ? esc(c.name || "") : "الأدق: بيستخدم GPS الموبايل مرة واحدة"}</small></span>
      <button class="btn" style="height:38px;padding:0 14px" data-act="gps">${icSm("pin", 18)}حدد موقعي</button></div>
    <label class="setting"><span class="grow"><b>أو اختار مدينة</b></span>
      <select id="pcity"><option value="">— اختار —</option>${cities}</select></label>
    <label class="setting"><span class="grow"><b>طريقة الحساب</b></span><select id="pmethod">${opts}</select></label>
    <label class="setting"><span class="grow"><b>صلاة العصر</b></span>
      <select id="pasr"><option value="1" ${c.asr == 1 ? "selected" : ""}>الجمهور (شافعي، مالكي، حنبلي)</option><option value="2" ${c.asr == 2 ? "selected" : ""}>الحنفي</option></select></label>`;
  after(() => {
    $("#pcity").addEventListener("change", (e) => {
      const x = CITIES[+e.target.value];
      if (!x) return;
      Object.assign(c, { name: x[0], lat: x[1], lng: x[2], tz: x[3], method: x[4], auto: false });
      save(true); toast(`تم: ${x[0]}`); route();
    });
    $("#pmethod").addEventListener("change", (e) => { c.method = e.target.value; c.auto = false; save(true); route(); });
    $("#pasr").addEventListener("change", (e) => { c.asr = +e.target.value; save(true); route(); });
  });
  return html;
}

function locateMe() {
  if (!navigator.geolocation) return toast("الموبايل مش بيدعم تحديد الموقع، اختار مدينتك من القائمة");
  toast("جاري تحديد موقعك…", 15000);
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const c = prayerCfg();
    c.lat = +pos.coords.latitude.toFixed(4); c.lng = +pos.coords.longitude.toFixed(4);
    c.tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    c.name = "موقعي الحالي"; c.auto = false;
    // pick the method of the nearest listed city
    let best = null, bd = 1e9;
    for (const x of CITIES) { const dd = (x[1] - c.lat) ** 2 + (x[2] - c.lng) ** 2; if (dd < bd) { bd = dd; best = x; } }
    if (best && bd < 60) c.method = best[4];
    try {
      const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${c.lat}&longitude=${c.lng}&localityLanguage=ar`);
      const j = await r.json();
      c.name = j.city || j.locality || j.principalSubdivision || c.name;
    } catch {}
    save(true); toast(`تم تحديد موقعك: ${c.name}`); route();
  }, () => toast("مقدرناش نحدد موقعك. اسمح للموقع بالوصول للمكان أو اختار مدينتك من القائمة", 5000),
  { enableHighAccuracy: false, timeout: 15000, maximumAge: 6 * 3600e3 });
}

async function muezzinPicker(which) {
  const fajr = which === "fajr";
  setTop(fajr ? "مؤذن الفجر" : "اختار المؤذن");
  const list = await adhanList();
  const c = prayerCfg();
  const cur = fajr ? c.fajrMuezzin?.u : (c.muezzin?.u || (list.find((x) => x[2] === DEFAULT_MUEZZIN.t) || [])[3]);
  const by = new Map();
  list.forEach((a) => { if (!by.has(a[0])) by.set(a[0], []); by.get(a[0]).push(a); });
  const tracks = list.map((a) => ({ t: a[2], s: a[1], d: "أذان", u: a[3], img: portrait(a[0]) }));
  const L = reg(tracks);
  let idx = 0;
  const groups = [...by.entries()].map(([pid, arr]) => {
    const rows = arr.map((a) => {
      const i = idx++;
      const sel = a[3] === cur;
      return `<li><div class="row ${sel ? "now" : ""}" data-u="${esc(a[3])}">
        <button class="num" data-play="${L}:${i}" aria-label="استمع">${icSm("play", 16)}</button>
        <button class="grow" data-play="${L}:${i}" style="text-align:start"><span class="t">${esc(a[2])}</span><span class="s">${fmtTime(a[4])}${a[5] ? " · أذان فجر" : ""}</span></button>
        <span class="end"><button class="pick ${sel ? "on" : ""}" data-act="pickM" data-w="${fajr ? "fajr" : ""}" data-i="${i}">${sel ? "المختار" : "اختيار"}</button></span></div></li>`;
    }).join("");
    return `<section class="mgroup"><div class="mhead">${avatar(pid, arr[0][1])}<b>${esc(arr[0][1])}</b><span class="count">${n2a(arr.length)}</span></div><ul class="list">${rows}</ul></section>`;
  }).join("");
  window.__adhanPick = list;
  return `${fajr ? `<div class="setting"><span class="grow"><b>نفس مؤذن الصلوات</b><small>استخدم نفس الأذان للفجر</small></span><button class="btn ${c.fajrMuezzin ? "ghost" : ""}" style="height:38px;padding:0 14px" data-act="pickM" data-w="fajr" data-i="-1">${c.fajrMuezzin ? "استخدمه" : "مفعّل"}</button></div>` : ""}
    <p class="note">${n2a(list.length)} أذان بأصوات ${n2a(by.size)} من أعلام المقرئين. دوس ▶ تسمع، و«اختيار» يخليه أذانك.</p>${groups}`;
}

function buildICS() {
  const c = prayerCfg();
  const pad = (x) => String(x).padStart(2, "0");
  const z = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const now = z(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UltraQuran//Prayer//AR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:مواقيت الصلاة · ألترا قرآن"];
  for (let day = 0; day < 30; day++) {
    const t = dayTimes(day);
    for (const [k, name] of PRAYERS) {
      if (k === "sunrise" || !c.on[k]) continue;
      const s = t[k], e = new Date(s.getTime() + 10 * 60e3);
      lines.push("BEGIN:VEVENT", `UID:uq-${k}-${z(s)}@ultraquran`, `DTSTAMP:${now}`, `DTSTART:${z(s)}`, `DTEND:${z(e)}`,
        `SUMMARY:🕌 أذان ${name}`, `DESCRIPTION:حان الآن موعد صلاة ${name} · ${c.name || ""}`, "TRANSP:TRANSPARENT",
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:أذان ${name}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mawaqit-alsalah.ics";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("افتح الملف اللي نزل واختار «إضافة الكل» للتقويم", 6000);
}

/* ---------------- INSTALL AS APP ---------------- */
let installEvt = null;
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $$(".install-card").forEach((x) => x.hidden = false); });
window.addEventListener("appinstalled", () => { installEvt = null; toast("اتثبت ✓ هتلاقي ألترا قرآن على الشاشة الرئيسية"); $$(".install-card").forEach((x) => x.remove()); });
function installCard(force) {
  if (isStandalone() || (!force && S.installHidden)) return "";
  return `<div class="install-card"><span class="install-ic"><img src="icons/icon-192.png" alt=""></span>
    <span class="grow"><b>ثبّت ألترا قرآن كتطبيق</b><small>أيقونة على الشاشة الرئيسية، يفتح ملء الشاشة، والأذان والإشعارات يشتغلوا أحسن</small></span>
    <span class="install-btns"><button class="btn" style="height:38px;padding:0 16px" data-act="install">تثبيت</button>
    ${force ? "" : `<button class="xbtn" data-act="installHide" aria-label="إخفاء">${icSm("x", 16)}</button>`}</span></div>`;
}
async function doInstall() {
  if (installEvt) {
    installEvt.prompt();
    const r = await installEvt.userChoice.catch(() => null);
    installEvt = null;
    if (r && r.outcome === "accepted") return;
    return;
  }
  openModal(isIOS()
    ? `<h2>التثبيت على الآيفون</h2><ol class="steps">
        <li>افتح الموقع من <b>Safari</b></li>
        <li>دوس زرار المشاركة ${icSm("share", 18)} تحت</li>
        <li>اختار <b>«إضافة إلى الشاشة الرئيسية»</b></li>
        <li>دوس <b>«إضافة»</b> فوق على اليمين</li></ol>
        <p class="note">بعد التثبيت افتحه من الأيقونة، وفعّل إشعار وقت الصلاة من صفحة المواقيت.</p>`
    : `<h2>تثبيت التطبيق</h2><ol class="steps">
        <li>افتح قائمة المتصفح ⋮ فوق</li>
        <li>اختار <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b></li>
        <li>وافق، وهتلاقي الأيقونة على الشاشة الرئيسية</li></ol>`);
}
function openModal(html) {
  let m = $("#modal");
  if (!m) { m = document.createElement("div"); m.id = "modal"; m.className = "modal"; document.body.appendChild(m); }
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}<div class="btn-row" style="justify-content:center"><button class="btn" data-act="closeModal">تمام</button></div></div>`;
  m.classList.add("open");
}

/* ---------------- QIBLA ---------------- */
function qiblaBearing(lat, lng) {
  const k = [21.4225, 39.8262].map((x) => (x * Math.PI) / 180);
  const p = [lat, lng].map((x) => (x * Math.PI) / 180);
  const dl = k[1] - p[1];
  const b = Math.atan2(Math.sin(dl), Math.cos(p[0]) * Math.tan(k[0]) - Math.sin(p[0]) * Math.cos(dl));
  return ((b * 180) / Math.PI + 360) % 360;
}
function kaabaKm(lat, lng) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dLat = r(21.4225 - lat), dLng = r(39.8262 - lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(lat)) * Math.cos(r(21.4225)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}
let compassOn = null;
function stopCompass() {
  if (!compassOn) return;
  window.removeEventListener("deviceorientationabsolute", compassOn, true);
  window.removeEventListener("deviceorientation", compassOn, true);
  compassOn = null;
}
async function startCompass(bearing) {
  stopCompass();
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try { if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return toast("محتاجين إذن البوصلة عشان نحدد الاتجاه"); }
    catch { return toast("البوصلة مش متاحة على الجهاز ده"); }
  }
  let got = false;
  compassOn = (e) => {
    const dial = $("#qdial");
    if (!dial) return stopCompass();
    let heading = null;
    if (typeof e.webkitCompassHeading === "number") heading = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === "number") heading = 360 - e.alpha;
    if (heading == null) return;
    got = true;
    dial.style.transform = `rotate(${-heading}deg)`;
    const diff = Math.abs(((bearing - heading + 540) % 360) - 180);
    const ok = diff < 4;
    $("#qwrap").classList.toggle("aligned", ok);
    $("#qhint").textContent = ok ? "انت في اتجاه القبلة ✓" : `لف ${n2a(Math.round(diff))}° ${((bearing - heading + 360) % 360) < 180 ? "يمين" : "شمال"}`;
    if (ok && navigator.vibrate && !$("#qwrap").dataset.buzz) { $("#qwrap").dataset.buzz = 1; navigator.vibrate(40); }
    if (!ok) delete $("#qwrap").dataset.buzz;
  };
  window.addEventListener("deviceorientationabsolute", compassOn, true);
  window.addEventListener("deviceorientation", compassOn, true);
  setTimeout(() => { if (!got && $("#qhint")) $("#qhint").textContent = "البوصلة مش شغالة على الجهاز ده. استخدم الزاوية من الشمال."; }, 2500);
}
function qibla() {
  setTop("اتجاه القبلة");
  const c = prayerCfg();
  if (c.lat == null) return prayerSetup(true);
  const b = qiblaBearing(c.lat, c.lng);
  return `<section class="qibla" id="qwrap">
      <div class="qdial" id="qdial" style="transform:rotate(0deg)">
        <span class="qn">N</span><span class="qe">E</span><span class="qs">S</span><span class="qw">W</span>
        <span class="qneedle" style="transform:rotate(${b}deg)"><i></i><b>${icSm("dome", 22)}</b></span>
      </div>
      <span class="qphone" aria-hidden="true"></span>
    </section>
    <p class="qhint" id="qhint">دوس «شغّل البوصلة» وامسك الموبايل مفرود</p>
    <div class="btn-row" style="justify-content:center"><button class="btn" data-act="compass">${icSm("pin", 18)}شغّل البوصلة</button></div>
    <div class="setting"><span class="grow"><b>${n2a(Math.round(b))}° من الشمال</b><small>${esc(c.name || "")} · المسافة للكعبة حوالي ${n2a(kaabaKm(c.lat, c.lng))} كم</small></span></div>
    <p class="note">ابعد الموبايل عن الحاجات المعدنية والمغناطيس. لو الاتجاه مش مظبوط، حرّك الموبايل على شكل رقم 8 في الهوا عشان البوصلة تتظبط.</p>`;
}
/* ---------------- SAVED ---------------- */
async function saved() {
  setTop("محفوظاتي");
  const fav = S.fav;
  const off = Object.values(S.saved).sort((a, b) => b.at - a.at);
  const LF = reg(fav), LO = reg(off);
  const row = (t, L, i, del) => `<li><div class="row" data-u="${esc(t.u)}">
    <button class="num" data-play="${L}:${i}" aria-label="تشغيل">${t.v ? ic("video").replace('class="icon"', 'class="icon" style="width:18px;height:18px"') : t.live ? ic("radio").replace('class="icon"', 'class="icon" style="width:18px;height:18px"') : n2a(i + 1)}</button>
    <button class="grow" data-play="${L}:${i}" style="text-align:start"><span class="t">${esc(t.t)}</span><span class="s">${esc([t.s, t.size ? `${(t.size / 1048576).toFixed(1)} ميجا` : t.d].filter(Boolean).join(" · "))}</span></button>
    <span class="end"><button data-${del}="${esc(t.u)}" aria-label="حذف">${ic("trash")}</button></span></div></li>`;
  let usage = "";
  try { const e = await navigator.storage.estimate(); usage = `المساحة المستخدمة على الموبايل: ${(e.usage / 1048576).toFixed(0)} ميجا`; } catch {}
  return `<div class="sec-h"><h2>المفضلة</h2>${fav.length > 1 ? `<button data-play="${LF}:0">تشغيل الكل</button>` : ""}</div>
    ${fav.length ? `<ul class="list">${fav.map((t, i) => row(t, LF, i, "unfav")).join("")}</ul>` : `<p class="note">دوس على ♡ جنب أي سورة أو درس أو إذاعة عشان يتحفظ هنا.</p>`}
    <div class="sec-h"><h2>محفوظ بدون نت</h2>${off.length > 1 ? `<button data-play="${LO}:0">تشغيل الكل</button>` : ""}</div>
    ${off.length ? `<ul class="list">${off.map((t, i) => row(t, LO, i, "unsave")).join("")}</ul>` : `<p class="note">افتح المشغّل ودوس «بدون نت» عشان تسمع المقطع بعدين من غير إنترنت.</p>`}
    ${usage ? `<p class="note">${usage}</p>` : ""}
    ${installCard(true)}`;
}

/* ---------------- SEARCH ---------------- */
let LIBINDEX = null;
async function buildIndex() {
  if (LIBINDEX) return LIBINDEX;
  const secs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13];
  const out = [];
  const roots = await Promise.all(secs.map((s) => getJSON(`data/lib/${s}.json`).catch(() => null)));
  roots.forEach((root, k) => {
    if (!root) return;
    const walk = (n, path) => {
      const kids = kidsOf(n);
      (kids || []).forEach((c, i) => {
        const p = path + "/" + i;
        out.push({ t: c.title, s: root.title, path: `#/lib/${secs[k]}${p}`, audio: typeof c.audio === "string" ? c.audio : null, v: !!c.video, folder: !!kidsOf(c), d: c.subtitle || c.badge || "", n: norm(c.title) });
        walk(c, p);
      });
    };
    walk(root, "");
  });
  LIBINDEX = out;
  return out;
}
let QURAN = null;
const qnorm = (t) => String(t || "").replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, "")
  .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/\s+/g, " ").trim();
const AYAH_NAMES = [
  ["ايه الكرسي", [[2, 255]]], ["خواتيم البقره", [[2, 285], [2, 286]]], ["اواخر البقره", [[2, 285], [2, 286]]],
  ["ايه الدين", [[2, 282]]], ["ايه النور", [[24, 35]]], ["ايه السيف", [[9, 5]]],
];
async function ayahSearch(q, limit) {
  QURAN ||= await getJSON("data/quran.json");
  const v = qnorm(q);
  if (v.length < 2) return { list: [], total: 0 };
  const named = AYAH_NAMES.find(([n]) => n.startsWith(v.replace(/^اي[هة]?\s*/, "ايه ")) || v.includes(n));
  if (named && v.length > 4) {
    const hits = named[1].map(([su, a]) => QURAN.find((r) => r[0] === su && r[1] === a));
    return { list: hits, total: hits.length };
  }
  let hits = QURAN.filter((r) => r[4].includes(v));
  if (!hits.length) {
    const words = v.split(" ").filter((w) => w.length > 1);
    if (words.length > 1) hits = QURAN.filter((r) => words.every((w) => r[4].includes(w)));
  }
  return { list: hits.slice(0, limit), total: hits.length };
}
function ayahHTML(r) {
  return `<a class="ayah" href="#/mushaf/${r[2]}"><span class="ayah-t">﴿${esc(r[3])}﴾</span>
    <span class="ayah-m">سورة ${esc(META.chapters[r[0] - 1])} · الآية ${n2a(r[1])} <i>صفحة ${n2a(r[2])} ${icSm("chev", 14).replace('class="icon"', 'class="icon flip"')}</i></span></a>`;
}

async function search(parts, qs) {
  const onlyQuran = qs.get("in") === "quran";
  setTop(onlyQuran ? "البحث في القرآن" : "بحث");
  const q0 = qs.get("q") || "";
  const hint = onlyQuran ? "اكتب كلمة أو جزء من آية، زي «الصابرين» أو «ربنا آتنا»." : "اكتب اسم قارئ، سورة، شيخ، موضوع زي «الصبر»، أو كلمة من آية.";
  after(() => {
    const inp = $("#q");
    inp.value = q0;
    inp.focus();
    let t = 0;
    inp.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => run(inp.value), 260); });
    if (q0) run(q0);
  });
  async function run(q) {
    history.replaceState(history.state, "", `#/search?${onlyQuran ? "in=quran&" : ""}q=${encodeURIComponent(q)}`);
    const v = norm(q), box = $("#res");
    if (qnorm(q).length < 2) { box.innerHTML = `<p class="note">${hint}</p>`; return; }
    box.innerHTML = `<p class="note">جاري البحث…</p>`;
    let ay;
    try { ay = await ayahSearch(q, onlyQuran ? 300 : 3); } catch { ay = { list: [], total: 0 }; }
    if ($("#q").value !== q) return;
    const ayHTML = ay.total ? `<div class="sec-h"><h2>في آيات القرآن</h2><span class="count">${n2a(ay.total)}</span></div>
      <div class="ayahs">${ay.list.map(ayahHTML).join("")}</div>
      ${!onlyQuran && ay.total > ay.list.length ? `<div class="btn-row"><a class="btn ghost" href="#/search?in=quran&q=${encodeURIComponent(q)}">كل الآيات · ${n2a(ay.total)}</a></div>` : ""}
      ${onlyQuran && ay.total > ay.list.length ? `<p class="note">ظاهر أول ${n2a(ay.list.length)} آية. زوّد كلمة عشان تضيّق البحث.</p>` : ""}` : "";
    if (onlyQuran) {
      box.innerHTML = ayHTML || `<div class="empty"><b>مفيش آيات فيها «${esc(q)}»</b>جرّب كلمة واحدة، أو اكتبها من غير تشكيل.</div>`;
      return;
    }
    const rs = await getJSON("data/radios.json");
    const idx = await buildIndex();
    const people = RECITERS.filter((r) => norm(r[1]).includes(v)).slice(0, 24);
    const surahs = META.chapters.map((n, i) => [n, i]).filter(([n]) => norm(n).includes(v)).slice(0, 6);
    const radios = rs.filter((r) => norm(r[0]).includes(v)).slice(0, 10);
    const libs = idx.filter((x) => x.n.includes(v)).slice(0, 80);
    const rT = radios.map((r) => ({ t: r[0], s: "إذاعة القرآن الكريم", d: "بث مباشر", u: r[1], live: true }));
    const RL = reg(rT);
    const lT = libs.filter((x) => x.audio).map((x) => ({ t: x.t, s: x.s, d: x.d, u: x.audio, v: x.v }));
    const LL = reg(lT);
    let j = 0;
    if ($("#q").value !== q) return;
    box.innerHTML = (people.length + surahs.length + radios.length + libs.length + ay.total) === 0
      ? `<div class="empty"><b>مفيش نتايج لـ «${esc(q)}»</b>جرّب كلمة أقصر أو اسم من غير «الشيخ».</div>`
      : `${people.length ? `<div class="sec-h"><h2>القراء والمشايخ</h2></div><div class="gallery">${people.map((r) => `<a class="person" href="#/r/${r[0]}">${avatar(r[0], r[1])}<b>${esc(r[1])}</b></a>`).join("")}</div>` : ""}
        ${surahs.length ? `<div class="sec-h"><h2>السور في المصحف</h2></div><ul class="list">${surahs.map(([n, i]) => `<li><a class="row" href="#/mushaf/${META.spages[i]}"><span class="num">${n2a(i + 1)}</span><span class="grow"><span class="t">سورة ${esc(n)}</span><span class="s">صفحة ${n2a(META.spages[i])}</span></span></a></li>`).join("")}</ul>` : ""}
        ${ayHTML}
        ${radios.length ? `<div class="sec-h"><h2>الإذاعات</h2></div><ul class="list">${rT.map((t, i) => `<li><button class="row" data-play="${RL}:${i}" data-u="${esc(t.u)}"><span class="num">${ic("radio").replace('class="icon"', 'class="icon" style="width:18px;height:18px"')}</span><span class="grow"><span class="t">${esc(t.t)}</span><span class="s">بث مباشر</span></span></button></li>`).join("")}</ul>` : ""}
        ${libs.length ? `<div class="sec-h"><h2>الدروس والمواد</h2></div><ul class="list">${libs.map((x) => {
          if (x.audio) { const k = j++; return `<li><button class="row" data-play="${LL}:${k}" data-u="${esc(x.audio)}"><span class="num">${ic(x.v ? "video" : "play").replace('class="icon"', 'class="icon" style="width:16px;height:16px"')}</span><span class="grow"><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s)}</span></span></button></li>`; }
          return `<li><a class="row folder" href="${x.path}"><span class="ic">${ic(x.folder ? "folder" : "text")}</span><span class="grow"><span class="t">${esc(x.t)}</span><span class="s">${esc(x.s)}</span></span></a></li>`;
        }).join("")}</ul>` : ""}`;
    updatePlayerUI(false);
  }
  return `<div class="chips" role="group" aria-label="نطاق البحث">
      <a class="chip" href="#/search${q0 ? `?q=${encodeURIComponent(q0)}` : ""}" aria-pressed="${!onlyQuran}">كل الأقسام</a>
      <a class="chip" href="#/search?in=quran${q0 ? `&q=${encodeURIComponent(q0)}` : ""}" aria-pressed="${onlyQuran}">آيات القرآن</a></div>
    <label class="search">${ic("search")}<input id="q" type="search" placeholder="${onlyQuran ? "ابحث بكلمة من الآية" : "ابحث في كل الأقسام"}" autocomplete="off" enterkeyhint="search"></label><div id="res"><p class="note">${hint}</p></div>`;
}

/* ======================================================================
   EVENTS
   ====================================================================== */
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-play],[data-fav],[data-act],[data-go],[data-qi],[data-unfav],[data-unsave],[data-bead],a[data-keep]");
  if (!el) return;
  if (el.matches("a[data-keep]")) { sessionStorage.setItem("keep-scroll", "1"); return; }
  if (el.dataset.play) {
    e.preventDefault();
    const [L, i] = el.dataset.play.split(":");
    if (LISTS[L]) playList(LISTS[L], +i);
    return;
  }
  if (el.dataset.fav) {
    const [L, i] = el.dataset.fav.split(":");
    const t = LISTS[L]?.[+i];
    if (t) { toggleFav(t); el.classList.toggle("on", isFav(t.u)); }
    return;
  }
  if (el.dataset.qi) { P.i = +el.dataset.qi; loadCur(true); return; }
  if (el.dataset.unfav) { S.fav = S.fav.filter((f) => f.u !== el.dataset.unfav); save(true); route(); return; }
  if (el.dataset.unsave) {
    const u = el.dataset.unsave;
    try { await (await caches.open("uq-audio")).delete(u); } catch {}
    delete S.saved[u]; save(true); toast("اتمسح من الحفظ بدون نت"); route(); return;
  }
  if (el.dataset.go) { e.preventDefault(); location.hash = el.dataset.go; return; }
  if (el.dataset.bead) {
    const goal = +el.dataset.bead; const c = (+el.dataset.c || 0) + 1; el.dataset.c = c;
    if (navigator.vibrate) navigator.vibrate(c % goal === 0 ? [30, 60, 30] : 12);
    $(".cnt", el).textContent = n2a(c);
    el.classList.toggle("done", c % goal === 0);
    $(".rounds", el).textContent = c >= goal ? `أتممت ${n2a(Math.floor(c / goal))} مرة` : `الهدف ${n2a(goal)}`;
    return;
  }
  const act = el.dataset.act, t = cur();
  switch (act) {
    case "back": if (history.length > 1) history.back(); else location.hash = "#/"; break;
    case "reload": memo.clear(); route(); break;
    case "toggle": toggle(); break;
    case "next": next(); break;
    case "prev": prev(); break;
    case "fwd": seekBy(15); break;
    case "rew": seekBy(-15); break;
    case "closeSheet": closeSheet(); break;
    case "stopPlayer": closePlayer(); break;
    case "fav": if (t) { toggleFav(t); renderSheet(true); } break;
    case "rate": P.rate = RATES[(RATES.indexOf(P.rate) + 1) % RATES.length]; A.playbackRate = P.rate; renderSheet(true); break;
    case "repeat": P.repeat = (P.repeat + 1) % 3; renderSheet(true); break;
    case "offline": if (t) saveOffline(t); break;
    case "sleep": {
      const box = $("#sleepBox");
      box.innerHTML = box.innerHTML ? "" : `<div class="sleep-menu">${[[15, "15 دقيقة"], [30, "30 دقيقة"], [60, "ساعة"], [-1, "نهاية المقطع"], [0, "إلغاء"]].map(([m, l]) => `<button class="chip" data-act="sleepSet" data-m="${m}">${l}</button>`).join("")}</div>`;
      break;
    }
    case "sleepSet": setSleep(+el.dataset.m); break;
    case "share": {
      const url = location.href.split("#")[0];
      const text = t ? `${t.t} — ${t.s || ""}\nاستمع على ألترا قرآن: ${url}` : url;
      if (navigator.share) navigator.share({ title: "ألترا قرآن", text }).catch(() => {});
      else { try { await navigator.clipboard.writeText(text); toast("اتنسخ الرابط"); } catch {} }
      break;
    }
    case "resume": {
      const L = S.last;
      if (L?.q?.length) playList(L.q, L.i, L.q[L.i]?.live ? 0 : L.time || 0);
      break;
    }
    case "shuffle": {
      const list = [...(LISTS[el.dataset.list] || [])].sort(() => Math.random() - 0.5);
      playList(list, 0);
      break;
    }
    case "bio": {
      const b = $("#bio"); b.classList.toggle("clamp");
      el.textContent = b.classList.contains("clamp") ? "اقرأ السيرة كاملة" : "إخفاء";
      break;
    }
    case "pg": goPage(+el.dataset.p); break;
    case "riwaya": S.riwaya = S.riwaya === "hafs" ? "warsh" : "hafs"; save(); sessionStorage.setItem("keep-scroll", "1"); route(); break;
    case "mode": S.mode = S.mode === "img" ? "text" : "img"; save(); sessionStorage.setItem("keep-scroll", "1"); route(); break;
    case "tafsirT": S.tafsir = !S.tafsir; save(); el.setAttribute("aria-pressed", S.tafsir); $("#tafsir").hidden = !S.tafsir; if (S.tafsir) drawTafsir(S.page); break;
    case "saveMushaf": saveMushaf(); break;
    case "pgPrev": goPage((BOOK?.page || S.page) - (BOOK?.step?.() || 1)); break;
    case "pgNext": goPage((BOOK?.page || S.page) + (BOOK?.step?.() || 1)); break;
    case "listenSurah": listenSurah(); break;
    case "pickMReciter": pickMReciter(); break;
    case "setMReciter": S.mReciter = +el.dataset.id; save(true); $("#modal").classList.remove("open"); sessionStorage.setItem("keep-scroll", "1"); route(); setTimeout(listenSurah, 300); break;
    case "bookmark": { const p = BOOK?.page || S.page; S.bookmark = S.bookmark === p ? null : p; save(true); el.setAttribute("aria-pressed", String(S.bookmark === p)); toast(S.bookmark ? `اتحطت علامة على صفحة ${n2a(p)}` : "اتشالت العلامة"); break; }
    case "immersive": toggleImmersive(); break;
    case "compass": { const c = prayerCfg(); startCompass(qiblaBearing(c.lat, c.lng)); break; }
    case "fs": { S.fs = Math.min(1.6, Math.max(0.8, +((S.fs || 1) + 0.1 * +el.dataset.d).toFixed(2))); save(); $("#deck")?.style.setProperty("--rfs", S.fs); break; }
    case "beadReset": { const b = el.parentElement.querySelector("[data-bead]"); b.dataset.c = 0; $(".cnt", b).textContent = "0"; b.classList.remove("done"); $(".rounds", b).textContent = `الهدف ${n2a(+b.dataset.bead)}`; break; }
    case "pbell": { const c = prayerCfg(); const k = el.dataset.k; c.on[k] = !c.on[k]; save(true); toast(c.on[k] ? `أذان ${PNAME[k]} مفعّل` : `أذان ${PNAME[k]} متوقف`); sessionStorage.setItem("keep-scroll", "1"); route(); break; }
    case "testAdhan": playAdhan("dhuhr", true); break;
    case "gps": locateMe(); break;
    case "confirmCity": { const c = prayerCfg(); c.auto = false; save(true); toast(`تم ✓ الأذان هيشتغل على مواقيت ${c.name}`); route(); break; }
    case "ics": buildICS(); break;
    case "notify": {
      const c = prayerCfg();
      if (!("Notification" in window)) { toast(isIOS() ? "على الآيفون: ثبّت التطبيق على الشاشة الرئيسية الأول، وبعدين فعّل الإشعارات" : "المتصفح ده مبيدعمش الإشعارات", 5000); break; }
      if (c.notify && Notification.permission === "granted") { c.notify = false; save(true); el.setAttribute("aria-pressed", "false"); break; }
      const p = await Notification.requestPermission();
      c.notify = p === "granted"; save(true);
      el.setAttribute("aria-pressed", String(c.notify));
      toast(c.notify ? "الإشعارات اتفعلت ✓" : "الإشعارات مرفوضة من إعدادات الموبايل");
      break;
    }
    case "pickM": {
      const c = prayerCfg(); const i = +el.dataset.i; const fajr = el.dataset.w === "fajr";
      if (i < 0) { delete c.fajrMuezzin; save(true); toast("أذان الفجر هيبقى بنفس مؤذن الصلوات"); history.back(); break; }
      const a = window.__adhanPick[i];
      const m = { u: a[3], t: a[2], pid: a[0], n: a[1] };
      if (fajr) c.fajrMuezzin = m; else c.muezzin = m;
      save(true); toast(`تم اختيار أذان ${a[1]}`); history.back(); break;
    }
    case "install": doInstall(); break;
    case "installHide": S.installHidden = true; save(true); (el.closest(".install-card") || el.closest(".cont"))?.remove(); toast("تقدر تثبته بعدين من «محفوظاتي»"); break;
    case "closeModal": $("#modal").classList.remove("open"); break;
  }
});
$("#miniPP").addEventListener("click", toggle);
$("#miniX").addEventListener("click", closePlayer);
$("#miniMeta").addEventListener("click", openSheet);
$("#miniArt").addEventListener("click", openSheet);
$("#vClose").addEventListener("click", () => closeVideo());
window.addEventListener("popstate", () => {
  if ($("#sheet").classList.contains("open") && !history.state?.sheet) { closeSheet(true); return; }
  if ($("#video").classList.contains("open") && !history.state?.video) { closeVideo(true); return; }
});
window.addEventListener("hashchange", route);
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === " " && cur()) { e.preventDefault(); toggle(); }
  if (location.hash.startsWith("#/mushaf")) {
    if (e.key === "ArrowLeft") goPage(S.page + (BOOK?.step?.() || 1));
    if (e.key === "ArrowRight") goPage(S.page - (BOOK?.step?.() || 1));
  }
  if (e.key === "Escape") { closeSheet(); closeVideo(); }
});

/* ======================================================================
   BOOT
   ====================================================================== */
(async function boot() {
  try {
    [META, RECITERS] = await Promise.all([getJSON("data/meta.json"), getJSON("data/reciters.json")]);
  } catch {
    $("#view").innerHTML = `<div class="empty"><b>محتاج نت أول مرة</b>افتح الموقع وانت متصل بالإنترنت مرة واحدة، وبعدها أجزاء كتير منه هتشتغل من غير نت.<div class="btn-row" style="justify-content:center"><button class="btn" onclick="location.reload()">جرّب تاني</button></div></div>`;
    return;
  }
  RECITERS.forEach((r) => { RIDX[r[0]] = r; });
  route();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
    // a new version took over: reload once so the page shows it
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
})();
})();
