import "./style.css";

/* =========================================================
   VinylWall - main.js
   Fixes:
   ✅ Live covers load normally (no crossOrigin on live images)
   ✅ Download Image exports a compact collage and AUTO-SHRINKS
   ✅ Download uses Netlify image proxy to bypass Discogs CORS
   ✅ Share link Reddit-safe (no username in URL)
   ✅ Collage = Privacy Mode (strips ?user= when enabled)
   ========================================================= */

const els = {
  username: document.getElementById("username"),
  go: document.getElementById("go"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  shuffle: document.getElementById("shuffle"),
  viewMode: document.getElementById("viewMode"),
  downloadImage: document.getElementById("downloadImage"),
  clear: document.getElementById("clear"),
  statusText: document.getElementById("statusText"),
  countText: document.getElementById("countText"),
  grid: document.getElementById("grid"),

  tokenHint: document.getElementById("tokenHint"),
  setToken: document.getElementById("setToken"),
  shareWall: document.getElementById("shareWall"),

  modal: document.getElementById("modal"),
  modalBackdrop: document.getElementById("modalBackdrop"),
  modalClose: document.getElementById("modalClose"),
  modalImg: document.getElementById("modalImg"),
  modalTitle: document.getElementById("modalTitle"),
  modalArtist: document.getElementById("modalArtist"),
  modalYear: document.getElementById("modalYear"),
  modalFormat: document.getElementById("modalFormat"),
  modalLink: document.getElementById("modalLink"),
};

const CACHE_PREFIX = "discovers_cache_v1_";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

const PAYPAL_EMAIL = "titans.rule1215@gmail.com";
const DEFAULT_DRINK_USD = "5.00";

let allItems = [];
let viewItems = [];
let observer = null;
let collageOn = false;

// =====================
// STATS (persist + overlay)
// =====================
const STATS_KEY = "vw_stats";

function stripDiscogsSuffix(name) {
  return String(name || "").replace(/\s\(\d+\)$/, "").trim();
}

function computeCollectionStats(items) {
  const artistCount = new Map();
  let oldest = null;
  let newest = null;

  for (const it of items || []) {
    const artist = stripDiscogsSuffix(it.artist || "");
    if (artist) artistCount.set(artist, (artistCount.get(artist) || 0) + 1);

    const y = typeof it.year === "number" ? it.year : parseInt(it.year, 10) || 0;
    if (y > 0) {
      oldest = oldest === null ? y : Math.min(oldest, y);
      newest = newest === null ? y : Math.max(newest, y);
    }
  }

  const topArtists = [...artistCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  return {
    totalShown: (items || []).length,
    uniqueArtists: artistCount.size,
    oldestYear: oldest,
    newestYear: newest,
    topArtists,
  };
}

function saveStats(username, stats) {
  try {
    localStorage.setItem(
      STATS_KEY,
      JSON.stringify({ username: String(username || ""), stats, ts: Date.now() })
    );
  } catch {}
}

function readStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.stats) return null;
    return parsed;
  } catch {
    return null;
  }
}

