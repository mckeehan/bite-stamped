// Place search through OpenStreetMap's Nominatim (free, no key), only while
// online and only on the "new place" screen; everything else is local.
// Usage policy (at most one request per second, no search-as-you-type):
// https://operations.osmfoundation.org/policies/nominatim/

import { distance, nameMatches, typeFromKind } from './model.js';

const SERVER = 'https://nominatim.openstreetmap.org';

// Requests go out one at a time, at least 1.1 s apart.
let queue = Promise.resolve();
let lastRequest = 0;
function request(path, params) {
  const run = async () => {
    const wait = lastRequest + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    params.set('format', 'jsonv2');
    params.set('addressdetails', '1');
    params.set('accept-language', navigator.language || 'en');
    const res = await fetch(`${SERVER}/${path}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return res.json();
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

async function nominatim(params) {
  params.set('extratags', '1');
  return (await request('search', params)).filter((hit) => hit.name).map(toPlace);
}

// The street address at a point, for places found elsewhere (Foursquare) that
// come with a location but no address: { street, city, state, country,
// countryCode, postcode }, or null if there is none.
export async function addressAt({ lat, lon }) {
  const hit = await request('reverse', new URLSearchParams({ lat: String(lat), lon: String(lon), zoom: '18' }));
  if (!hit || hit.error || !hit.address) return null;
  return addressParts(hit.address);
}

function addressParts(a) {
  return {
    street: [a.house_number, a.road].filter(Boolean).join(' '),
    city: a.city || a.town || a.village || a.municipality || a.suburb || '',
    state: a.state || '',
    country: a.country || '',
    countryCode: (a.country_code || '').toUpperCase(),
    postcode: a.postcode || '',
  };
}

// Kinds of places listed nearby, most common first: the list fills in as each
// arrives. Food and drink, and things to see.
const FOOD = ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe', 'shop=bakery', 'amenity=pub', 'amenity=bar', 'amenity=ice_cream'];
const NEARBY = [...FOOD, 'craft=brewery', 'tourism=museum', 'tourism=attraction'];

const nearbyCache = new Map(); // "lat,lon/size" → { time, places }, for 10 minutes

// Named places of those kinds within about 3 km of `near` (or `size` degrees
// either way: 0.005 is about 500 m), closest first.
// `onUpdate` gets the list so far after each kind of place.
export async function nearbyPlaces(near, onUpdate = () => {}, { size = 0.03 } = {}) {
  const key = `${near.lat.toFixed(3)},${near.lon.toFixed(3)}/${size}`;
  const cached = nearbyCache.get(key);
  if (cached && Date.now() - cached.time < 10 * 60_000) return cached.places;
  const d = size;
  const viewbox = [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(',');
  const byId = new Map();
  let places = [];
  let failures = 0;
  for (const tag of NEARBY) {
    try {
      const hits = await nominatim(new URLSearchParams({ q: `[${tag}]`, viewbox, bounded: '1', limit: '40' }));
      for (const hit of hits) byId.set(hit.id, { ...hit, distance: distance(near, hit) });
    } catch {
      failures++;
      continue;
    }
    places = [...byId.values()].sort((a, b) => a.distance - b.distance);
    onUpdate(places);
  }
  if (failures === NEARBY.length) throw new Error('Nearby search failed');
  if (!failures) {
    if (nearbyCache.size >= 6) nearbyCache.delete(nearbyCache.keys().next().value);
    nearbyCache.set(key, { time: Date.now(), places });
  }
  return places;
}

const MILE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

export function formatDistance(m) {
  let region = '';
  try { region = new Intl.Locale(navigator.language).maximize().region; } catch {}
  if (MILE_REGIONS.has(region)) {
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} ${mi >= 0.95 && mi < 1.05 ? 'mile' : 'miles'}`;
  }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

let lastPosition = null;

// Resolves to {lat, lon}, or null with locate.denied set when the user said no.
// A position up to 10 minutes old will do, unless `fresh` (e.g. to refresh).
export function locate({ fresh = false } = {}) {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => { locate.denied = false; resolve((lastPosition = { lat: p.coords.latitude, lon: p.coords.longitude })); },
      (err) => { locate.denied = err.code === err.PERMISSION_DENIED; resolve(lastPosition); },
      { maximumAge: fresh ? 0 : 10 * 60_000, timeout: 8000, enableHighAccuracy: fresh },
    );
  });
}

