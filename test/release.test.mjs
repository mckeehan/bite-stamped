// Installed copies only update when sw.js itself changes, so its VERSION
// must follow the release in js/version.js. The release is a semantic
// version, the same in package.json, with an entry in CHANGELOG.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const readRoot = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const release = () => {
  const [, version, date] = read('js/version.js').match(/version: '([^']+)', date: '([^']+)'/);
  return { version, date };
};

test('the release is a semantic version, the same in package.json', () => {
  const { version } = release();
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(JSON.parse(readRoot('package.json')).version, version);
});

test('CHANGELOG.md has an entry for the release, newest first', () => {
  const { version, date } = release();
  const entries = [...readRoot('CHANGELOG.md').matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d\d-\d\d)$/gm)];
  assert.ok(entries.length, 'no "## [x.y.z] - YYYY-MM-DD" entries');
  assert.deepEqual([entries[0][1], entries[0][2]], [version, date], 'the first entry is the current release');
});

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