function ensureStatsUI() {
  if (document.getElementById("vwStatsPanel")) return;

  const style = document.createElement("style");
  style.textContent = `
    .vw-stats-fab{
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 9998;
      border-radius: 999px;
      padding: 12px 14px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(10,10,14,0.72);
      color: #fff;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      box-shadow: 0 18px 45px rgba(0,0,0,0.45);
      font-weight: 700;
      letter-spacing: .02em;
      cursor: pointer;
      user-select: none;
    }
    .vw-stats-backdrop{
      position: fixed;
      inset: 0;
      z-index: 9998;
      background: rgba(0,0,0,0.55);
      display: none;
    }
    .vw-stats-panel{
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%,-50%);
      z-index: 9999;
      width: min(720px, calc(100vw - 26px));
      max-height: min(78vh, 760px);
      overflow: auto;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(12,12,18,0.72);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 30px 90px rgba(0,0,0,0.6);
      padding: 14px;
      display: none;
    }
    .vw-stats-head{
      display:flex; align-items:flex-start; justify-content:space-between;
      gap: 10px; padding: 6px 8px 10px;
    }
    .vw-stats-title{
      font-size: 14px; letter-spacing: .12em; opacity:.7; text-transform: uppercase;
    }
    .vw-stats-user{
      font-size: 14px; opacity:.9; margin-top: 2px;
    }
    .vw-stats-close{
      border: 0;
      background: rgba(255,255,255,0.08);
      color: #fff;
      border-radius: 12px;
      padding: 8px 10px;
      cursor: pointer;
    }
    .vw-stats-grid{
      display:grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 8px;
    }
    @media (min-width: 720px){
      .vw-stats-grid{ grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    .vw-card{
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.05);
      padding: 12px;
      min-height: 86px;
    }
    .vw-card .k{ font-size: 12px; letter-spacing:.12em; opacity:.6; text-transform: uppercase; }
    .vw-card .v{ font-size: 28px; font-weight: 800; margin-top: 6px; }
    .vw-card .s{ font-size: 12px; opacity: .7; margin-top: 2px; }
    .vw-top{
      padding: 8px;
    }
    .vw-top h3{
      margin: 8px 8px 10px;
      font-size: 12px;
      letter-spacing: .14em;
      opacity:.65;
      text-transform: uppercase;
    }
    .vw-top-list{
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,0.10);
      background: rgba(255,255,255,0.05);
      padding: 10px;
      margin: 0 8px 10px;
    }
    .vw-top-row{
      display:flex; justify-content:space-between; gap: 10px;
      padding: 8px 6px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 14px;
      opacity: .92;
    }
    .vw-top-row:last-child{ border-bottom: 0; }
    .vw-muted{ opacity:.65; padding: 8px 6px; }
    .vw-stats-foot{
      display:flex; justify-content:space-between; gap: 10px;
      padding: 0 14px 12px;
      font-size: 12px; opacity:.55;
    }
  `;
  document.head.appendChild(style);

  const fab = document.createElement("button");
  fab.className = "vw-stats-fab";
  fab.id = "vwStatsFab";
  fab.type = "button";
  fab.textContent = "Stats";

  const backdrop = document.createElement("div");
  backdrop.className = "vw-stats-backdrop";
  backdrop.id = "vwStatsBackdrop";

  const panel = document.createElement("div");
  panel.className = "vw-stats-panel";
  panel.id = "vwStatsPanel";
  panel.innerHTML = `
    <div class="vw-stats-head">
      <div>
        <div class="vw-stats-title">Collection Flex</div>
        <div class="vw-stats-user">Loaded: <span id="vwStatsUser">—</span></div>
      </div>
      <button class="vw-stats-close" id="vwStatsClose" type="button">✕</button>
    </div>

    <div class="vw-stats-grid">
      <div class="vw-card">
        <div class="k">Items</div>
        <div class="v" id="vwStatsItems">—</div>
        <div class="s">shown</div>
      </div>

      <div class="vw-card">
        <div class="k">Unique artists</div>
        <div class="v" id="vwStatsUniqueArtists">—</div>
        <div class="s">estimated</div>
      </div>

      <div class="vw-card">
        <div class="k">Oldest</div>
        <div class="v" id="vwStatsOldest">—</div>
        <div class="s">year</div>
      </div>

      <div class="vw-card">
        <div class="k">Newest</div>
        <div class="v" id="vwStatsNewest">—</div>
        <div class="s">year</div>
      </div>
    </div>

    <div class="vw-top">
      <h3>Top artists</h3>
      <div class="vw-top-list" id="vwStatsTopArtists">
        <div class="vw-muted">No stats yet</div>
      </div>
    </div>

    <div class="vw-stats-foot">
      <div>Tip: this stays for return visits.</div>
      <div>Saved as ${STATS_KEY}</div>
    </div>
  `;

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(fab);

  const open = () => {
    backdrop.style.display = "block";
    panel.style.display = "block";
  };
  const close = () => {
    backdrop.style.display = "none";
    panel.style.display = "none";
  };

  fab.addEventListener("click", open);
  backdrop.addEventListener("click", close);
  panel.querySelector("#vwStatsClose")?.addEventListener("click", close);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderStatsOverlay(username, items) {
  ensureStatsUI();

  const stats = computeCollectionStats(items);
  saveStats(username, stats);

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setText("vwStatsUser", username || "—");
  setText("vwStatsItems", String(stats.totalShown || 0));
  setText("vwStatsUniqueArtists", stats.uniqueArtists ? String(stats.uniqueArtists) : "—");
  setText("vwStatsOldest", stats.oldestYear ? String(stats.oldestYear) : "—");
  setText("vwStatsNewest", stats.newestYear ? String(stats.newestYear) : "—");

  const list = document.getElementById("vwStatsTopArtists");
  if (list) {
    list.innerHTML = "";
    if (!stats.topArtists.length) {
      list.innerHTML = `<div class="vw-muted">No stats yet</div>`;
    } else {
      for (const a of stats.topArtists) {
        const row = document.createElement("div");
        row.className = "vw-top-row";
        row.innerHTML = `<span>${escapeHtml(a.name)}</span><span>${a.count}</span>`;
        list.appendChild(row);
      }
    }
  }

  return stats;
}

function hydrateStatsFromStorage() {
  const saved = readStats();
  if (!saved?.stats) return;

  ensureStatsUI();

  const username = saved.username || "—";
  const stats = saved.stats;

  const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  setText("vwStatsUser", username);
  setText("vwStatsItems", String(stats.totalShown || 0));
  setText("vwStatsUniqueArtists", stats.uniqueArtists ? String(stats.uniqueArtists) : "—");
  setText("vwStatsOldest", stats.oldestYear ? String(stats.oldestYear) : "—");
  setText("vwStatsNewest", stats.newestYear ? String(stats.newestYear) : "—");

  const list = document.getElementById("vwStatsTopArtists");
  if (list) {
    list.innerHTML = "";
    if (!Array.isArray(stats.topArtists) || !stats.topArtists.length) {
      list.innerHTML = `<div class="vw-muted">No stats yet</div>`;
    } else {
      for (const a of stats.topArtists.slice(0, 8)) {
        const row = document.createElement("div");
        row.className = "vw-top-row";
        row.innerHTML = `<span>${escapeHtml(a.name)}</span><span>${a.count}</span>`;
        list.appendChild(row);
      }
    }
  }
}

// -------------------- LOADING STATE --------------------
function setLoading(on) {
  document.body.classList.toggle("is-loading", !!on);
  if (els.go) els.go.disabled = !!on;
}

// -------------------- CACHE --------------------
function cacheKey(username) {
  return `${CACHE_PREFIX}${username.toLowerCase()}`;
}

function readCache(username) {
  try {
    const raw = localStorage.getItem(cacheKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ts || !Array.isArray(parsed?.items)) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) return null;
    return parsed.items;
  } catch {
    return null;
  }
}

