import "./style.css";

const els = {
  username: document.getElementById("username"),
  go: document.getElementById("go"),
  search: document.getElementById("search"),
  sort: document.getElementById("sort"),
  shuffle: document.getElementById("shuffle"),
  clear: document.getElementById("clear"),
  statusText: document.getElementById("statusText"),
  countText: document.getElementById("countText"),
  grid: document.getElementById("grid"),

  // optional UI in HTML
  tokenHint: document.getElementById("tokenHint"),
  setToken: document.getElementById("setToken"),

  // Share button (id="shareWall")
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
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

// Your PayPal email (fallback only if HTML doesn't provide a paypal.me link)
const PAYPAL_EMAIL = "titans.rule1215@gmail.com";
const DEFAULT_DRINK_USD = "5.00";

let allItems = [];
let viewItems = [];
let observer = null;

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
    localStorage.setItem(
      cacheKey(username),
      JSON.stringify({ ts: Date.now(), items })
    );
  } catch {
    // ignore storage issues
  }
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
 * normalizeItem:
 * - Uses release id to build a correct Discogs web URL:
 *   https://www.discogs.com/release/{id}
 */
function normalizeItem(entry) {
  const bi = entry?.basic_information || {};
  const releaseId = bi?.id || null;
  const discogsUrl = releaseId ? `https://www.discogs.com/release/${releaseId}` : "";

  return {
    id:
      entry?.id ??
      releaseId ??
      (globalThis.crypto?.randomUUID?.() || String(Math.random())),
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

/**
 * Server-side Discogs fetch via Netlify Function (NO TOKEN IN BROWSER)
 * Calls:
 *   /.netlify/functions/discogs?username=...&page=...&per_page=...
 */
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
        j?.error
          ? `${j.error}${j.details ? ` — ${j.details}` : ""}`
          : `Server error ${res.status}`
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

    // basic retry with backoff for 429s
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
function renderGrid(items) {
  els.grid.innerHTML = "";
  createObserver();

  const frag = document.createDocumentFragment();

  for (const item of items) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.title = `${item.artist} — ${item.title}`;

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

    // added_desc default
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

// -------------------- LOAD USER --------------------
async function loadUser(username) {
  if (!username) return;

  const cached = readCache(username);
  if (cached) {
    allItems = cached;
    setStatus("Loaded.", `${allItems.length} total`);
    applyFilters();
    return;
  }

  setStatus("Contacting Discogs…", "");
  const items = await fetchAllCollection(username);
  allItems = items;
  writeCache(username, items);
  setStatus("Loaded.", `${items.length} total`);
  applyFilters();
}

// -------------------- URL PARAMS (shareable) --------------------
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

  const shareUrl = `${location.origin}${location.pathname}?user=${encodeURIComponent(
    username
  )}`;

  const shareData = {
    title: "My Discogs Wall",
    text: `Check out my Discogs wall (${username}).`,
    url: shareUrl,
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
  } catch {
    return; // user canceled
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    alert("Link copied. Paste it anywhere.");
  } catch {
    window.prompt("Copy this link:", shareUrl);
  }
}

// -------------------- 🍺 PAYPAL FALLBACK (email donate link) --------------------
function paypalDonateUrl() {
  const base = "https://www.paypal.com/donate";
  const u = new URL(base);
  u.searchParams.set("business", PAYPAL_EMAIL);
  u.searchParams.set("currency_code", "USD");
  u.searchParams.set("amount", DEFAULT_DRINK_USD);
  return u.toString();
}

// -------------------- 🍺 CHEERS FX (FIXED) --------------------
function beerCheersFX() {
  const beer = document.getElementById("beer");
  const toast = document.getElementById("cheersToast");

  if (navigator.vibrate) navigator.vibrate(30);

  // Beer emoji animation
  if (beer) {
    beer.classList.remove("beer-pop");
    void beer.offsetWidth; // restart animation
    beer.classList.add("beer-pop");
  }

  // Toast popup (ONLY when clicked)
  if (toast) {
    toast.textContent = "Cheers 🍻";
    toast.hidden = false;
    toast.classList.add("show");
    toast.setAttribute("aria-hidden", "false");

    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove("show");
      toast.setAttribute("aria-hidden", "true");
      toast.hidden = true;
      toast.textContent = "";
    }, 900);
  }
}

// -------------------- INIT --------------------
function init() {
  // Hide token UI (no nerd text)
  if (els.tokenHint) els.tokenHint.textContent = "";
  if (els.setToken) els.setToken.style.display = "none";

  // FORCE-hide cheers toast on load (so it never sits bottom-left)
  const toast = document.getElementById("cheersToast");
  if (toast) {
    toast.hidden = true;
    toast.textContent = "";
    toast.classList.remove("show");
    toast.setAttribute("aria-hidden", "true");
  }

  // Hook Share button
  if (els.shareWall) els.shareWall.addEventListener("click", shareWall);

  // Hook Drink link: DO NOT overwrite paypal.me if HTML already has it.
  const drinkLink = document.getElementById("drinkLink");
  if (drinkLink) {
    const href = String(drinkLink.getAttribute("href") || "").trim();

    // If for some reason href is missing, set a safe fallback
    if (!href || href === "#") {
      drinkLink.setAttribute("href", paypalDonateUrl());
    }

    // Cheers FX on tap/click (words OR 🍺)
    drinkLink.addEventListener("click", () => {
      beerCheersFX();
    });
  }

  // Auto-load from shared link
  const initialUser = getUserFromUrl();
  if (initialUser) {
    els.username.value = initialUser;
    loadUser(initialUser).catch((err) =>
      setStatus(String(err.message || err), "")
    );
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

  // modal close
  els.modalBackdrop.addEventListener("click", closeModal);
  els.modalClose.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
