// Place search through OpenStreetMap's Nominatim (free, no key), only while
// online and only on the "new restaurant" screen; everything else is local.
// Usage policy (at most one request per second, no search-as-you-type):
// https://operations.osmfoundation.org/policies/nominatim/

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// Requests go out one at a time, at least 1.1 s apart.
let queue = Promise.resolve();
let lastRequest = 0;
function nominatim(params) {
  const run = async () => {
    const wait = lastRequest + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    params.set('format', 'jsonv2');
    params.set('addressdetails', '1');
    params.set('extratags', '1');
    params.set('accept-language', navigator.language || 'en');
    const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return (await res.json()).filter((hit) => hit.name).map(toPlace);
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

// Kinds of food places, most common first: the list fills in as each arrives.
const FOOD = ['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe', 'shop=bakery', 'amenity=pub', 'amenity=bar', 'amenity=ice_cream'];

let nearbyCache = null;

// Named food businesses within about 3 km of `near`, closest first.
// `onUpdate` gets the list so far after each kind of place.
export async function nearbyFood(near, onUpdate = () => {}) {
  const key = `${near.lat.toFixed(3)},${near.lon.toFixed(3)}`;
  if (nearbyCache?.key === key && Date.now() - nearbyCache.time < 10 * 60_000) return nearbyCache.places;
  const d = 0.03;
  const viewbox = [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(',');
  const byId = new Map();
  let places = [];
  let failures = 0;
  for (const tag of FOOD) {
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
  if (failures === FOOD.length) throw new Error('Nearby search failed');
  if (!failures) nearbyCache = { key, time: Date.now(), places };
  return places;
}

// Meters between two {lat, lon}.
export function distance(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371e3 * Math.asin(Math.sqrt(h));
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
export function locate() {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => { locate.denied = false; resolve((lastPosition = { lat: p.coords.latitude, lon: p.coords.longitude })); },
      (err) => { locate.denied = err.code === err.PERMISSION_DENIED; resolve(lastPosition); },
      { maximumAge: 10 * 60_000, timeout: 8000 },
    );
  });
}

// Search by name: food places within roughly 30 km first; if there are none,
// anything anywhere. Food places come before other kinds of results.
export async function searchPlaces(query, near = lastPosition) {
  let hits = [];
  if (near) {
    const d = 0.3;
    const viewbox = [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(',');
    hits = await nominatim(new URLSearchParams({ q: query, limit: '20', viewbox, bounded: '1' }));
  }
  if (!hits.length) hits = await nominatim(new URLSearchParams({ q: query, limit: '10' }));
  return hits
    .map((p) => ({ ...p, distance: near ? distance(near, p) : undefined }))
    .sort((a, b) => b.food - a.food || (a.distance ?? 0) - (b.distance ?? 0));
}

const FOOD_TYPES = new Set(FOOD.map((t) => t.split('=')[1]).concat(['food_court', 'biergarten', 'pastry', 'deli', 'confectionery', 'coffee']));

function toPlace(hit) {
  const a = hit.address || {};
  const t = hit.extratags || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality || a.suburb || '';
  return {
    id: `${hit.osm_type}${hit.osm_id}`,
    food: FOOD_TYPES.has(hit.type) && ['amenity', 'shop'].includes(hit.category),
    name: hit.name || hit.display_name.split(',')[0],
    kind: (hit.type || '').replace(/_/g, ' '),
    address: [street, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    street,
    city,
    state: a.state || '',
    country: a.country || '',
    countryCode: (a.country_code || '').toUpperCase(),
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    website: t.website || t['contact:website'] || '',
    phone: t.phone || t['contact:phone'] || '',
    cuisine: (t.cuisine || '').split(';').map((c) => c.trim().replace(/_/g, ' ')).filter(Boolean).join(', '),
    display: hit.display_name,
  };
}