function writeCache(username, items) {
  try {
    localStorage.setItem(cacheKey(username), JSON.stringify({ ts: Date.now(), items }));
  } catch {}
}

function clearAllCaches() {
  const keys = Object.keys(localStorage);
  for (const k of keys) {
    if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
  }
}

// -------------------- UI HELPERS --------------------
function setStatus(text, count = "") {
  if (els.statusText) els.statusText.textContent = text;
  if (els.countText) els.countText.textContent = count;
}

// -------------------- FORMATTERS --------------------
function formatArtists(artistsArr) {
  if (!Array.isArray(artistsArr)) return "";
  return artistsArr.map((a) => a?.name).filter(Boolean).join(", ");
}

function formatFormats(formatsArr) {
  if (!Array.isArray(formatsArr)) return "";
  return formatsArr
    .map((f) => {
      const desc = Array.isArray(f.descriptions) ? f.descriptions.join(", ") : "";
      const qty = f.qty ? `${f.qty}× ` : "";
      return `${qty}${f.name}${desc ? ` (${desc})` : ""}`.trim();
    })
    .join(" • ");
}

function normalizeItem(entry) {
  const bi = entry?.basic_information || {};
  const releaseId = bi?.id || null;

  const uri = entry?.uri || "";
  const discogsUrl = uri
    ? uri.startsWith("http")
      ? uri
      : `https://www.discogs.com${uri}`
    : releaseId
      ? `https://www.discogs.com/release/${releaseId}`
      : "";

  return {
    id: entry?.id ?? releaseId ?? (globalThis.crypto?.randomUUID?.() || String(Math.random())),
    releaseId,
    title: bi?.title || "(Unknown Title)",
    artist: formatArtists(bi?.artists),
    year: bi?.year || null,
    cover: bi?.cover_image || "",
    formats: formatFormats(bi?.formats),
    discogsUrl,
    dateAdded: entry?.date_added || null,
  };
}

