// The list search: plain words, field filters (tag:, with:…) and suggestions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches, suggest, applySuggestion } from '../app/js/search.js';
import { newRestaurant } from '../app/js/model.js';

const place = (fields) => newRestaurant({ type: 'Restaurant', ...fields });
const brunch = place({
  name: 'Café Ruby', city: 'Knoxville', state: 'TN', cuisine: 'breakfast, american', tags: ['Brunch', 'Date night'],
  visits: [{ date: '2026-11-01', people: ['Anna', 'Ben'] }], dishes: [{ name: 'Shrimp and grits' }], notes: 'Great tacos on Tuesdays',
});
const tacos = place({
  name: 'Taco Ranch', city: 'Pigeon Forge', state: 'TN', cuisine: 'mexican', tags: ['Oldest in Tennessee'],
  visits: [{ date: '2026-10-01', people: ['Anna'] }],
});
const all = [brunch, tacos];

test('plain words search everything, ignoring case and accents', () => {
  assert.ok(matches(brunch, 'cafe ruby'));
  assert.ok(matches(brunch, 'TACOS'), 'notes count for a plain word');
  assert.ok(matches(brunch, '"date night"'), 'a quoted phrase');
  assert.ok(!matches(brunch, 'sushi'));
  assert.ok(matches(brunch, '   '));
});

test('field:value looks only in that field, partly', () => {
  assert.ok(matches(brunch, 'tag:brun'));
  assert.ok(matches(brunch, 'tag:"date ni"'));
  assert.ok(!matches(brunch, 'tag:taco'), 'tacos in the notes is not a tag');
  assert.ok(matches(brunch, 'taco'));
  assert.ok(matches(tacos, 'tag:oldest'));
  assert.ok(matches(brunch, 'with:ben') && !matches(tacos, 'with:ben'));
  assert.ok(matches(brunch, 'people:anna'), 'an alias');
  assert.ok(matches(tacos, 'city:pigeon') && !matches(brunch, 'city:pigeon'));
  assert.ok(matches(brunch, 'cuisine:american dish:grits'));
  assert.ok(!matches(brunch, 'tag:brunch city:pigeon'), 'every term has to match');
  assert.ok(matches(brunch, 'tag:'), 'an empty field term filters nothing yet');
  assert.ok(matches(brunch, '10:30') === false && parseQuery('10:30')[0].field === null, 'not a field: a plain word');
});

test('parseQuery finds terms and where they are', () => {
  assert.deepEqual(parseQuery('tag:"date night" anna'), [
    { field: 'tag', value: 'date night', open: false, start: 0, end: 16 },
    { field: null, value: 'anna', open: false, start: 17, end: 21 },
  ]);
  assert.equal(parseQuery('Tags:"brun').at(-1).open, true);
});

test('suggest offers the values of the field being typed, matching ones first', () => {
  assert.deepEqual(suggest('tag:', all).values.map((v) => v.value), ['Brunch', 'Date night', 'Oldest in Tennessee']);
  assert.deepEqual(suggest('anna tag:n', all).values.map((v) => v.value), ['Date night', 'Brunch', 'Oldest in Tennessee'],
    'a word starting with it first, then the rest by use and name');
  assert.deepEqual(suggest('with:', all).values, [{ value: 'Anna', count: 2 }, { value: 'Ben', count: 1 }], 'most used first');
  assert.deepEqual(suggest('tag:"date n', all).values.map((v) => v.value), ['Date night']);
  assert.equal(suggest('tag:brunch ', all), null, 'done with that term');
  assert.equal(suggest('tag:"date night"', all), null);
  assert.equal(suggest('brunch', all), null, 'not a field term');
});

test('applySuggestion puts the value in, quoted when it has a space', () => {
  const text = 'anna tag:da';
  assert.equal(applySuggestion(text, suggest(text, all), 'Date night'), 'anna tag:"Date night" ');
  assert.equal(applySuggestion('tag:', suggest('tag:', all), 'Brunch'), 'tag:Brunch ');
});
