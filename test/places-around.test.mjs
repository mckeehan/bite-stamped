// placesAround (app/js/places.js): every business close by, from one
// Overpass request, with a fake Overpass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placesAround } from '../app/js/places.js';

const HERE = { lat: 36.3269, lon: -82.8351 };

function fakeOverpass(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: String(opts.body) });
    const next = responses.shift();
    return { ok: next.status === 200, status: next.status, json: async () => next.body };
  };
  return calls;
}

const ELEMENTS = [
  { type: 'node', id: 1, lat: 36.3270, lon: -82.8351, tags: { name: 'Marathon', amenity: 'fuel' } },
  { type: 'way', id: 2, center: { lat: 36.3290, lon: -82.8351 }, tags: { name: 'The Crossing Church', amenity: 'place_of_worship', 'addr:housenumber': '12', 'addr:street': 'Main Street', 'addr:city': 'Baileyton', website: 'https://example.com' } },
  { type: 'node', id: 3, lat: 36.3275, lon: -82.8351, tags: { name: 'Pizza Plus', amenity: 'restaurant', cuisine: 'pizza;italian' } },
  { type: 'node', id: 4, lat: 36.3271, lon: -82.8351, tags: { name: 'Big Lot', amenity: 'parking' } },
  { type: 'node', id: 5, lat: 36.3271, lon: -82.8351, tags: { amenity: 'bank' } },
  { type: 'node', id: 6, lat: 36.3280, lon: -82.8351, tags: { name: 'Apex Bank', amenity: 'bank' } },
];

test('lists named places of every kind, closest first, in the shape of a Nominatim result', async () => {
  const calls = fakeOverpass([{ status: 200, body: { elements: ELEMENTS } }]);
  const places = await placesAround(HERE, 600);
  assert.equal(calls.length, 1);
  assert.match(decodeURIComponent(calls[0].body), /around:600,36\.326900,-82\.835100/);
  assert.deepEqual(places.map((p) => p.name), ['Marathon', 'Pizza Plus', 'Apex Bank', 'The Crossing Church']);
  const church = places.find((p) => p.name === 'The Crossing Church');
  assert.equal(church.id, 'way2');
  assert.equal(church.kind, 'place of worship');
  assert.equal(church.street, '12 Main Street');
  assert.equal(church.city, 'Baileyton');
  assert.equal(church.website, 'https://example.com');
  assert.equal(church.lat, 36.3290);
  assert.ok(church.distance > 200 && church.distance < 250);
  const pizza = places.find((p) => p.name === 'Pizza Plus');
  assert.equal(pizza.food, true);
  assert.equal(pizza.cuisine, 'pizza, italian');
});

test('a busy server is asked once more', async () => {
  const calls = fakeOverpass([{ status: 504, body: null }, { status: 200, body: { elements: ELEMENTS.slice(0, 1) } }]);
  const places = await placesAround({ lat: 35, lon: -83 }, 600);
  assert.equal(calls.length, 2);
  assert.deepEqual(places.map((p) => p.name), ['Marathon']);
});
