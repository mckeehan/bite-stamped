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

// Local date and time to the minute, e.g. 2026-10-12T19:30 (visits).
export function now() {
  const d = new Date();
  return `${today()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

// Links that open a navigation app with the restaurant as the destination.
// With a location they use it (exact); otherwise the name and address.
// null when there is nothing to navigate to.
export function directionLinks(r) {
  const hasPoint = Number.isFinite(r.lat) && Number.isFinite(r.lon);
  const where = [r.address, r.city, r.state, r.country].filter(Boolean).join(', ');
  if (!hasPoint && !where) return null;
  const text = encodeURIComponent([r.name, where].filter(Boolean).join(', '));
  const name = encodeURIComponent(r.name || '');
  const ll = hasPoint ? `${r.lat},${r.lon}` : '';
  return {
    apple: hasPoint ? `https://maps.apple.com/?daddr=${ll}&q=${name}` : `https://maps.apple.com/?daddr=${text}`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${hasPoint ? ll : text}`,
    waze: hasPoint ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${text}&navigate=yes`,
    // Android: lets the user pick any installed map app.
    geo: hasPoint ? `geo:${ll}?q=${ll}(${name})` : `geo:0,0?q=${text}`,
    // For sharing as text: the address, and a link that opens anywhere.
    address: where,
    web: `https://www.google.com/maps/search/?api=1&query=${hasPoint ? ll : text}`,
  };
}

// --- merging two versions of one restaurant (sync conflicts) ---

const filled = (v) => v !== null && v !== undefined && v !== '' && v !== 0;

function mergeText(a, b) {
  if (a === b || !b) return a;
  if (!a) return b;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n\n${b}`;
}

function unionBy(local, remote, key, combine = (l) => l) {
  const out = [...local];
  const index = new Map(local.map((item, i) => [key(item), i]));
  for (const item of remote) {
    const k = key(item);
    if (index.has(k)) out[index.get(k)] = combine(out[index.get(k)], item);
    else { index.set(k, out.length); out.push(item); }
  }
  return out;
}

// Combines this device's version with the server's: nothing that either side
// added is lost. Single values prefer this device's version when it has one.
// (An item deleted on one side but kept on the other comes back.)
export function mergeRestaurants(local, remote) {
  const r = { ...local };
  for (const key of ['name', 'rating', 'cuisine', 'address', 'city', 'state', 'country', 'countryCode', 'lat', 'lon', 'website', 'phone', 'googlePlaceId']) {
    if (!filled(r[key]) && filled(remote[key])) r[key] = remote[key];
  }
  r.created = [local.created, remote.created].filter(Boolean).sort()[0] || '';
  r.tags = [...new Set([...local.tags, ...remote.tags])];
  r.notes = mergeText(local.notes, remote.notes);
  r.visits = unionBy(local.visits, remote.visits, (v) => JSON.stringify([v.date, v.rating, [...v.people].sort(), v.notes]));
  r.dishes = unionBy(local.dishes, remote.dishes, (m) => m.name.trim().toLowerCase(), (l, m) => ({
    ...l,
    rating: l.rating || m.rating,
    price: l.price || m.price,
    notes: mergeText(l.notes, m.notes),
    image: l.image || m.image,
  }));
  r.photos = unionBy(local.photos, remote.photos, (p) => p.file, (l, p) => ({ ...l, title: l.title || p.title, date: l.date || p.date }));
  return r;
}

export function mergeMarkdown(path, localText, remoteText) {
  return toMarkdown(mergeRestaurants(fromMarkdown(path, localText), fromMarkdown(path, remoteText)));
}

// Meters between two {lat, lon}.
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371e3 * Math.asin(Math.sqrt(h));
}

// Restaurant names compared loosely: case, accents, apostrophes, "&"/"and"
// and a leading "The" don't matter.
export function nameKey(name) {
  return str(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}

// Whether a place's name fits what was searched for: every word typed (but
// "the", "and"…) starts a word of the name, or the other way round for longer
// words ("calhoun" finds "Calhoun's", "bbq" doesn't find "Waffle House").
const LITTLE_WORDS = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'on', 'in']);
export function nameMatches(query, name) {
  const words = nameKey(query).split(' ').filter((w) => w && !LITTLE_WORDS.has(w));
  if (!words.length) return true;
  const have = nameKey(name).split(' ');
  return words.every((w) => have.some((h) => h.startsWith(w) || (h.length >= 4 && w.startsWith(h))));
}

const sameName = (a, b) => a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
const streetKey = (address) => nameKey(str(address).split(',')[0]);

// The journal restaurant that is this place (from a place search), if any:
// a similar name and within 250 m, or, without coordinates, the same name
// and street address. Chains are told apart by where they are.
export function findInJournal(place, restaurants) {
  const name = nameKey(place.name);
  if (!name) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const r of restaurants) {
    if (!sameName(name, nameKey(r.name))) continue;
    if (r.lat !== null && r.lon !== null && Number.isFinite(place.lat)) {
      const d = distance(place, r);
      if (d <= 250 && d < bestDistance) { best = r; bestDistance = d; }
    } else if (bestDistance === Infinity && r.address && streetKey(r.address) === streetKey(place.street ?? place.address)) {
      best = r;
    }
  }
  return best;
}