// -------------------- DISCOGS FETCH --------------------
async function discogsFetchCollectionPage(username, page, perPage) {
  const url =
    `/.netlify/functions/discogs?username=${encodeURIComponent(username)}` +
    `&page=${encodeURIComponent(page)}` +
    `&per_page=${encodeURIComponent(perPage)}`;

  const res = await fetch(url, { headers: { Accept: "application/json" } });

  if (res.status === 429) throw new Error("Rate limited (429).");
  const txt = await res.text().catch(() => "");
  if (!res.ok) {
    try {
      const j = JSON.parse(txt);
      throw new Error(
        j?.error ? `${j.error}${j.details ? ` — ${j.details}` : ""}` : `Server error ${res.status}`
      );
    } catch {
      throw new Error(`Server error ${res.status}. ${txt.slice(0, 160)}`);
    }
  }

  return JSON.parse(txt);
}

async function fetchAllCollection(username) {
  const perPage = 100;
  let page = 1;
  let pages = 1;
  const out = [];

  while (page <= pages) {
    setStatus(`Loading… page ${page} of ${pages}`, "");
    let json;

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        json = await discogsFetchCollectionPage(username, page, perPage);
        break;
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("429")) {
          const wait = 900 * (attempt + 1);
          setStatus(`Discogs is throttling. Waiting ${wait}ms…`, "");
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }

    if (!json) throw new Error("Failed to load from Discogs.");

    pages = json?.pagination?.pages || 1;
    const releases = Array.isArray(json?.releases) ? json.releases : [];
    for (const r of releases) out.push(normalizeItem(r));
    page += 1;
  }

  return out;
}

// -------------------- LAZY IMAGE OBSERVER --------------------
function destroyObserver() {
  if (observer) observer.disconnect();
  observer = null;
}

function createObserver() {
  destroyObserver();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const img = entry.target;
        const src = img.dataset.src;
        if (src) img.src = src;
        img.removeAttribute("data-src");
        observer.unobserve(img);
      }
    },
    { rootMargin: "400px" }
  );
}

// -------------------- OPEN DISCOGS --------------------
function openDiscogs(url) {
  if (!url) return;
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) return;
  } catch {}
  location.href = url;
}

// -------------------- MODAL --------------------
let currentModalUrl = "";

