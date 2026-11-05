// The visits as an iCalendar feed (RFC 5545), for calendar apps to subscribe
// to: GET /api/calendar/<token>.ics. Calendar apps can't sign in, so each
// account gets a private link with a random token; signed-in users create,
// replace or remove theirs through /api/calendar.

import { fromMarkdown, isPlaceFile } from '../app/js/model.js';
import { json, readJSON, randomToken, sha256, HttpError } from './http.js';

export function createCalendar({ storage, config }) {
  const base = config.basePath || '';
  const feedURL = (url, token) => `${url.origin}${base}/api/calendar/${token}.ics`;
  const row = (email) => storage.get('SELECT token, created_at, time_zone FROM calendar_feeds WHERE email = ?', email);
  const answer = (url, r) => json(r
    ? { url: feedURL(url, r.token), created: new Date(r.created_at).toISOString(), timeZone: r.time_zone || SERVER_ZONE }
    : { url: null });

  // Signed-in: the account's link (or null), a new one, or none.
  const info = (user, url) => answer(url, row(user.email));
  // The device sends its time zone, which visit times are in.
  async function create(user, url, request) {
    let input = {};
    try { input = await readJSON(request); } catch {}
    storage.run(
      `INSERT INTO calendar_feeds (email, token, created_at, time_zone) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET token = excluded.token, created_at = excluded.created_at, time_zone = excluded.time_zone`,
      user.email, randomToken(24), Date.now(), validZone(input.timeZone),
    );
    return answer(url, row(user.email));
  }
  function remove(user) {
    storage.run('DELETE FROM calendar_feeds WHERE email = ?', user.email);
    return json({ url: null });
  }

  // The feed itself; the token is the only key.
  function feed(token, url) {
    const owner = /^[\w-]{20,64}$/.test(token) && storage.get('SELECT email, time_zone FROM calendar_feeds WHERE token = ?', token);
    if (!owner || !config.allowedEmails.includes(owner.email)) throw new HttpError(404, { error: 'Not found' });
    const restaurants = [];
    // places/, and restaurants/ from before 2.0.0 (until a device moves them).
    for (const f of storage.all("SELECT path, rev FROM files WHERE deleted = 0 AND (path LIKE 'places/%.md' OR path LIKE 'restaurants/%.md')")) {
      if (!isPlaceFile(f.path)) continue;
      const bytes = storage.readVersion(f.path, f.rev);
      if (!bytes) continue;
      try {
        restaurants.push(fromMarkdown(f.path, new TextDecoder().decode(bytes)));
      } catch {
        // a file that doesn't parse is left out
      }
    }
    const appURL = `${url.origin}${base}/`;
    return new Response(toICS(restaurants, { appURL, timeZone: owner.time_zone || SERVER_ZONE }), {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="bite-stamped-visits.ics"',
        'Cache-Control': 'private, no-cache',
      },
    });
  }

  return { info, create, remove, feed };
}

// --- time zones ---

const SERVER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

// An IANA time zone name this server knows, or ''.
export function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return zone;
  } catch {
    return '';
  }
}

// How far ahead of UTC the zone's clocks are at an instant, in ms.
function offsetAt(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, Number(p.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms;
}

// The instant a wall-clock time in a zone stands for (daylight saving included).
export function zonedTime(y, mo, d, h, min, zone) {
  const wall = Date.UTC(y, mo - 1, d, h, min);
  let ms = wall - offsetAt(wall, zone);
  ms = wall - offsetAt(ms, zone); // again, in case the offset changes in between
  return new Date(ms);
}

// --- iCalendar ---

const text = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes continue on the next line after a space,
// without splitting a character.
function fold(line) {
  const out = [];
  let part = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(part);
      part = '';
      bytes = 0;
    }
    part += ch;
    bytes += n;
  }
  out.push(part);
  return out.join('\r\n ');
}

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

// A visit's date as DTSTART/DTEND lines: a moment at that time (the end is the
// start, written out so no app adds a default length of its own), or the whole
// day when only the date is known. null if not a date. Times are stored as
// clock times without a zone; they go out in UTC, read in `zone`, because
// some calendar apps (Apple's) take times without a zone for UTC.
function when(date, zone) {
  const m = String(date).match(/^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?$/);
  if (!m) return null;
  const [, y, mo, d, h, min] = m;
  if (h) {
    const at = stamp(zonedTime(Number(y), Number(mo), Number(d), Number(h), Number(min), zone));
    return [`DTSTART:${at}`, `DTEND:${at}`];
  }
  const next = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + 1));
  return [`DTSTART;VALUE=DATE:${y}${mo}${d}`, `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`];
}

export function toICS(restaurants, { appURL = '', now = new Date(), timeZone = SERVER_ZONE } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bite-Stamped//Visits//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Bite-Stamped visits',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const r of restaurants) {
    const where = [r.address, r.city, r.state, r.country].filter(Boolean).join(', ');
    const link = appURL ? `${appURL}#/r/${encodeURIComponent(r.path)}` : '';
    const seen = new Map();
    for (const v of r.visits) {
      const times = when(v.date, timeZone);
      if (!times) continue;
      // Visits have no id: the restaurant, the date and, for several on one
      // date, which one, keep an event the same from one refresh to the next.
      const n = (seen.get(v.date) || 0) + 1;
      seen.set(v.date, n);
      const details = [
        v.rating ? `${'★'.repeat(v.rating)}${'☆'.repeat(5 - v.rating)}` : '',
        r.cuisine,
        v.people.length ? `With ${v.people.join(', ')}` : '',
        v.notes,
        link,
      ].filter(Boolean).join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${sha256(`${r.path}\n${v.date}\n${n}`).slice(0, 32)}@bite-stamped`,
        `DTSTAMP:${stamp(now)}`,
        ...times,
        `SUMMARY:${text(r.name || r.path.replace(/^[^/]+\//, '').replace(/\.md$/, ''))}`,
        ...(where ? [`LOCATION:${text(where)}`] : []),
        ...(Number.isFinite(r.lat) && Number.isFinite(r.lon) ? [`GEO:${r.lat};${r.lon}`] : []),
        ...(details ? [`DESCRIPTION:${text(details)}`] : []),
        ...(link ? [`URL:${link}`] : []),
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
