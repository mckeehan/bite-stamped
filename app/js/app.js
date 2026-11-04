import * as repo from './repo.js';
import {
  newRestaurant, sortVisits, lastVisit, displayRating, coverImage, matches, placeLine, mapsURL, today, findInJournal,
} from './model.js';
import { renderMarkdown } from './md.js';
import { searchPlaces, locate, nearbyFood, formatDistance } from './places.js';
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
const link = (path) => `#/r/${encodeURIComponent(path)}`;

function formatDate(ymd, style = 'medium') {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Intl.DateTimeFormat(undefined, { dateStyle: style }).format(new Date(y, m - 1, d));
}

function stars(n, { input = false, name = 'rating', size = '' } = {}) {
  const items = [1, 2, 3, 4, 5].map((i) => input
    ? `<button type="button" class="star${i <= n ? ' on' : ''}" data-value="${i}" aria-label="${i} star${i > 1 ? 's' : ''}">★</button>`
    : `<span class="star${i <= n ? ' on' : ''}">★</span>`).join('');
  return input
    ? `<span class="stars input ${size}" data-name="${name}" data-value="${n}" role="group" aria-label="Rating">${items}</span>`
    : n ? `<span class="stars ${size}" aria-label="${n} of 5 stars">${items}</span>` : '';
}

// Star inputs: tapping the current value clears it.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.stars.input .star');
  if (!btn) return;
  const group = btn.parentElement;
  const v = Number(btn.dataset.value);
  const next = Number(group.dataset.value) === v ? 0 : v;
  group.dataset.value = next;
  $$('.star', group).forEach((s) => s.classList.toggle('on', Number(s.dataset.value) <= next));
  group.dispatchEvent(new CustomEvent('rate', { bubbles: true, detail: next }));
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

const listState = { tab: 'visited', query: '', sort: 'recent' };
try {
  Object.assign(listState, JSON.parse(localStorage.getItem('listState') || '{}'), { query: '' });
} catch {}

function sortRestaurants(list, sort) {
  const by = {
    recent: (a, b) => (lastVisit(b) || b.created).localeCompare(lastVisit(a) || a.created),
    rating: (a, b) => displayRating(b) - displayRating(a) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    visits: (a, b) => b.visits.length - a.visits.length || a.name.localeCompare(b.name),
    added: (a, b) => (b.created || '').localeCompare(a.created || ''),
  }[sort] || (() => 0);
  return list.sort(by);
}

