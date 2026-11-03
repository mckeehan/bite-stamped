// The Eats server as a function from a web Request to a Response: the app's
// static files plus the sync API under /api/. server/index.js plugs it into
// node:http; the tests call it directly.

import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStorage } from './storage.js';
import { createAuth } from './auth.js';
import { createFiles } from './files.js';
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
    "img-src 'self' blob: data:",
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
    return async (email, code) => console.log(`[eats] sign-in code for ${email}: ${code}`);
  }
  return (email, code) => sendMail(config.smtpUrl, {
    from: config.mailFrom,
    fromName: 'Eats',
    to: email,
    subject: `Eats sign-in code: ${code}`,
    text: `Your sign-in code for Eats is ${code}\n\nIt is valid for 10 minutes. If you did not ask for it, ignore this email.\n`,
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
  const limitSignIn = rateLimiter(20, 60 * 60_000);

  async function api(request, url, ip) {
    const { pathname } = url;
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') checkSameOrigin(request, url);

    if (pathname === '/api/auth/start' && method === 'POST') { limitSignIn(ip); return auth.start(request); }
    if (pathname === '/api/auth/verify' && method === 'POST') { limitSignIn(ip); return auth.verify(request, url); }
    if (pathname === '/api/auth/logout' && method === 'POST') return auth.logout(request, url);

    const user = auth.currentUser(request);
    if (pathname === '/api/auth/me' && method === 'GET') return json({ email: user?.email ?? null });
    if (!user) throw new HttpError(401, { error: 'Not signed in' });

    if (pathname === '/api/changes' && method === 'GET') return files.changes(url);
    if (pathname.startsWith('/api/files/')) {
      const path = decodeURIComponent(pathname.slice('/api/files/'.length));
      if (method === 'GET') return files.get(path, url.searchParams.get('rev'));
      if (method === 'PUT') return files.put(request, path, user);
      if (method === 'DELETE') return files.remove(request, path, user);
    }
    throw new HttpError(404, { error: 'Not found' });
  }

  async function serveStatic(url) {
    let path = decodeURIComponent(url.pathname);
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

  async function handle(request, ip = '') {
    const url = new URL(request.url);
    let response;
    if (url.pathname.startsWith('/api/')) {
      try {
        response = await api(request, url, ip);
      } catch (e) {
        if (!(e instanceof HttpError)) console.error(e);
        response = e instanceof HttpError ? json(e.body, e.status) : json({ error: 'Server error' }, 500);
      }
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      response = await serveStatic(url);
    } else {
      response = new Response('Method not allowed', { status: 405 });
    }
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) response.headers.set(k, v);
    return response;
  }

  return { handle, storage, close: () => storage.close() };
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

// Writes must come from the app itself: a custom header (which other sites
// cannot send without a CORS preflight, which this server never allows) and,
// when the browser sends one, a matching Origin.
function checkSameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (request.headers.get('X-Eats') !== '1' || (origin && origin !== url.origin)) {
    throw new HttpError(403, { error: 'Forbidden' });
  }
}
