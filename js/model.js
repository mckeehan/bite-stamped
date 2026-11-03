// A restaurant is one Markdown file, `restaurants/<slug>.md`. Its YAML header
// holds the details, visits, dishes and photos; the body holds free notes.
// Images live in `media/<slug>/`, referenced by path from the header.
// Pure functions only (no browser APIs), so they run under `node --test`.

import { parseFrontMatter, stringifyFrontMatter } from './yaml.js';

export const RESTAURANT_DIR = 'restaurants/';
export const MEDIA_DIR = 'media/';

const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const list = (v) => (Array.isArray(v) ? v : v === null || v === undefined || v === '' ? [] : [v]);
const rating = (v) => {
  const n = num(v);
  return n === null ? 0 : Math.max(0, Math.min(5, Math.round(n)));
};

export function slugify(name) {
  const s = str(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return s || 'restaurant';
}

export function uniquePath(name, takenPaths) {
  const taken = new Set(takenPaths);
  const base = slugify(name);
  let path = `${RESTAURANT_DIR}${base}.md`;
  for (let n = 2; taken.has(path); n++) path = `${RESTAURANT_DIR}${base}-${n}.md`;
  return path;
}

export function slugOf(path) {
  return path.slice(RESTAURANT_DIR.length).replace(/\.md$/, '');
}

export function mediaDir(path) {
  return `${MEDIA_DIR}${slugOf(path)}/`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function newRestaurant(fields = {}) {
  return normalize({ created: new Date().toISOString(), ...fields });
}

export function normalize(d) {
  return {
    path: d.path || '',
    name: str(d.name),
    rating: rating(d.rating),
    toTry: d.toTry === true || d.toTry === 'true',
    cuisine: str(d.cuisine),
    address: str(d.address),
    city: str(d.city),
    state: str(d.state),
    country: str(d.country),
    countryCode: str(d.countryCode),
    lat: num(d.lat),
    lon: num(d.lon),
    website: str(d.website),
    phone: str(d.phone),
    googlePlaceId: str(d.googlePlaceId),
    tags: list(d.tags).map(str).filter(Boolean),
    created: str(d.created),
    updated: str(d.updated),
    visits: list(d.visits).filter((v) => v && typeof v === 'object').map((v) => ({
      date: str(v.date),
      rating: rating(v.rating),
      people: list(v.people).map(str).filter(Boolean),
      notes: str(v.notes),
    })),
    dishes: list(d.dishes).filter((m) => m && typeof m === 'object').map((m) => ({
      name: str(m.name),
      rating: rating(m.rating),
      price: str(m.price),
      notes: str(m.notes),
      image: str(m.image),
    })),
    photos: list(d.photos)
      .map((p) => (typeof p === 'string' ? { file: p } : p))
      .filter((p) => p && typeof p === 'object' && p.file)
      .map((p) => ({ file: str(p.file), title: str(p.title), date: str(p.date) })),
    notes: str(d.notes),
  };
}

export function fromMarkdown(path, text) {
  const { data, body } = parseFrontMatter(text);
  return normalize({ ...data, path, notes: body.trim() });
}

export function toMarkdown(r) {
  const header = {
    name: r.name,
    rating: r.rating || null,
    toTry: r.toTry || null,
    cuisine: r.cuisine,
    address: r.address,
    city: r.city,
    state: r.state,
    country: r.country,
    countryCode: r.countryCode,
    lat: r.lat,
    lon: r.lon,
    website: r.website,
    phone: r.phone,
    googlePlaceId: r.googlePlaceId,
    tags: r.tags,
    created: r.created,
    updated: r.updated,
    visits: sortVisits(r.visits).map((v) => ({
      date: v.date,
      rating: v.rating || null,
      people: v.people,
      notes: v.notes,
    })),
    dishes: r.dishes.map((m) => ({
      name: m.name,
      rating: m.rating || null,
      price: m.price,
      notes: m.notes,
      image: m.image,
    })),
    photos: r.photos.map((p) => ({ file: p.file, title: p.title, date: p.date })),
  };
  return stringifyFrontMatter(header, r.notes);
}

// Newest first.
export function sortVisits(visits) {
  return [...visits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export function lastVisit(r) {
  return r.visits.reduce((max, v) => (v.date > max ? v.date : max), '');
}

export function averageVisitRating(r) {
  const rated = r.visits.filter((v) => v.rating);
  return rated.length ? rated.reduce((s, v) => s + v.rating, 0) / rated.length : 0;
}

// The overall rating if set, otherwise the average of rated visits.
export function displayRating(r) {
  return r.rating || Math.round(averageVisitRating(r));
}

export function coverImage(r) {
  return r.photos[0]?.file || r.dishes.find((m) => m.image)?.image || '';
}

// Every image file a restaurant refers to.
export function imagesOf(r) {
  return [...r.photos.map((p) => p.file), ...r.dishes.map((m) => m.image)].filter(Boolean);
}

export function matches(r, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    r.name, r.cuisine, r.city, r.state, r.country, r.address, r.notes, ...r.tags,
    ...r.dishes.map((m) => m.name),
    ...r.visits.flatMap((v) => [...v.people, v.notes]),
    ...r.photos.map((p) => p.title),
  ].join('\n').toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function placeLine(r) {
  return [r.city, r.state && r.state !== r.city ? r.state : '', r.countryCode && r.countryCode.toUpperCase() !== 'US' ? r.country : '']
    .filter(Boolean)
    .join(', ');
}

export function mapsURL(r) {
  const q = encodeURIComponent([r.name, r.address].filter(Boolean).join(', '));
  if (r.lat !== null && r.lon !== null) return `https://maps.apple.com/?q=${encodeURIComponent(r.name)}&ll=${r.lat},${r.lon}`;
  return `https://maps.apple.com/?q=${q}`;
}
