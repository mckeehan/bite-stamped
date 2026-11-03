// Starts the Bite-Stamped server: `npm start` (node --env-file-if-exists=.env server/index.js)
// Settings come from environment variables or .env; see README.md.

import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { normalizeEmail } from './auth.js';

const env = process.env;
const config = {
  port: Number(env.PORT) || 8080,
  host: env.HOST || '127.0.0.1',
  dataDir: resolve(env.DATA_DIR || 'data'),
  allowedEmails: String(env.ALLOWED_EMAILS || '').split(',').map(normalizeEmail).filter(Boolean),
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || '',
  // Behind a reverse proxy (Apache, Caddy, nginx, Tailscale serve): trust its
  // X-Forwarded-Proto/-Host/-For headers.
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  // Serve the app below a path, e.g. /bites for https://example.com/bites/.
  basePath: String(env.BASE_PATH || '').replace(/\/+$/, ''),
};

if (config.basePath && !/^(\/[\w.-]+)+$/.test(config.basePath)) {
  console.error(`BASE_PATH must look like /bites (got "${env.BASE_PATH}").`);
  process.exit(1);
}

if (config.smtpUrl && !config.mailFrom) {
  console.error('SMTP_URL is set, so MAIL_FROM (the sender address) is needed too.');
  process.exit(1);
}
if (!config.allowedEmails.length) console.warn('[bite-stamped] ALLOWED_EMAILS is empty: nobody can sign in to sync.');
console.log(`[bite-stamped] sign-in codes go ${config.smtpUrl ? `by email via ${new URL(config.smtpUrl).hostname}` : 'to this log (no SMTP_URL set)'}`);

const app = createApp(config);

function toRequest(req) {
  const first = (h) => String(h || '').split(',')[0].trim();
  const proto = config.trustProxy && req.headers['x-forwarded-proto'] ? first(req.headers['x-forwarded-proto']) : 'http';
  const host = (config.trustProxy && first(req.headers['x-forwarded-host'])) || req.headers.host || `localhost:${config.port}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`${proto}://${host}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  });
}

const server = createServer(async (req, res) => {
  try {
    const ip = (config.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    const response = await app.handle(toRequest(req), ip);
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    if (response.body && req.method !== 'HEAD') Readable.fromWeb(response.body).pipe(res);
    else res.end();
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(400);
    res.end();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[bite-stamped] serving on http://${config.host}:${config.port}${config.basePath}/ · data in ${config.dataDir}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close();
    app.close();
    process.exit(0);
  });
}
