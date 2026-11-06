// Turns a Foursquare / Swarm data export into Bite-Stamped places: one place
// per venue, one visit per check-in. Pure functions (no network, no files), so
// the tests can run them; import.mjs reads the files and looks venues up.
//
// What the export has (checkins*.json, lists.json, tips.json, photos*.json, pix/):
// - a check-in: when (UTC, plus the time zone offset in minutes), the venue
//   (id, name, link only) and where the phone was; sometimes a "shout" (text)
// - lists: venues saved to a list ("Wishlist"), which become places to try
// - tips: text written about a venue, which goes into the place's notes
// - photos: images taken with a check-in, attached to the place they were taken at

import {
  newRestaurant, placePath, mediaDir, findInJournal, mergeRestaurants, isFoodPlace,
  isPlaceFile, fromMarkdown, toMarkdown, sortVisits,
} from '../../app/js/model.js';

const decode = (bytes) => new TextDecoder().decode(bytes);
const baseName = (path) => path.split('/').pop();

// "2026-04-17 12:26:27.000000" (UTC) or seconds since 1970 → milliseconds.
export function utcMillis(createdAt) {
  if (typeof createdAt === 'number') return createdAt * 1000;
  const m = String(createdAt ?? '').match(/^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(?::\d\d)?)/);
  return m ? Date.parse(`${m[1]}T${m[2]}Z`) : NaN;
}

