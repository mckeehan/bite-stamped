import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromMarkdown, toMarkdown, newRestaurant, placePath, fileWord, isFoodPlace, typeFromKind, foursquareURL, notePreview, stateCode, mediaDir, displayRating, matches, lastVisit, findInJournal, nameKey, nameMatches, placeSymbol } from '../app/js/model.js';

test('a restaurant round-trips through Markdown', () => {
  const r = newRestaurant({
    path: 'restaurants/chez-marie.md',
    name: 'Chez Marie',
    rating: 4,
    city: 'Bern',
    lat: 46.95,
    lon: 7.44,
    visits: [
      { date: '2026-01-01', rating: 3, people: ['Anna'], notes: '' },
      { date: '2026-05-01', rating: 5, people: [], notes: 'Great "rösti"' },
    ],
    dishes: [{ name: 'Rösti', rating: 5, price: 'CHF 24', notes: '', image: 'media/chez-marie/a.jpg' }],
    photos: [{ file: 'media/chez-marie/b.jpg', title: 'Terrace at sunset', date: '2026-05-01' }],
    notes: 'Book ahead on weekends.',
  });
  const md = toMarkdown(r);
  assert.match(md, /^---\nname: Chez Marie\nrating: 4\n/);
  assert.match(md, /\n---\n\nBook ahead on weekends\.\n$/);
  // Visits are written newest first.
  assert.ok(md.indexOf('2026-05-01') < md.indexOf('2026-01-01'));

  const back = fromMarkdown(r.path, md);
  assert.equal(back.name, 'Chez Marie');
  assert.equal(back.photos[0].title, 'Terrace at sunset');
  assert.equal(back.dishes[0].image, 'media/chez-marie/a.jpg');
  assert.equal(back.visits[0].notes, 'Great "rösti"');
  assert.equal(back.notes, 'Book ahead on weekends.');
  assert.equal(lastVisit(back), '2026-05-01');
});

test('tolerates hand-edited files', () => {
  const r = fromMarkdown('restaurants/x.md', `---
name: X
rating: "9"
visits:
  - date: 2026-02-02
    people: Anna
photos:
  - media/x/1.jpg
---
`);
  assert.equal(r.rating, 5);
  assert.deepEqual(r.visits[0].people, ['Anna']);
  assert.deepEqual(r.photos, [{ file: 'media/x/1.jpg', title: '', date: '' }]);
});

test('file names: STATE-city-name, unique, readable', () => {
  assert.equal(fileWord("Debbie's Drive-Inn!"), 'debbie-s-drive-inn');
  assert.equal(fileWord('Café & Bar Zürich'), 'cafe-bar-zurich');
  assert.equal(stateCode('TN'), 'TN');
  assert.equal(stateCode('tn'), 'TN');
  assert.equal(stateCode('Tennessee'), 'TN');
  assert.equal(stateCode('North Carolina'), 'NC');
  assert.equal(stateCode('Québec'), 'QC');
  assert.equal(stateCode('Bern'), 'BERN');
  assert.equal(stateCode(''), '');

  const debbie = { name: "Debbie's Drive Inn", city: 'Newport', state: 'Tennessee' };
  assert.equal(placePath(debbie, []), 'places/TN-newport-debbie-s-drive-inn.md');
  assert.equal(placePath({ name: 'Chez Marie' }, []), 'places/chez-marie.md', 'no state or city');
  assert.equal(placePath({ name: '' }, []), 'places/place.md');

  // Another restaurant with the same name and town: -2, -3…, whatever the case.
  const taco = { name: 'Taco Bell', city: 'Sevierville', state: 'TN' };
  assert.equal(placePath(taco, ['places/TN-sevierville-taco-bell.md']), 'places/TN-sevierville-taco-bell-2.md');
  assert.equal(placePath(taco, ['places/tn-sevierville-taco-bell.md', 'places/TN-sevierville-taco-bell-2.md']), 'places/TN-sevierville-taco-bell-3.md');

  // A restaurant keeps a name that already fits, suffix included; an old-style one moves.
  const second = { ...taco, path: 'places/TN-sevierville-taco-bell-2.md' };
  assert.equal(placePath(second, ['places/TN-sevierville-taco-bell.md', second.path]), second.path);
  const old = { ...taco, path: 'restaurants/taco-bell.md' }; // before 2.0.0
  assert.equal(placePath(old, [old.path]), 'places/TN-sevierville-taco-bell.md');
  // Renamed in the app: a new name, and the old one is free again.
  const moved = { ...taco, city: 'Kodak', path: 'places/TN-sevierville-taco-bell.md' };
  assert.equal(placePath(moved, [moved.path]), 'places/TN-kodak-taco-bell.md');

  assert.equal(mediaDir('places/TN-newport-debbie-s-drive-inn.md'), 'media/TN-newport-debbie-s-drive-inn/');
});

