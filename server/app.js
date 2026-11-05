// The Bite-Stamped server as a function from a web Request to a Response: the app's
// static files plus the sync API under /api/. server/index.js plugs it into
// node:http; the tests call it directly.

import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage } from './storage.js';
import { createAuth } from './auth.js';
import { createFiles } from './files.js';
import { createPlaces } from './places.js';
import { createCalendar } from './calendar.js';
import { sendMail } from './smtp.js';
import { json, HttpError } from './http.js';

const APP_DIR = fileURLToPath(new URL('../app/', import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' blob: data: https://tile.openstreetmap.org",
    "connect-src 'self' https://nominatim.openstreetmap.org",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

// Codes go by email when SMTP is set up; otherwise they are written to the log.
function codeSender(config) {
  if (!config.smtpUrl) {
    return async (email, code) => console.log(`[bite-stamped] sign-in code for ${email}: ${code}`);
  }
  return (email, code) => sendMail(config.smtpUrl, {
    from: config.mailFrom,
    fromName: 'Bite-Stamped',
    to: email,
    subject: `Bite-Stamped sign-in code: ${code}`,
    text: `Your sign-in code for Bite-Stamped is ${code}\n\nIt is valid for 10 minutes. If you did not ask for it, ignore this email.\n`,
  });
}

// A simple per-address limit for the sign-in endpoints.
function rateLimiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) throw new HttpError(429, { error: 'Too many attempts. Try again later.' });
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 10_000) hits.clear();
  };
}

export function createApp(config) {
  const storage = openStorage(config.dataDir);
  const auth = createAuth({ storage, config, sendCode: config.sendCode || codeSender(config) });
  const files = createFiles({ storage });
  const places = createPlaces({ apiKey: config.foursquareKey, fetch: config.fetch });
  const calendar = createCalendar({ storage, config });
  const limitSignIn = rateLimiter(20, 60 * 60_000);

  // `pathname` is the path inside the app, without BASE_PATH.
  async function api(request, url, ip, pathname) {
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') checkSameOrigin(request, url);

    if (pathname === '/api/auth/start' && method === 'POST') { limitSignIn(ip); return auth.start(request); }
    if (pathname === '/api/auth/verify' && method === 'POST') { limitSignIn(ip); return auth.verify(request, url); }
    if (pathname === '/api/auth/logout' && method === 'POST') return auth.logout(request, url);

    // Calendar apps can't sign in: the token in the link is the key.
    const ics = pathname.match(/^\/api\/calendar\/([^/]+)\.ics$/);
    if (ics && method === 'GET') return calendar.feed(ics[1], url);

    const user = auth.currentUser(request);
    if (pathname === '/api/auth/me' && method === 'GET') {
      // fallbackSearch: whether /api/places/search is there for this user.
      return json({ email: user?.email ?? null, fallbackSearch: Boolean(user && places.enabled) });
    }
    if (!user) throw new HttpError(401, { error: 'Not signed in' });

    if (pathname === '/api/changes' && method === 'GET') return files.changes(url);
    if (pathname === '/api/places/search' && method === 'GET') return places.search(url, user);
    if (pathname === '/api/calendar') {
      if (method === 'GET') return calendar.info(user, url);
      if (method === 'POST') return calendar.create(user, url, request);
      if (method === 'DELETE') return calendar.remove(user);
    }
    if (pathname.startsWith('/api/files/')) {
      const path = decodeURIComponent(pathname.slice('/api/files/'.length));
      if (method === 'GET') return files.get(path, url.searchParams.get('rev'));
      if (method === 'PUT') return files.put(request, path, user);
      if (method === 'DELETE') return files.remove(request, path, user);
    }
    throw new HttpError(404, { error: 'Not found' });
  }

  async function serveStatic(pathname) {
    let path = decodeURIComponent(pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(APP_DIR, path));
    if (!file.startsWith(APP_DIR) || file.split(sep).some((part) => part.startsWith('.'))) return notFound();
    try {
      return new Response(await readFile(file), {
        headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
      });
    } catch {
      return notFound();
    }
  }

  // With BASE_PATH (e.g. /bites) the whole app lives below it, so it can share
  // a site with other things behind a reverse proxy that passes the full path.
  const base = config.basePath || '';

  async function route(request, url, ip) {
    let pathname = url.pathname;
    if (base) {
      if (pathname === base || pathname === '/') return redirect(`${base}/`);
      if (!pathname.startsWith(`${base}/`)) return notFound();
      pathname = pathname.slice(base.length);
    }
    if (pathname.startsWith('/api/')) {
      try {
        return await api(request, url, ip, pathname);
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        return e instanceof HttpError ? json(e.body, e.status) : json({ error: 'Server error' }, 500);
      }
    }
    if (request.method === 'GET' || request.method === 'HEAD') return serveStatic(pathname);
    return new Response('Method not allowed', { status: 405 });
  }

  async function handle(request, ip = '') {
    const response = await route(request, new URL(request.url), ip);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
    return response;
  }

  return { handle, storage, close: () => storage.close() };
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
const redirect = (location) => new Response(null, { status: 301, headers: { Location: location } });

// Writes must come from the app itself: a custom header (which other sites
// cannot send without a CORS preflight, which this server never allows) and,
// when the browser sends one, a matching Origin.
function checkSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (request.headers.get('X-Bite-Stamped') !== '1' || (origin && origin !== url.origin)) {
    throw new HttpError(403, { error: 'Forbidden' });
  }
}