function openModal(item) {
  currentModalUrl = item.discogsUrl || "";

  if (els.modalImg) {
    els.modalImg.src = item.cover || "";
    els.modalImg.alt = `${item.artist} — ${item.title}`;
  }
  if (els.modalTitle) els.modalTitle.textContent = item.title || "";
  if (els.modalArtist) els.modalArtist.textContent = item.artist || "";
  if (els.modalYear) els.modalYear.textContent = item.year ? `Year: ${item.year}` : "";
  if (els.modalFormat) els.modalFormat.textContent = item.formats ? `Format: ${item.formats}` : "";

  if (els.modalLink) {
    if (currentModalUrl) {
      els.modalLink.href = currentModalUrl;
      els.modalLink.textContent = "Open on Discogs ↗";
      els.modalLink.style.display = "inline-block";
    } else {
      els.modalLink.style.display = "none";
    }
  }

  if (els.modal) {
    els.modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
}

function closeModal() {
  if (els.modal) els.modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  currentModalUrl = "";
}

// -------------------- GRID --------------------
function deterministicTilt(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = (h >>> 0) % 7;
  const deg = (r - 3) * 0.35;
  return deg.toFixed(2);
}

function renderGrid(items) {
  if (!els.grid) return;
  els.grid.innerHTML = "";
  createObserver();

  els.grid.classList.toggle("collage", collageOn);

  const frag = document.createDocumentFragment();

  for (const item of items) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.title = `${item.artist} — ${item.title}`;

    if (collageOn) tile.style.setProperty("--tilt", `${deterministicTilt(String(item.id))}deg`);
    else tile.style.removeProperty("--tilt");

    const img = document.createElement("img");
    img.dataset.src = item.cover || "";
    img.alt = `${item.artist} — ${item.title}`;
    img.loading = "lazy";
    // ✅ Do NOT set crossOrigin on LIVE images (can break loading)

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = `
      <div class="t">${escapeHtml(item.title)}</div>
      <div class="a">${escapeHtml(item.artist || "")}${item.year ? ` • ${item.year}` : ""}</div>
      <div class="discogs-hint">Tap to open Discogs ↗</div>
    `;

    tile.appendChild(img);
    tile.appendChild(badge);

    tile.addEventListener("click", () => openDiscogs(item.discogsUrl));

    let pressTimer = null;
    tile.addEventListener(
      "touchstart",
      () => (pressTimer = setTimeout(() => openModal(item), 450)),
      { passive: true }
    );
    tile.addEventListener("touchend", () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    });
    tile.addEventListener(
      "touchmove",
      () => {
        if (pressTimer) clearTimeout(pressTimer);
        pressTimer = null;
      },
      { passive: true }
    );

    frag.appendChild(tile);
    observer.observe(img);
  }

  els.grid.appendChild(frag);
}

// -------------------- FILTERS/SORT --------------------
function applyFilters() {
  const q = (els.search?.value || "").trim().toLowerCase();
  let items = allItems.slice();

  if (q) {
    items = items.filter(
      (it) =>
        (it.title || "").toLowerCase().includes(q) ||
        (it.artist || "").toLowerCase().includes(q)
    );
  }

  const sort = els.sort?.value || "added_desc";
  const byStr = (a, b, ka, kb) =>
    ka.localeCompare(kb, undefined, { sensitivity: "base" }) ||
    String(a.id).localeCompare(String(b.id));

  const safeYear = (y) => (typeof y === "number" ? y : parseInt(y, 10) || 0);

  items.sort((a, b) => {
    if (sort === "artist_asc") return byStr(a, b, a.artist || "", b.artist || "");
    if (sort === "title_asc") return byStr(a, b, a.title || "", b.title || "");
    if (sort === "year_desc") return safeYear(b.year) - safeYear(a.year);
    if (sort === "year_asc") return safeYear(a.year) - safeYear(b.year);

    const da = a.dateAdded ? Date.parse(a.dateAdded) : 0;
    const db = b.dateAdded ? Date.parse(b.dateAdded) : 0;
    return db - da;
  });

  viewItems = items;
  renderGrid(viewItems);
  setStatus("Loaded.", `${viewItems.length} shown`);

  const currentUser = (els.username?.value || "").trim();
  if (currentUser && viewItems.length) renderStatsOverlay(currentUser, viewItems);
}

