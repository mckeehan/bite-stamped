// The Foursquare export importer (tools/foursquare-import), with a small made-up
// export and fake Foursquare / OpenStreetMap answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcMillis, localTime, parseExport, collectVenues, parseJournal, buildPlaces } from '../tools/foursquare-import/convert.mjs';
import { openCache, lookUpVenues, fromFoursquare } from '../tools/foursquare-import/lookup.mjs';
import { fromMarkdown, toMarkdown, newRestaurant } from '../app/js/model.js';

const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const venue = (id, name) => ({ id, name, url: `https://app.foursquare.com/v/x/${id}` });
const checkin = (id, createdAt, v, extra = {}) => ({
  id, createdAt, type: 'checkin', timeZoneOffset: -240, venue: v, comments: { count: 0 }, lat: 35.96, lng: -83.92, ...extra,
});

const DELI = venue('v-deli', "McAlister's Deli");
const GAS = venue('v-gas', 'Pilot Travel Center');
const NEW = venue('v-new', 'Brand New Bistro');

function exportFiles() {
  return [
    { path: 'data-export/checkins1.json', bytes: enc({ count: 4, items: [
      checkin('c1', '2026-04-17 16:57:00.000000', DELI, { shout: 'Lunch!' }),
      checkin('c2', '2026-04-17 17:20:00.000000', DELI), // 23 min later: the same visit
      checkin('c3', '2025-01-02 23:30:00.000000', NEW, { lat: 35.97, lng: -83.93 }),
      checkin('c4', '2025-01-03 12:00:00.000000', GAS),
      { id: 'c5', createdAt: '2025-01-04 12:00:00.000000', type: 'checkin', timeZoneOffset: 0, comments: { count: 0 } }, // no venue
    ] }) },
    { path: 'data-export/checkins2.json', bytes: enc({ count: 1, items: [checkin('c6', '2020-06-01 12:00:00.000000', DELI)] }) },
    { path: 'data-export/lists.json', bytes: enc({ count: 1, items: [{ name: 'Wishlist', listItems: { count: 2, items: [
      { venue: venue('v-wish', 'Cucina 24') }, { venue: NEW },
    ] } }] }) },
    { path: 'data-export/tips.json', bytes: enc({ count: 1, items: [{ createdAt: '2013-06-14 20:32:30.000000', text: 'Great burgers.', venue: NEW }] }) },
    { path: 'data-export/photos1.json', bytes: enc({ count: 1, items: [{ id: 'p1', createdAt: '2025-01-02 23:45:00.000000', suffix: '/abc.jpg' }] }) },
    { path: 'data-export/pix/123_abc.jpg', bytes: new Uint8Array([0xff, 0xd8, 1, 2]) },
  ];
}

function journalPlace() {
  const r = newRestaurant({
    name: "McAlister's Deli", type: 'Restaurant', city: 'Knoxville', state: 'TN', lat: 35.9601, lon: -83.9201,
    created: '2019-01-01T00:00:00.000Z',
    visits: [{ date: '2026-04-17T12:50', rating: 4, people: ['Ann'], notes: '' }],
  });
  r.path = 'places/TN-knoxville-mcalister-s-deli.md';
  return r;
}

test('check-in times become local visit times', () => {
  const ms = utcMillis('2026-04-17 16:57:12.000000');
  assert.equal(localTime(ms, -240), '2026-04-17T12:57');
  assert.equal(utcMillis(1341193595), 1341193595000); // older exports: seconds
  assert.ok(Number.isNaN(utcMillis('')));
});

