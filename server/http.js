import { createHash, randomBytes } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

// Reads a request body, refusing more than `max` bytes.
export async function readBody(request, max) {
  if (Number(request.headers.get('Content-Length') || 0) > max) throw new HttpError(413, { error: 'Too large' });
  if (!request.body) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body) {
    size += chunk.byteLength;
    if (size > max) throw new HttpError(413, { error: 'Too large' });
    chunks.push(chunk);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export async function readJSON(request) {
  try {
    return JSON.parse(new TextDecoder().decode(await readBody(request, 10_000)));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, { error: 'Expected JSON' });
  }
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
