import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZip, readZip } from '../js/zip.js';

test('reads back what it writes', async () => {
  const image = new Uint8Array([0xff, 0xd8, 0, 1, 2, 3, 0xff, 0xd9]);
  const zip = await createZip([
    { path: 'restaurants/café.md', data: '---\nname: Café\n---\n' },
    { path: 'media/cafe/a.jpg', data: new Blob([image]) },
  ]);
  const files = await readZip(zip);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'restaurants/café.md');
  assert.equal(new TextDecoder().decode(files[0].bytes), '---\nname: Café\n---\n');
  assert.deepEqual(files[1].bytes, image);
});

test('the system unzip accepts our archives, and we read deflated ones', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'eats-zip-'));
  const ours = join(dir, 'ours.zip');
  writeFileSync(ours, new Uint8Array(await (await createZip([{ path: 'a/b.md', data: 'hello' }])).arrayBuffer()));
  try {
    execFileSync('unzip', ['-tq', ours]);
  } catch (e) {
    if (e.code === 'ENOENT') return t.skip('unzip not installed');
    throw e;
  }

  try {
    new DecompressionStream('deflate-raw');
  } catch {
    return t.skip('this Node has no deflate-raw (needs Node 22+)');
  }
  writeFileSync(join(dir, 'big.md'), 'repeat '.repeat(1000));
  execFileSync('zip', ['-q', 'theirs.zip', 'big.md'], { cwd: dir });
  const files = await readZip(new Blob([readFileSync(join(dir, 'theirs.zip'))]));
  assert.equal(new TextDecoder().decode(files[0].bytes), 'repeat '.repeat(1000));
});