// The local date and time of a moment, as visits store it: 2026-04-17T08:26.
export function localTime(ms, offsetMinutes = 0) {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

// A visit date as minutes, for comparing visits (both in local time).
const visitMinutes = (date) => Date.parse(`${date.length === 10 ? `${date}T00:00` : date.slice(0, 16)}Z`) / 60_000;

// [{ path, bytes }] (a folder or ZIP) → what the export holds.
export function parseExport(files) {
  const json = (name) => {
    const f = files.find((x) => baseName(x.path) === name);
    return f ? JSON.parse(decode(f.bytes)) : null;
  };
  const numbered = (prefix) => files
    .filter((f) => new RegExp(`^${prefix}\\d+\\.json$`).test(baseName(f.path)))
    .flatMap((f) => JSON.parse(decode(f.bytes)).items || []);

  const checkins = numbered('checkins');
  if (!checkins.length) throw new Error('No check-ins found (checkins1.json, checkins2.json…). Is this a Foursquare data export?');
  const lists = (json('lists.json')?.items || []).map((l) => ({
    name: l.name || '',
    venues: (l.listItems?.items || []).map((i) => i.venue).filter((v) => v?.id),
  }));
  const tips = (json('tips.json')?.items || []).filter((t) => t.venue?.id && t.text);
  const pix = new Map(files.filter((f) => f.path.split('/').includes('pix')).map((f) => [baseName(f.path), f.bytes]));
  // A photo's file in pix/ is named after the end of its link, with the user id in front.
  const photos = numbered('photos').map((p) => {
    const tail = baseName(p.suffix || p.fullUrl || '');
    const file = pix.has(tail) ? tail : [...pix.keys()].find((k) => k.endsWith(`_${tail}`));
    return { id: p.id, ms: utcMillis(p.createdAt), bytes: file ? pix.get(file) : null, ext: (tail.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase() };
  });
  return { checkins, lists, tips, photos };
}

// Check-ins grouped by venue: Map id → { id, name, url, location?, categories?, checkins }.
// Check-ins at the same venue less than an hour apart count as one visit.
export function collectVenues(checkins, { since = '' } = {}) {
  const venues = new Map();
  const sinceMs = since ? Date.parse(`${since}T00:00Z`) : -Infinity;
  for (const c of checkins) {
    if (!c.venue?.id) continue; // a check-in without a place
    const ms = utcMillis(c.createdAt);
    if (!Number.isFinite(ms)) continue;
    const offset = Number(c.timeZoneOffset) || 0;
    if (ms + offset * 60_000 < sinceMs) continue;
    let v = venues.get(c.venue.id);
    if (!v) {
      v = { id: c.venue.id, name: c.venue.name || '', url: c.venue.url || '', location: c.venue.location, categories: c.venue.categories, checkins: [] };
      venues.set(v.id, v);
    }
    v.checkins.push({
      id: c.id, ms, offset, date: localTime(ms, offset), notes: (c.shout || '').trim(),
      lat: Number.isFinite(c.lat) ? c.lat : c.venue.location?.lat, lon: Number.isFinite(c.lng) ? c.lng : c.venue.location?.lng,
    });
  }
  for (const v of venues.values()) {
    v.checkins.sort((a, b) => a.ms - b.ms);
    const visits = [];
    for (const c of v.checkins) {
      const last = visits.at(-1);
      if (last && c.ms - last.ms < 60 * 60_000) {
        if (c.notes && !last.notes.includes(c.notes)) last.notes = [last.notes, c.notes].filter(Boolean).join('\n');
      } else visits.push({ ...c });
    }
    v.visits = visits;
  }
  return venues;
}

// Where a venue is, from the check-ins (the median, so one far-off check-in
// doesn't move it), or null.
export function venuePosition(venue) {
  const pts = (venue.checkins || []).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
  if (!pts.length) return null;
  const mid = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { lat: mid(pts.map((p) => p.lat)), lon: mid(pts.map((p) => p.lon)) };
}

// Place details from an old-style export, which had them with each venue.
export function infoFromExport(venue) {
  const loc = venue.location;
  if (!loc) return null;
  return {
    address: loc.address || '', city: loc.city || '', state: loc.state || '', country: loc.country || '',
    countryCode: (loc.cc || '').toUpperCase(), lat: loc.lat, lon: loc.lng, type: '', cuisine: '',
    ...(venue.categories?.[0]?.name ? { kind: venue.categories[0].name } : {}),
  };
}

// The journal ([{ path, bytes }] of an export ZIP or the server's files folder) → places.
export function parseJournal(files) {
  const top = files.some((f) => isPlaceFile(f.path)) ? '' : (files[0]?.path.split('/')[0] ?? '') + '/';
  return files
    .map((f) => ({ ...f, path: f.path.startsWith(top) ? f.path.slice(top.length) : f.path }))
    .filter((f) => isPlaceFile(f.path))
    .map((f) => fromMarkdown(f.path, decode(f.bytes)));
}

// Whether a check-in is already one of the place's visits: the same day for a
// visit without a time, otherwise within two hours.
function knownVisit(visits, visit) {
  return visits.find((v) => (v.date.length === 10
    ? v.date === visit.date.slice(0, 10)
    : Math.abs(visitMinutes(v.date) - visitMinutes(visit.date)) <= 120));
}

/**
 * Builds the files for the ZIP.
 * venues: from collectVenues; info: Map venue id → looked-up details (or null);
 * journal: the places there are already; options: { minCheckins, food, lists }.
 * → { files: [{ path, data }], counts, skipped }
 */
export function buildPlaces({ venues, lists = [], tips = [], photos = [], info = new Map(), journal = [], options = {} }) {
  const { minCheckins = 1, food = false, toTryLists = null } = options;
  const stamp = new Date().toISOString();
  const taken = new Set(journal.map((r) => r.path));
  const changed = new Map(); // path → place, for the output
  const media = [];          // images for the output: { path, data }
  const places = [...journal]; // matched against as we go, new places too
  const counts = { newPlaces: 0, updatedPlaces: 0, visits: 0, knownVisits: 0, toTry: 0, photos: 0, tips: 0 };
  const skipped = { fewCheckins: 0, notFood: 0 };

  // Each photo goes with the check-in it was taken at: the latest one up to
  // three hours before it.
  const allCheckins = [...venues.values()].flatMap((v) => v.checkins.map((c) => ({ ...c, venue: v.id }))).sort((a, b) => a.ms - b.ms);
  const photosOf = new Map();
  for (const p of photos) {
    if (!p.bytes || !Number.isFinite(p.ms)) continue;
    let at = null;
    for (const c of allCheckins) { if (c.ms > p.ms) break; at = c; }
    if (!at || p.ms - at.ms > 3 * 3600_000) continue;
    if (!photosOf.has(at.venue)) photosOf.set(at.venue, []);
    photosOf.get(at.venue).push({ ...p, date: localTime(p.ms, at.offset).slice(0, 10) });
  }

  const fieldsOf = (venue) => {
    const d = info.get(venue.id) || infoFromExport(venue) || {};
    const pos = Number.isFinite(d.lat) ? { lat: d.lat, lon: d.lon } : venuePosition(venue);
    return {
      name: d.name || venue.name || 'Unnamed place',
      type: d.type || '', cuisine: d.cuisine || '',
      address: d.address || '', city: d.city || '', state: d.state || '', country: d.country || '', countryCode: d.countryCode || '',
      website: d.website || '', phone: d.phone || '',
      lat: pos?.lat ?? null, lon: pos?.lon ?? null,
      foursquareId: venue.id,
      tags: d.closed ? ['closed'] : [],
      known: Boolean(info.get(venue.id)),
      food: d.food,
    };
  };

  const add = (venue, { visits = [], toTry = false }) => {
    const { known, food: isFood, ...fields } = fieldsOf(venue);
    // Only places to eat and drink: leaves out those known not to be.
    if (food && known && !isFood && !isFoodPlace(fields)) { skipped.notFood++; return; }
    const venueTips = tips.filter((t) => t.venue.id === venue.id)
      .map((t) => `Foursquare tip (${localTime(utcMillis(t.createdAt)).slice(0, 10)}): ${t.text.trim()}`);
    const venuePhotos = photosOf.get(venue.id) || [];

    const existing = places.find((r) => r.foursquareId === venue.id)
      || findInJournal({ name: fields.name, lat: fields.lat ?? NaN, lon: fields.lon ?? NaN, street: fields.address }, places);
    let r;
    let newVisits = visits.map((v) => ({ date: v.date, rating: 0, people: [], notes: v.notes }));
    if (existing) {
      const original = JSON.stringify(existing);
      r = changed.get(existing.path) || { ...existing, visits: existing.visits.map((v) => ({ ...v })) };
      const fresh = [];
      for (const v of newVisits) {
        const same = knownVisit(r.visits, v);
        if (!same) { fresh.push(v); continue; }
        counts.knownVisits++;
        if (v.notes && !same.notes) same.notes = v.notes; // the check-in's text
      }
      newVisits = fresh;
      const notes = venueTips.filter((t) => !r.notes.includes(t));
      const pics = venuePhotos.filter((p) => !r.photos.some((x) => x.file.endsWith(`foursquare-${p.id}.${p.ext}`)));
      r = mergeRestaurants(r, { ...newRestaurant(fields), created: '', visits: newVisits, notes: notes.join('\n\n') });
      // Checked in after it went on the to-try list: it has been visited.
      if (r.toTry && newVisits.some((v) => v.date.slice(0, 10) >= (existing.created || '').slice(0, 10))) r.toTry = false;
      for (const p of pics) { const e = photoEntry(r.path, p); r.photos.push(e); media.push({ path: e.file, data: p.bytes }); }
      if (!changed.has(r.path)) {
        if (JSON.stringify(r) === original) return; // nothing new
        counts.updatedPlaces++;
      }
      Object.assign(counts, { visits: counts.visits + newVisits.length, photos: counts.photos + pics.length, tips: counts.tips + notes.length });
      places[places.indexOf(existing)] = r;
    } else {
      const first = visits[0];
      r = newRestaurant({
        ...fields,
        toTry: toTry && !visits.length,
        visits: newVisits,
        notes: venueTips.join('\n\n'),
        created: first ? new Date(first.ms).toISOString() : stamp,
      });
      r.path = placePath(r, taken);
      taken.add(r.path);
      for (const p of venuePhotos) { const e = photoEntry(r.path, p); r.photos.push(e); media.push({ path: e.file, data: p.bytes }); }
      places.push(r);
      counts.newPlaces++;
      if (r.toTry) counts.toTry++;
      Object.assign(counts, { visits: counts.visits + newVisits.length, photos: counts.photos + venuePhotos.length, tips: counts.tips + venueTips.length });
    }
    r.visits = sortVisits(r.visits);
    r.updated = stamp;
    changed.set(r.path, r);
  };

  for (const venue of venues.values()) {
    if (venue.checkins.length < minCheckins) { skipped.fewCheckins++; continue; }
    add(venue, { visits: venue.visits });
  }
  // Saved to a list but never checked in at (or filtered out above): places to try.
  for (const list of lists) {
    if (toTryLists && !toTryLists.some((n) => n.toLowerCase() === list.name.toLowerCase())) continue;
    for (const v of list.venues) {
      if (venues.has(v.id) && venues.get(v.id).checkins.length >= minCheckins) continue;
      add({ id: v.id, name: v.name, url: v.url, location: v.location, checkins: [] }, { toTry: true });
    }
  }

  const files = [...[...changed.values()].map((r) => ({ path: r.path, data: toMarkdown(r) })), ...media];
  return { files: files.sort((a, b) => a.path.localeCompare(b.path)), counts, skipped };
}

function photoEntry(path, p) {
  return { file: `${mediaDir(path)}foursquare-${p.id}.${p.ext}`, title: '', date: p.date };
}
