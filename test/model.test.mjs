import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromMarkdown, toMarkdown, newRestaurant, uniquePath, slugify, mediaDir, displayRating, matches, lastVisit, findInJournal, nameKey,
} from '../app/js/model.js';

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

test('paths are unique and readable', () => {
  assert.equal(slugify('Café & Bar Zürich!'), 'cafe-and-bar-zurich');
  assert.equal(uniquePath('Chez Marie', ['restaurants/chez-marie.md']), 'restaurants/chez-marie-2.md');
  assert.equal(mediaDir('restaurants/chez-marie-2.md'), 'media/chez-marie-2/');
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
