// A small SMTP client for the sign-in emails, using only node:net and node:tls.
//   smtps://user:pass@host:465   TLS from the start
//   smtp://user:pass@host:587    STARTTLS (required, except to localhost)
// Add ?insecure to an smtp:// URL to allow a plain connection to another host
// (only for a relay on a trusted network).

import net from 'node:net';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';

const TIMEOUT = 20_000;

function reader(socket) {
  let buffer = '';
  let lines = [];
  let waiting = null;
  let failure = null;

  const settle = () => {
    if (!waiting) return;
    if (failure) { const w = waiting; waiting = null; w.reject(failure); return; }
    let i;
    while ((i = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines };
        lines = [];
        const w = waiting;
        waiting = null;
        w.resolve(reply);
        return;
      }
    }
  };
  const onData = (d) => { buffer += d.toString('utf8'); settle(); };
  const onError = (e) => { failure = e; settle(); };
  const onClose = () => { failure ??= new Error('SMTP connection closed'); settle(); };
  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  return {
    read: () => new Promise((resolve, reject) => {
      waiting = { resolve, reject };
      settle();
    }),
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    },
  };
}

function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

function message({ from, fromName, to, subject, text }) {
  const domain = from.split('@')[1];
  const body = text.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
  return [
    `From: ${fromName ? `${encodeHeader(fromName)} ` : ''}<${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');
}

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1';
const safeAddress = (a) => /^[^\s<>@,;:"\r\n]+@[^\s<>@,;:"\r\n]+$/.test(a);

export async function sendMail(url, mail) {
  const u = new URL(url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error('SMTP_URL must start with smtp:// or smtps://');
  if (!safeAddress(mail.from) || !safeAddress(mail.to)) throw new Error('Invalid email address');
  const implicitTLS = u.protocol === 'smtps:';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const port = Number(u.port) || (implicitTLS ? 465 : 587);
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);

  let socket = implicitTLS ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
  socket.setTimeout(TIMEOUT, () => socket.destroy(new Error('SMTP timeout')));
  let r = reader(socket);

  const expect = async (codes, what) => {
    const reply = await r.read();
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${what}: ${reply.lines.join(' | ')}`);
    return reply;
  };
  const command = (line, codes, what = line.split(' ')[0]) => {
    socket.write(`${line}\r\n`);
    return expect(codes, what);
  };

  try {
    await expect([220], 'greeting');
    let ehlo = await command('EHLO bite-stamped.local', [250], 'EHLO');

    if (!implicitTLS) {
      const canTLS = ehlo.lines.some((l) => /^250[- ]STARTTLS\b/i.test(l));
      if (canTLS) {
        await command('STARTTLS', [220]);
        r.detach();
        socket = tls.connect({ socket, servername: host });
        socket.setTimeout(TIMEOUT, () => socket.destroy(new Error('SMTP timeout')));
        await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
        r = reader(socket);
        ehlo = await command('EHLO bite-stamped.local', [250], 'EHLO');
      } else if (!isLocal(host) && !u.searchParams.has('insecure')) {
        throw new Error(`${host} does not offer STARTTLS; use smtps:// or add ?insecure`);
      }
    }

    if (user) {
      const token = Buffer.from(`\0${user}\0${pass}`).toString('base64');
      await command(`AUTH PLAIN ${token}`, [235], 'AUTH');
    }
    await command(`MAIL FROM:<${mail.from}>`, [250]);
    await command(`RCPT TO:<${mail.to}>`, [250, 251]);
    await command('DATA', [354]);
    socket.write(`${message(mail)}\r\n.\r\n`);
    await expect([250], 'message');
    socket.write('QUIT\r\n');
  } finally {
    socket.end();
  }
}
