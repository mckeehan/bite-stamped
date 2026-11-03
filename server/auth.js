// Sign-in with a one-time code sent by email, to allow-listed addresses only
// (ALLOWED_EMAILS). A successful sign-in sets a long-lived HttpOnly session
// cookie; the session's token is stored only as a hash.

import { randomInt } from 'node:crypto';
import { json, readJSON, sha256, randomToken, HttpError } from './http.js';

const COOKIE = 'bite_stamped_session';
const CODE_TTL = 10 * 60_000;
const RESEND_AFTER = 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_DAYS = 365;

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export function createAuth({ storage, config, sendCode }) {
  const allowed = (email) => config.allowedEmails.includes(email);

  async function start(request) {
    const email = normalizeEmail((await readJSON(request)).email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, { error: 'Enter a valid email address' });

    // Same answer whether or not the address may sign in, so the list stays private.
    const answer = json({ ok: true });
    if (!allowed(email)) return answer;

    const now = Date.now();
    const existing = storage.get('SELECT created_at FROM login_codes WHERE email = ?', email);
    if (existing && now - existing.created_at < RESEND_AFTER) return answer;

    const code = String(randomInt(1_000_000)).padStart(6, '0');
    storage.run(
      `INSERT INTO login_codes (email, code_hash, expires_at, created_at, attempts) VALUES (?, ?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         created_at = excluded.created_at, attempts = 0`,
      email, sha256(`${email}:${code}`), now + CODE_TTL, now,
    );
    try {
      await sendCode(email, code);
    } catch (e) {
      storage.run('DELETE FROM login_codes WHERE email = ?', email);
      console.error(`[bite-stamped] could not send the sign-in email to ${email}:`, e.message);
      throw new HttpError(502, { error: 'The sign-in email could not be sent. Try again later.' });
    }
    return answer;
  }

  async function verify(request, url) {
    const input = await readJSON(request);
    const email = normalizeEmail(input.email);
    const code = String(input.code || '').replace(/\D/g, '');
    const fail = new HttpError(400, { error: 'That code is not right, or it has expired. Ask for a new one.' });

    const row = storage.get('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?', email);
    if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS || !allowed(email)) throw fail;
    if (sha256(`${email}:${code}`) !== row.code_hash) {
      storage.run('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?', email);
      throw fail;
    }

    const token = randomToken();
    const now = Date.now();
    storage.transaction(() => {
      storage.run('DELETE FROM login_codes WHERE email = ?', email);
      storage.run('INSERT INTO sessions (token_hash, email, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
        sha256(token), email, String(input.device || '').slice(0, 100), now, now);
    });
    return json({ email }, 200, { 'Set-Cookie': cookie(token, url, SESSION_DAYS * 86400) });
  }

  function logout(request, url) {
    const token = readCookie(request);
    if (token) storage.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', url, 0) });
  }

  // → { email } or null
  function currentUser(request) {
    const token = readCookie(request);
    if (!token) return null;
    const hash = sha256(token);
    const row = storage.get('SELECT email, last_seen FROM sessions WHERE token_hash = ?', hash);
    if (!row || !allowed(row.email)) return null;
    if (Date.now() - row.last_seen > 86_400_000) storage.run('UPDATE sessions SET last_seen = ? WHERE token_hash = ?', Date.now(), hash);
    return { email: row.email };
  }

  function cookie(value, url, maxAge) {
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    return `${COOKIE}=${value}; Path=/api/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
  }

  return { start, verify, logout, currentUser };
}

function readCookie(request) {
  const header = request.headers.get('Cookie') || '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}
