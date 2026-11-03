// The SMTP client against a tiny fake mail server on localhost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendMail } from '../server/smtp.js';

function fakeSmtp({ starttls = false, authOk = true } = {}) {
  const received = { commands: [], data: '' };
  const server = net.createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 queued\r\n'); } else received.data += `${line}\n`;
          continue;
        }
        received.commands.push(line);
        if (line.startsWith('EHLO')) socket.write(`250-fake\r\n${starttls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
        else if (line.startsWith('AUTH')) socket.write(authOk ? '235 ok\r\n' : '535 bad credentials\r\n');
        else if (line.startsWith('MAIL') || line.startsWith('RCPT')) socket.write('250 ok\r\n');
        else if (line === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('500 what\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received })));
}

const mail = { from: 'eats@example.com', fromName: 'Eats', to: 'me@example.com', subject: 'Eats sign-in code: 123456', text: 'Code 123456\n.\nend' };

test('sends a message with login', async () => {
  const { server, port, received } = await fakeSmtp();
  try {
    await sendMail(`smtp://user%40x:p%40ss@localhost:${port}`, mail);
    assert.equal(received.commands[1], `AUTH PLAIN ${Buffer.from('\0user@x\0p@ss').toString('base64')}`);
    assert.ok(received.commands.includes('MAIL FROM:<eats@example.com>'));
    assert.ok(received.commands.includes('RCPT TO:<me@example.com>'));
    assert.match(received.data, /^From: Eats <eats@example.com>$/m);
    assert.match(received.data, /^Subject: Eats sign-in code: 123456$/m);
    assert.match(received.data, /^\.\.$/m); // a lone dot in the text is escaped
  } finally {
    server.close();
  }
});

test('reports a rejected login', async () => {
  const { server, port } = await fakeSmtp({ authOk: false });
  try {
    await assert.rejects(sendMail(`smtp://u:p@localhost:${port}`, mail), /535 bad credentials/);
  } finally {
    server.close();
  }
});

test('refuses unencrypted SMTP to another host unless asked', async () => {
  const { server, port, received } = await fakeSmtp();
  try {
    // Only localhost, 127.0.0.1 and ::1 are exempt; the IPv4-mapped address reaches the fake server without being exempt.
    await assert.rejects(sendMail(`smtp://u:p@[::ffff:127.0.0.1]:${port}`, mail), /does not offer STARTTLS/);
    assert.ok(!received.commands.some((c) => c.startsWith('AUTH')), 'no password sent in the clear');
    await sendMail(`smtp://u:p@[::ffff:127.0.0.1]:${port}?insecure`, mail);
  } finally {
    server.close();
  }
});

test('rejects bad settings and addresses', async () => {
  await assert.rejects(sendMail('http://x', mail), /smtp:\/\/ or smtps:\/\//);
  await assert.rejects(sendMail('smtp://localhost:1', { ...mail, to: 'a@b.c\r\nRCPT TO:<x@y.z>' }), /Invalid email/);
});
