import * as repo from './repo.js';
import {
  newRestaurant, notePreview, isFoodPlace, PLACE_TYPES, foursquareURL, sortVisits, lastVisit, displayRating, coverImage, matches, placeLine, directionLinks, today, now, findInJournal, distance,
} from './model.js';
import { renderMarkdown } from './md.js';
import { searchPlaces, locate, nearbyPlaces, formatDistance, fallbackSearch, addressAt } from './places.js';
import { createMap } from './map.js';
import { fileDate } from './images.js';
import * as store from './store.js';
import { createSync } from './sync.js';

const APP_NAME = 'Bite-Stamped';
const main = document.getElementById('main');
const sheet = document.getElementById('sheet');

// --- helpers ---

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';
// "Powered by Foursquare", as Foursquare's brand guidelines ask, light or dark.
const POWERED_BY_FOURSQUARE = `<a class="fsq-credit" href="https://foursquare.com" target="_blank" rel="noopener"><picture>
  <source srcset="icons/powered-by-foursquare-dark.svg" media="(prefers-color-scheme: dark)">
  <img src="icons/powered-by-foursquare.svg" alt="Powered by Foursquare" width="161" height="28"></picture></a>`;
const link = (path) => `#/r/${encodeURIComponent(path)}`;
// What kind of place, in a few words for cards: the cuisine (or category), else the type.
const kindLine = (r) => r.cuisine || r.type;

function formatDate(ymd, style = 'medium') {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(undefined, { dateStyle: style }).format(new Date(y, m - 1, d));
}

// "2026-10-12T19:30" → date and time; a date without a time → just the date.
function formatDateTime(value, style = 'medium') {
  const [, h, min] = String(value || '').match(/T(\d\d):(\d\d)/) || [];
  if (!h) return formatDate(value, style);
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(2000, 0, 1, Number(h), Number(min)));
  return `${formatDate(value, style)}, ${time}`;
}

// Read-only stars are one image to screen readers ("4 of 5 stars"). Star
// inputs are a radio group: one tab stop, arrow keys change the rating.
function stars(n, { input = false, name = 'rating', size = '' } = {}) {
  const items = [1, 2, 3, 4, 5].map((i) => input
    ? `<button type="button" class="star${i <= n ? ' on' : ''}" data-value="${i}" role="radio" aria-checked="${i === n}"
        tabindex="${i === (n || 1) ? 0 : -1}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`
    : `<span class="star${i <= n ? ' on' : ''}">★</span>`).join('');
  return input
    ? `<span class="stars input ${size}" data-name="${name}" data-value="${n}" role="radiogroup" aria-label="Rating">${items}</span>`
    : n ? `<span class="stars ${size}" role="img" aria-label="${n} of 5 stars">${items}</span>` : '';
}

function setStars(group, value) {
  group.dataset.value = value;
  for (const s of $$('.star', group)) {
    const v = Number(s.dataset.value);
    s.classList.toggle('on', v <= value);
    s.setAttribute('aria-checked', String(v === value));
    s.tabIndex = v === (value || 1) ? 0 : -1;
  }
  group.dispatchEvent(new CustomEvent('rate', { bubbles: true, detail: value }));
}

// Star inputs: tapping the current value clears it.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.stars.input .star');
  if (!btn) return;
  const group = btn.parentElement;
  const v = Number(btn.dataset.value);
  setStars(group, Number(group.dataset.value) === v ? 0 : v);
});

const STAR_KEYS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, Home: -5, End: 5 };
document.addEventListener('keydown', (e) => {
  const btn = e.target.closest?.('.stars.input .star');
  if (!btn || !(e.key in STAR_KEYS)) return;
  e.preventDefault();
  const group = btn.parentElement;
  const next = Math.min(5, Math.max(1, (Number(group.dataset.value) || 0) + STAR_KEYS[e.key]));
  setStars(group, next);
  $(`.star[data-value="${next}"]`, group).focus();
});

const starValue = (root, name = 'rating') => Number($(`.stars.input[data-name="${name}"]`, root)?.dataset.value || 0);

async function hydrateImages(root = main) {
  await Promise.all($$('img[data-file]', root).map(async (img) => {
    const url = await repo.imageURL(img.dataset.file);
    if (url) img.src = url;
    else img.closest('.thumb, .cover')?.classList.add('missing');
  }));
}

function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}

function openSheet(html, onReady) {
  sheet.innerHTML = html;
  sheet.showModal();
  onReady?.(sheet);
  hydrateImages(sheet);
}

function closeSheet() {
  sheet.close();
  sheet.innerHTML = '';
}

sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close]')) closeSheet();
});

function pickFiles({ multiple = false, capture = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    if (capture) input.capture = 'environment';
    input.hidden = true;
    document.body.append(input); // some mobile browsers ignore detached file inputs
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    input.click();
  });
}

function setTitle(text) {
  document.title = text ? `${text} – ${APP_NAME}` : APP_NAME;
}

// --- list ---
// Three top-level lists, each as a list or a map: "Timeline" (#/, every visit,
// newest first, under a heading per day), "Visited" (#/visited) and "To Try"
// (#/totry), the last two with their own sort order (remembered on this device).

const LISTS = {
  timeline: { title: 'Timeline', hash: '#/' },
  visited: { title: 'Visited', hash: '#/visited' },
  totry: { title: 'To Try', hash: '#/totry' },
};
const SORTS = {
  visited: [['name', 'Name'], ['recent', 'Last visit'], ['rating', 'Rating'], ['visits', 'Most visits'], ['nearest', 'Nearest'], ['added', 'Date added']],
  totry: [['nearest', 'Nearest'], ['added', 'Date added'], ['name', 'Name']],
};
const listState = { view: 'list', query: '', sorts: { visited: 'name', totry: 'nearest' } };
try {
  const saved = JSON.parse(localStorage.getItem('listState') || '{}');
  if (saved.view === 'map') listState.view = 'map';
  // Before v2, To Try's old default (date added) was saved even if never chosen;
  // before v3 the visited list was the start screen, sorted by last visit.
  if ((saved.v || 0) < 2 && saved.sorts?.totry === 'added') delete saved.sorts.totry;
  if ((saved.v || 0) < 3) delete saved.sorts?.visited;
  Object.assign(listState.sorts, saved.sorts);
} catch {}
const rememberList = () => {
  try { localStorage.setItem('listState', JSON.stringify({ v: 3, view: listState.view, sorts: listState.sorts })); } catch {}
};
// "Back" from a restaurant goes to the list it was opened from.
let lastList = '';
const homeOf = (r) => (r?.toTry ? '#/totry' : lastList && lastList !== '#/totry' ? lastList : '#/');

let here = null; // device position, once "Nearest" asked for it

function sortRestaurants(list, sort) {
  const away = (r) => (here && r.lat !== null && r.lon !== null ? distance(here, r) : Infinity);
  const by = {
    recent: (a, b) => (lastVisit(b) || b.created).localeCompare(lastVisit(a) || a.created),
    rating: (a, b) => displayRating(b) - displayRating(a) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    visits: (a, b) => b.visits.length - a.visits.length || a.name.localeCompare(b.name),
    added: (a, b) => (b.created || '').localeCompare(a.created || ''),
    nearest: (a, b) => away(a) - away(b) || a.name.localeCompare(b.name),
  }[sort] || (() => 0);
  return list.sort(by);
}

const ICONS = {
  sort: '<svg viewBox="0 0 24 24"><path d="M8 4v16M8 4 4.5 7.5M8 4l3.5 3.5M16 20V4M16 20l-3.5-3.5M16 20l3.5-3.5"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  add: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  directions: '<svg viewBox="0 0 24 24"><path d="M3.5 11 20.5 3.5 13 20.5l-2-7.5-7.5-2Z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/></svg>',
};

// Directions and sharing for one restaurant: map apps, the system share sheet,
// or the address to paste somewhere.
const ua = navigator.userAgent;
const isAppleDevice = /iPhone|iPad|iPod|Macintosh/.test(ua);
const isAndroid = /Android/.test(ua);