function shuffleCurrent() {
  const arr = viewItems.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  viewItems = arr;
  renderGrid(viewItems);
  setStatus("Shuffled.", `${viewItems.length} shown`);

  const currentUser = (els.username?.value || "").trim();
  if (currentUser && viewItems.length) renderStatsOverlay(currentUser, viewItems);
}

// -------------------- URL PARAMS --------------------
function getUserFromUrl() {
  const u = new URL(location.href);
  return (u.searchParams.get("user") || "").trim();
}

function setUserInUrl(username) {
  const u = new URL(location.href);
  if (username) u.searchParams.set("user", username);
  else u.searchParams.delete("user");
  history.replaceState({}, "", u.toString());
}

function stripUserFromUrl() {
  const u = new URL(location.href);
  u.searchParams.delete("user");
  history.replaceState({}, "", u.toString());
}

// -------------------- SHARE WALL (Reddit-safe) --------------------
async function shareWall() {
  const shareUrl = `${location.origin}${location.pathname}`;
  const shareData = { title: "VinylWall", text: `Drop the needle on my wall.`, url: shareUrl };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
  } catch {
    return;
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    alert("Link copied. Paste it anywhere.");
  } catch {
    window.prompt("Copy this link:", shareUrl);
  }
}

// -------------------- PAYPAL FALLBACK --------------------
function paypalDonateUrl() {
  const base = "https://www.paypal.com/donate";
  const u = new URL(base);
  u.searchParams.set("business", PAYPAL_EMAIL);
  u.searchParams.set("currency_code", "USD");
  u.searchParams.set("amount", DEFAULT_DRINK_USD);
  return u.toString();
}

// -------------------- 🍺 CHEERS FX --------------------
function beerCheersFX() {
  const beer = document.getElementById("beer");
  const toast = document.getElementById("cheersToast");

  if (navigator.vibrate) navigator.vibrate(30);

  if (beer) {
    beer.classList.remove("beer-pop");
    void beer.offsetWidth;
    beer.classList.add("beer-pop");
  }

  if (toast) {
    toast.textContent = "Cheers 🍻";
    toast.hidden = false;
    toast.classList.add("show");

    setTimeout(() => {
      toast.classList.remove("show");
      setTimeout(() => {
        toast.hidden = true;
        toast.textContent = "";
      }, 250);
    }, 900);
  }
}

// -------------------- 🎧 NEEDLE DROP SOUND --------------------
let audioCtx = null;

function needleDropSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();

    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0, now);
    master.gain.linearRampToValueAtTime(0.9, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    master.connect(audioCtx.destination);

    const thump = audioCtx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(120, now);
    thump.frequency.exponentialRampToValueAtTime(55, now + 0.08);

    const thumpGain = audioCtx.createGain();
    thumpGain.gain.setValueAtTime(0.0, now);
    thumpGain.gain.linearRampToValueAtTime(0.55, now + 0.005);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    thump.connect(thumpGain);
    thumpGain.connect(master);
    thump.start(now);
    thump.stop(now + 0.13);

    const bufferSize = Math.floor(audioCtx.sampleRate * 0.22);
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;

    const hp = audioCtx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(2500, now);

    const lp = audioCtx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(7500, now);

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.0, now);
    noiseGain.gain.linearRampToValueAtTime(0.75, now + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    noise.connect(hp);
    hp.connect(lp);
    lp.connect(noiseGain);
    noiseGain.connect(master);

    noise.start(now);
    noise.stop(now + 0.23);
  } catch {}
}

// =========================================================
// DOWNLOAD AS IMAGE (compact + auto-shrink + PROXY)
// =========================================================

