// Offline check-ins (app/js/offline.js), kept in a device's meta table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offlineCheckIns } from '../app/js/offline.js';

const memoryMeta = () => {
  const m = new Map();
  return { getMeta: async (k) => m.get(k), setMeta: async (k, v) => { m.set(k, structuredClone(v)); } };
};

test('offline check-ins are kept with what was typed, where and when, until done', async () => {
  const offline = offlineCheckIns(memoryMeta());
  assert.deepEqual(await offline.list(), []);
  const a = await offline.add({ query: '  taco bell ', lat: 35.96, lon: -83.92, date: '2026-11-06T12:30' });
  const b = await offline.add({ query: '', lat: undefined, lon: 5, date: '2026-11-06T18:05' });
  assert.deepEqual(a, { id: a.id, query: 'taco bell', lat: 35.96, lon: -83.92, date: '2026-11-06T12:30' });
  assert.equal(b.lat, null, 'no location: neither coordinate');
  assert.equal(b.lon, null);
  assert.notEqual(a.id, b.id);
  assert.deepEqual((await offline.list()).map((c) => c.id), [a.id, b.id], 'oldest first');
  assert.deepEqual(await offline.get(b.id), b);
  await offline.remove(a.id);
  assert.deepEqual((await offline.list()).map((c) => c.id), [b.id]);
  assert.equal(await offline.get(a.id), null);
});
