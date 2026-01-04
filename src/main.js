import "./style.css";

const els = {
  username: document.getElementById("username"),
  go: document.getElementById("go"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  shuffle: document.getElementById("shuffle"),
  viewMode: document.getElementById("viewMode"),
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

// -------------------- LOADING STATE (spin + tonearm) --------------------
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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

/**
 * FIXED HERE ✅
 * Prefer Discogs "uri" from the collection item when available.
 * uri is usually "/release/12345" so we must prefix with "https://www.discogs.com"
 * Otherwise we fallback to /release/{id}
 */
function normalizeItem(entry) {
  const bi = entry?.basic_information || {};
  const releaseId = bi?.id || null;

  const uri = entry?.uri || "";
  const discogsUrl = uri
    ? (uri.startsWith("http") ? uri : `https://www.discogs.com${uri}`)
    : (releaseId ? `https://www.discogs.com/release/${releaseId}` : "");

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

// -------------------- MODAL --------------------
function openModal(item) {
  els.modalImg.src = item.cover || "";
  els.modalImg.alt = `${item.artist} — ${item.title}`;
  els.modalTitle.textContent = item.title || "";
  els.modalArtist.textContent = item.artist || "";
  els.modalYear.textContent = item.year ? `Year: ${item.year}` : "";
  els.modalFormat.textContent = item.formats ? `Format: ${item.formats}` : "";

  if (item.discogsUrl) {
    els.modalLink.href = item.discogsUrl;
    els.modalLink.target = "_blank";
    els.modalLink.rel = "noopener";
    els.modalLink.style.display = "inline-block";
  } else {
    els.modalLink.style.display = "none";
  }

  els.modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  els.modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
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
  els.grid.innerHTML = "";
  createObserver();

  els.grid.classList.toggle("collage", collageOn);

  const frag = document.createDocumentFragment();

  for (const item of items) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.title = `${item.artist} — ${item.title}`;

    if (collageOn) {
      tile.style.setProperty("--tilt", `${deterministicTilt(String(item.id))}deg`);
    } else {
      tile.style.removeProperty("--tilt");
    }

    const img = document.createElement("img");
    img.dataset.src = item.cover || "";
    img.alt = `${item.artist} — ${item.title}`;
    img.loading = "lazy";

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = `
      <div class="t">${escapeHtml(item.title)}</div>
      <div class="a">${escapeHtml(item.artist || "")}${item.year ? ` • ${item.year}` : ""}</div>
    `;

    tile.appendChild(img);
    tile.appendChild(badge);
    tile.addEventListener("click", () => openModal(item));

    frag.appendChild(tile);
    observer.observe(img);
  }

  els.grid.appendChild(frag);
}

// -------------------- FILTERS/SORT --------------------
function applyFilters() {
  const q = (els.search.value || "").trim().toLowerCase();
  let items = allItems.slice();

  if (q) {
    items = items.filter(
      (it) =>
        (it.title || "").toLowerCase().includes(q) ||
        (it.artist || "").toLowerCase().includes(q)
    );
  }

  const sort = els.sort.value;
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

// -------------------- SHARE WALL --------------------
async function shareWall() {
  const username = (els.username?.value || "").trim();
  if (!username) {
    alert("Enter a Discogs username first.");
    return;
  }

  const shareUrl = `${location.origin}${location.pathname}?user=${encodeURIComponent(username)}`;

  const shareData = {
    title: "My VinylWall",
    text: `Drop the needle on my Discogs wall (${username}).`,
    url: shareUrl,
  };

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
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1);

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

    const hum = audioCtx.createOscillator();
    hum.type = "sine";
    hum.frequency.setValueAtTime(40, now);
    const humGain = audioCtx.createGain();
    humGain.gain.setValueAtTime(0.0, now);
    humGain.gain.linearRampToValueAtTime(0.12, now + 0.02);
    humGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    hum.connect(humGain);
    humGain.connect(master);
    hum.start(now);
    hum.stop(now + 0.36);
  } catch {}
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
  } finally {
    setLoading(false);
  }
}

// -------------------- INIT --------------------
function init() {
  if (els.tokenHint) els.tokenHint.textContent = "";
  if (els.setToken) els.setToken.style.display = "none";

  if (els.shareWall) els.shareWall.addEventListener("click", shareWall);

  // Collage toggle (only if you actually have the button in HTML)
  if (els.viewMode) {
    els.viewMode.addEventListener("click", () => {
      collageOn = !collageOn;
      els.viewMode.textContent = collageOn ? "Grid" : "Collage";
      if (allItems.length) applyFilters();
    });
  }

  const drinkLink = document.getElementById("drinkLink");
  if (drinkLink) {
    const href = String(drinkLink.getAttribute("href") || "").trim();
    if (!href || href === "#") drinkLink.setAttribute("href", paypalDonateUrl());
    drinkLink.addEventListener("click", () => beerCheersFX());
  }

  const initialUser = getUserFromUrl();
  if (initialUser) {
    els.username.value = initialUser;
    loadUser(initialUser).catch((err) => setStatus(String(err.message || err), ""));
  }

  els.go.addEventListener("click", async () => {
    const username = els.username.value.trim();
    if (!username) return;
    setUserInUrl(username);
    try {
      await loadUser(username);
    } catch (e) {
      setStatus(String(e.message || e), "");
    }
  });

  els.username.addEventListener("keydown", (e) => {
    if (e.key === "Enter") els.go.click();
  });

  els.search.addEventListener("input", () => {
    if (!allItems.length) return;
    applyFilters();
  });

  els.sort.addEventListener("change", () => {
    if (!allItems.length) return;
    applyFilters();
  });

  els.shuffle.addEventListener("click", () => {
    if (!viewItems.length) return;
    shuffleCurrent();
  });

  els.clear.addEventListener("click", () => {
    clearAllCaches();
    setStatus("Cache cleared.", "");
  });

  if (els.modalBackdrop) els.modalBackdrop.addEventListener("click", closeModal);
  if (els.modalClose) els.modalClose.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
