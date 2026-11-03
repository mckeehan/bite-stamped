// Place search through OpenStreetMap's Nominatim (free, no key). Only used
// while online, and only when the user searches; everything else is local.
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

let lastPosition = null;

export function locate() {
  if (!('geolocation' in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve((lastPosition = { lat: p.coords.latitude, lon: p.coords.longitude })),
      () => resolve(lastPosition),
      { maximumAge: 10 * 60_000, timeout: 8000 },
    );
  });
}

export async function searchPlaces(query, near = lastPosition) {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    extratags: '1',
    limit: '10',
    'accept-language': navigator.language || 'en',
  });
  if (near) {
    // Prefer results within roughly 30 km, without excluding the rest.
    const d = 0.3;
    params.set('viewbox', [near.lon - d, near.lat + d, near.lon + d, near.lat - d].join(','));
  }
  const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return (await res.json()).map(toPlace);
}

function toPlace(hit) {
  const a = hit.address || {};
  const t = hit.extratags || {};
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.municipality || a.suburb || '';
  return {
    name: hit.name || hit.display_name.split(',')[0],
    kind: (hit.type || '').replace(/_/g, ' '),
    address: [street, [a.postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    city,
    state: a.state || '',
    country: a.country || '',
    countryCode: (a.country_code || '').toUpperCase(),
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    website: t.website || t['contact:website'] || '',
    phone: t.phone || t['contact:phone'] || '',
    cuisine: (t.cuisine || '').split(';').map((c) => c.replace(/_/g, ' ')).join(', '),
    display: hit.display_name,
  };
}