function renderList() {
  setTitle('');
  const everything = repo.all();
  const counts = { visited: everything.filter((r) => !r.toTry).length, totry: everything.filter((r) => r.toTry).length };

  main.innerHTML = `
    <header class="bar">
      <h1>${APP_NAME}</h1>
      <a class="icon-btn sync-badge" href="#/settings" id="syncBadge" aria-label="Sync">${syncIcon()}</a>
      <a class="icon-btn" href="#/settings" aria-label="Settings"><svg viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Zm7.4-2.5a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.5h-4l-.3 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"/></svg></a>
      <a class="icon-btn primary" href="#/new" aria-label="Add restaurant"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></a>
    </header>
    <div class="list-tools">
      <input type="search" id="q" placeholder="Search restaurants, dishes, people…" value="${esc(listState.query)}" autocomplete="off">
      <div class="row">
        <div class="segmented" role="tablist">
          <button role="tab" data-tab="visited" aria-selected="${listState.tab === 'visited'}">Been <span>${counts.visited}</span></button>
          <button role="tab" data-tab="totry" aria-selected="${listState.tab === 'totry'}">To try <span>${counts.totry}</span></button>
        </div>
        <select id="sort" aria-label="Sort">
          ${[['recent', 'Recent'], ['rating', 'Rating'], ['visits', 'Most visits'], ['name', 'Name'], ['added', 'Added']]
            .map(([v, l]) => `<option value="${v}"${listState.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
    </div>
    <ul class="cards" id="cards"></ul>`;

  const fill = () => {
    const shown = sortRestaurants(
      everything.filter((r) => (listState.tab === 'totry') === r.toTry && matches(r, listState.query)),
      listState.sort,
    );
    const cards = $('#cards');
    if (!shown.length) {
      cards.innerHTML = `<li class="empty">${
        listState.query ? 'Nothing matches your search.'
        : listState.tab === 'totry' ? 'Places you want to try go here.<br><a href="#/new?totry=1">Add one</a>'
        : everything.length ? 'No visited places yet.' : `Your restaurant journal is empty.<br><a href="#/new">Add your first restaurant</a>`
      }</li>`;
      return;
    }
    cards.innerHTML = shown.map((r) => {
      const cover = coverImage(r);
      const last = lastVisit(r);
      const sub = [r.cuisine, placeLine(r)].filter(Boolean).join(' · ');
      const visits = r.visits.length ? `${r.visits.length} visit${r.visits.length > 1 ? 's' : ''} · ${formatDate(last)}` : '';
      return `<li><a class="card" href="${link(r.path)}">
        <span class="thumb">${cover ? `<img data-file="${esc(cover)}" alt="">` : `<span class="initial">${esc(r.name.slice(0, 1).toUpperCase())}</span>`}</span>
        <span class="card-body">
          <strong>${esc(r.name)}</strong>
          ${stars(displayRating(r), { size: 'small' })}
          ${sub ? `<small>${esc(sub)}</small>` : ''}
          ${visits ? `<small class="muted">${esc(visits)}</small>` : ''}
        </span></a></li>`;
    }).join('');
    hydrateImages(cards);
  };
  fill();

  const remember = () => { try { localStorage.setItem('listState', JSON.stringify(listState)); } catch {} };
  $('#q').addEventListener('input', (e) => { listState.query = e.target.value; fill(); });
  $('#sort').addEventListener('change', (e) => { listState.sort = e.target.value; remember(); fill(); });
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => {
    listState.tab = b.dataset.tab;
    remember();
    $$('.segmented button').forEach((x) => x.setAttribute('aria-selected', x === b));
    fill();
  }));
}

// --- detail ---

function renderDetail(path) {
  const r = repo.get(path);
  if (!r) return notFound();
  setTitle(r.name);
  const cover = r.photos[0]?.file;
  const contact = [
    r.address ? `<a href="${esc(mapsURL(r))}" target="_blank" rel="noopener">📍 ${esc(r.address)}</a>` : r.lat !== null ? `<a href="${esc(mapsURL(r))}" target="_blank" rel="noopener">📍 Open in Maps</a>` : '',
    r.website ? `<a href="${esc(/^https?:/.test(r.website) ? r.website : 'https://' + r.website)}" target="_blank" rel="noopener">🌐 ${esc(r.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '',
    r.phone ? `<a href="tel:${esc(r.phone.replace(/[^\d+]/g, ''))}">📞 ${esc(r.phone)}</a>` : '',
  ].filter(Boolean);

  main.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <span class="grow"></span>
      <a class="text-btn" href="#/edit/${encodeURIComponent(r.path)}">Edit</a>
    </header>
    ${cover ? `<div class="cover"><img data-file="${esc(cover)}" alt=""></div>` : ''}
    <section class="detail-head">
      <h1>${esc(r.name)}</h1>
      ${[r.cuisine, placeLine(r)].filter(Boolean).length ? `<p class="muted">${esc([r.cuisine, placeLine(r)].filter(Boolean).join(' · '))}</p>` : ''}
      <div class="head-row">
        ${stars(r.rating, { input: true, size: 'large' })}
        <button type="button" class="chip${r.toTry ? ' on' : ''}" id="toTry">${r.toTry ? '★ To try' : '☆ To try'}</button>
      </div>
      ${!r.rating && displayRating(r) ? `<p class="muted small">Visits average ${displayRating(r)} ★</p>` : ''}
      ${contact.length ? `<div class="contact">${contact.join('')}</div>` : ''}
      ${r.tags.length ? `<div class="tags">${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${r.notes ? `<div class="notes">${renderMarkdown(r.notes)}</div>` : ''}
    </section>

    <section class="block">
      <div class="block-head"><h2>Visits <span class="count">${r.visits.length || ''}</span></h2><button class="text-btn" id="addVisit">+ Visit</button></div>
      ${r.visits.length ? `<ul class="rows">${sortVisits(r.visits).map((v) => `
        <li><button class="row-btn" data-visit="${r.visits.indexOf(v)}">
          <span class="row-main"><strong>${esc(formatDate(v.date, 'long'))}</strong>${stars(v.rating, { size: 'small' })}</span>
          ${v.people.length ? `<small>with ${esc(v.people.join(', '))}</small>` : ''}
          ${v.notes ? `<small class="muted pre">${esc(v.notes)}</small>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="muted small">No visits yet.</p>'}
    </section>

    <section class="block">
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
    </section>

    <section class="block">
      <div class="block-head"><h2>Photos <span class="count">${r.photos.length || ''}</span></h2><button class="text-btn" id="addPhotos">+ Photos</button></div>
      ${r.photos.length ? `<ul class="grid">${r.photos.map((p, i) => `
        <li><button class="photo" data-photo="${i}">
          <span class="thumb square"><img data-file="${esc(p.file)}" alt="${esc(p.title)}"></span>
          ${p.title ? `<span class="caption">${esc(p.title)}</span>` : ''}
        </button></li>`).join('')}</ul>` : '<p class="muted small">No photos yet.</p>'}
    </section>

    <p class="danger-zone"><button class="text-btn danger" id="deleteRestaurant">Delete restaurant</button></p>`;

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
  if (pendingVisit === path) { pendingVisit = null; editVisit(r, -1); }
  $$('[data-visit]').forEach((b) => b.addEventListener('click', () => editVisit(r, Number(b.dataset.visit))));
  $('#addDish').addEventListener('click', () => editDish(r, -1));
  $$('[data-dish]').forEach((b) => b.addEventListener('click', () => editDish(r, Number(b.dataset.dish))));
  $('#addPhotos').addEventListener('click', () => addPhotos(r));
  $$('[data-photo]').forEach((b) => b.addEventListener('click', () => editPhoto(r, Number(b.dataset.photo))));
  $('#deleteRestaurant').addEventListener('click', async () => {
    if (!confirm(`Delete “${r.name}” with all its visits, dishes and photos?`)) return;
    await repo.remove(r);
    toast('Deleted');
    location.hash = '#/';
  });
}

function peopleDatalist() {
  return `<datalist id="people">${repo.knownPeople().map((p) => `<option value="${esc(p)}">`).join('')}</datalist>`;
}

function editVisit(r, index) {
  const v = r.visits[index] || { date: today(), rating: 0, people: [], notes: '' };
  openSheet(`
    <form method="dialog" class="sheet-form">
      <header><button type="button" class="text-btn" data-close>Cancel</button><h2>${index < 0 ? 'New visit' : 'Visit'}</h2><button class="text-btn strong" value="save">Save</button></header>
      <label>Date <input type="date" name="date" value="${esc(v.date.slice(0, 10))}" required></label>
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
      const visit = { date: form.date.value, rating: starValue(dlg, 'visit'), people, notes: form.notes.value.trim() };
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
  setTitle(existing ? `Edit ${r.name}` : 'New restaurant');
  const back = existing ? link(existing.path) : '#/';

  main.innerHTML = `
    <header class="bar">
      <a class="text-btn" href="${back}">Cancel</a>
      <h1 class="center">${existing ? 'Edit' : 'New restaurant'}</h1>
      <button class="text-btn strong" form="editForm" id="saveBtn"${existing ? '' : ' hidden'}>Save</button>
    </header>
    ${existing ? '' : `
    <section class="place-picker" id="placePicker">
      <form class="search-row" id="placeSearch" role="search">
        <input type="search" id="placeQuery" placeholder="Search for restaurant" autocomplete="off" enterkeyhint="search" aria-label="Search for restaurant">
      </form>
      <p class="muted small picker-status" id="placeStatus"></p>
      <ul class="place-list" id="placeResults"></ul>
      <button type="button" class="text-btn custom-place" id="customPlace">Not there? Add a custom location</button>
    </section>`}
    <form id="editForm" class="edit-form"${existing ? '' : ' hidden'}>
      ${existing ? '' : '<button type="button" class="text-btn back-to-search" id="backToSearch">‹ Search again</button>'}
      <label>Name <input name="name" value="${esc(r.name)}" required autocomplete="off"></label>
      <div class="field"><span>Rating</span>${stars(r.rating, { input: true, size: 'large' })}</div>
      <label class="check"><input type="checkbox" name="toTry"${r.toTry ? ' checked' : ''}> I want to try this place</label>
      <label>Cuisine <input name="cuisine" value="${esc(r.cuisine)}" placeholder="e.g. Thai, Pizza" autocomplete="off"></label>
      <label>Address <input name="address" value="${esc(r.address)}" autocomplete="off"></label>
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
    </form>`;

  const form = $('#editForm');

  if (!existing) setUpPlacePicker(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    Object.assign(r, {
      name: f.name.value.trim(),
      rating: starValue(form),
      toTry: f.toTry.checked,
      cuisine: f.cuisine.value.trim(),
      address: f.address.value.trim(),
      city: f.city.value.trim(),
      state: f.state.value.trim(),
      country: f.country.value.trim(),
      countryCode: f.countryCode.value.trim(),
      website: f.website.value.trim(),
      phone: f.phone.value.trim(),
      tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
      notes: f.notes.value.trim(),
      lat: f.lat.value === '' ? null : Number(f.lat.value),
      lon: f.lon.value === '' ? null : Number(f.lon.value),
    });
    if (!r.name) return;
    const saved = await repo.save(r);
    location.replace(link(saved.path));
  });
}

// New restaurant: first pick a place (food places nearby, filtered as you type;
// press Search to look further), or open the empty form for a custom one.
// Set when "Add visit" on the new-restaurant screen opens a restaurant.
let pendingVisit = null;

// How a journal restaurant shows up in place results.
function journalNote(r) {
  const last = lastVisit(r);
  if (last) return `Visited ${formatDate(last)}`;
  if (r.toTry) return 'On your to-try list';
  return 'In your journal';
}

function setUpPlacePicker(form) {
  const journal = repo.all();
  const picker = $('#placePicker');
  const input = $('#placeQuery');
  const list = $('#placeResults');
  const status = $('#placeStatus');
  let nearby = [];   // food places around the device
  let found = null;  // results of the last Search, for `foundFor`
  let foundFor = '';
  let shown = [];
  let nearbyNote = '';

  // One entry per place: OpenStreetMap sometimes has a place as both a point and a building.
  const withoutDuplicates = (places) => {
    const seen = new Set();
    return places.filter((p) => {
      const key = `${fold(p.name)}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
      if (seen.has(p.id) || seen.has(key)) return false;
      seen.add(p.id).add(key);
      return true;
    });
  };
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const render = () => {
    const q = input.value.trim();
    if (found && foundFor !== q) found = null;
    const fq = fold(q);
    const matching = q ? nearby.filter((p) => fold(`${p.name} ${p.cuisine} ${p.kind}`).includes(fq)) : nearby;
    shown = (found ? found : matching.slice(0, 60)).map((p) => ({ ...p, mine: findInJournal(p, journal) }));
    list.innerHTML = shown.map((p, i) => `
      <li${p.mine ? ' class="in-journal"' : ''}><button type="button" data-place="${i}">
        <span class="place-text"><strong>${esc(p.name)}</strong><small>${esc(p.address || p.display || p.kind)}</small>${
          p.mine ? `<span class="journal-note">✓ ${esc(journalNote(p.mine))}</span>` : ''}</span>
        <span class="place-dist muted">${p.distance === undefined ? '' : esc(formatDistance(p.distance))}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button></li>`).join('');
    status.textContent = found
      ? (found.length ? '' : `Nothing found for “${q}”.`)
      : q
        ? `${matching.length ? '' : 'No match nearby. '}Press Search to look everywhere for “${q}”.`
        : nearbyNote;
  };

  const loadNearby = async () => {
    if (!navigator.onLine) { nearbyNote = 'You are offline. Add a custom location below.'; return render(); }
    nearbyNote = 'Finding food places near you…';
    render();
    const here = await locate();
    if (!here) {
      nearbyNote = locate.denied
        ? 'Allow location access to see places near you, or search by name.'
        : 'Your location is not available. Search by name instead.';
      return render();
    }
    try {
      nearby = withoutDuplicates(await nearbyFood(here, (sofar) => { nearby = withoutDuplicates(sofar); nearbyNote = ''; render(); }));
      nearbyNote = nearby.length ? '' : 'No food places found nearby. Search by name instead.';
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
    status.textContent = 'Searching…';
    try {
      const results = await searchPlaces(q);
      if (input.value.trim() !== q) return;
      // Nearby matches stay on top.
      const fq = fold(q);
      const close = nearby.filter((p) => fold(`${p.name} ${p.cuisine} ${p.kind}`).includes(fq));
      found = withoutDuplicates([...close, ...results]);
      foundFor = q;
      render();
    } catch {
      status.textContent = 'Search is not available right now.';
    }
  });
  input.addEventListener('input', render);

  const showForm = () => {
    picker.hidden = true;
    form.hidden = false;
    $('#saveBtn').hidden = false;
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
    for (const key of ['name', 'cuisine', 'address', 'city', 'state', 'country', 'website', 'phone', 'lat', 'lon', 'countryCode']) {
      const value = key === 'address' && p.street !== undefined ? p.street : p[key];
      form[key].value = value === undefined || Number.isNaN(value) ? '' : value;
    }
    showForm();
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
        <button type="button" class="btn" id="dupNew">Create new restaurant</button>
        <button type="button" class="btn" data-close>Cancel</button>
      </div>`, (dlg) => {
      $('#dupVisit', dlg).addEventListener('click', () => {
        pendingVisit = r.path;
        location.replace(link(r.path));
      });
      $('#dupNew', dlg).addEventListener('click', () => {
        closeSheet();
        useNewPlace(p);
      });
    });
  };

  $('#customPlace').addEventListener('click', () => {
    for (const key of ['cuisine', 'address', 'city', 'state', 'country', 'website', 'phone', 'lat', 'lon', 'countryCode']) form[key].value = '';
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

async function renderSettings() {
  setTitle('Settings');
  const all = repo.all();
  const visits = all.reduce((n, r) => n + r.visits.length, 0);
  const photos = all.reduce((n, r) => n + r.photos.length + r.dishes.filter((m) => m.image).length, 0);
  const est = await repo.storageEstimate();

  main.innerHTML = `
    <header class="bar">
      <a class="icon-btn" href="#/" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <h1 class="center">Settings</h1><span class="icon-btn"></span>
    </header>
    <section class="block">
      <h2>Your data</h2>
      <p>${all.length} restaurants, ${visits} visits, ${photos} images · ${formatBytes(est.usage)} used on this device.</p>
      <p class="muted small">${est.persisted
        ? 'Storage is marked as persistent, so the browser will not clear it to free space.'
        : 'The browser may clear this data if the device runs low on space. Add the app to your Home Screen and export a backup now and then.'}</p>
      ${est.persisted ? '' : '<button class="btn" id="persist">Ask to keep data permanently</button>'}
    </section>
    <section class="block" id="syncSection"></section>
    <section class="block">
      <h2>Backup and files</h2>
      <p class="muted small">Export saves everything as a ZIP: one Markdown file with a YAML header per restaurant, plus the images. Edit the files anywhere and import them again; files with the same name are replaced.</p>
      <div class="stack">
        <button class="btn" id="export">Export ZIP</button>
        <label class="btn file-btn">Import ZIP<input type="file" id="import" accept=".zip,application/zip"></label>
      </div>
    </section>
    <section class="block">
      <h2>Place search</h2>
      <p class="muted small">When you add a restaurant, your rough location (if you allow it) goes to OpenStreetMap’s Nominatim service to list food places nearby, and so does any text you search for.</p>
    </section>
    <section class="block">
      <h2>Start over</h2>
      <p class="muted small">Removes all restaurants and photos from this device only. When you are signed in, they download again from the server; nothing is deleted there.</p>
      <button class="text-btn danger" id="wipe">Remove all data from this device</button>
    </section>`;

  renderSyncSection();

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
      toast(`Imported ${n} restaurant${n === 1 ? '' : 's'}`);
      renderSettings();
    } catch (err) {
      alert(`Could not import: ${err.message}`);
    }
  });
  $('#wipe').addEventListener('click', async () => {
    const warning = sync.state.email
      ? 'This removes every restaurant and photo from this device; they download again from the server. Changes not yet synced are lost. Type REMOVE to confirm.'
      : 'You are not signed in to sync, so this deletes every restaurant and photo for good. Type REMOVE to confirm.';
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
    const badge = $('#syncBadge');
    if (badge) badge.outerHTML = `<a class="icon-btn sync-badge" href="#/settings" id="syncBadge" aria-label="Sync">${syncIcon()}</a>`;
    // Never redraw the sign-in form while someone may be typing in it.
    if ($('#syncSection') && !$('#signIn')) renderSyncSection();
  },
});

function syncIcon() {
  const { status, email, pending } = sync.state;
  const kind = !email ? 'signed-out' : status === 'syncing' ? 'syncing' : status === 'error' ? 'error' : status === 'offline' || pending ? 'pending' : 'ok';
  const title = {
    'signed-out': 'Sync is off',
    syncing: 'Syncing…',
    error: 'Sync problem',
    pending: `${pending || 'Some'} change${pending === 1 ? '' : 's'} waiting to sync`,
    ok: 'Synced',
  }[kind];
  return `<svg viewBox="0 0 24 24" class="cloud ${kind}"><title>${esc(title)}</title><path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18Z"/>${
    kind === 'ok' ? '<path d="M9.5 13.5l2 2 3.5-4"/>' : kind === 'signed-out' ? '<path d="M4 4l16 16"/>' : kind === 'error' ? '<path d="M12 10v3M12 15.5v.01"/>' : kind === 'syncing' ? '<path d="M9 13h6M12 10v6"/>' : '<circle cx="12" cy="13.5" r="1.3" fill="currentColor"/>'
  }</svg>`;
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return formatDate(iso.slice(0, 10));
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
  const editing = sheet.open || /^#\/(new|edit\/|settings)/.test(location.hash);
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
    <p class="empty">This restaurant does not exist (any more).</p>`;
}

// --- router ---

function route() {
  if (sheet.open) closeSheet();
  if (staleView) { staleView = false; repo.loadAll().then(render); window.scrollTo(0, 0); return; }
  window.scrollTo(0, 0);
  render();
}

function render() {
  const [pathPart, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = pathPart.split('/').filter(Boolean);
  if (parts[0] === 'r' && parts[1]) return renderDetail(decodeURIComponent(parts[1]));
  if (parts[0] === 'edit' && parts[1]) return renderEdit(decodeURIComponent(parts[1]), params);
  if (parts[0] === 'new') return renderEdit(null, params);
  if (parts[0] === 'settings') return renderSettings();
  return renderList();
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
  return (screen === '' || screen === 'r') && !sheet.open;
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
  navigator.serviceWorker.register('sw.js')
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
  sync.sync();
})();
