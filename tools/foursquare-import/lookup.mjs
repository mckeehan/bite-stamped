// Looks up what the export doesn't have about each venue: address, town,
// state, kind of place, phone, website. Two sources:
// - foursquare: Foursquare's Places API, place details by the venue's id (the
//   ids in the export still work). Best data; each call is billed by Foursquare
//   (a "Pro" call). Needs FOURSQUARE_API_KEY.
// - nominatim: OpenStreetMap's reverse geocoding at where the check-ins were.
//   Free, but only the address (no kind of place), and at most one request
//   a second, as its usage policy asks.
// Answers are kept in a cache file, so running the import again asks nothing twice.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { toPlace } from '../../server/places.js';
import { venuePosition } from './convert.mjs';

const FSQ = 'https://places-api.foursquare.com/places/';
const FSQ_VERSION = '2025-06-17';
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'bite-stamped-foursquare-import (+https://github.com/mckeehan/bite-stamped)';

// The cache: { venues: { <id>: { foursquare: {info}, nominatim: {info} } } },
// info null when the source doesn't know the venue.
export function openCache(path) {
  let data = { venues: {} };
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  data.venues ||= {};
  return {
    get: (id, source) => data.venues[id]?.[source],
    set: (id, source, info) => { (data.venues[id] ||= {})[source] = { info, at: new Date().toISOString() }; },
    save: () => {
      if (!path) return;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(data));
    },
  };
}

// Foursquare's answer → the fields of a place.
export function fromFoursquare(hit) {
  const p = toPlace(hit);
  return {
    name: p.name, type: p.type, cuisine: p.cuisine, food: p.food,
    address: p.street, city: p.city, state: p.state, country: countryName(p.countryCode) || p.country, countryCode: p.countryCode,
    lat: Number.isFinite(p.lat) ? p.lat : undefined, lon: Number.isFinite(p.lon) ? p.lon : undefined,
    website: p.website, phone: p.phone, closed: hit.date_closed || '',
  };
}

// "US" → "United States", as the app's own place search writes it.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  try { return code ? regionNames.of(code) : ''; } catch { return ''; }
}

// Nominatim's answer → the address fields (the kind of place stays unknown).
export function fromNominatim(hit) {
  const a = hit?.address;
  if (!a) return null;
  const region = (a['ISO3166-2-lvl4'] || '').split('-')[1];
  return {
    address: [a.house_number, a.road].filter(Boolean).join(' '),
    city: a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || '',
    state: region && /^[A-Z]{2}$/.test(region) ? region : a.state || '',
    country: a.country || '',
    countryCode: (a.country_code || '').toUpperCase(),
  };
}

/**
 * venues: [{ id, checkins }] → Map id → details (null: not found).
 * mode: 'foursquare' | 'nominatim' | 'none'. Foursquare misses go to Nominatim.
 */
export async function lookUpVenues(venues, { mode, apiKey, cache, fetch: doFetch = fetch, log = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), concurrency = 4 }) {
  const info = new Map();
  if (mode === 'none') return info;
  const counts = { cached: 0, foursquare: 0, nominatim: 0, failed: 0 };

  // Foursquare first (when asked to), a few at a time; what it doesn't know
  // (or can't answer) goes to Nominatim.
  const toNominatim = [];
  const ask = [];
  for (const v of venues) {
    const hit = mode === 'foursquare' ? cache.get(v.id, 'foursquare') : undefined;
    if (hit?.info) { info.set(v.id, hit.info); counts.cached++; }
    else if (hit || mode !== 'foursquare') toNominatim.push(v);
    else ask.push(v);
  }
  const total = ask.length;
  let done = 0;
  let stop = '';
  const worker = async () => {
    while (ask.length && !stop) {
      const v = ask.shift();
      let res = null;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await doFetch(FSQ + encodeURIComponent(v.id), {
            headers: { Authorization: `Bearer ${apiKey}`, 'X-Places-Api-Version': FSQ_VERSION, Accept: 'application/json' },
            signal: AbortSignal.timeout(15_000),
          });
        } catch { res = null; }
        if ((res && res.status < 500) || attempt >= 2) break; // retry network errors and 5xx
        await wait(5000 * (attempt + 1));
      }
      if (res?.ok) {
        const d = fromFoursquare(await res.json());
        cache.set(v.id, 'foursquare', d);
        info.set(v.id, d);
        counts.foursquare++;
      } else {
        if (res && (res.status === 404 || res.status === 400)) cache.set(v.id, 'foursquare', null); // not there: don't ask again
        else if (res && [401, 403, 429].includes(res.status)) {
          stop ||= `Foursquare answered ${res.status}${res.status === 429 ? ' (too many requests, or out of calls)' : ' (check FOURSQUARE_API_KEY)'}; stopped asking it.`;
        } else counts.failed++;
        toNominatim.push(v);
      }
      if (++done % 25 === 0) { cache.save(); log(`  Foursquare: ${done} of ${total}`); }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  toNominatim.push(...ask); // left over after a stop
  cache.save();
  if (stop) log(stop);

  // Nominatim, one request a second.
  let n = 0;
  for (const v of toNominatim) {
    const hit = cache.get(v.id, 'nominatim');
    if (hit) { if (hit.info) { info.set(v.id, hit.info); counts.cached++; } continue; }
    const pos = venuePosition(v);
    if (!pos) continue;
    if (n++) await wait(1100);
    try {
      const params = new URLSearchParams({ format: 'jsonv2', lat: String(pos.lat), lon: String(pos.lon), zoom: '18', addressdetails: '1' });
      const res = await doFetch(`${NOMINATIM}?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) { counts.failed++; continue; }
      const d = fromNominatim(await res.json());
      cache.set(v.id, 'nominatim', d);
      if (d) { info.set(v.id, d); counts.nominatim++; }
    } catch {
      counts.failed++;
    }
    if (n % 25 === 0) { cache.save(); log(`  OpenStreetMap: ${n} of ${toNominatim.length}`); }
  }
  cache.save();
  log(`Looked up: ${counts.foursquare} on Foursquare, ${counts.nominatim} on OpenStreetMap, ${counts.cached} from the cache` +
    (counts.failed ? `, ${counts.failed} failed (run again to retry)` : ''));
  return info;
}
