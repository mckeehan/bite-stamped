import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { testServer, deviceFetch } from './helpers.mjs';
import { validPath } from '../server/files.js';
import { createApp } from '../server/app.js';

const W = { 'X-Bite-Stamped': '1', 'Content-Type': 'application/json' };
const post = (f, path, body) => f(path, { method: 'POST', headers: W, body: JSON.stringify(body) });

async function signIn(srv, email = 'me@example.com') {
  const f = deviceFetch(srv.app);
  await post(f, '/api/auth/start', { email });
  const res = await post(f, '/api/auth/verify', { email, code: srv.codes.get(email) });
  assert.equal(res.status, 200);
  return f;
}

test('serves the app with security headers, and nothing outside it', async () => {
  const { app } = testServer();
  const f = deviceFetch(app);
  const home = await f('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('Content-Type'), /text\/html/);
  assert.match(home.headers.get('Content-Security-Policy'), /default-src 'self'/);
  assert.equal((await f('/js/app.js')).status, 200);
  assert.equal((await f('/../package.json')).status, 404);
  assert.equal((await f('/%2e%2e/package.json')).status, 404);
  assert.equal((await f('/nope.html')).status, 404);
});

test('only allow-listed addresses get a code, and the answer does not tell', async () => {
  const srv = testServer();
  const f = deviceFetch(srv.app);
  const res = await post(f, '/api/auth/start', { email: 'someone@else.com' });
  assert.equal(res.status, 200);
  assert.equal(srv.codes.size, 0);
  await post(f, '/api/auth/start', { email: 'Partner@Example.com ' });
  assert.match(srv.codes.get('partner@example.com'), /^\d{6}$/);
});

test('sign-in sets an HttpOnly cookie that opens the API', async () => {
  const srv = testServer();
  const f = deviceFetch(srv.app);
  assert.equal((await f('/api/changes')).status, 401);

  await post(f, '/api/auth/start', { email: 'me@example.com' });
  const res = await post(f, '/api/auth/verify', { email: 'me@example.com', code: srv.codes.get('me@example.com') });
  assert.match(res.headers.get('Set-Cookie'), /HttpOnly; SameSite=Strict.*Secure/);
  assert.equal((await f('/api/changes')).status, 200);
  assert.deepEqual(await (await f('/api/auth/me')).json(), { email: 'me@example.com', fallbackSearch: false, placesDir: true });

  await post(f, '/api/auth/logout', {});
  assert.equal((await f('/api/changes')).status, 401);
});

test('a code works once and stops after five wrong tries', async () => {
  const srv = testServer();
  const f = deviceFetch(srv.app);
  await post(f, '/api/auth/start', { email: 'me@example.com' });
  const code = srv.codes.get('me@example.com');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await post(f, '/api/auth/verify', { email: 'me@example.com', code: wrong })).status, 400);
  assert.equal((await post(f, '/api/auth/verify', { email: 'me@example.com', code })).status, 400);
});

test('sign-in attempts are limited per address', async () => {
  const srv = testServer();
  const f = deviceFetch(srv.app);
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await post(f, '/api/auth/start', { email: 'someone@else.com' })).status);
  assert.equal(statuses.filter((s) => s === 429).length, 2);
});

test('a failed email is reported and no code is left behind', async () => {
  const srv = testServer({ sendCode: async () => { throw new Error('connection refused'); } });
  const f = deviceFetch(srv.app);
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await post(f, '/api/auth/start', { email: 'me@example.com' })).status, 502);
  } finally {
    console.error = original;
  }
  assert.equal(srv.app.storage.get('SELECT count(*) n FROM login_codes').n, 0);
});

test('removing an address from the list ends its sessions', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  srv.config.allowedEmails.splice(0, srv.config.allowedEmails.length, 'partner@example.com');
  assert.equal((await f('/api/changes')).status, 401);
});

test('writes need the app header and the same origin', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  const put = (headers) => f('/api/files/restaurants/a.md', { method: 'PUT', headers, body: 'x' });
  assert.equal((await put({})).status, 403);
  assert.equal((await put({ 'X-Bite-Stamped': '1', Origin: 'https://evil.example' })).status, 403);
  assert.equal((await put({ 'X-Bite-Stamped': '1', Origin: 'https://bite-stamped.test' })).status, 200);
});

