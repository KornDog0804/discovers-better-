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
  tokenHint: document.getElementById("tokenHint"),
  setToken: document.getElementById("setToken"),
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

const LS_TOKEN_KEY = "discogs_token";
const CACHE_PREFIX = "discovers_cache_v1_";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

let allItems = [];
let viewItems = [];
let observer = null;

function getToken() {
  return localStorage.getItem(LS_TOKEN_KEY) || "";
}

function setToken(token) {
  if (!token) return;
  localStorage.setItem(LS_TOKEN_KEY, token.trim());
  updateTokenHint();
}

function updateTokenHint() {
  const has = !!getToken();
  els.tokenHint.textContent = has
    ? "Discogs token set (stored in this browser)."
    : "You need a Discogs Personal Access Token (free). Click “Set Discogs token”.";
}

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

function setStatus(text, count = "") {
  els.statusText.textContent = text;
  els.countText.textContent = count;
}

function formatArtists(artistsArr) {
  if (!Array.isArray(artistsArr)) return "";
  return artistsArr.map(a => a?.name).filter(Boolean).join(", ");
}

function formatFormats(formatsArr) {
  if (!Array.isArray(formatsArr)) return "";
  // e.g. [{name:"Vinyl", qty:"1", descriptions:["LP","Album"]}]
  return formatsArr.map(f => {
    const desc = Array.isArray(f.descriptions) ? f.descriptions.join(", ") : "";
    const qty = f.qty ? `${f.qty}× ` : "";
    return `${qty}${f.name}${desc ? ` (${desc})` : ""}`.trim();
  }).join(" • ");
}

function normalizeItem(entry) {
  // Discogs collection entry shape:
  // entry.basic_information.cover_image, title, year, artists, formats, resource_url, id, etc.
  const bi = entry?.basic_information || {};
  return {
    id: entry?.id ?? bi?.id ?? crypto.randomUUID(),
    title: bi?.title || "(Unknown Title)",
    artist: formatArtists(bi?.artists),
    year: bi?.year || null,
    cover: bi?.cover_image || "",
    formats: formatFormats(bi?.formats),
    discogsUrl: bi?.resource_url ? bi.resource_url.replace("api.discogs.com", "www.discogs.com") : "",
    dateAdded: entry?.date_added || null,
  };
}

async function discogsFetch(url) {
  const token = getToken();
  if (!token) {
    throw new Error("Missing Discogs token.");
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Discogs token=${token}`,
      "User-Agent": "discovers-better/1.0 (+local)",
    },
  });

  if (res.status === 429) {
    // rate limit — back off a bit
    throw new Error("Rate limited (429).");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Discogs error ${res.status}. ${txt?.slice(0, 120) || ""}`);
  }
  return res.json();
}

async function fetchAllCollection(username) {
  // folder 0 = "All"
  const perPage = 100;
  let page = 1;
  let pages = 1;
  const out = [];

  while (page <= pages) {
    setStatus(`Loading… page ${page} of ${pages}`, "");
    const url = `https://api.discogs.com/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=${perPage}&page=${page}&sort=added&sort_order=desc`;
    let json;

    // basic retry with backoff for 429s
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        json = await discogsFetch(url);
        break;
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("429")) {
          const wait = 900 * (attempt + 1);
          setStatus(`Discogs is throttling. Waiting ${wait}ms…`, "");
          await new Promise(r => setTimeout(r, wait));
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

function destroyObserver() {
  if (observer) observer.disconnect();
  observer = null;
}

function createObserver() {
  destroyObserver();
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      const src = img.dataset.src;
      if (src) img.src = src;
      img.removeAttribute("data-src");
      observer.unobserve(img);
    }
  }, { rootMargin: "400px" });
}

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

function renderGrid(items) {
  els.grid.innerHTML = "";
  createObserver();

  const frag = document.createDocumentFragment();

  for (const item of items) {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.title = `${item.artist} — ${item.title}`;

    const img = document.createElement("img");
    // lazy load
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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function applyFilters() {
  const q = (els.search.value || "").trim().toLowerCase();
  let items = allItems.slice();

  if (q) {
    items = items.filter(it =>
      (it.title || "").toLowerCase().includes(q) ||
      (it.artist || "").toLowerCase().includes(q)
    );
  }

  const sort = els.sort.value;

  const byStr = (a,b,ka,kb) => (ka.localeCompare(kb, undefined, { sensitivity:"base" }) || a.id - b.id);
  const safeYear = (y) => (typeof y === "number" ? y : (parseInt(y,10) || 0));

  items.sort((a,b) => {
    if (sort === "artist_asc") return byStr(a,b,(a.artist||""),(b.artist||""));
    if (sort === "title_asc") return byStr(a,b,(a.title||""),(b.title||""));
    if (sort === "year_desc") return safeYear(b.year) - safeYear(a.year);
    if (sort === "year_asc") return safeYear(a.year) - safeYear(b.year);
    // recently added default
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

async function loadUser(username) {
  if (!username) return;

  const cached = readCache(username);
  if (cached) {
    allItems = cached;
    setStatus("Loaded from cache.", `${allItems.length} total`);
    applyFilters();
    return;
  }

  setStatus("Contacting Discogs…", "");
  const items = await fetchAllCollection(username);
  allItems = items;
  writeCache(username, items);
  setStatus("Loaded from Discogs.", `${items.length} total`);
  applyFilters();
}

function getUserFromUrl() {
  const u = new URL(location.href);
  return u.searchParams.get("user") || "";
}

function setUserInUrl(username) {
  const u = new URL(location.href);
  if (username) u.searchParams.set("user", username);
  else u.searchParams.delete("user");
  history.replaceState({}, "", u.toString());
}

function init() {
  updateTokenHint();

  const initialUser = getUserFromUrl();
  if (initialUser) {
    els.username.value = initialUser;
    // auto-load if token exists
    if (getToken()) loadUser(initialUser).catch(err => setStatus(String(err.message || err), ""));
  }

  els.go.addEventListener("click", async () => {
    const username = els.username.value.trim();
    if (!username) return;

    if (!getToken()) {
      alert("You need a Discogs Personal Access Token first. Click “Set Discogs token”.");
      return;
    }

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

  els.setToken.addEventListener("click", () => {
    const current = getToken();
    const token = prompt(
      "Paste your Discogs Personal Access Token here.\n\nGet it at: Discogs → Settings → Developers → Personal access token",
      current
    );
    if (token && token.trim()) {
      setToken(token);
      alert("Token saved in this browser.");
    }
  });

  // modal close
  els.modalBackdrop.addEventListener("click", closeModal);
  els.modalClose.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

init();
