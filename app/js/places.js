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

// Where an address is: { lat, lon, exact }, or null when OpenStreetMap
// doesn't know it. `exact` is false when only the street was found (no house
// numbers there on the map): the point is then somewhere along it. Needs a street address (a town alone would put the pin in its middle).
// First the address in its parts, then as one line.
export async function locationOf({ address, city, state, country, countryCode }) {
  const street = String(address || '').trim();
  if (!street) return null;
  const parts = new URLSearchParams({ street, limit: '1' });
  if (city) parts.set('city', city);
  if (state) parts.set('state', state);
  if (country) parts.set('country', country);
  if (countryCode) parts.set('countrycodes', countryCode.toLowerCase());
  let hits = await request('search', parts);
  if (!hits.length) {
    const line = new URLSearchParams({ q: [street, city, state, country].filter(Boolean).join(', '), limit: '1' });
    if (countryCode) line.set('countrycodes', countryCode.toLowerCase());
    hits = await request('search', line);
  }
  const hit = hits[0];
  if (!hit) return null;
  const streetOnly = !hit.address?.house_number && (hit.category === 'highway' || hit.addresstype === 'road');
  return { lat: Number(hit.lat), lon: Number(hit.lon), exact: !streetOnly };
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

// Every named business and place to visit within `meters` of `near` (shops,
// banks, churches, offices, doctors, parks…, and places to eat and drink),
// in one request to OpenStreetMap's Overpass API: Nominatim can only look up
// one kind of place at a time, a second apart. Closest first; the same
// shape and ids as Nominatim's results, without the town (addressAt can
// find it). Usage policy: https://dev.overpass-api.de/overpass-doc/en/preface/commons.html
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const BUSINESS_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'craft', 'office', 'healthcare', 'historic', 'club'];
// Named things that aren't places one goes to.
const NOT_PLACES = {
  amenity: new Set(['parking', 'parking_space', 'parking_entrance', 'bicycle_parking', 'motorcycle_parking', 'bench',
    'waste_basket', 'waste_disposal', 'recycling', 'shelter', 'toilets', 'drinking_water', 'vending_machine', 'atm',
    'telephone', 'post_box', 'charging_station', 'fountain', 'clock', 'loading_dock', 'hunting_stand', 'weighbridge',
    'grit_bin', 'bbq', 'water_point', 'compressed_air', 'letter_box', 'parcel_locker']),
  leisure: new Set(['pitch', 'track', 'swimming_pool', 'picnic_table', 'firepit', 'slipway', 'garden', 'outdoor_seating']),
  tourism: new Set(['information', 'artwork', 'picnic_site']),
  historic: new Set(['memorial', 'wayside_cross', 'boundary_stone', 'milestone']),
};
const aroundCache = new Map(); // "lat,lon/meters" → { time, places }, for 10 minutes

export async function placesAround(near, meters = 600) {
  const key = `${near.lat.toFixed(3)},${near.lon.toFixed(3)}/${meters}`;
  const cached = aroundCache.get(key);
  if (cached && Date.now() - cached.time < 10 * 60_000) return cached.places;
  const around = `around:${Math.round(meters)},${near.lat.toFixed(6)},${near.lon.toFixed(6)}`;
  const query = `[out:json][timeout:25];(${BUSINESS_KEYS.map((k) => `nwr(${around})[name][${k}];`).join('')});out center tags 300;`;
  const ask = () => fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  });
  // A busy server answers 429, 502 or 504 now and then: once more, a little later.
  let res = await ask().catch(() => null);
  if (!res || [429, 502, 503, 504].includes(res.status)) {
    await new Promise((r) => setTimeout(r, 3000));
    res = await ask();
  }
  if (!res.ok) throw new Error(`Overpass failed (${res.status})`);
  const places = [];
  for (const e of (await res.json()).elements || []) {
    const t = e.tags || {};
    const category = BUSINESS_KEYS.find((k) => t[k] && !NOT_PLACES[k]?.has(t[k]));
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (!category || !t.name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const kind = t[category] === 'yes' ? category : t[category];
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const city = t['addr:city'] || '';
    const place = {
      id: `${e.type}${e.id}`,
      venue: true,
      food: FOOD_TYPES.has(kind) && ['amenity', 'shop'].includes(category),
      type: typeFromKind(kind),
      name: t.name,
      kind: kind.replace(/_/g, ' '),
      address: [street, [t['addr:postcode'], city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      street,
      city,
      state: t['addr:state'] || '',
      country: '',
      countryCode: (t['addr:country'] || '').toUpperCase(),
      lat,
      lon,
      website: t.website || t['contact:website'] || '',
      phone: t.phone || t['contact:phone'] || '',
      cuisine: (t.cuisine || '').split(';').map((c) => c.trim().replace(/_/g, ' ')).filter(Boolean).join(', '),
      source: 'overpass',
    };
    places.push({ ...place, distance: distance(near, place) });
  }
  places.sort((a, b) => a.distance - b.distance);
  if (aroundCache.size >= 6) aroundCache.delete(aroundCache.keys().next().value);
  aroundCache.set(key, { time: Date.now(), places });
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