function calcExportLayout(n, targetWidth = 2048) {
  const cols = Math.max(5, Math.ceil(Math.sqrt(n)));
  const rows = Math.ceil(n / cols);

  let tile = Math.floor(targetWidth / cols);
  const minTile = 26;
  if (tile < minTile) tile = minTile;

  const width = cols * tile;
  const height = rows * tile;

  return { cols, rows, tile, width, height };
}

function proxyCoverUrl(originalUrl) {
  const u = String(originalUrl || "").trim();
  if (!u) return "";
  // Route through our Netlify function so the canvas export can capture it.
  return `/.netlify/functions/img-proxy?url=${encodeURIComponent(u)}`;
}

function buildExportStage(items) {
  const old = document.getElementById("vwExportStage");
  if (old) old.remove();

  const stage = document.createElement("div");
  stage.id = "vwExportStage";
  stage.style.position = "fixed";
  stage.style.left = "-10000px";
  stage.style.top = "0";
  stage.style.opacity = "0.0001";
  stage.style.pointerEvents = "none";
  stage.style.zIndex = "-1";

  const inner = document.createElement("div");
  inner.id = "vwExportInner";
  inner.style.background = "#0b0b0e";
  inner.style.display = "grid";
  inner.style.gap = "0px";
  inner.style.boxSizing = "border-box";
  inner.style.padding = "0px";
  inner.style.margin = "0px";

  stage.appendChild(inner);
  document.body.appendChild(stage);

  for (const it of items) {
    const cell = document.createElement("div");
    cell.style.overflow = "hidden";
    cell.style.background = "rgba(255,255,255,0.04)";
    cell.style.border = "1px solid rgba(255,255,255,0.06)";
    cell.style.boxSizing = "border-box";

    const img = document.createElement("img");

    // ✅ PROXY URL HERE (the whole fix)
    img.src = proxyCoverUrl(it.cover);

    img.alt = "";
    img.decoding = "async";
    img.loading = "eager";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.display = "block";

    // With proxy, crossOrigin is safe (same-origin path)
    img.crossOrigin = "anonymous";

    cell.appendChild(img);
    inner.appendChild(cell);
  }

  return stage;
}

async function waitForExportImages(stage, timeoutMs = 12000) {
  const imgs = [...stage.querySelectorAll("img")];
  if (!imgs.length) return;

  const start = Date.now();

  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          const done = () => resolve();

          if (img.complete && img.naturalWidth > 0) return resolve();

          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });

          const tick = () => {
            if (Date.now() - start > timeoutMs) return done();
            if (img.complete) return done();
            setTimeout(tick, 120);
          };
          tick();
        })
    )
  );
}

