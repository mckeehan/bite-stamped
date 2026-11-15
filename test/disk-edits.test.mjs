// Place files edited on the server, in DATA_DIR/files/places/ (files.js:
// scanDisk), reach the devices on their next sync.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, statSync, utimesSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { testServer, deviceFetch, memoryStore } from './helpers.mjs';
import { createSync } from '../app/js/sync.js';
import { fromMarkdown, toMarkdown, newRestaurant } from '../app/js/model.js';

async function device(srv) {
  const store = memoryStore();
  const sync = createSync({ store, fetch: deviceFetch(srv.app) });
  await sync.init();
  await sync.sendCode('me@example.com');
  await sync.verify('me@example.com', srv.codes.get('me@example.com'), 'test');
  return { store, sync };
}

const PATH = 'places/TN-knoxville-luca.md';
const read = async (store, path) => fromMarkdown(path, await store.readText(path));
const onDisk = (env, path) => join(env.dataDir, 'files', path);
// Saved "a while ago", as an editor's save is by the next sync.
function saveOnDisk(env, path, text) {
  writeFileSync(onDisk(env, path), text);
  const past = new Date(Date.now() - 10_000);
  utimesSync(onDisk(env, path), past, past);
}

async function withPlace() {
  const env = testServer();
  const a = await device(env);
  await a.store.writeFile(PATH, toMarkdown(newRestaurant({ path: PATH, name: 'Luca', city: 'Knoxville', state: 'TN' })));
  await a.sync.sync();
  return { env, a };
}

test('an edit to a place file on the server reaches the devices', async () => {
  const { env, a } = await withPlace();
  const text = readFileSync(onDisk(env, PATH), 'utf8').replace('name: Luca', 'name: Luca Trattoria');
  saveOnDisk(env, PATH, text);
  env.app.scanDisk({ force: true });
  await a.sync.sync();
  assert.equal((await read(a.store, PATH)).name, 'Luca Trattoria');
  // Once only: checking again finds nothing new.
  const { seq } = env.app.storage.get('SELECT seq FROM counter WHERE id = 1');
  env.app.scanDisk({ force: true });
  assert.equal(env.app.storage.get('SELECT seq FROM counter WHERE id = 1').seq, seq);
});

test('place files are copies, so an edit in place keeps the saved versions as they were', async () => {
  const { env } = await withPlace();
  assert.equal(statSync(onDisk(env, PATH)).nlink, 1);
  const versions = join(env.dataDir, 'versions', PATH);
  const [first] = readdirSync(versions);
  const before = readFileSync(join(versions, first), 'utf8');
  saveOnDisk(env, PATH, before.replace('name: Luca', 'name: Changed'));
  assert.equal(readFileSync(join(versions, first), 'utf8'), before);
  env.app.scanDisk({ force: true });
  assert.equal(readdirSync(versions).length, 2);
});

test('a new place file on the server is added; a deleted one is deleted', async () => {
  const { env, a } = await withPlace();
  const NEW = 'places/TN-knoxville-new-place.md';
  saveOnDisk(env, NEW, toMarkdown(newRestaurant({ path: NEW, name: 'New Place', city: 'Knoxville', state: 'TN' })));
  rmSync(onDisk(env, PATH));
  env.app.scanDisk({ force: true });
  await a.sync.sync();
  assert.equal((await read(a.store, NEW)).name, 'New Place');
  assert.deepEqual(a.store.live(), [NEW]);
});

test('a file whose header cannot be read is not synced', async () => {
  const { env, a } = await withPlace();
  saveOnDisk(env, PATH, 'Luca, notes without a header');
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    env.app.scanDisk({ force: true });
  } finally {
    console.warn = warn;
  }
  saveOnDisk(env, PATH, '---\nrating: 4\n---\nNo name\n');
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    env.app.scanDisk({ force: true });
  } finally {
    console.warn = warn;
  }
  await a.sync.sync();
  assert.equal((await read(a.store, PATH)).name, 'Luca');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /no header/);
  assert.match(warnings[1], /no name/);
});

test('a file still being saved waits for the next check', async () => {
  const { env, a } = await withPlace();
  writeFileSync(onDisk(env, PATH), readFileSync(onDisk(env, PATH), 'utf8').replace('name: Luca', 'name: Later'));
  env.app.scanDisk({ force: true });
  await a.sync.sync();
  assert.equal((await read(a.store, PATH)).name, 'Luca');
});

test('an empty or missing places folder deletes nothing', async () => {
  const { env, a } = await withPlace();
  rmSync(join(env.dataDir, 'files', 'places'), { recursive: true });
  env.app.scanDisk({ force: true });
  await a.sync.sync();
  assert.deepEqual(a.store.live(), [PATH]);
});
