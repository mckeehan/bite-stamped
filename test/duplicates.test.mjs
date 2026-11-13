// Finding the same place twice, and merging two places into one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, duplicateReasons, findDuplicates, mergePlaces, pairKey } from '../app/js/duplicates.js';
import { newRestaurant } from '../app/js/model.js';

let n = 0;
const place = (fields) => newRestaurant({ path: `places/p${++n}.md`, ...fields });

test('addressKey compares house number and street loosely', () => {
  assert.equal(addressKey('2849 Winfield Dunn Pkwy'), addressKey('2849 Winfield Dunn Parkway, Sevierville'));
  assert.equal(addressKey('100 N. Main St., Suite 4'), '100 north main street');
  assert.equal(addressKey('Main Street'), '', 'no house number: not an address to compare');
  assert.notEqual(addressKey('2849 Winfield Dunn Pkwy'), addressKey('2851 Winfield Dunn Pkwy'));
});

test('the same address counts, whatever the names and towns', () => {
  const usps = place({ name: 'United States Postal Service', type: 'Post office', cuisine: 'Post Office', address: '2849 Winfield Dunn Pkwy', city: 'Kodak', state: 'Tennessee', lat: 35.9701, lon: -83.6201 });
  const po = place({ name: 'Kodak Post Office', type: 'Post office', address: '2849 Winfield Dunn Parkway', city: 'Sevierville', state: 'TN', lat: 35.9703, lon: -83.6199 });
  assert.deepEqual(duplicateReasons(usps, po), ['Same address', 'Same kind of place']);
  const pairs = findDuplicates([usps, po, place({ name: 'Elsewhere', address: '1 Main St' })]);
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].meters > 20 && pairs[0].meters < 40, `about 30 m apart, not ${pairs[0].meters}`);
  assert.equal(findDuplicates([usps, po], new Set([pairKey(po, usps)])).length, 0, '"not the same" is remembered either way round');
  const shop1 = place({ name: 'Five Below', type: 'Shop', cuisine: 'variety store', address: '750 Winfield Dunn Pkwy' });
  const shop2 = place({ name: 'HomeGoods', type: 'Shop', cuisine: 'department store', address: '750 Winfield Dunn Pkwy' });
  assert.deepEqual(duplicateReasons(shop1, shop2), [], 'a shopping centre: one address, different kinds of place');
});

test('the same name counts close by, not across town (chains)', () => {
  const a = place({ name: 'Taco Bell', lat: 35.9600, lon: -83.9200, city: 'Knoxville' });
  const b = place({ name: 'Taco Bell', lat: 35.9605, lon: -83.9203, city: 'Knoxville' });
  const far = place({ name: 'Taco Bell', lat: 35.9300, lon: -83.9900, city: 'Knoxville' });
  assert.deepEqual(duplicateReasons(a, b), ['Same name']);
  assert.deepEqual(duplicateReasons(a, far), []);
  const noPoint1 = place({ name: "Dyer's Burgers", city: 'Memphis' });
  const noPoint2 = place({ name: 'Dyers Burgers', city: 'Memphis' });
  assert.deepEqual(duplicateReasons(noPoint1, noPoint2), ['Same name'], 'without a location, the same town');
  assert.deepEqual(findDuplicates([a, b, far]).map((p) => [p.a.path, p.b.path]), [[a.path, b.path]]);
});

test('similar names count only very close', () => {
  const a = place({ name: "Calhoun's", lat: 35.9600, lon: -83.9200 });
  const b = place({ name: "Calhoun's on the River", lat: 35.9602, lon: -83.9201 });
  const c = place({ name: "Calhoun's on the River", lat: 35.9650, lon: -83.9200 });
  assert.deepEqual(duplicateReasons(a, b), ['Similar name']);
  assert.deepEqual(duplicateReasons(a, c), [], '550 m away');
  assert.deepEqual(duplicateReasons(a, place({ name: 'Pizza Hut', lat: 35.9600, lon: -83.9200 })), [], 'next door, another name');
});

test("merging keeps one place's details and both places' visits, dishes, photos, tags and notes", () => {
  const keep = place({
    name: 'Kodak Post Office', address: '2849 Winfield Dunn Parkway', city: 'Sevierville', rating: 0, phone: '',
    tags: ['Errands'], notes: 'Parking in back.',
    visits: [{ date: '2026-11-13T10:00', people: [] }],
    photos: [{ file: 'media/p1/a.jpg', title: 'Front' }],
  });
  const other = place({
    name: 'United States Postal Service', address: '2849 Winfield Dunn Pkwy', city: 'Kodak', rating: 3, phone: '+1 865 555 0100',
    tags: ['Errands', 'Government'], notes: 'Closes at 4.', created: '2020-01-01T00:00:00Z',
    visits: [{ date: '2026-04-17T09:30', people: ['Anna'] }, { date: '2026-11-13T10:00', people: [] }],
    photos: [{ file: 'media/p1/b.jpg', title: '' }],
    dishes: [{ name: 'Stamps', rating: 4 }],
  });
  const m = mergePlaces(keep, other);
  assert.equal(m.path, keep.path);
  assert.equal(m.name, 'Kodak Post Office');
  assert.equal(m.city, 'Sevierville', "the kept place's details win");
  assert.equal(m.phone, '+1 865 555 0100', 'empty ones are filled in');
  assert.equal(m.rating, 3);
  assert.deepEqual(m.tags, ['Errands', 'Government']);
  assert.equal(m.notes, 'Parking in back.\n\nCloses at 4.');
  assert.deepEqual(m.visits.map((v) => v.date).sort(), ['2026-04-17T09:30', '2026-11-13T10:00'], 'the same visit only once');
  assert.deepEqual(m.photos.map((p) => p.file), ['media/p1/a.jpg', 'media/p1/b.jpg']);
  assert.equal(m.dishes.length, 1);
  assert.equal(m.created, '2020-01-01T00:00:00Z', 'the earlier date added');
  assert.equal(m.toTry, false);
  assert.equal(mergePlaces(place({ name: 'A', toTry: true }), place({ name: 'A', toTry: true })).toTry, true);
  assert.equal(mergePlaces(place({ name: 'A', toTry: true }), place({ name: 'A', visits: [{ date: '2026-01-01' }] })).toTry, false);
});