function openDirections(r) {
  const d = directionLinks(r);
  if (!d) return;
  const app = (href, label) => `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
  const shareText = [r.name, d.address].filter(Boolean).join('\n');
  openSheet(`
    <div class="choice">
      <h2>${esc(r.name)}</h2>
      ${d.address ? `<p class="muted small">${esc(d.address)}</p>` : ''}
      ${isAppleDevice || !isAndroid ? app(d.apple, 'Apple Maps') : ''}
      ${app(d.google, 'Google Maps')}
      ${app(d.waze, 'Waze')}
      ${isAndroid ? `<a class="btn" href="${esc(d.geo)}">Other map app</a>` : ''}
      ${navigator.share ? '<button type="button" class="btn" id="shareBtn">Share…</button>' : ''}
      <button type="button" class="btn" id="copyBtn">Copy address</button>
      <button type="button" class="btn" data-close>Cancel</button>
    </div>`, (dlg) => {
    $('#shareBtn', dlg)?.addEventListener('click', async () => {
      try {
        await navigator.share({ title: r.name, text: shareText, url: d.web });
        closeSheet();
      } catch {
        // cancelled: leave the sheet open
      }
    });
    $('#copyBtn', dlg).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`${shareText}\n${d.web}`);
        closeSheet();
        toast('Address copied');
      } catch {
        toast('Could not copy');
      }
    });
    for (const a of $$('a.btn', dlg)) a.addEventListener('click', () => setTimeout(closeSheet));
  });
}

// "Mon, Nov 2" (with the year when it isn't this year).
function formatDay(ymd) {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const sameYear = y === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' })
    .format(new Date(y, m - 1, d));
}
function formatTime(value) {
  const [, h, min] = String(value || '').match(/T(\d\d):(\d\d)/) || [];
  return h ? new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(2000, 0, 1, Number(h), Number(min))) : '';
}

function renderList(tab) {
  const { title } = LISTS[tab];
  lastList = LISTS[tab].hash;
  setTitle(tab === 'timeline' ? '' : title);
  const everything = repo.all();
  const sort = () => listState.sorts[tab];

  main.innerHTML = `
    <header class="bar">
      <button type="button" class="icon-btn" id="sortBtn" aria-label="Sort">${ICONS.sort}</button>
      <h1 class="center">${title}</h1>
      <button type="button" class="icon-btn" id="viewBtn"></button>
      ${tab === 'timeline'
        ? `<a class="icon-btn" href="#/checkin" aria-label="Check in">${ICONS.add}</a>`
        : `<a class="icon-btn" href="#/new${tab === 'totry' ? '?totry=1' : ''}" aria-label="Add place">${ICONS.add}</a>`}
    </header>
    <div class="list-tools">
      <input type="search" id="q" placeholder="Search places, dishes, people…" value="${esc(listState.query)}" autocomplete="off">
      <p class="muted small sort-note" id="sortNote"></p>
    </div>
    <ul class="cards" id="cards"></ul>
    <div class="map-view" id="mapView" hidden><div class="map-box" id="mapBox"></div><div class="map-card" id="mapCard" hidden></div></div>`;

  let map = null;
  const shownRestaurants = () => sortRestaurants(
    everything.filter((r) => (tab === 'timeline' ? r.visits.length > 0 : (tab === 'totry') === r.toTry) && matches(r, listState.query)),
    sort(),
  );
  const thumb = (r) => {
    const cover = coverImage(r);
    return `<span class="thumb">${cover ? `<img data-file="${esc(cover)}" alt="">` : `<span class="initial">${esc(r.name.slice(0, 1).toUpperCase())}</span>`}</span>`;
  };

  // One timeline entry: a visit, with its restaurant.
  const visitCard = (r, v) => {
    const sub = [kindLine(r), placeLine(r)].filter(Boolean).join(' · ');
    const when = [formatTime(v.date), v.people.length ? `with ${v.people.join(', ')}` : ''].filter(Boolean).join(' · ');
    return `<a class="card" href="${link(r.path)}">
      ${thumb(r)}
      <span class="card-body">
        <strong>${esc(r.name)}</strong>
        ${v.rating ? stars(v.rating, { size: 'small' }) : ''}
        ${sub ? `<small>${esc(sub)}</small>` : ''}
        ${when ? `<small class="muted">${esc(when)}</small>` : ''}
      </span></a>`;
  };

  // Every visit, newest first, grouped under a heading per day.
  const timelineHTML = (shown) => {
    const visits = shown.flatMap((r) => r.visits.filter((v) => v.date).map((v) => ({ r, v })))
      .sort((a, b) => b.v.date.localeCompare(a.v.date));
    const days = [];
    for (const item of visits) {
      const day = item.v.date.slice(0, 10);
      if (days.at(-1)?.day !== day) days.push({ day, items: [] });
      days.at(-1).items.push(item);
    }
    return days.map(({ day, items }) => `<li class="day">
      <h2 class="day-heading">${esc(formatDay(day))}</h2>
      <ul class="cards">${items.map(({ r, v }) => `<li>${visitCard(r, v)}</li>`).join('')}</ul>
    </li>`).join('');
  };

  const card = (r) => {
    const last = lastVisit(r);
    const away = sort() === 'nearest' && here && r.lat !== null ? formatDistance(distance(here, r)) : '';
    const sub = [away, kindLine(r), placeLine(r)].filter(Boolean).join(' · ');
    const when = tab === 'totry'
      ? (r.created ? `Added ${formatDate(r.created)}` : '')
      : r.visits.length ? `${r.visits.length} visit${r.visits.length > 1 ? 's' : ''} · ${formatDate(last)}` : '';
    // The notes' first line, so places with notes stand out.
    const note = notePreview(r.notes);
    return `<a class="card" href="${link(r.path)}">
      ${thumb(r)}
      <span class="card-body">
        <strong>${esc(r.name)}</strong>
        ${stars(displayRating(r), { size: 'small' })}
        ${sub ? `<small>${esc(sub)}</small>` : ''}
        ${when ? `<small class="muted">${esc(when)}</small>` : ''}
        ${note ? `<small class="note-line"><span aria-hidden="true">📝 </span>${esc(note)}</small>` : ''}
      </span></a>`;
  };

  const fillList = () => {
    const shown = shownRestaurants();
    const cards = $('#cards');
    if (!shown.length) {
      cards.innerHTML = `<li class="empty">${
        listState.query ? 'Nothing matches your search.'
        : tab === 'totry' ? 'Places you want to try go here.<br><a href="#/new?totry=1">Add one</a>'
        : everything.length ? (tab === 'timeline' ? 'No visits yet.' : 'No visited places yet.')
        : 'Your journal is empty.<br><a href="#/new">Add your first place</a>'
      }</li>`;
      return;
    }
    cards.classList.toggle('timeline', tab === 'timeline');
    cards.innerHTML = tab === 'timeline' ? timelineHTML(shown) : shown.map((r) => `<li>${card(r)}</li>`).join('');
    hydrateImages(cards);
  };

  const fillMap = () => {
    map?.destroy();
    $('#mapCard').hidden = true;
    const shown = shownRestaurants();
    const byPath = new Map(shown.map((r) => [r.path, r]));
    map = createMap($('#mapBox'), {
      pins: shown.map((r) => ({ id: r.path, lat: r.lat, lon: r.lon, label: r.name })),
      here,
      onPin: (path) => {
        const box = $('#mapCard');
        if (!path) { box.hidden = true; return; }
        box.innerHTML = card(byPath.get(path));
        box.hidden = false;
        hydrateImages(box);
      },
    });
    const missing = shown.filter((r) => r.lat === null || r.lon === null).length;
    $('#sortNote').textContent = missing ? `${missing} without a location ${missing === 1 ? 'is' : 'are'} not on the map.` : '';
  };

  const fill = () => {
    const mapMode = listState.view === 'map';
    $('#cards').hidden = mapMode;
    $('#mapView').hidden = !mapMode;
    $('#viewBtn').innerHTML = mapMode ? ICONS.list : ICONS.map;
    $('#viewBtn').setAttribute('aria-label', mapMode ? 'Show as list' : 'Show on map');
    // The timeline has one order (newest first); keep the button's space so the title stays centered.
    $('#sortBtn').hidden = mapMode;
    $('#sortBtn').style.visibility = tab === 'timeline' ? 'hidden' : '';
    $('#sortNote').textContent = '';
    if (mapMode) fillMap();
    else { map?.destroy(); map = null; fillList(); }
  };

  const useNearest = async () => {
    $('#sortNote').textContent = 'Finding your location…';
    const pos = await locate();
    if (pos) here = pos;
    $('#sortNote').textContent = pos ? '' : 'Your location is not available, so “Nearest” cannot sort.';
    if (pos && sort() === 'nearest' && listState.view === 'list') fillList();
  };

  $('#q').addEventListener('input', (e) => { listState.query = e.target.value; fill(); });
  $('#viewBtn').addEventListener('click', () => {
    listState.view = listState.view === 'map' ? 'list' : 'map';
    rememberList();
    fill();
  });
  $('#sortBtn').addEventListener('click', () => {
    openSheet(`
      <div class="choice sort-choice">
        <h2>Sort ${title}</h2>
        ${SORTS[tab].map(([value, label]) => `<button type="button" class="btn${value === sort() ? ' selected' : ''}" data-sort="${value}">${label}${value === sort() ? ' ✓' : ''}</button>`).join('')}
        <button type="button" class="btn" data-close>Cancel</button>
      </div>`, (dlg) => {
      dlg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sort]');
        if (!b) return;
        listState.sorts[tab] = b.dataset.sort;
        rememberList();
        closeSheet();
        fill();
        if (sort() === 'nearest') useNearest();
      });
    });
  });

  fill();
  if (sort() === 'nearest' && !here) useNearest();
}

// --- detail ---

function renderDetail(path) {
  const r = repo.get(path);
  if (!r) return notFound();
  setTitle(r.name);
  const cover = r.photos[0]?.file;
  const directions = directionLinks(r);
  const contact = [
    directions ? `<button type="button" class="contact-btn" data-directions>📍 ${esc(r.address || 'Directions')}</button>` : '',
    r.website ? `<a href="${esc(/^https?:/.test(r.website) ? r.website : 'https://' + r.website)}" target="_blank" rel="noopener">🌐 ${esc(r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '',
    r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(r.phone)}</a>` : '',
    // Found on Foursquare: its terms ask for a link to the place there.
    r.foursquareId ? `<a href="${esc(foursquareURL(r.foursquareId))}" target="_blank" rel="noopener">🔗 View on Foursquare</a>` : '',
  ].filter(Boolean);

  main.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="${homeOf(r)}" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="grow"></span>
      ${directions ? `<button type="button" class="icon-btn" data-directions aria-label="Directions and sharing">${ICONS.directions}</button>` : ''}
      <a class="text-btn" href="#/edit/${encodeURIComponent(r.path)}">Edit</a>
    </header>
    ${cover ? `<div class="cover"><img data-file="${esc(cover)}" alt=""></div>` : ''}
    <section class="detail-head">
      <h1>${esc(r.name)}</h1>
      ${[r.type, r.cuisine, placeLine(r)].filter(Boolean).length ? `<p class="muted">${esc([r.type, r.cuisine, placeLine(r)].filter(Boolean).join(' · '))}</p>` : ''}
      <div class="head-row">
        ${stars(r.rating, { input: true, size: 'large' })}
        <button type="button" class="chip${r.toTry ? ' on' : ''}" id="toTry">${r.toTry ? '★ To try' : '☆ To try'}</button>
      </div>
      ${!r.rating && displayRating(r) ? `<p class="muted small">Visits average ${displayRating(r)} ★</p>` : ''}
      ${contact.length ? `<div class="contact">${contact.join('')}</div>` : ''}
      ${r.foursquareId ? `<p class="fsq-place">${POWERED_BY_FOURSQUARE}</p>` : ''}
      ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.notes ? `<div class="notes">${renderMarkdown(r.notes)}</div>` : ''}
    </section>

    <section class="block">
      <div class="block-head"><h2>Visits <span class="count">${r.visits.length || ''}</span></h2><button class="text-btn" id="addVisit">+ Visit</button></div>
      ${r.visits.length ? `<ul class="rows">${sortVisits(r.visits).map((v) => `
        <li><button class="row-btn" data-visit="${r.visits.indexOf(v)}">
          <span class="row-main"><strong>${esc(formatDateTime(v.date, 'long'))}</strong>${stars(v.rating, { size: 'small' })}</span>
          ${v.people.length ? `<small>with ${esc(v.people.join(', '))}</small>` : ''}
          ${v.notes ? `<small class="muted pre">${esc(v.notes)}</small>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="muted small">No visits yet.</p>'}
    </section>

    ${isFoodPlace(r) || r.dishes.length ? `<section class="block">
      <div class="block-head"><h2>Dishes <span class="count">${r.dishes.length || ''}</span></h2><button class="text-btn" id="addDish">+ Dish</button></div>
      ${r.dishes.length ? `<ul class="rows">${r.dishes.map((m, i) => `
        <li><button class="row-btn with-thumb" data-dish="${i}">
          <span class="thumb small">${m.image ? `<img data-file="${esc(m.image)}" alt="">` : '<span class="initial">🍽</span>'}</span>
          <span class="row-text">
            <span class="row-main"><strong>${esc(m.name)}</strong>${m.price ? `<span class="muted">${esc(m.price)}</span>` : ''}</span>
            ${stars(m.rating, { size: 'small' })}
            ${m.notes ? `<small class="muted pre">${esc(m.notes)}</small>` : ''}
          </span>
        </button></li>`).join('')}</ul>` : '<p class="muted small">No dishes yet.</p>'}
    </section>` : ''}

    <section class="block">
      <div class="block-head"><h2>Photos <span class="count">${r.photos.length || ''}</span></h2><button class="text-btn" id="addPhotos">+ Photos</button></div>
      ${r.photos.length ? `<ul class="grid">${r.photos.map((p, i) => `
        <li><button class="photo" data-photo="${i}">
          <span class="thumb square"><img data-file="${esc(p.file)}" alt="${esc(p.title)}"></span>
          ${p.title ? `<span class="caption">${esc(p.title)}</span>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="muted small">No photos yet.</p>'}
    </section>

    <p class="danger-zone"><button class="text-btn danger" id="deleteRestaurant">Delete place</button></p>`;

  hydrateImages();

  $('.detail-head .stars.input').addEventListener('rate', async (e) => {
    r.rating = e.detail;
    await repo.save(r);
  });
  $('#toTry').addEventListener('click', async () => {
    r.toTry = !r.toTry;
    await repo.save(r);
    renderDetail(r.path);
  });
  $('#addVisit').addEventListener('click', () => editVisit(r, -1));
  for (const b of $$('[data-directions]', main)) b.addEventListener('click', () => openDirections(r));
  if (pendingVisit?.path === path) { const { index = -1 } = pendingVisit; pendingVisit = null; editVisit(r, index); }
  $$('[data-visit]').forEach((b) => b.addEventListener('click', () => editVisit(r, Number(b.dataset.visit))));
  $('#addDish')?.addEventListener('click', () => editDish(r, -1));
  $$('[data-dish]').forEach((b) => b.addEventListener('click', () => editDish(r, Number(b.dataset.dish))));
  $('#addPhotos').addEventListener('click', () => addPhotos(r));
  $$('[data-photo]').forEach((b) => b.addEventListener('click', () => editPhoto(r, Number(b.dataset.photo))));
  $('#deleteRestaurant').addEventListener('click', async () => {
    if (!confirm(`Delete “${r.name}” with all its visits, dishes and photos?`)) return;
    await repo.remove(r);
    toast('Deleted');
    location.hash = homeOf(r);
  });
}

function peopleDatalist() {
  return `<datalist id="people">${repo.knownPeople().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function editVisit(r, index) {
  const v = r.visits[index] || { date: now(), rating: 0, people: [], notes: '' };
  openSheet(`
    <form method="dialog" class="sheet-form">
      <header><button type="button" class="text-btn" data-close>Cancel</button><h2>${index < 0 ? 'New visit' : 'Visit'}</h2><button class="text-btn strong" value="save">Save</button></header>
      <div class="row date-time">
        <label class="grow">Date <input type="date" name="date" value="${esc(v.date.slice(0, 10))}" required></label>
        <label class="grow">Time <input type="time" name="time" value="${esc(v.date.slice(11, 16))}"></label>
      </div>
      <div class="field"><span>Rating</span>${stars(v.rating, { input: true, name: 'visit', size: 'large' })}</div>
      <div class="field">
        <span>With</span>
        <div class="people" id="people">${v.people.map((p) => `<span class="tag removable" data-person="${esc(p)}">${esc(p)} ×</span>`).join('')}</div>
        <input name="person" list="people" placeholder="Add a person, then Return" autocomplete="off" enterkeyhint="done">
        ${peopleDatalist()}
      </div>
      <label>Notes <textarea name="notes" rows="4">${esc(v.notes)}</textarea></label>
      ${index >= 0 ? '<button type="button" class="text-btn danger" id="del">Delete visit</button>' : ''}
    </form>`, (dlg) => {
    const form = $('form', dlg);
    const people = [...v.people];
    const drawPeople = () => {
      $('#people', dlg).innerHTML = people.map((p) => `<span class="tag removable" data-person="${esc(p)}">${esc(p)} ×</span>`).join('');
    };
    const addPerson = () => {
      const input = form.person;
      const name = input.value.trim().replace(/,$/, '');
      if (name && !people.includes(name)) people.push(name);
      input.value = '';
      drawPeople();
    };
    form.person.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addPerson(); }
    });
    form.person.addEventListener('change', addPerson);
    $('#people', dlg).addEventListener('click', (e) => {
      const tag = e.target.closest('[data-person]');
      if (!tag) return;
      people.splice(people.indexOf(tag.dataset.person), 1);
      drawPeople();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      addPerson();
      const date = form.date.value + (form.time.value ? `T${form.time.value.slice(0, 5)}` : '');
      const visit = { date, rating: starValue(dlg, 'visit'), people, notes: form.notes.value.trim() };
      if (index < 0) r.visits.push(visit);
      else r.visits[index] = visit;
      if (index < 0 && r.toTry) r.toTry = false;
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
    $('#del', dlg)?.addEventListener('click', async () => {
      if (!confirm('Delete this visit?')) return;
      r.visits.splice(index, 1);
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
  });
}

function editDish(r, index) {
  const m = { ...(r.dishes[index] || { name: '', rating: 0, price: '', notes: '', image: '' }) };
  let newImage = null; // a File waiting to be stored
  let removeImage = false;
  openSheet(`
    <form method="dialog" class="sheet-form">
      <header><button type="button" class="text-btn" data-close>Cancel</button><h2>${index < 0 ? 'New dish' : 'Dish'}</h2><button class="text-btn strong" value="save">Save</button></header>
      <div class="dish-image">
        <span class="thumb large" id="dishThumb">${m.image ? `<img data-file="${esc(m.image)}" alt="">` : '<span class="initial">🍽</span>'}</span>
        <div class="stack">
          <button type="button" class="btn" id="pickImage">${m.image ? 'Change image' : 'Add image'}</button>
          <button type="button" class="text-btn danger" id="clearImage"${m.image ? '' : ' hidden'}>Remove image</button>
        </div>
      </div>
      <label>Name <input name="name" value="${esc(m.name)}" required autocomplete="off"></label>
      <div class="field"><span>Rating</span>${stars(m.rating, { input: true, name: 'dish', size: 'large' })}</div>
      <label>Price <input name="price" value="${esc(m.price)}" placeholder="e.g. $14" autocomplete="off"></label>
      <label>Notes <textarea name="notes" rows="3">${esc(m.notes)}</textarea></label>
      ${index >= 0 ? '<button type="button" class="text-btn danger" id="del">Delete dish</button>' : ''}
    </form>`, (dlg) => {
    const form = $('form', dlg);
    $('#pickImage', dlg).addEventListener('click', async () => {
      const [file] = await pickFiles();
      if (!file) return;
      newImage = file;
      removeImage = false;
      $('#dishThumb', dlg).innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
      $('#clearImage', dlg).hidden = false;
      $('#pickImage', dlg).textContent = 'Change image';
    });
    $('#clearImage', dlg).addEventListener('click', () => {
      newImage = null;
      removeImage = true;
      $('#dishThumb', dlg).innerHTML = '<span class="initial">🍽</span>';
      $('#clearImage', dlg).hidden = true;
      $('#pickImage', dlg).textContent = 'Add image';
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const old = m.image;
      if (newImage) m.image = await repo.addImage(r, newImage);
      else if (removeImage) m.image = '';
      if (old && old !== m.image) await repo.deleteImage(old);
      Object.assign(m, { name: form.name.value.trim(), rating: starValue(dlg, 'dish'), price: form.price.value.trim(), notes: form.notes.value.trim() });
      if (index < 0) r.dishes.push(m);
      else r.dishes[index] = m;
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
    $('#del', dlg)?.addEventListener('click', async () => {
      if (!confirm(`Delete “${m.name}”?`)) return;
      if (m.image) await repo.deleteImage(m.image);
      r.dishes.splice(index, 1);
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
  });
}

async function addPhotos(r) {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;
  toast(files.length > 1 ? `Adding ${files.length} photos…` : 'Adding photo…');
  for (const file of files) {
    const path = await repo.addImage(r, file);
    r.photos.push({ file: path, title: '', date: fileDate(file) });
  }
  await repo.save(r);
  renderDetail(r.path);
  if (files.length === 1) editPhoto(r, r.photos.length - 1);
}

function editPhoto(r, index) {
  const p = r.photos[index];
  openSheet(`
    <form method="dialog" class="sheet-form photo-sheet">
      <header><button type="button" class="text-btn" data-close>Cancel</button><h2>Photo</h2><button class="text-btn strong" value="save">Save</button></header>
      <div class="photo-large"><img data-file="${esc(p.file)}" alt="${esc(p.title)}"></div>
      <label>Title <input name="title" value="${esc(p.title)}" placeholder="Give this photo a title" autocomplete="off" enterkeyhint="done"></label>
      <label>Date <input type="date" name="date" value="${esc(p.date.slice(0, 10))}"></label>
      <div class="row spread">
        ${index > 0 ? '<button type="button" class="btn" id="cover">Use as cover</button>' : '<span class="muted small">Cover photo</span>'}
        <button type="button" class="text-btn danger" id="del">Delete photo</button>
      </div>
    </form>`, (dlg) => {
    const form = $('form', dlg);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      p.title = form.title.value.trim();
      p.date = form.date.value;
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
    $('#cover', dlg)?.addEventListener('click', async () => {
      p.title = form.title.value.trim();
      p.date = form.date.value;
      r.photos.splice(index, 1);
      r.photos.unshift(p);
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
    $('#del', dlg).addEventListener('click', async () => {
      if (!confirm('Delete this photo?')) return;
      r.photos.splice(index, 1);
      await repo.deleteImage(p.file);
      await repo.save(r);
      closeSheet();
      renderDetail(r.path);
    });
  });
}

// --- add / edit ---

function renderEdit(path, params) {
  const existing = path ? repo.get(path) : null;
  if (path && !existing) return notFound();
  const r = existing ? { ...existing } : newRestaurant({ toTry: params.get('totry') === '1' });
  setTitle(existing ? `Edit ${r.name}` : 'New place');
  const back = existing ? link(existing.path) : r.toTry ? '#/totry' : homeOf(r);

  main.innerHTML = `
    <header class="bar">
      <a class="text-btn" href="${back}">Cancel</a>
      <h1 class="center">${existing ? 'Edit' : 'New place'}</h1>
      <button class="text-btn strong" form="editForm" id="saveBtn"${existing ? '' : ' hidden'}>Save</button>
    </header>
    ${existing ? '' : `
    <section class="place-picker" id="placePicker">
      <form class="search-row" id="placeSearch" role="search">
        <input type="search" id="placeQuery" placeholder="Search for a place" autocomplete="off" enterkeyhint="search" aria-label="Search for a place">
      </form>
      <p class="muted small picker-status" id="placeStatus"></p>
      <ul class="place-list" id="placeResults"></ul>
      <p class="muted small place-credit" id="placeCredit"></p>
      <button type="button" class="btn more-places" id="moreFoursquare" hidden></button>
      <button type="button" class="text-btn custom-place" id="customPlace">Not there? Add a custom location</button>
    </section>`}
    <form id="editForm" class="edit-form"${existing ? '' : ' hidden'}>
      ${existing ? '' : '<button type="button" class="text-btn back-to-search" id="backToSearch">‹ Search again</button>'}
      <label>Name <input name="name" value="${esc(r.name)}" required autocomplete="off"></label>
      <div class="field"><span>Rating</span>${stars(r.rating, { input: true, size: 'large' })}</div>
      <label class="check"><input type="checkbox" name="toTry"${r.toTry ? ' checked' : ''}> I want to try this place</label>
      ${existing ? '' : `<p class="muted small visit-note" id="visitNote"${r.toTry ? ' hidden' : ''}>Saving also adds a visit for ${esc(formatDateTime(now()))}.</p>`}
      <label>Type <input name="type" value="${esc(r.type)}" list="typeList" placeholder="e.g. Restaurant, Bar, Museum" autocomplete="off"></label>
      <datalist id="typeList">${[...new Set([...PLACE_TYPES, ...repo.all().map((x) => x.type).filter(Boolean)])].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <label><span id="cuisineLabel">${isFoodPlace(r) ? 'Cuisine' : 'Category'}</span> <input name="cuisine" value="${esc(r.cuisine)}" placeholder="${isFoodPlace(r) ? 'e.g. Thai, Pizza' : 'e.g. Art, History'}" autocomplete="off"></label>
      <label>Address <input name="address" value="${esc(r.address)}" autocomplete="off"></label>
      ${existing ? '' : '<p class="muted small" id="addressNote" role="status" hidden></p>'}
      <div class="two">
        <label>City <input name="city" value="${esc(r.city)}" autocomplete="off"></label>
        <label>State / region <input name="state" value="${esc(r.state)}" autocomplete="off"></label>
      </div>
      <label>Country <input name="country" value="${esc(r.country)}" autocomplete="off"></label>
      <label>Website <input name="website" inputmode="url" value="${esc(r.website)}" autocomplete="off"></label>
      <label>Phone <input name="phone" type="tel" value="${esc(r.phone)}" autocomplete="off"></label>
      <label>Tags <input name="tags" value="${esc(r.tags.join(', '))}" list="tagList" placeholder="comma separated" autocomplete="off"></label>
      <datalist id="tagList">${repo.knownTags().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
      <label>Notes <small class="muted">(Markdown)</small><textarea name="notes" rows="6">${esc(r.notes)}</textarea></label>
      <input type="hidden" name="lat" value="${r.lat ?? ''}"><input type="hidden" name="lon" value="${r.lon ?? ''}">
      <input type="hidden" name="countryCode" value="${esc(r.countryCode)}">
      <input type="hidden" name="foursquareId" value="${esc(r.foursquareId)}">
    </form>`;

  const form = $('#editForm');

  // "Cuisine" for places to eat and drink, "Category" for the rest.
  const labelCuisine = () => {
    const food = isFoodPlace({ type: form.type.value.trim() });
    $('#cuisineLabel').textContent = food ? 'Cuisine' : 'Category';
    form.cuisine.placeholder = food ? 'e.g. Thai, Pizza' : 'e.g. Art, History';
  };
  form.type.addEventListener('input', labelCuisine);

  if (!existing) {
    setUpPlacePicker(form, labelCuisine);
    form.toTry.addEventListener('change', () => { $('#visitNote').hidden = form.toTry.checked; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    Object.assign(r, {
      name: f.name.value.trim(),
      rating: starValue(form),
      toTry: f.toTry.checked,
      type: f.type.value.trim(),
      cuisine: f.cuisine.value.trim(),
      address: f.address.value.trim(),
      city: f.city.value.trim(),
      state: f.state.value.trim(),
      country: f.country.value.trim(),
      countryCode: f.countryCode.value.trim(),
      foursquareId: f.foursquareId.value.trim(),
      website: f.website.value.trim(),
      phone: f.phone.value.trim(),
      tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      notes: f.notes.value.trim(),
      lat: f.lat.value === '' ? null : Number(f.lat.value),
      lon: f.lon.value === '' ? null : Number(f.lon.value),
    });
    if (!r.name) return;
    // A new place that isn't just "to try" was visited: record a visit for now,
    // with the rating given here.
    if (!existing && !r.toTry) r.visits = [{ date: now(), rating: r.rating, people: [], notes: '' }];
    const saved = await repo.save(r, { rename: true });
    location.replace(link(saved.path));
  });
}

// New restaurant: first pick a place (food places nearby, filtered as you type;
// press Search to look further), or open the empty form for a custom one.
// Set when "Add visit" on the new-restaurant screen opens a restaurant.
let pendingVisit = null; // { path, index }: open that visit (-1: a new one) on the place's page

// --- check in (the + on the Timeline) ---
// The places right around you, closest first: the ones in your journal and
// the ones OpenStreetMap knows. Tapping one records a visit for now and opens
// it to add a rating, people and notes. "Not here?" leads to the full search.

const CHECKIN_RADIUS = 600; // meters: "here" is a short walk at most

async function checkIn(place) {
  const visit = { date: now(), rating: 0, people: [], notes: '' };
  let r = place.mine ? { ...place.mine } : null;
  if (!r) {
    r = newRestaurant({
      name: place.name, type: place.type || '', cuisine: place.cuisine || '',
      address: place.street ?? place.address ?? '', city: place.city || '', state: place.state || '',
      country: place.country || '', countryCode: place.countryCode || '', website: place.website || '', phone: place.phone || '',
      lat: Number.isFinite(place.lat) ? place.lat : null, lon: Number.isFinite(place.lon) ? place.lon : null,
    });
  }
  r.visits = [visit, ...r.visits];
  r.toTry = false; // been there now
  const saved = await repo.save(r);
  toast(`Checked in at ${saved.name}`);
  pendingVisit = { path: saved.path, index: 0 };
  location.replace(link(saved.path));
}

function renderCheckIn() {
  setTitle('Check in');
  main.innerHTML = `
    <header class="bar">
      <a class="text-btn" href="#/">Cancel</a>
      <h1 class="center">Check in</h1>
      <button type="button" class="icon-btn" id="refreshCheckin" aria-label="Refresh: find places around you again">${ICONS.refresh}</button>
    </header>
    <section class="place-picker checkin" id="checkinRoot">
      <div class="pull-hint" id="pullHint" aria-hidden="true"></div>
      <p class="muted small picker-status" id="checkinStatus" role="status">Finding places around you…</p>
      <ul class="place-list" id="checkinList"></ul>
      <p class="muted small place-credit" id="checkinCredit"></p>
      <a class="text-btn custom-place" href="#/new">Not here? Search for a place</a>
    </section>`;
  const list = $('#checkinList');
  const status = $('#checkinStatus');
  const journal = repo.all();
  let shown = [];

  const draw = (here, nearby) => {
    const covered = new Set();
    const places = nearby.map((p) => {
      const mine = findInJournal(p, journal);
      if (mine) covered.add(mine);
      return { ...p, mine };
    });
    for (const r of journal) {
      if (covered.has(r) || r.lat === null || r.lon === null) continue;
      places.push({ id: `journal:${r.path}`, name: r.name, lat: r.lat, lon: r.lon, address: [r.address, r.city].filter(Boolean).join(', '), mine: r });
    }
    const close = places.map((p) => ({ ...p, distance: distance(here, p) })).sort((a, b) => a.distance - b.distance);
    // Very close first; if little is that close, the nearest ten anyway.
    shown = close.filter((p) => p.distance <= CHECKIN_RADIUS);
    if (shown.length < 3) shown = close.slice(0, 10);
    shown = shown.slice(0, 40);
    list.innerHTML = shown.map((p, i) => `
      <li${p.mine ? ' class="in-journal"' : ''}><button type="button" data-i="${i}">
        <span class="place-text"><strong>${esc(p.mine?.name || p.name)}</strong><small>${esc(p.address || p.kind || '')}</small>${
          p.mine ? `<span class="journal-note">✓ ${esc(journalNote(p.mine))}</span>` : ''}</span>
        <span class="place-dist muted">${esc(formatDistance(p.distance))}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button></li>`).join('');
    $('#checkinCredit').innerHTML = shown.some((p) => !p.id.startsWith('journal:'))
      ? `Places © <a href="${OSM_COPYRIGHT}" target="_blank" rel="noopener">OpenStreetMap contributors</a>` : '';
  };

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-i]');
    if (!b || b.disabled) return;
    b.disabled = true;
    await checkIn(shown[Number(b.dataset.i)]);
  });

  // Finds the location (a fresh one when refreshing) and the places around it.
  // A newer load replaces an older one still running.
  let loads = 0;
  const load = async ({ fresh = false } = {}) => {
    const run = ++loads;
    const current = () => run === loads && $('#checkinList');
    status.textContent = fresh ? 'Finding where you are…' : 'Finding places around you…';
    const here = await locate({ fresh });
    if (!current()) return; // left the screen, or a newer load
    if (!here) {
      status.innerHTML = locate.denied
        ? 'Allow location access to check in at the places around you, or <a href="#/new">search for a place</a>.'
        : 'Your location is not available. <a href="#/new">Search for a place</a> instead.';
      return;
    }
    draw(here, []);
    status.textContent = navigator.onLine ? 'Finding places around you…' : 'You are offline: only places in your journal.';
    if (!navigator.onLine) return;
    try {
      // First the small area right around you (so the nearest places aren't
      // crowded out where there are many); where OpenStreetMap has little
      // there, about 3 km around (the same search as when adding a place).
      let nearby = await nearbyPlaces(here, (sofar) => { if (current()) draw(here, sofar); }, { size: 0.006 });
      if (!current()) return;
      const close = nearby.filter((p) => distance(here, p) <= CHECKIN_RADIUS).length;
      if (close < 3) {
        status.textContent = `${close ? 'Little' : 'Nothing'} on OpenStreetMap within about ${formatDistance(CHECKIN_RADIUS)}; looking a little further…`;
        const wider = await nearbyPlaces(here, (sofar) => { if (current()) draw(here, [...nearby, ...sofar]); });
        if (!current()) return;
        nearby = [...nearby, ...wider.filter((w) => !nearby.some((n) => n.id === w.id))];
      }
      draw(here, nearby);
      status.textContent = !shown.length ? 'Nothing found around you. Search for a place instead.'
        : shown[0].distance > CHECKIN_RADIUS ? `Nothing within about ${formatDistance(CHECKIN_RADIUS)}; the nearest places:` : '';
    } catch {
      if (current()) status.textContent = 'Places around you are not available right now; showing the ones in your journal.';
    }
  };

  // Pull down (at the top of the screen) or the refresh button: look again.
  const hint = $('#pullHint');
  const PULL = 64; // px to pull before letting go refreshes
  let refreshing = false;
  const showPull = (px, text) => {
    hint.style.height = `${px}px`;
    hint.textContent = text ?? (px >= PULL ? 'Release to refresh' : px > 8 ? 'Pull to refresh' : '');
  };
  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    hint.classList.add('settle');
    showPull(40, 'Refreshing…');
    $('#refreshCheckin').disabled = true;
    try { await load({ fresh: true }); } finally {
      refreshing = false;
      if ($('#checkinList')) { showPull(0, ''); $('#refreshCheckin').disabled = false; }
    }
  };
  $('#refreshCheckin').addEventListener('click', refresh);
  const root = $('#checkinRoot');
  let startY = null;
  let pulled = 0;
  root.addEventListener('touchstart', (e) => {
    startY = window.scrollY <= 0 && !refreshing && e.touches.length === 1 ? e.touches[0].clientY : null;
    pulled = 0;
    hint.classList.remove('settle');
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    pulled = Math.max(0, Math.min(96, (e.touches[0].clientY - startY) * 0.5));
    showPull(pulled);
  }, { passive: true });
  const letGo = (e) => {
    if (startY === null) return;
    startY = null;
    if (pulled >= PULL && e.type === 'touchend') refresh(); // not when the system cancels the touch
    else { hint.classList.add('settle'); showPull(0, ''); }
  };
  root.addEventListener('touchend', letGo);
  root.addEventListener('touchcancel', letGo);

  load();
}

// How a journal restaurant shows up in place results.
function journalNote(r) {
  const last = lastVisit(r);
  if (last) return `Visited ${formatDate(last)}`;
  if (r.toTry) return 'On your to-try list';
  return 'In your journal';
}

// Phones only show the keyboard for an input focused during the tap itself,
// and the search box doesn't exist yet when "+" is tapped. So the tap focuses
// a hidden input (the keyboard opens), and focusSearch hands focus over once
// the screen is drawn; the keyboard stays open. Without a tap, touch screens
// get no focus at all rather than a box that looks focused without a cursor.
let keyboardBridge = null;
const touchScreen = matchMedia('(pointer: coarse)').matches;
document.addEventListener('click', (e) => {
  if (!touchScreen || !e.target.closest?.('a[href^="#/new"]')) return;
  keyboardBridge?.remove();
  const bridge = document.createElement('input');
  bridge.setAttribute('aria-hidden', 'true');
  bridge.tabIndex = -1;
  bridge.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0';
  document.body.append(bridge);
  bridge.focus({ preventScroll: true });
  keyboardBridge = bridge;
  setTimeout(() => { if (keyboardBridge === bridge) { bridge.remove(); keyboardBridge = null; } }, 3000);
}, true);

function focusSearch(input) {
  if (touchScreen && !keyboardBridge) return;
  input.focus({ preventScroll: true });
  keyboardBridge?.remove();
  keyboardBridge = null;
}

function setUpPlacePicker(form, onFill = () => {}) {
  const journal = repo.all();
  const picker = $('#placePicker');
  const input = $('#placeQuery');
  const list = $('#placeResults');
  const status = $('#placeStatus');
  focusSearch(input);
  // Adding a place to try: Search looks everywhere, not just around here.
  const anywhere = () => form.toTry.checked;
  if (anywhere()) input.placeholder = 'Name, town';
  let nearby = [];   // places around the device
  let found = null;  // results of the last Search, for `foundFor`
  let foundFor = '';
  let shown = [];
  let nearbyNote = '';

  // One entry per place: OpenStreetMap sometimes has a place as both a point and a building.
  const withoutDuplicates = (places) => {
    const seen = new Set();
    return places.filter((p) => {
      const key = Number.isFinite(p.lat) && Number.isFinite(p.lon) ? `${fold(p.name)}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}` : p.id;
      if (seen.has(p.id) || seen.has(key)) return false;
      seen.add(p.id).add(key);
      return true;
    });
  };
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Restaurants in the journal (visited or to try) are offered too (also
  // offline), unless a nearby place already stands for them. Before anything
  // is typed: with a location, those within about 5 miles, by distance;
  // without one, all of them, most recent first. Typing finds any of them,
  // however far away.
  const SAVED_RADIUS = 8000; // meters
  let position = null;
  const saved = journal.filter((r) => r.visits.length || r.toTry).map((r) => ({
    id: `journal:${r.path}`,
    name: r.name,
    kind: r.type,
    type: r.type,
    cuisine: r.cuisine,
    address: [r.address, r.city, r.state].filter(Boolean).join(', '),
    street: r.address,
    city: r.city,
    state: r.state,
    country: r.country,
    countryCode: r.countryCode,
    website: r.website,
    phone: r.phone,
    lat: r.lat ?? NaN,
    lon: r.lon ?? NaN,
    mine: r,
  }));
  const latest = (r) => lastVisit(r) || r.created || '';
  const byLatest = [...saved].sort((a, b) => latest(b.mine).localeCompare(latest(a.mine)));
  let candidatesFor = null;
  let candidateList = [];
  const candidates = () => {
    if (candidatesFor === nearby && candidateList.position === position) return candidateList;
    // Nearby places that are in the journal know it, so they can be told apart.
    const near = nearby.map((p) => ({ ...p, mine: findInJournal(p, journal) }));
    const covered = new Set(near.map((p) => p.mine).filter(Boolean));
    const extra = (position ? saved : byLatest).filter((p) => !covered.has(p.mine)).map((p) => {
      const away = position ? (Number.isFinite(p.lat) ? distance(position, p) : Infinity) : undefined;
      return { ...p, distance: away, far: away > SAVED_RADIUS };
    });
    candidateList = position
      ? [...near, ...extra].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
      : [...near, ...extra];
    candidateList.position = position;
    candidatesFor = nearby;
    return candidateList;
  };

  // Adding a place to try: places already in the journal only show up when
  // they match what was typed.
  const nearbyMatching = (q) => {
    const fq = fold(q);
    if (!q) return candidates().filter((p) => !p.far && !(anywhere() && p.mine));
    return candidates().filter((p) => fold(`${p.name} ${p.cuisine} ${p.kind}`).includes(fq));
  };

  // Fallback search (Foursquare, through our server; only when the server has a
  // key): when OpenStreetMap has nothing for what was typed, either after a
  // Search or once typing has paused long enough to look finished.
  // The button under the results adds Foursquare's results to what is shown,
  // for a search Foursquare hasn't answered yet.
  let foundNote = '';      // shown above Search results, e.g. where they came from
  let foursquareFor = '';  // the text Foursquare was last asked about
  let nearbyLoading = true;
  let typingTimer = 0;
  const TYPING_PAUSE = 1500;
  const moreButton = $('#moreFoursquare');
  const fallbackReady = (q) => sync.state.fallbackSearch && navigator.onLine && q.length >= 3;
  const runFallback = async (q, { extend = false } = {}) => {
    status.textContent = extend ? 'Searching Foursquare…' : 'Not on OpenStreetMap. Searching Foursquare…';
    moreButton.disabled = true;
    moreButton.textContent = 'Searching Foursquare…';
    try {
      const results = await fallbackSearch(q, apiBase, undefined, { anywhere: anywhere() });
      if (input.value.trim() !== q) return;
      const before = extend ? (found ?? nearbyMatching(q)) : [];
      // Restaurants from Foursquare go above results that are only streets or towns.
      const first = !before.some((p) => p.venue || p.mine);
      found = withoutDuplicates(first ? [...results, ...before] : [...before, ...results]);
      foundFor = q;
      foursquareFor = q;
      const added = found.length - before.length;
      foundNote = !extend ? 'Not on OpenStreetMap. Results from Foursquare.'
        : added ? `Added ${added} result${added > 1 ? 's' : ''} from Foursquare${first ? '' : ' at the bottom'}.`
        : `Foursquare found nothing more for “${q}”.`;
      render();
    } catch {
      if (input.value.trim() === q) status.textContent = 'Search is not available right now.';
    } finally {
      moreButton.disabled = false;
      moreButton.textContent = `Search Foursquare for “${input.value.trim()}”`;
    }
  };
  moreButton.addEventListener('click', () => {
    clearTimeout(typingTimer);
    runFallback(input.value.trim(), { extend: true });
  });
  const fallbackAfterTyping = () => {
    clearTimeout(typingTimer);
    const q = input.value.trim();
    if (found || nearbyLoading || !fallbackReady(q) || nearbyMatching(q).length) return;
    typingTimer = setTimeout(() => {
      if (input.value.trim() === q && !found) runFallback(q);
    }, TYPING_PAUSE);
  };

  const render = () => {
    const q = input.value.trim();
    if (found && foundFor !== q) found = null;
    const matching = nearbyMatching(q);
    shown = (found ? found : matching.slice(0, 60)).map((p) => ({ ...p, mine: p.mine || findInJournal(p, journal) }));
    list.innerHTML = shown.map((p, i) => `
      <li${p.mine ? ' class="in-journal"' : ''}><button type="button" data-place="${i}">
        <span class="place-text"><strong>${esc(p.name)}</strong><small>${esc(p.address || p.display || p.kind)}</small>${
          p.mine ? `<span class="journal-note">✓ ${esc(journalNote(p.mine))}</span>` : ''}</span>
        <span class="place-dist muted">${p.distance === undefined ? '' : esc(formatDistance(p.distance))}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button>${p.source === 'foursquare' ? `<a class="fsq-link" href="${esc(foursquareURL(p.id.slice(4)))}" target="_blank" rel="noopener">View on Foursquare</a>` : ''}</li>`).join('');
    status.textContent = found
      ? (found.length ? foundNote : `Nothing found for “${q}”.${q.includes(',') ? '' : ` If it’s not near you, add the town after a comma: “${q}, town”.`}`)
      : q
        ? `${matching.length ? '' : 'No match nearby. '}Press Search to look everywhere for “${q}”.`
        : nearbyNote;
    moreButton.hidden = !fallbackReady(q) || foursquareFor === q;
    moreButton.textContent = `Search Foursquare for “${q}”`;
    // Credit for the places shown (OpenStreetMap's licence and Foursquare's terms ask for it).
    const fromOSM = shown.some((p) => !p.id.startsWith('journal:') && p.source !== 'foursquare');
    const fromFoursquare = shown.some((p) => p.source === 'foursquare');
    $('#placeCredit').innerHTML = [
      fromOSM ? `Places © <a href="${OSM_COPYRIGHT}" target="_blank" rel="noopener">OpenStreetMap contributors</a>` : '',
    ].filter(Boolean).join(' · ') + (fromFoursquare ? POWERED_BY_FOURSQUARE : '');
  };

  const loadNearby = async () => {
    try {
      await findNearby();
    } finally {
      nearbyLoading = false;
      fallbackAfterTyping();
    }
  };

  const findNearby = async () => {
    if (!navigator.onLine) { nearbyNote = 'You are offline. Add a custom location below.'; return render(); }
    nearbyNote = 'Finding places near you…';
    render();
    const here = await locate();
    position = here;
    if (!here) {
      nearbyNote = locate.denied
        ? 'Allow location access to see places near you, or search by name.'
        : 'Your location is not available. Search by name instead.';
      return render();
    }
    try {
      nearby = withoutDuplicates(await nearbyPlaces(here, (sofar) => { nearby = withoutDuplicates(sofar); nearbyNote = ''; render(); }));
      nearbyNote = nearby.length ? '' : 'No places found nearby. Search by name instead.';
    } catch {
      nearbyNote = 'Places nearby are not available right now. Search by name instead.';
    }
    render();
  };

  $('#placeSearch').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (!navigator.onLine) { status.textContent = 'You are offline. Add a custom location below.'; return; }
    clearTimeout(typingTimer);
    status.textContent = 'Searching…';
    try {
      const results = await searchPlaces(q, undefined, { anywhere: anywhere() });
      if (input.value.trim() !== q) return;
      // Nearby matches stay on top.
      const both = withoutDuplicates([...nearbyMatching(q), ...results]);
      if (!both.length && fallbackReady(q)) return runFallback(q);
      found = both;
      foundFor = q;
      foundNote = '';
      foursquareFor = '';
      render();
      // Only streets or towns by that name: ask Foursquare for the restaurant too.
      if (!both.some((p) => p.venue || p.mine) && fallbackReady(q)) runFallback(q, { extend: true });
    } catch {
      if (fallbackReady(q)) return runFallback(q);
      status.textContent = 'Search is not available right now.';
    }
  });
  input.addEventListener('input', () => {
    render();
    fallbackAfterTyping();
  });

  const showForm = () => {
    picker.hidden = true;
    form.hidden = false;
    $('#saveBtn').hidden = false;
    $('#addressNote').hidden = true;
    addressFor = null;
    window.scrollTo(0, 0);
  };

  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-place]');
    if (!b) return;
    const p = shown[Number(b.dataset.place)];
    if (p.mine) askAboutDuplicate(p);
    else useNewPlace(p);
  });

  const useNewPlace = (p) => {
    for (const key of ['name', 'type', 'cuisine', 'address', 'city', 'state', 'country', 'website', 'phone', 'lat', 'lon', 'countryCode', 'foursquareId']) {
      const value = key === 'address' && p.street !== undefined ? p.street
        : key === 'foursquareId' ? (p.source === 'foursquare' ? p.id.slice(4) : '') : p[key];
      form[key].value = value === undefined || value === null || Number.isNaN(value) ? '' : value;
    }
    onFill();
    showForm();
    if (!p.street && Number.isFinite(p.lat) && Number.isFinite(p.lon)) fillAddress(p);
  };

  // Some places (from Foursquare) have a location but no address: look the
  // address up from the location, and fill in only fields that are still empty.
  let addressFor = null;
  const fillAddress = async (p) => {
    if (!navigator.onLine) return;
    const note = $('#addressNote');
    addressFor = p;
    note.textContent = 'Looking up the address…';
    note.hidden = false;
    let found = null;
    try { found = await addressAt(p); } catch {}
    if (addressFor !== p || form.hidden) return;
    if (found) {
      for (const [field, value] of [['address', found.street], ['city', found.city], ['state', found.state], ['country', found.country], ['countryCode', found.countryCode]]) {
        if (value && !form[field].value.trim()) form[field].value = value;
      }
    }
    note.innerHTML = found?.street
      ? `Address from the location, © <a href="${OSM_COPYRIGHT}" target="_blank" rel="noopener">OpenStreetMap contributors</a>. Check that it is right.`
      : 'No address found for this location.';
  };

  // A place already in the journal: add a visit to it, or make a new restaurant anyway.
  const askAboutDuplicate = (p) => {
    const r = p.mine;
    const last = lastVisit(r);
    const message = last
      ? `You last visited ${esc(r.name)} on ${esc(formatDate(last))}.`
      : r.toTry
        ? `${esc(r.name)} is already on your to-try list.`
        : `You added ${esc(r.name)} on ${esc(formatDate(r.created))}.`;
    openSheet(`
      <div class="choice">
        <h2>Already in your journal</h2>
        <p>${message}</p>
        <button type="button" class="btn primary" id="dupVisit">Add visit to ${esc(r.name)}</button>
        <button type="button" class="btn" id="dupNew">Create new place</button>
        <button type="button" class="btn" data-close>Cancel</button>
      </div>`, (dlg) => {
      $('#dupVisit', dlg).addEventListener('click', () => {
        pendingVisit = { path: r.path };
        location.replace(link(r.path));
      });
      $('#dupNew', dlg).addEventListener('click', () => {
        closeSheet();
        useNewPlace(p);
      });
    });
  };

  $('#customPlace').addEventListener('click', () => {
    for (const key of ['type', 'cuisine', 'address', 'city', 'state', 'country', 'website', 'phone', 'lat', 'lon', 'countryCode', 'foursquareId']) form[key].value = '';
    onFill();
    form.name.value = input.value.trim();
    showForm();
    form.name.focus();
  });

  $('#backToSearch').addEventListener('click', () => {
    form.hidden = true;
    $('#saveBtn').hidden = true;
    picker.hidden = false;
    input.focus();
  });

  loadNearby();
}

// --- settings ---

function formatBytes(n) {
  if (n === null) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function releaseLine() {
  const release = self.BITE_STAMPED_RELEASE;
  if (!release) return APP_NAME;
  return `${APP_NAME} version ${release.version} · released ${formatDate(release.date, 'long')}`;
}

async function renderSettings() {
  setTitle('Settings');
  const all = repo.all();
  const visits = all.reduce((n, r) => n + r.visits.length, 0);
  const photos = all.reduce((n, r) => n + r.photos.length + r.dishes.filter((m) => m.image).length, 0);
  const est = await repo.storageEstimate();

  main.innerHTML = `
    <header class="bar">
      <span class="icon-btn"></span><h1 class="center">Settings</h1><span class="icon-btn"></span>
    </header>
    <section class="block">
      <h2>Your data</h2>
      <p>${all.length} places, ${visits} visits, ${photos} images · ${formatBytes(est.usage)} used on this device.</p>
      <p class="muted small">${est.persisted
        ? 'Storage is marked as persistent, so the browser will not clear it to free space.'
        : 'The browser may clear this data if the device runs low on space. Add the app to your Home Screen and export a backup now and then.'}</p>
      ${est.persisted ? '' : '<button class="btn" id="persist">Ask to keep data permanently</button>'}
    </section>
    <section class="block" id="syncSection"></section>
    <section class="block" id="calendarSection" hidden></section>
    <section class="block">
      <h2>Backup and files</h2>
      <p class="muted small">Export saves everything as a ZIP: one Markdown file with a YAML header per place, plus the images. Edit the files anywhere and import them again; files with the same name are replaced.</p>
      <div class="stack">
        <button class="btn" id="export">Export ZIP</button>
        <label class="btn file-btn">Import ZIP<input type="file" id="import" accept=".zip,application/zip"></label>
      </div>
    </section>
    <section class="block">
      <h2>Place search and maps</h2>
      <p class="muted small">When you add a place, your rough location (if you allow it) goes to OpenStreetMap’s Nominatim service to list places nearby, and so does any text you search for. The map view loads its map images from OpenStreetMap, which shows them the area you look at. Sorting by “Nearest” uses your location on this device only.</p>
      <p class="muted small" id="fallbackNote"${sync.state.fallbackSearch ? '' : ' hidden'}>When OpenStreetMap has nothing for what you typed, the search text and your rough location (to about 100 m) go through this app’s server to Foursquare, which searches its own list of places.</p>
    </section>
    <section class="block">
      <h2>Start over</h2>
      <p class="muted small">Removes all places and photos from this device only. When you are signed in, they download again from the server; nothing is deleted there.</p>
      <button class="text-btn danger" id="wipe">Remove all data from this device</button>
    </section>
    <p class="muted small app-version">${esc(releaseLine())}</p>`;

  renderSyncSection();
  renderCalendarSection();

  $('#persist')?.addEventListener('click', async () => {
    const ok = await repo.requestPersistence();
    toast(ok ? 'Data will be kept' : 'The browser said no (installing the app usually helps)');
    renderSettings();
  });
  $('#export').addEventListener('click', async () => {
    const blob = await repo.exportZip();
    const name = `bite-stamped-${today()}.zip`;
    const file = new File([blob], name, { type: 'application/zip' });
    if (navigator.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
  $('#import').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    if (!file) return;
    try {
      const n = await repo.importZip(file);
      toast(`Imported ${n} place${n === 1 ? '' : 's'}`);
      renderSettings();
    } catch (err) {
      alert(`Could not import: ${err.message}`);
    }
  });
  $('#wipe').addEventListener('click', async () => {
    const warning = sync.state.email
      ? 'This removes every place and photo from this device; they download again from the server. Changes not yet synced are lost. Type REMOVE to confirm.'
      : 'You are not signed in to sync, so this deletes every place and photo for good. Type REMOVE to confirm.';
    if (prompt(warning) !== 'REMOVE') return;
    await repo.deleteEverything();
    toast('Removed from this device');
    location.hash = '#/';
    sync.sync();
  });
}

// --- sync ---

// The app may live below a path (e.g. /bites/); the API sits next to index.html.
const apiBase = new URL('.', location.href).pathname.replace(/\/$/, '');

const sync = createSync({
  store,
  base: apiBase,
  onRemoteChange: () => refreshAfterRemoteChange(),
  onState: () => {
    updateTabs();
    // Never redraw the sign-in form while someone may be typing in it.
    if ($('#syncSection') && !$('#signIn')) renderSyncSection();
    if ($('#calendarSection') && $('#calendarSection').dataset.email !== (sync.state.email || '')) renderCalendarSection();
    // The server says whether it offers the fallback search after Settings is drawn.
    if ($('#fallbackNote')) $('#fallbackNote').hidden = !sync.state.fallbackSearch;
  },
});

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(iso.slice(0, 10));
}

// The visits as a calendar feed (server/calendar.js): a private link that
// calendar apps subscribe to. Only for a signed-in account, since the feed
// comes from the server's copy.
async function renderCalendarSection(link) {
  const section = $('#calendarSection');
  if (!section) return;
  const email = sync.state.email || '';
  section.dataset.email = email;
  section.hidden = !email;
  if (!email) return;
  const intro = '<h2>Calendar</h2><p class="muted small">Your visits as a calendar to subscribe to in Apple Calendar, Google Calendar or Outlook. It updates on its own; calendar apps check for changes every few hours.</p>';
  if (link === undefined) {
    section.innerHTML = `${intro}<p class="muted small">Loading…</p>`;
    try {
      link = (await sync.calendar()).url;
    } catch {
      if (section.dataset.email === email) section.innerHTML = `${intro}<p class="muted small">The calendar link needs a connection to the server.</p>`;
      return;
    }
    if (section.dataset.email !== email || !section.isConnected) return;
  }
  const change = async (method, question) => {
    if (question && !confirm(question)) return;
    try {
      renderCalendarSection((await sync.calendar(method)).url);
    } catch (e) {
      toast(`Could not change the calendar link: ${e.message}`);
    }
  };
  if (!link) {
    section.innerHTML = `${intro}<button class="btn" id="makeFeed">Create calendar link</button>`;
    $('#makeFeed', section).addEventListener('click', () => change('POST'));
    return;
  }
  const webcal = link.replace(/^https?:/, 'webcal:');
  section.innerHTML = `${intro}
    <input type="text" class="feed-url" id="feedURL" readonly value="${esc(link)}" aria-label="Calendar link">
    <div class="stack">
      <a class="btn" href="${esc(webcal)}">Add to Calendar</a>
      <a class="btn" href="https://calendar.google.com/calendar/render?cid=${esc(encodeURIComponent(webcal))}" target="_blank" rel="noopener">Add to Google Calendar</a>
      <button class="btn" id="copyFeed">Copy link</button>
    </div>
    <p class="muted small">Anyone with this link can see your visits without signing in. If it gets out, make a new link; the old one then stops working.</p>
    <div class="row">
      <button class="text-btn" id="newFeed">Make a new link</button>
      <button class="text-btn danger" id="stopFeed">Turn off</button>
    </div>`;
  $('#feedURL', section).addEventListener('focus', (e) => e.target.select());
  $('#copyFeed', section).addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Calendar link copied');
    } catch {
      $('#feedURL', section).select();
      toast('Could not copy; the link is selected');
    }
  });
  $('#newFeed', section).addEventListener('click', () => change('POST', 'Make a new calendar link? Calendars subscribed to the old link stop updating.'));
  $('#stopFeed', section).addEventListener('click', () => change('DELETE', 'Turn off the calendar link? Calendars subscribed to it stop updating.'));
}

function renderSyncSection() {
  const section = $('#syncSection');
  if (!section) return;
  const { email, status, lastSync, pending, error } = sync.state;

  if (email) {
    const line = status === 'syncing' ? 'Syncing…'
      : status === 'offline' ? `Offline. ${pending ? `${pending} change${pending === 1 ? '' : 's'} will sync when you are back online.` : 'Changes sync when you are back online.'}`
      : status === 'error' ? `Last sync failed: ${error}`
      : pending ? `${pending} change${pending === 1 ? '' : 's'} waiting.` : `Up to date. Last synced ${timeAgo(lastSync)}.`;
    section.innerHTML = `
      <h2>Sync</h2>
      <p>Signed in as <strong>${esc(email)}</strong></p>
      <p class="muted small">${esc(line)}</p>
      <p class="muted small">Everything you change here is saved on this device first and synced to your other devices and the server backup whenever there is a connection.</p>
      <div class="row">
        <button class="btn" id="syncNow"${status === 'syncing' ? ' disabled' : ''}>Sync now</button>
        <button class="text-btn" id="signOut">Sign out</button>
      </div>`;
    $('#syncNow', section).addEventListener('click', () => sync.sync());
    $('#signOut', section).addEventListener('click', async () => {
      if (pending && !confirm(`${pending} change${pending === 1 ? ' has' : 's have'} not synced yet. They stay on this device and sync after you sign in again. Sign out?`)) return;
      await sync.signOut();
    });
    return;
  }

  section.innerHTML = `
    <h2>Sync</h2>
    <p class="muted small">Sign in to keep your journal in sync across devices and backed up on the server. The app keeps working offline either way.</p>
    <form id="signIn" class="sign-in" data-step="email">
      <label>Email <input type="email" name="email" autocomplete="email" inputmode="email" required></label>
      <label class="code" hidden>Code from the email <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7"></label>
      <p class="muted small hint" hidden></p>
      <div class="row">
        <button class="btn" type="submit">Send code</button>
        <button class="text-btn" type="button" id="restart" hidden>Use another address</button>
      </div>
    </form>`;
  const form = $('#signIn', section);
  const step = (name) => {
    form.dataset.step = name;
    $('.code', form).hidden = name !== 'code';
    form.code.required = name === 'code';
    form.email.readOnly = name === 'code';
    $('#restart', form).hidden = name !== 'code';
    $('button[type="submit"]', form).textContent = name === 'code' ? 'Sign in' : 'Send code';
  };
  const hint = (text) => { $('.hint', form).hidden = !text; $('.hint', form).textContent = text; };
  $('#restart', form).addEventListener('click', () => { step('email'); hint(''); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) return hint('You are offline. Signing in needs a connection.');
    form.dataset.busy = '1';
    const button = $('button[type="submit"]', form);
    button.disabled = true;
    try {
      if (form.dataset.step === 'email') {
        await sync.sendCode(form.email.value);
        step('code');
        hint('If this address may use the app, a 6-digit code is on its way. It is valid for 10 minutes.');
        form.code.focus();
      } else {
        await sync.verify(form.email.value, form.code.value, navigator.userAgent.slice(0, 100));
        delete form.dataset.busy;
        toast('Signed in. Syncing…');
        renderSyncSection();
        return;
      }
    } catch (err) {
      hint(err.message);
    } finally {
      button.disabled = false;
      delete form.dataset.busy;
    }
  });
}

// Shows changes from other devices, unless the user is in the middle of
// something (a form or a sheet); then they appear on the next navigation.
let staleView = false;
async function refreshAfterRemoteChange() {
  await repo.loadAll();
  const onMap = listState.view === 'map' && /^#\/?(totry|visited)?$/.test(location.hash || '#/');
  const editing = sheet.open || onMap || /^#\/(new|edit\/|settings|checkin)/.test(location.hash);
  if (editing) { staleView = true; return; }
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

let syncTimer;
store.onLocalChange(() => {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync.sync(), 1500);
});
window.addEventListener('online', () => sync.sync());
window.addEventListener('offline', () => sync.sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.sync(); });
setInterval(() => { if (document.visibilityState === 'visible') sync.sync(); }, 5 * 60_000);

function notFound() {
  main.innerHTML = `<header class="bar"><a class="icon-btn" href="#/" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a></header>
    <p class="empty">This place does not exist (any more).</p>`;
}

// --- router ---

function route() {
  if (sheet.open) closeSheet();
  if (staleView) { staleView = false; repo.loadAll().then(render); window.scrollTo(0, 0); return; }
  window.scrollTo(0, 0);
  render();
}

// The bottom bar shows on the four top-level screens only.
function updateTabs() {
  const screen = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  const current = { '': 'timeline', visited: 'visited', totry: 'totry', settings: 'settings' }[screen];
  const tabs = document.getElementById('tabs');
  tabs.hidden = !current;
  document.body.classList.toggle('with-tabs', !!current);
  for (const a of tabs.querySelectorAll('[data-tab]')) {
    if (a.dataset.tab === current) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const { status, email, pending } = sync.state;
  const problem = email && (status === 'error' || pending);
  tabs.querySelector('[data-tab="settings"]').classList.toggle('alert', !!problem);
}

function render() {
  updateTabs();
  const [pathPart, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = pathPart.split('/').filter(Boolean);
  if (parts[0] === 'r' && parts[1]) return renderDetail(decodeURIComponent(parts[1]));
  if (parts[0] === 'edit' && parts[1]) return renderEdit(decodeURIComponent(parts[1]), params);
  if (parts[0] === 'new') return renderEdit(null, params);
  if (parts[0] === 'checkin') return renderCheckIn();
  if (parts[0] === 'settings') return renderSettings();
  if (parts[0] === 'totry') return renderList('totry');
  if (parts[0] === 'visited') return renderList('visited');
  return renderList('timeline');
}

// --- app updates ---
// A new version installs in the background (sw.js) and takes over at once;
// the page then reloads into it, but only on the list or a restaurant page
// with nothing open, so no edit is lost. Otherwise it waits for the next
// change of screen.

let updateReady = false;
const UPDATED_FLAG = 'bite-stamped-updated';

function safeToReload() {
  const screen = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0];
  return (['', 'visited', 'totry', 'r'].includes(screen)) && !sheet.open;
}

function reloadIfUpdated() {
  if (!updateReady || !safeToReload()) return false;
  try { sessionStorage.setItem(UPDATED_FLAG, '1'); } catch {}
  location.reload();
  return true;
}

function watchForUpdates() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // first install, not an update
    updateReady = true;
    reloadIfUpdated();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // Installed apps resume without a page load, so look for updates then too.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('Service worker:', e));
  sheet.addEventListener('close', () => setTimeout(reloadIfUpdated));
  try {
    if (sessionStorage.getItem(UPDATED_FLAG)) {
      sessionStorage.removeItem(UPDATED_FLAG);
      toast(`${APP_NAME} was updated`);
    }
  } catch {}
}

window.addEventListener('hashchange', () => {
  if (!reloadIfUpdated()) route();
});

(async () => {
  await repo.loadAll();
  route();
  watchForUpdates();
  await sync.init();
  // Restaurant files from before the naming pattern (STATE-city-name) get
  // their new names, after the server's changes are in, so a device that
  // comes second finds them renamed already.
  try { await sync.sync(); } catch {}
  // Not before the server takes files in places/ (a server older than 2.0.0
  // would get the deletions of the old files but refuse the new ones).
  const moved = !sync.state.email || sync.state.placesDir ? await repo.renameAll() : new Map();
  if (moved.size) {
    const [, screen, path] = location.hash.match(/^#\/(r|edit)\/([^?]+)/) || [];
    const next = path && moved.get(decodeURIComponent(path));
    if (next) location.replace(`#/${screen}/${encodeURIComponent(next)}`);
    else if (!sheet.open && !/^#\/(new|edit\/|settings)/.test(location.hash)) render();
  }
})();