test('rating falls back to the visit average', () => {
  const r = newRestaurant({ visits: [{ date: '2026-01-01', rating: 4 }, { date: '2026-01-02', rating: 5 }] });
  assert.equal(displayRating(r), 5);
});

test('search looks at dishes, people and photo titles', () => {
  const r = newRestaurant({
    name: 'A',
    dishes: [{ name: 'Ramen' }],
    visits: [{ date: '2026-01-01', people: ['Ben'] }],
    photos: [{ file: 'f.jpg', title: 'Birthday' }],
  });
  assert.ok(matches(r, 'ramen ben'));
  assert.ok(matches(r, 'birthday'));
  assert.ok(!matches(r, 'sushi'));
});

test('findInJournal matches by loose name and nearby location', () => {
  const journal = [
    { name: 'Taco Bell', lat: 35.9606, lon: -83.9207, address: '145 Stadium Dr' },
    { name: 'Taco Bell', lat: 35.99, lon: -83.95, address: '3310 Parkway' },
    { name: "Calhoun's", lat: 35.9555, lon: -83.9262, address: '400 Neyland Dr' },
    { name: 'The Lunchbox', lat: null, lon: null, address: 'Market St SW, Knoxville' },
  ];
  // 100 m away from the first Taco Bell, far from the second.
  assert.equal(findInJournal({ name: 'Taco Bell', lat: 35.9615, lon: -83.9207 }, journal), journal[0]);
  assert.equal(findInJournal({ name: 'Taco Bell', lat: 36.2, lon: -83.9 }, journal), null);
  assert.equal(findInJournal({ name: 'Calhoun’s on the River', lat: 35.9556, lon: -83.9263 }, journal), journal[2]);
  assert.equal(findInJournal({ name: 'Calhoun County', lat: 35.9556, lon: -83.9263 }, journal), null);
  assert.equal(findInJournal({ name: 'Lunchbox', lat: 35.96, lon: -83.92, street: 'Market St SW' }, journal), journal[3]);
  assert.equal(findInJournal({ name: 'Lunchbox', lat: 35.96, lon: -83.92, street: 'Gay St' }, journal), null);
  assert.equal(nameKey('The Pig & Whistle’s'), 'pig and whistles');
});

test('visits keep their time, and sort with date-only visits', () => {
  const r = newRestaurant({ name: 'Late Night', visits: [
    { date: '2026-10-12', rating: 3, people: [], notes: '' },
    { date: '2026-10-12T19:30', rating: 4, people: [], notes: '' },
    { date: '2026-10-11T23:05', rating: 5, people: [], notes: '' },
  ] });
  const md = toMarkdown(r);
  assert.match(md, /date: 2026-10-12T19:30\n/);
  const back = fromMarkdown('restaurants/late-night.md', md);
  // Saved newest first; a visit with a time sorts after a date-only one of the same day.
  assert.deepEqual(back.visits.map((v) => v.date), ['2026-10-12T19:30', '2026-10-12', '2026-10-11T23:05']);
  assert.equal(lastVisit(back), '2026-10-12T19:30');
});

test('directions use the location when there is one, otherwise the address', async () => {
  const { directionLinks } = await import('../app/js/model.js');
  const withPoint = directionLinks(newRestaurant({ name: 'Chez Marie', address: '1 Main St', city: 'Bern', lat: 46.95, lon: 7.44 }));
  assert.equal(withPoint.google, 'https://www.google.com/maps/dir/?api=1&destination=46.95,7.44');
  assert.equal(withPoint.waze, 'https://waze.com/ul?ll=46.95,7.44&navigate=yes');
  assert.equal(withPoint.apple, 'https://maps.apple.com/?daddr=46.95,7.44&q=Chez%20Marie');
  assert.equal(withPoint.geo, 'geo:46.95,7.44?q=46.95,7.44(Chez%20Marie)');
  assert.equal(withPoint.address, '1 Main St, Bern');

  const addressOnly = directionLinks(newRestaurant({ name: 'Joe’s', address: '5 Elm St', city: 'Knoxville', state: 'TN' }));
  assert.equal(addressOnly.google, `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('Joe’s, 5 Elm St, Knoxville, TN')}`);
  assert.equal(addressOnly.waze, `https://waze.com/ul?q=${encodeURIComponent('Joe’s, 5 Elm St, Knoxville, TN')}&navigate=yes`);

  assert.equal(directionLinks(newRestaurant({ name: 'Nowhere' })), null);
});