test('reads the export and groups check-ins by venue', () => {
  const exp = parseExport(exportFiles());
  assert.equal(exp.checkins.length, 6);
  assert.deepEqual(exp.lists.map((l) => [l.name, l.venues.length]), [['Wishlist', 2]]);
  assert.equal(exp.photos[0].bytes.length, 4, 'the photo file is found in pix/ despite the user id in front');
  const venues = collectVenues(exp.checkins);
  assert.equal(venues.size, 3, 'the check-in without a venue is left out');
  const deli = venues.get('v-deli');
  assert.equal(deli.checkins.length, 3);
  assert.deepEqual(deli.visits.map((v) => [v.date, v.notes]), [['2020-06-01T08:00', ''], ['2026-04-17T12:57', 'Lunch!']]);
  assert.equal(collectVenues(exp.checkins, { since: '2025-01-03' }).size, 2);
  assert.throws(() => parseExport([]), /No check-ins/);
});

test('check-ins at a place in the journal become visits there, without repeating known ones', () => {
  const exp = parseExport(exportFiles());
  const venues = collectVenues(exp.checkins);
  const mine = journalPlace();
  const { files, counts } = buildPlaces({ venues, lists: exp.lists, tips: exp.tips, photos: exp.photos, journal: [mine] });
  const deli = files.find((f) => f.path === mine.path);
  assert.ok(deli, 'written under its own name, so the import updates it');
  const r = fromMarkdown(deli.path, deli.data);
  assert.equal(r.foursquareId, 'v-deli');
  // 12:57 is within two hours of the 12:50 visit: the same one, which gets the check-in's text.
  assert.deepEqual(r.visits.map((v) => [v.date, v.rating, v.notes]), [['2026-04-17T12:50', 4, 'Lunch!'], ['2020-06-01T08:00', 0, '']]);
  assert.equal(counts.knownVisits, 1);
  assert.equal(counts.updatedPlaces, 1);
});

test('new venues become new places; list venues never checked in at become places to try', () => {
  const exp = parseExport(exportFiles());
  const venues = collectVenues(exp.checkins);
  const info = new Map([['v-new', { name: 'Brand New Bistro', type: 'Restaurant', food: true, address: '1 Main St', city: 'Knoxville', state: 'TN', lat: 35.97, lon: -83.93 }]]);
  const { files, counts } = buildPlaces({ venues, lists: exp.lists, tips: exp.tips, photos: exp.photos, info, journal: [journalPlace()] });
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('places/TN-knoxville-brand-new-bistro.md'));
  const bistro = fromMarkdown('places/TN-knoxville-brand-new-bistro.md', files.find((f) => f.path === 'places/TN-knoxville-brand-new-bistro.md').data);
  assert.equal(bistro.toTry, false, 'on the wishlist, but checked in at');
  assert.deepEqual(bistro.visits.map((v) => v.date), ['2025-01-02T19:30']);
  assert.match(bistro.notes, /Foursquare tip \(2013-06-14\): Great burgers\./);
  assert.deepEqual(bistro.photos, [{ file: 'media/TN-knoxville-brand-new-bistro/foursquare-p1.jpg', title: '', date: '2025-01-02' }]);
  assert.ok(paths.includes('media/TN-knoxville-brand-new-bistro/foursquare-p1.jpg'));
  const wish = files.find((f) => f.path === 'places/cucina-24.md');
  assert.equal(fromMarkdown(wish.path, wish.data).toTry, true);
  assert.equal(counts.toTry, 1);
  assert.equal(counts.newPlaces, 3); // bistro, gas station, wishlist
});

test('a name already taken gets a number; --food and --min-checkins leave places out', () => {
  const exp = parseExport(exportFiles());
  const venues = collectVenues(exp.checkins);
  const other = newRestaurant({ name: 'Pilot Travel Center', city: 'Far', state: 'GA', lat: 10, lon: 10 });
  other.path = 'places/pilot-travel-center.md';
  const info = new Map([['v-gas', { name: 'Pilot Travel Center', type: 'Gas station', food: false }]]);
  let { files } = buildPlaces({ venues, info, journal: [other] });
  assert.ok(files.some((f) => f.path === 'places/pilot-travel-center-2.md'), 'the far-away one is another place');
  ({ files } = buildPlaces({ venues, info, journal: [other], options: { food: true } }));
  assert.ok(!files.some((f) => f.path.startsWith('places/pilot')));
  const { skipped } = buildPlaces({ venues, info, options: { minCheckins: 2 } });
  assert.equal(skipped.fewCheckins, 2);
});

