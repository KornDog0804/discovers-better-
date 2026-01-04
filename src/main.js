const API_BASE = 'https://api.discogs.com';
const PER_PAGE = 100;

const grid = document.getElementById('grid');
const statusText = document.getElementById('statusText');
const countText = document.getElementById('countText');

let releases = [];
let filtered = [];

async function fetchCollection(username) {
  releases = [];
  let page = 1;
  let pages = 1;

  statusText.textContent = 'Loading collection…';

  while (page <= pages) {
    const res = await fetch(
      `${API_BASE}/users/${username}/collection/folders/0/releases?per_page=${PER_PAGE}&page=${page}`
    );
    const data = await res.json();

    pages = data.pagination.pages;
    releases.push(...data.releases);
    page++;
  }

  filtered = [...releases];
  render();
  statusText.textContent = 'Collection loaded.';
  countText.textContent = `${filtered.length} records`;
}

function render() {
  grid.innerHTML = '';

  filtered.forEach(item => {
    const info = item.basic_information;
    const cover =
      info.cover_image ||
      info.thumb ||
      '';

    // THIS IS THE KEY LINE
    const discogsUrl = item.uri;

    const card = document.createElement('a');
    card.className = 'record';
    card.href = discogsUrl;
    card.target = '_blank';
    card.rel = 'noopener';

    card.innerHTML = `
      <img src="${cover}" alt="${info.title}" loading="lazy" />
    `;

    grid.appendChild(card);
  });
}

// =====================
// CONTROLS
// =====================

document.getElementById('go').addEventListener('click', () => {
  const user = document.getElementById('username').value.trim();
  if (!user) return;
  fetchCollection(user);
});

document.getElementById('search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  filtered = releases.filter(r => {
    const info = r.basic_information;
    return (
      info.title.toLowerCase().includes(q) ||
      info.artists[0].name.toLowerCase().includes(q)
    );
  });
  render();
  countText.textContent = `${filtered.length} records`;
});

document.getElementById('shuffle').addEventListener('click', () => {
  filtered.sort(() => Math.random() - 0.5);
  render();
});

document.getElementById('clear').addEventListener('click', () => {
  localStorage.clear();
  statusText.textContent = 'Cache cleared.';
});
