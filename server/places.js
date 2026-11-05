// Fallback place search through Foursquare's Places API, for when OpenStreetMap
// (searched by the app itself) has nothing. Only on when FOURSQUARE_API_KEY is
// set; the key stays on the server, and only signed-in users can search.
// API: https://docs.foursquare.com/fsq-developers-places/reference/place-search

import { json, HttpError } from './http.js';

const ENDPOINT = 'https://places-api.foursquare.com/places/search';
const API_VERSION = '2025-06-17';
const FOOD = /restaurant|food|caf[eé]|coffee|bakery|bar\b|pub|diner|pizz|grill|steak|burger|taco|sushi|bistro|brewery|tea|dessert|ice cream|joint|kitchen|eatery|deli|bbq|barbecue|noodle|ramen/i;

// Each call is billed by Foursquare, so each user gets a modest number per hour.
const PER_HOUR = 60;

export function createPlaces({ apiKey, fetch: doFetch = (...a) => fetch(...a) }) {
  const calls = new Map(); // email → recent call times

  function limit(email) {
    const now = Date.now();
    const recent = (calls.get(email) || []).filter((t) => now - t < 60 * 60_000);
    if (recent.length >= PER_HOUR) throw new HttpError(429, { error: 'Too many searches. Try again later.' });
    recent.push(now);
    calls.set(email, recent);
  }

  async function search(url, user) {
    if (!apiKey) throw new HttpError(404, { error: 'Not found' });
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > 100) throw new HttpError(400, { error: 'Search text is missing or too long' });
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const hasPlace = url.searchParams.has('lat') && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    // anywhere=1 (places to try): the location only ranks results, it doesn't limit them.
    const anywhere = url.searchParams.get('anywhere') === '1';
    limit(user.email);

    const params = new URLSearchParams({ query: q, limit: '20' });
    if (hasPlace) {
      // Rounded to about 100 m: enough to rank what is close.
      params.set('ll', `${lat.toFixed(3)},${lon.toFixed(3)}`);
      if (!anywhere) params.set('radius', '50000');
    }
    let res;
    try {
      res = await doFetch(`${ENDPOINT}?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}`, 'X-Places-Api-Version': API_VERSION, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new HttpError(502, { error: 'Place search is not available right now' });
    }
    if (!res.ok) {
      console.warn(`[bite-stamped] Foursquare search failed: HTTP ${res.status}`);
      throw new HttpError(502, { error: 'Place search is not available right now' });
    }
    const data = await res.json();
    return json({ places: (data.results || []).map(toPlace).filter((p) => p.name && Number.isFinite(p.lat)) });
  }

  return { enabled: Boolean(apiKey), search };
}

// Same shape as the app's OpenStreetMap results (app/js/places.js).
export function toPlace(hit) {
  const loc = hit.location || {};
  const categories = (hit.categories || []).map((c) => c.name).filter(Boolean);
  const street = loc.address || '';
  const city = loc.locality || '';
  return {
    id: `fsq:${hit.fsq_place_id}`,
    source: 'foursquare',
    food: categories.some((c) => FOOD.test(c)),
    name: hit.name || '',
    kind: (categories[0] || '').toLowerCase(),
    address: [street, [loc.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    street,
    city,
    state: loc.region || '',
    country: loc.country || '',
    countryCode: (loc.country || '').length === 2 ? loc.country.toUpperCase() : '',
    lat: Number(hit.latitude),
    lon: Number(hit.longitude),
    website: hit.website || '',
    phone: hit.tel || '',
    cuisine: categories.map((c) => c.replace(/\s+(Restaurant|Place|Joint|Shop)$/i, '')).filter((c) => !/^(Restaurant|Food)$/i.test(c)).join(', '),
    display: loc.formatted_address || '',
  };
}
