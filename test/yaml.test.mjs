import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, stringify, parseFrontMatter, stringifyFrontMatter } from '../js/yaml.js';

test('round-trips the values the app writes', () => {
  const data = {
    name: 'Joe\'s Bar: "the" place #1',
    rating: 4,
    toTry: true,
    lat: 46.93,
    created: '2026-11-03T10:00:00.000Z',
    zip: '03075',
    looksLikeBool: 'yes',
    looksLikeNumber: '12.5',
    dash: '- not a list',
    tags: ['pizza', 'late night', 'a, b'],
    visits: [
      { date: '2026-10-01', rating: 5, people: ['Anna', 'Ben'], notes: 'Line one\nLine two' },
      { date: '2026-09-01' },
    ],
  };
  assert.deepEqual(parse(stringify(data)), data);
});

test('leaves out empty values', () => {
  assert.equal(stringify({ a: '', b: null, c: [], d: 'x' }), 'd: x\n');
});

test('reads hand-written YAML', () => {
  const text = `
# comment
name: Café Paris   # trailing comment
tags: [french, "bistro, cosy", 'it''s']
visits:
- date: 2026-01-02
  people:
    - Anna
  notes: |
    First line
    Second line
- date: 2026-02-03
  rating: 3
dishes:
  - name: Soup
    price: "12"
empty:
url: https://example.com/a#b
`;
  assert.deepEqual(parse(text), {
    name: 'Café Paris',
    tags: ['french', 'bistro, cosy', "it's"],
    visits: [
      { date: '2026-01-02', people: ['Anna'], notes: 'First line\nSecond line\n' },
      { date: '2026-02-03', rating: 3 },
    ],
    dishes: [{ name: 'Soup', price: '12' }],
    empty: null,
    url: 'https://example.com/a#b',
  });
});

test('front matter splits header and body', () => {
  const text = stringifyFrontMatter({ name: 'X' }, '# Notes\n\nGood.');
  assert.equal(text, '---\nname: X\n---\n\n# Notes\n\nGood.\n');
  assert.deepEqual(parseFrontMatter(text), { data: { name: 'X' }, body: '# Notes\n\nGood.\n' });
});

test('a file without a header is all body', () => {
  assert.deepEqual(parseFrontMatter('Just notes'), { data: {}, body: 'Just notes' });
});