async function downloadCollectionImage() {
  const btn = els.downloadImage;
  if (!btn) return;

  const items = viewItems.length ? viewItems : allItems;
  if (!items.length) {
    alert("Load a collection first!");
    return;
  }

  const originalText = btn.textContent;
  btn.textContent = "Creating image...";
  btn.disabled = true;

  try {
    const stage = buildExportStage(items);
    const inner = stage.querySelector("#vwExportInner");

    const layout = calcExportLayout(items.length, 2048);

    inner.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.tile}px)`;
    inner.style.width = `${layout.width}px`;
    inner.style.height = `${layout.height}px`;

    const cells = inner.children;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      c.style.width = `${layout.tile}px`;
      c.style.height = `${layout.tile}px`;
      c.style.borderRadius = layout.tile >= 48 ? "10px" : "8px";
    }

    await waitForExportImages(stage, 12000);

    // eslint-disable-next-line no-undef
    const canvas = await html2canvas(inner, {
      backgroundColor: "#0b0b0e",
      scale: 1,
      logging: false,
      useCORS: true,
      allowTaint: true,
      imageTimeout: 12000,
    });

    const username = (els.username?.value || "collection").trim() || "collection";
    const filename = `vinylwall-${username}-${items.length}-${Date.now()}.jpg`;

    const quality =
      items.length >= 1000 ? 0.76 :
      items.length >= 500 ? 0.80 :
      0.86;

    canvas.toBlob(
      (blob) => {
        if (!blob) throw new Error("Failed to create image blob.");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = filename;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);

        stage.remove();
        btn.textContent = originalText;
        btn.disabled = false;
      },
      "image/jpeg",
      quality
    );
  } catch (err) {
    console.error("Download failed:", err);
    alert("Download failed. Try again.");

    const stage = document.getElementById("vwExportStage");
    if (stage) stage.remove();

    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// -------------------- LOAD USER --------------------
async function loadUser(username) {
  if (!username) return;

  const cached = readCache(username);
  if (cached) {
    allItems = cached;
    setStatus("Loaded.", `${allItems.length} total`);
    applyFilters();
    needleDropSound();
    renderStatsOverlay(username, viewItems.length ? viewItems : allItems);
    return;
  }

  setLoading(true);
  try {
    setStatus("Contacting Discogs…", "");
    const items = await fetchAllCollection(username);
    allItems = items;
    writeCache(username, items);
    setStatus("Loaded.", `${items.length} total`);
    applyFilters();
    needleDropSound();
    renderStatsOverlay(username, viewItems.length ? viewItems : allItems);
  } finally {
    setLoading(false);
  }
}

// -------------------- INIT --------------------
function init() {
  if (els.tokenHint) els.tokenHint.textContent = "";
  if (els.setToken) els.setToken.style.display = "none";

  hydrateStatsFromStorage();

  if (els.shareWall) els.shareWall.addEventListener("click", shareWall);

  if (els.viewMode) {
    els.viewMode.addEventListener("click", () => {
      collageOn = !collageOn;
      document.body.classList.toggle("privacy-mode", collageOn);
      if (collageOn) stripUserFromUrl();
      els.viewMode.textContent = collageOn ? "Grid" : "Collage";
      if (allItems.length) applyFilters();
    });
  }

  if (els.downloadImage) {
    els.downloadImage.addEventListener("click", downloadCollectionImage);
  }

  const drinkLink = document.getElementById("drinkLink");
  if (drinkLink) {
    const href = String(drinkLink.getAttribute("href") || "").trim();
    if (!href || href === "#") drinkLink.setAttribute("href", paypalDonateUrl());
    drinkLink.addEventListener("click", () => beerCheersFX());
  }

  const initialUser = getUserFromUrl();
  if (initialUser && els.username) {
    els.username.value = initialUser;
    loadUser(initialUser).catch((err) => setStatus(String(err.message || err), ""));
  }

  if (els.go) {
    els.go.addEventListener("click", async () => {
      const username = (els.username?.value || "").trim();
      if (!username) return;

      if (!collageOn) setUserInUrl(username);

      try {
        await loadUser(username);
      } catch (e) {
        setStatus(String(e.message || e), "");
      }
    });
  }

  if (els.username && els.go) {
    els.username.addEventListener("keydown", (e) => {
      if (e.key === "Enter") els.go.click();
    });
  }

  if (els.search) {
    els.search.addEventListener("input", () => {
      if (!allItems.length) return;
      applyFilters();
    });
  }

  if (els.sort) {
    els.sort.addEventListener("change", () => {
      if (!allItems.length) return;
      applyFilters();
    });
  }

  if (els.shuffle) {
    els.shuffle.addEventListener("click", () => {
      if (!viewItems.length) return;
      shuffleCurrent();
    });
  }

  if (els.clear) {
    els.clear.addEventListener("click", () => {
      clearAllCaches();
      try {
        localStorage.removeItem(STATS_KEY);
      } catch {}
      setStatus("Cache cleared.", "");
    });
  }

  if (els.modalBackdrop) els.modalBackdrop.addEventListener("click", closeModal);
  if (els.modalClose) els.modalClose.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
