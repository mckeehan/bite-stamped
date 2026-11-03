// Two devices syncing through the real server code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

const write = (store, r) => store.writeFile(r.path, toMarkdown(r));
const read = async (store, path) => fromMarkdown(path, await store.readText(path));

test('a restaurant and its image reach the other device', async () => {
  const env = testServer();
  const a = await device(env);
  const b = await device(env);

  await a.store.writeFile('media/luca/1.jpg', new Uint8Array([1, 2, 3]).buffer, 'image/jpeg');
  await write(a.store, newRestaurant({ path: 'restaurants/luca.md', name: 'Luca', photos: [{ file: 'media/luca/1.jpg', title: 'Door' }] }));
  await a.sync.sync();
  assert.equal(a.sync.state.status, 'idle');
  assert.equal(a.sync.state.pending, 0);

  await b.sync.sync();
  assert.deepEqual(b.store.live(), ['media/luca/1.jpg', 'restaurants/luca.md']);
  assert.equal((await read(b.store, 'restaurants/luca.md')).photos[0].title, 'Door');
  assert.deepEqual(new Uint8Array(b.store.files.get('media/luca/1.jpg').bytes), new Uint8Array([1, 2, 3]));
});

test('edits made offline on both devices are merged', async () => {
  const env = testServer();
  const a = await device(env);
  const b = await device(env);
  await write(a.store, newRestaurant({ path: 'restaurants/pho.md', name: 'Pho', notes: 'Good broth.' }));
  await a.sync.sync();
  await b.sync.sync();

  const ra = await read(a.store, 'restaurants/pho.md');
  ra.visits.push({ date: '2026-11-01', rating: 5, people: ['Anna'], notes: '' });
  ra.rating = 4;
  await write(a.store, ra);

  const rb = await read(b.store, 'restaurants/pho.md');
  rb.visits.push({ date: '2026-11-02', rating: 3, people: [], notes: 'Busy' });
  rb.dishes.push({ name: 'Pho tai', rating: 5, price: '', notes: '', image: '' });
  rb.cuisine = 'Vietnamese';
  await write(b.store, rb);

  await a.sync.sync();
  await b.sync.sync(); // conflicts, merges, uploads the merge
  await a.sync.sync();

  for (const d of [a, b]) {
    const r = await read(d.store, 'restaurants/pho.md');
    assert.deepEqual(r.visits.map((v) => v.date), ['2026-11-02', '2026-11-01']);
    assert.equal(r.dishes[0].name, 'Pho tai');
    assert.equal(r.rating, 4);
    assert.equal(r.cuisine, 'Vietnamese');
    assert.equal(r.notes, 'Good broth.');
  }
  assert.equal(await a.store.readText('restaurants/pho.md'), await b.store.readText('restaurants/pho.md'));
});

test('two devices adding the same new place offline end up with one merged file', async () => {
  const env = testServer();
  const a = await device(env);
  const b = await device(env);
  await write(a.store, newRestaurant({ path: 'restaurants/taco.md', name: 'Taco', toTry: true, tags: ['quick'] }));
  await write(b.store, newRestaurant({ path: 'restaurants/taco.md', name: 'Taco', city: 'Knoxville', tags: ['cheap'] }));
  await a.sync.sync();
  await b.sync.sync();
  await a.sync.sync();
  const r = await read(a.store, 'restaurants/taco.md');
  assert.deepEqual(r.tags.sort(), ['cheap', 'quick']);
  assert.equal(r.city, 'Knoxville');
});

test('deletions sync, and an edit wins over a deletion', async () => {
  const env = testServer();
  const a = await device(env);
  const b = await device(env);
  await write(a.store, newRestaurant({ path: 'restaurants/x.md', name: 'X' }));
  await write(a.store, newRestaurant({ path: 'restaurants/y.md', name: 'Y' }));
  await a.sync.sync();
  await b.sync.sync();

  await a.store.deleteFile('restaurants/x.md');
  await a.sync.sync();
  await b.sync.sync();
  assert.deepEqual(b.store.live(), ['restaurants/y.md']);

  // Y: deleted on A, edited on B at the same time.
  await a.store.deleteFile('restaurants/y.md');
  const y = await read(b.store, 'restaurants/y.md');
  y.notes = 'Still open!';
  await write(b.store, y);
  await a.sync.sync();
  await b.sync.sync();
  await a.sync.sync();
  assert.equal((await read(a.store, 'restaurants/y.md')).notes, 'Still open!');
});

test('offline: nothing is lost, it syncs later', async () => {
  const env = testServer();
  const store = memoryStore();
  const f = deviceFetch(env.app);
  let reachable = true;
  const sync = createSync({ store, fetch: (...args) => (reachable ? f(...args) : Promise.reject(new TypeError('Failed to fetch'))) });
  await sync.init();
  await sync.sendCode('me@example.com');
  await sync.verify('me@example.com', env.codes.get('me@example.com'));

  reachable = false;
  await write(store, newRestaurant({ path: 'restaurants/z.md', name: 'Z' }));
  await sync.sync();
  assert.equal(sync.state.status, 'offline');
  assert.equal(sync.state.pending, 1);

  reachable = true;
  await sync.sync();
  assert.equal(sync.state.status, 'idle');
  assert.equal(sync.state.pending, 0);
});

test('a lapsed session signs the device out but keeps its changes', async () => {
  const env = testServer();
  const a = await device(env);
  env.app.storage.run('DELETE FROM sessions');
  await write(a.store, newRestaurant({ path: 'restaurants/q.md', name: 'Q' }));
  await a.sync.sync();
  assert.equal(a.sync.state.status, 'signed-out');
  assert.equal((await a.store.listDirty()).length, 1);
});

test('after a server is replaced, devices upload their copy again', async () => {
  const old = testServer();
  const a = await device(old);
  await write(a.store, newRestaurant({ path: 'restaurants/r.md', name: 'R', notes: 'From A' }));
  await a.sync.sync();

  // A brand-new, empty server at the same address; the device signs in again.
  const fresh = testServer();
  const store = a.store;
  const sync = createSync({ store, fetch: deviceFetch(fresh.app) });
  await sync.init();
  await sync.sendCode('me@example.com');
  await sync.verify('me@example.com', fresh.codes.get('me@example.com'));
  assert.equal(sync.state.status, 'idle');
  assert.equal(sync.state.pending, 0);

  const b = await device(fresh);
  await b.sync.sync();
  assert.equal((await read(b.store, 'restaurants/r.md')).notes, 'From A');
});