test('nameMatches: every word typed starts a word of the name', () => {
  assert.ok(nameMatches('The Dillard House', 'The Dillard House'));
  assert.ok(nameMatches('dillard house', 'Dillard House Restaurant'));
  assert.ok(nameMatches('calhoun', 'Calhoun’s on the River'));
  assert.ok(nameMatches('Calhouns River', 'Calhoun’s on the River'));
  assert.ok(nameMatches('cafe', 'Café Rosé'));
  assert.ok(nameMatches('the', 'Anything'), 'only little words: no filter');
  assert.ok(!nameMatches('The Dillard House', 'Waffle House'));
  assert.ok(!nameMatches('The Dillard House', 'The Chop House'));
  assert.ok(!nameMatches('The Dillard House', 'The Dam Store'));
});

test('types of places: food or not, from search results', () => {
  assert.ok(isFoodPlace({ type: '' }), 'no type: a restaurant from before 2.0.0');
  for (const type of ['Restaurant', 'Café', 'Bar', 'Brewery', 'Fast food', 'Ice cream']) assert.ok(isFoodPlace({ type }), type);
  for (const type of ['Museum', 'Park', 'Attraction', 'Hotel']) assert.ok(!isFoodPlace({ type }), type);
  assert.equal(typeFromKind('fast_food'), 'Fast food');
  assert.equal(typeFromKind('cafe'), 'Café');
  assert.equal(typeFromKind('museum'), 'Museum');
  assert.equal(typeFromKind('bbq joint'), 'Restaurant');
  assert.equal(typeFromKind('Art Museum'), 'Art museum');
  assert.equal(typeFromKind(''), '');
});

test('a place found on Foursquare keeps its id, and links to its page there', () => {
  const r = newRestaurant({ name: 'The Dillard House', foursquareId: '4bb8a6e97421a59318f2c140' });
  assert.equal(fromMarkdown('places/x.md', toMarkdown(r)).foursquareId, '4bb8a6e97421a59318f2c140');
  assert.equal(foursquareURL(r.foursquareId), 'https://foursquare.com/v/4bb8a6e97421a59318f2c140');
  assert.equal(foursquareURL(''), '');
  assert.ok(!toMarkdown(newRestaurant({ name: 'x' })).includes('foursquareId'), 'not written when empty');
});

test('notePreview: the first line of the notes, without Markdown marks', () => {
  assert.equal(notePreview(''), '');
  assert.equal(notePreview('\n\n  Fabulous carrot cake\nSecond line'), 'Fabulous carrot cake');
  assert.equal(notePreview('* Shrimp Loco has very good **spinach**'), 'Shrimp Loco has very good spinach');
  assert.equal(notePreview('## Heard about it on _Diners, Drive-Ins and Dives_'), 'Heard about it on Diners, Drive-Ins and Dives');
  assert.equal(notePreview('From [Taking the kids](https://example.com/x?utm_source=tn)'), 'From Taking the kids');
  assert.equal(notePreview('---\n> Ask for the `cacio e pepe`'), 'Ask for the cacio e pepe');
  assert.equal(notePreview('snake_case_name stays'), 'snake_case_name stays');
});

test('a place without a photo gets a symbol for its kind', () => {
  const sym = (type, cuisine = '') => placeSymbol({ type, cuisine });
  assert.equal(sym('Restaurant', 'Mexican, Tex-Mex'), '🌮', 'a restaurant: its cuisine');
  assert.equal(sym('Fast food', 'Burger, Fast Food'), '🍔');
  assert.equal(sym('Fast food'), '🍟');
  assert.equal(sym('Restaurant', 'American'), '🍽️', 'nothing more specific');
  assert.equal(sym('', ''), '🍽️', 'no type: from before types, a restaurant');
  assert.equal(sym('Ice cream parlor'), '🍦', 'other types: the type first');
  assert.equal(sym('Steakhouse'), '🥩', '"steak" is not "tea"');
  assert.equal(sym('Fuel station', 'Fuel Station, Convenience Store'), '⛽');
  assert.equal(sym('Parking'), '🅿️', 'parking is not a park');
  assert.equal(sym('Dog park'), '🐕');
  assert.equal(sym('Park'), '🌳');
  assert.equal(sym('Hiking trail'), '🥾', 'a trail is not a train');
  assert.equal(sym('Barbershop'), '💇', 'a barber is not a bar');
  assert.equal(sym('Beer garden'), '🍺', 'a beer garden is not a garden');
  assert.equal(sym('Movie theater'), '🎬');
  assert.equal(sym("Doctor's office"), '🏥');
  assert.equal(sym('Hardware store'), '🔨');
  assert.equal(sym('Department store'), '🛍️');
  assert.equal(sym('Tire shop'), '🔧');
  assert.equal(sym('Something else entirely'), '📍', '"entirely" has no tire');
});