test('a place with nothing new is not written again', () => {
  const exp = parseExport(exportFiles());
  const venues = collectVenues(exp.checkins);
  const first = buildPlaces({ venues, lists: exp.lists, tips: exp.tips, photos: exp.photos, journal: [journalPlace()] });
  const journal = parseJournal(first.files.filter((f) => f.path.endsWith('.md')).map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.data) })));
  const again = buildPlaces({ venues, lists: exp.lists, tips: exp.tips, photos: exp.photos, journal });
  assert.deepEqual(again.files, []);
});

test('the journal can be an export ZIP with a top folder', () => {
  const r = journalPlace();
  const places = parseJournal([
    { path: 'bite-stamped/README.md', bytes: enc('hi') },
    { path: `bite-stamped/${r.path}`, bytes: enc(toMarkdown(r)) },
  ]);
  assert.deepEqual(places.map((p) => p.path), [r.path]);
});

test('lookups: Foursquare first, OpenStreetMap for what it lacks, all cached', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes('foursquare')) {
      if (url.endsWith('/v-gas')) return new Response('{}', { status: 404 });
      return Response.json({
        fsq_place_id: 'v-new', name: 'Brand New Bistro', latitude: 35.97, longitude: -83.93,
        categories: [{ name: 'American Restaurant' }], tel: '555', website: 'https://x.example',
        location: { address: '1 Main St', locality: 'Knoxville', region: 'TN', country: 'US' }, date_closed: '2026-01-01',
      });
    }
    return Response.json({ address: { house_number: '9', road: 'Pike', town: 'Kodak', state: 'Tennessee', 'ISO3166-2-lvl4': 'US-TN', country: 'United States', country_code: 'us' } });
  };
  const venues = [...collectVenues(parseExport(exportFiles()).checkins).values()].filter((v) => v.id !== 'v-deli');
  const cache = openCache('');
  const opts = { mode: 'foursquare', apiKey: 'k', cache, fetch: fake, wait: async () => {} };
  const info = await lookUpVenues(venues, opts);
  assert.deepEqual(info.get('v-new'), {
    name: 'Brand New Bistro', type: 'Restaurant', cuisine: 'American', food: true, address: '1 Main St', city: 'Knoxville', state: 'TN',
    country: 'United States', countryCode: 'US', lat: 35.97, lon: -83.93, website: 'https://x.example', phone: '555', closed: '2026-01-01',
  });
  assert.deepEqual(info.get('v-gas'), { address: '9 Pike', city: 'Kodak', state: 'TN', country: 'United States', countryCode: 'US' });
  assert.equal(calls.length, 3);
  await lookUpVenues(venues, opts);
  assert.equal(calls.length, 3, 'the second run asks nothing');
  assert.equal(fromFoursquare({ name: 'X', categories: [] }).lat, undefined);

  // A closed place gets the tag "closed".
  const { files } = buildPlaces({ venues: collectVenues(parseExport(exportFiles()).checkins), info });
  const bistro = files.find((f) => f.path === 'places/TN-knoxville-brand-new-bistro.md');
  assert.deepEqual(fromMarkdown(bistro.path, bistro.data).tags, ['closed']);
});

test('lookups stop asking Foursquare when it refuses the key', async () => {
  let fsq = 0;
  const fake = async (url) => {
    if (url.includes('foursquare')) { fsq++; return new Response('{}', { status: 401 }); }
    return Response.json({});
  };
  const venues = [...collectVenues(parseExport(exportFiles()).checkins).values()];
  const logs = [];
  await lookUpVenues(venues, { mode: 'foursquare', apiKey: 'bad', cache: openCache(''), fetch: fake, wait: async () => {}, log: (s) => logs.push(s), concurrency: 1 });
  assert.equal(fsq, 1);
  assert.ok(logs.some((l) => /401/.test(l)));
});
