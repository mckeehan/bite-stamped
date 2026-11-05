// The Foursquare fallback search behind /api/places/search, with a fake
// Foursquare: off without a key, sign-in only, key and location handling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, deviceFetch } from './helpers.mjs';

const W = { 'X-Bite-Stamped': '1', 'Content-Type': 'application/json' };
const post = (f, path, body) => f(path, { method: 'POST', headers: W, body: JSON.stringify(body) });

async function signIn(srv, email = 'me@example.com') {
  const f = deviceFetch(srv.app);
  await post(f, '/api/auth/start', { email });
  await post(f, '/api/auth/verify', { email, code: srv.codes.get(email) });
  return f;
}

const SAMPLE = {
  results: [{
    fsq_place_id: 'abc123',
    name: 'Calhoun’s on the River',
    latitude: 35.9606,
    longitude: -83.9207,
    categories: [{ name: 'BBQ Joint' }, { name: 'American Restaurant' }],
    location: { address: '400 Neyland Dr', locality: 'Knoxville', region: 'TN', postcode: '37902', country: 'US', formatted_address: '400 Neyland Dr, Knoxville, TN 37902' },
    tel: '(865) 673-3355',
    website: 'https://example.com/calhouns',
  }, { fsq_place_id: 'no-coords', name: 'Nowhere' }],
};

function fakeFoursquare() {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url: new URL(url), headers: opts.headers });
    return new Response(JSON.stringify(SAMPLE), { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetch };
}

test('without a key the fallback search is off', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  assert.equal((await (await f('/api/auth/me')).json()).fallbackSearch, false);
  assert.equal((await f('/api/places/search?q=tacos')).status, 404);
});

test('with a key: signed-in only, sends the key, rounds the location, maps results', async () => {
  const fsq = fakeFoursquare();
  const srv = testServer({ foursquareKey: 'test-key', fetch: fsq.fetch });

  const anon = deviceFetch(srv.app);
  assert.equal((await (await anon('/api/auth/me')).json()).fallbackSearch, false);
  assert.equal((await anon('/api/places/search?q=calhouns')).status, 401);
  assert.equal(fsq.calls.length, 0);

  const f = await signIn(srv);
  assert.equal((await (await f('/api/auth/me')).json()).fallbackSearch, true);
  const res = await f('/api/places/search?q=calhouns&lat=35.961234&lon=-83.920987');
  assert.equal(res.status, 200);
  const { places } = await res.json();

  const call = fsq.calls[0];
  assert.equal(call.url.origin + call.url.pathname, 'https://places-api.foursquare.com/places/search');
  assert.equal(call.headers.Authorization, 'Bearer test-key');
  assert.equal(call.headers['X-Places-Api-Version'], '2025-06-17');
  assert.equal(call.url.searchParams.get('query'), 'calhouns');
  assert.equal(call.url.searchParams.get('ll'), '35.961,-83.921');

  assert.equal(places.length, 1); // the hit without coordinates is dropped
  assert.deepEqual(places[0], {
    id: 'fsq:abc123', source: 'foursquare', venue: true, food: true, type: 'Restaurant', name: 'Calhoun’s on the River', kind: 'bbq joint',
    address: '400 Neyland Dr, 37902 Knoxville', street: '400 Neyland Dr', city: 'Knoxville', state: 'TN',
    country: 'US', countryCode: 'US', lat: 35.9606, lon: -83.9207, website: 'https://example.com/calhouns',
    phone: '(865) 673-3355', cuisine: 'BBQ, American', display: '400 Neyland Dr, Knoxville, TN 37902',
  });

  assert.equal((await f('/api/places/search?q=')).status, 400);
  assert.equal(fsq.calls.length, 1);
});

test('the key never reaches the browser', async () => {
  const fsq = fakeFoursquare();
  const srv = testServer({ foursquareKey: 'secret-test-key', fetch: fsq.fetch });
  const f = await signIn(srv);
  for (const path of ['/api/auth/me', '/api/places/search?q=x', '/', '/js/app.js']) {
    assert.ok(!(await (await f(path)).text()).includes('secret-test-key'), path);
  }
});

test('nearby searches stay within 50 km; anywhere=1 (places to try) goes to 100 km', async () => {
  const fsq = fakeFoursquare();
  const srv = testServer({ foursquareKey: 'test-key', fetch: fsq.fetch });
  const f = await signIn(srv);
  await f('/api/places/search?q=calhouns&lat=35.96&lon=-83.92');
  await f('/api/places/search?q=calhouns&lat=35.96&lon=-83.92&anywhere=1');
  assert.equal(fsq.calls[0].url.searchParams.get('radius'), '50000');
  assert.equal(fsq.calls[1].url.searchParams.get('radius'), '100000');
  assert.equal(fsq.calls[1].url.searchParams.get('ll'), '35.960,-83.920');
});

test('near=<town> searches in that town; a town Foursquare cannot place falls back to the location', async () => {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.searchParams.get('near') === 'Nowhereville') return new Response('{"message":"bad near"}', { status: 400 });
    return new Response(JSON.stringify(SAMPLE), { headers: { 'Content-Type': 'application/json' } });
  };
  const srv = testServer({ foursquareKey: 'test-key', fetch });
  const f = await signIn(srv);

  const res = await f('/api/places/search?q=The%20Dillard%20House&near=Dillard%20GA&lat=35.96&lon=-83.92');
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('near'), 'Dillard GA');
  assert.equal(calls[0].searchParams.get('query'), 'The Dillard House');
  assert.equal(calls[0].searchParams.get('ll'), null);

  assert.equal((await f('/api/places/search?q=calhouns&near=Nowhereville&lat=35.96&lon=-83.92')).status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].searchParams.get('near'), null);
  assert.equal(calls[2].searchParams.get('ll'), '35.960,-83.920');
});
