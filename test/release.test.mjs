// Installed copies only update when sw.js itself changes, so its VERSION
// must follow the release in js/version.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');

test('sw.js VERSION matches js/version.js', () => {
  const release = read('js/version.js').match(/version: '([^']+)'/)[1];
  const sw = read('sw.js').match(/const VERSION = 'v([^']+)'/)?.[1];
  assert.equal(sw, release);
});

test('every file sw.js caches exists', () => {
  const list = read('sw.js').match(/const FILES = \[([\s\S]*?)\];/)[1];
  for (const f of list.match(/'([^']+)'/g).map((s) => s.slice(1, -1))) {
    if (f !== './') readFileSync(new URL(`../app/${f}`, import.meta.url));
  }
});