test('files: create, read, conflict, delete, change feed, files on disk', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  const put = (path, body, rev) => f(`/api/files/${path}`, {
    method: 'PUT', headers: { 'X-Bite-Stamped': '1', 'Content-Type': 'text/markdown', ...(rev ? { 'If-Match': `"${rev}"` } : {}) }, body,
  });

  const r1 = await (await put('restaurants/a.md', 'one')).json();
  assert.equal(await (await f('/api/files/restaurants/a.md')).text(), 'one');

  // A second "new" file at the same path conflicts and reports the current version.
  const clash = await put('restaurants/a.md', 'other');
  assert.equal(clash.status, 409);
  assert.equal((await clash.json()).current.rev, r1.rev);

  const r2 = await (await put('restaurants/a.md', 'two', r1.rev)).json();
  assert.equal((await put('restaurants/a.md', 'stale', r1.rev)).status, 409);
  // Old versions stay readable (backup), and the current one is a plain file.
  assert.equal(await (await f(`/api/files/restaurants/a.md?rev=${r1.rev}`)).text(), 'one');
  assert.equal(readFileSync(join(srv.dataDir, 'files/restaurants/a.md'), 'utf8'), 'two');

  await put('media/a/x.jpg', 'img');
  const del = await f('/api/files/restaurants/a.md', { method: 'DELETE', headers: { 'X-Bite-Stamped': '1', 'If-Match': `"${r2.rev}"` } });
  assert.equal(del.status, 200);
  assert.equal((await f('/api/files/restaurants/a.md')).status, 404);
  assert.ok(!existsSync(join(srv.dataDir, 'files/restaurants/a.md')));
  assert.equal(readFileSync(join(srv.dataDir, `versions/restaurants/a.md/${r2.rev}`), 'utf8'), 'two');

  const feed = await (await f('/api/changes?since=0')).json();
  assert.deepEqual(feed.changes.map((c) => [c.path, c.deleted]), [['media/a/x.jpg', false], ['restaurants/a.md', true]]);
  assert.deepEqual((await (await f(`/api/changes?since=${feed.cursor}`)).json()).changes, []);
});

test('large uploads are refused', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  const big = new Uint8Array(25 * 1024 * 1024 + 1);
  const res = await f('/api/files/media/a/big.jpg', { method: 'PUT', headers: { 'X-Bite-Stamped': '1' }, body: big });
  assert.equal(res.status, 413);
});

test('data survives a restart', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  await f('/api/files/restaurants/k.md', { method: 'PUT', headers: { 'X-Bite-Stamped': '1' }, body: 'kept' });
  srv.app.close();
  srv.app.close = () => {}; // already closed; the cleanup hook calls it again
  const again = createApp(srv.config);
  try {
    assert.equal(again.storage.get('SELECT count(*) n FROM files').n, 1);
    const migrations = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).length;
    assert.equal(again.storage.get('SELECT count(*) n FROM schema_migrations').n, migrations);
  } finally {
    again.close();
  }
});

test('paths are limited to the app folders', () => {
  assert.ok(validPath('places/TN-newport-a.md'));
  assert.ok(validPath('restaurants/a.md'), 'before 2.0.0');
  assert.ok(validPath('media/a/b.jpg'));
  for (const bad of ['secrets.txt', 'restaurants/../x', 'media//x', 'restaurants/a\\b', '/restaurants/a.md', 'media/a/x.tmp']) {
    assert.ok(!validPath(bad), bad);
  }
});

test('BASE_PATH: everything lives below it', async () => {
  const srv = testServer({ basePath: '/bites' });
  const f = deviceFetch(srv.app);

  for (const path of ['/bites', '/']) {
    const res = await f(path);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('Location'), '/bites/');
  }
  assert.match(await (await f('/bites/')).text(), /<title>Bite-Stamped<\/title>/);
  assert.equal((await f('/bites/js/sync.js')).status, 200);
  assert.equal((await f('/js/sync.js')).status, 404);
  assert.equal((await f('/bitesx/js/sync.js')).status, 404);
  assert.equal((await f('/api/changes')).status, 404);

  await post(f, '/bites/api/auth/start', { email: 'me@example.com' });
  const res = await post(f, '/bites/api/auth/verify', { email: 'me@example.com', code: srv.codes.get('me@example.com') });
  assert.match(res.headers.get('Set-Cookie'), /Path=\/bites\/api\//);
  assert.equal((await f('/bites/api/changes')).status, 200);
});