// Search by name: within roughly 30 km first; if there is nothing, anywhere.
// Places (businesses, sights…) come before streets and towns.
// With `anywhere` (places to try, maybe far away): one search over the whole
// map (nothing is left out for being far), closest first.
export async function searchPlaces(query, near = lastPosition, { anywhere = false } = {}) {
  if (anywhere) {
    const params = new URLSearchParams({ q: query, limit: '20' });
    if (near) params.set('viewbox', [near.lon - 0.3, near.lat + 0.3, near.lon + 0.3, near.lat - 0.3].join(','));
    return (await nominatim(params))
      .map((p) => ({ ...p, distance: near ? distance(near, p) : undefined }))
      .sort((a, b) => b.venue - a.venue || (a.distance ?? 0) - (b.distance ?? 0));
  }
  let hits = [];
  if (near) {
    const d = 0.3;
    const viewbox = [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(',');
    hits = await nominatim(new URLSearchParams({ q: query, limit: '20', viewbox, bounded: '1' }));
  }
  if (!hits.length) hits = await nominatim(new URLSearchParams({ q: query, limit: '10' }));
  return hits
    .map((p) => ({ ...p, distance: near ? distance(near, p) : undefined }))
    .sort((a, b) => b.venue - a.venue || (a.distance ?? 0) - (b.distance ?? 0));
}

// Fallback when OpenStreetMap has nothing: Foursquare, through this app's own
// server, which holds the API key. `apiBase` is where the app's API lives.
// Text after a comma is the town to search in.
const fallbackCache = new Map();
export async function fallbackSearch(query, apiBase, near = lastPosition, { anywhere = false } = {}) {
  const key = `${query.toLowerCase()}@${near ? `${near.lat.toFixed(2)},${near.lon.toFixed(2)}` : ''}${anywhere ? '*' : ''}`;
  if (fallbackCache.has(key)) return fallbackCache.get(key);
  // "The Dillard House, Dillard GA": the name, and the town to search in.
  const comma = query.indexOf(',');
  const town = comma > 0 ? query.slice(comma + 1).trim() : '';
  const params = new URLSearchParams({ q: town ? query.slice(0, comma).trim() : query });
  if (town) params.set('near', town);
  if (near) { params.set('lat', near.lat.toFixed(3)); params.set('lon', near.lon.toFixed(3)); }
  if (anywhere) params.set('anywhere', '1');
  const res = await fetch(`${apiBase}/api/places/search?${params}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  // Foursquare also returns places that only share a word or two, or none,
  // with what was typed; those are left out.
  const places = (await res.json()).places
    .filter((p) => nameMatches(params.get('q'), p.name))
    .map((p) => ({ ...p, distance: near ? distance(near, p) : undefined }))
    .sort((a, b) => b.venue - a.venue || (a.distance ?? 0) - (b.distance ?? 0));
  fallbackCache.set(key, places);
  return places;
}

const FOOD_TYPES = new Set(FOOD.map((t) => t.split('=')[1]).concat(['food_court', 'biergarten', 'pastry', 'deli', 'confectionery', 'coffee']));
// OpenStreetMap categories of places one visits (not roads, towns or rivers).
const VENUE_CATEGORIES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft', 'historic', 'club']);

function toPlace(hit) {
  const t = hit.extratags || {};
  const { street, city, state, country, countryCode, postcode } = addressParts(hit.address || {});
  return {
    id: `${hit.osm_type}${hit.osm_id}`,
    venue: VENUE_CATEGORIES.has(hit.category),
    food: FOOD_TYPES.has(hit.type) && ['amenity', 'shop'].includes(hit.category),
    type: VENUE_CATEGORIES.has(hit.category) ? typeFromKind(hit.type) : '',
    name: hit.name || hit.display_name.split(',')[0],
    kind: (hit.type || '').replace(/_/g, ' '),
    address: [street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    street,
    city,
    state,
    country,
    countryCode,
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    website: t.website || t['contact:website'] || '',
    phone: t.phone || t['contact:phone'] || '',
    cuisine: (t.cuisine || '').split(';').map((c) => c.trim().replace(/_/g, ' ')).filter(Boolean).join(', '),
    display: hit.display_name,
  };
}
