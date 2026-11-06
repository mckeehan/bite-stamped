import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testServer, deviceFetch } from './helpers.mjs';
import { toICS, zonedTime } from '../server/calendar.js';
import { newRestaurant, toMarkdown } from '../app/js/model.js';

const W = { 'X-Bite-Stamped': '1', 'Content-Type': 'application/json' };
const post = (f, path, body) => f(path, { method: 'POST', headers: W, body: JSON.stringify(body) });

async function signIn(srv, email = 'me@example.com') {
  const f = deviceFetch(srv.app);
  await post(f, '/api/auth/start', { email });
  assert.equal((await post(f, '/api/auth/verify', { email, code: srv.codes.get(email) })).status, 200);
  return f;
}

const unfold = (ics) => ics.replace(/\r\n /g, '');

const taco = newRestaurant({
  path: 'restaurants/taco-bell.md',
  name: 'Taco Bell',
  cuisine: 'Mexican',
  address: '1407 Winfield Dunn Pkwy',
  city: 'Sevierville',
  state: 'TN',
  lat: 35.87,
  lon: -83.56,
  visits: [
    { date: '2026-11-02T19:24', rating: 4, people: ['Ann', 'Bob'], notes: 'Crunchy; good, cheap\nand fast' },
    { date: '2026-10-26', rating: 0 },
  ],
});

test('visits become events: timed ones a moment (end = start), date-only ones all day', () => {
  const ics = toICS([taco], { appURL: 'https://www.example.com/bites/', now: new Date(Date.UTC(2026, 10, 5, 12, 0, 0)), timeZone: 'America/New_York' });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.ok(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75), 'lines are folded');
  const text = unfold(ics);
  const events = text.split('BEGIN:VEVENT').slice(1);
  assert.equal(events.length, 2);
  // 7:24 pm in New York in November (EST, UTC-5) is 00:24 UTC the next day.
  assert.match(events[0], /DTSTART:20261103T002400Z\r\nDTEND:20261103T002400Z\r\n/);
  assert.match(events[0], /SUMMARY:Taco Bell/);
  assert.match(events[0], /LOCATION:1407 Winfield Dunn Pkwy\\, Sevierville\\, TN/);
  assert.match(events[0], /GEO:35.87;-83.56/);
  assert.match(events[0], /DESCRIPTION:★★★★☆\\nMexican\\nWith Ann\\, Bob\\nCrunchy\\; good\\, cheap\\nand fast\\n\[details\]\(<https:\/\/www.example.com\/bites\/#\/r\/restaurants%2Ftaco-bell.md>\)/);
  assert.match(events[0], /DTSTAMP:20261105T120000Z/);
  assert.match(events[1], /DTSTART;VALUE=DATE:20261026\r\nDTEND;VALUE=DATE:20261027/);
  // The same visit keeps its id from one refresh to the next.
  const uid = (s) => s.match(/UID:(\S+)/)[1];
  assert.equal(uid(unfold(toICS([taco], { timeZone: 'Europe/Zurich' }))), uid(events[0]));
  assert.notEqual(uid(events[0]), uid(events[1]));
});

test('calendar link: only signed in to manage, the token opens the feed, a new link replaces the old', async () => {
  const srv = testServer();
  const anon = deviceFetch(srv.app);
  assert.equal((await anon('/api/calendar')).status, 401);

  const f = await signIn(srv);
  await f('/api/files/restaurants/taco-bell.md', { method: 'PUT', headers: { 'X-Bite-Stamped': '1', 'Content-Type': 'text/markdown' }, body: toMarkdown(taco) });

  assert.deepEqual(await (await f('/api/calendar')).json(), { url: null });
  assert.equal((await f('/api/calendar', { method: 'POST' })).status, 403, 'writes need the app header');
  const { url } = await (await f('/api/calendar', { method: 'POST', headers: W })).json();
  assert.match(url, /^https:\/\/bite-stamped\.test\/api\/calendar\/[\w-]{32}\.ics$/);
  assert.equal((await (await f('/api/calendar')).json()).url, url);

  // No cookie needed for the feed itself.
  const res = await anon(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type'), /^text\/calendar/);
  assert.equal(unfold(await res.text()).split('BEGIN:VEVENT').length - 1, 2);

  const { url: next } = await (await f('/api/calendar', { method: 'POST', headers: W })).json();
  assert.notEqual(next, url);
  assert.equal((await anon(url)).status, 404);
  assert.equal((await anon(next)).status, 200);

  await f('/api/calendar', { method: 'DELETE', headers: W });
  assert.equal((await anon(next)).status, 404);
  assert.equal((await anon('/api/calendar/not-a-real-token-at-all-xx.ics')).status, 404);
});

test('clock times in a time zone, with daylight saving time', () => {
  const utc = (...a) => zonedTime(...a).toISOString();
  assert.equal(utc(2026, 11, 4, 12, 57, 'America/New_York'), '2026-11-04T17:57:00.000Z'); // EST
  assert.equal(utc(2026, 7, 4, 12, 57, 'America/New_York'), '2026-07-04T16:57:00.000Z'); // EDT
  assert.equal(utc(2026, 3, 8, 3, 30, 'America/New_York'), '2026-03-08T07:30:00.000Z'); // the morning DST starts
  assert.equal(utc(2026, 11, 1, 0, 30, 'America/New_York'), '2026-11-01T04:30:00.000Z'); // the night DST ends
  assert.equal(utc(2026, 1, 15, 9, 0, 'Europe/Zurich'), '2026-01-15T08:00:00.000Z');
  assert.equal(utc(2026, 1, 15, 9, 0, 'UTC'), '2026-01-15T09:00:00.000Z');
});

test('a new link keeps the time zone the device sends, and ignores one it does not know', async () => {
  const srv = testServer();
  const f = await signIn(srv);
  const make = async (timeZone) => (await f('/api/calendar', { method: 'POST', headers: W, body: JSON.stringify({ timeZone }) })).json();
  assert.equal((await make('America/Chicago')).timeZone, 'America/Chicago');
  assert.equal((await make('Mars/Olympus_Mons')).timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
});
