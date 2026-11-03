// Draws the app icon (a plate with fork and knife) as SVG and as PNGs.
// No image libraries: shapes are rasterised here with 4×4 supersampling and
// written as PNG with node:zlib. Run with `npm run icons`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(out, { recursive: true });

const BG = [0xc2, 0x41, 0x0c];
const WHITE = [0xff, 0xff, 0xff];
const RIM = [0xfd, 0xe8, 0xdc];

// Layers in 512-unit space, painted in order; each is [color, inside(x, y)].
const circle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect = (x0, y0, x1, y1, r = 0) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.max(x0 + r, Math.min(x, x1 - r));
  const cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const layers = [
  [WHITE, circle(256, 256, 150)],
  [RIM, circle(256, 256, 112)],
  [WHITE, circle(256, 256, 100)],
  // fork
  [WHITE, rect(70, 120, 80, 200, 5)],
  [WHITE, rect(88, 120, 98, 200, 5)],
  [WHITE, rect(106, 120, 116, 200, 5)],
  [WHITE, rect(70, 185, 116, 225, 18)],
  [WHITE, rect(84, 210, 102, 392, 9)],
  // knife
  [WHITE, rect(398, 120, 436, 270, 19)],
  [WHITE, rect(398, 140, 418, 270)],
  [WHITE, rect(408, 250, 426, 392, 9)],
];

function render(size, { rounded }) {
  const px = new Uint8Array(size * size * 4);
  const s = 512 / size;
  const corner = rounded ? rect(0, 0, 512, 512, 112) : () => true;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const ux = (x + (sx + 0.5) / 4) * s;
          const uy = (y + (sy + 0.5) / 4) * s;
          if (!corner(ux, uy)) continue;
          let c = BG;
          // Glyph at 80% so it stays inside the safe zone of maskable icons.
          const gx = 256 + (ux - 256) / 0.8, gy = 256 + (uy - 256) / 0.8;
          for (const [color, inside] of layers) if (inside(gx, gy)) c = color;
          r += c[0]; g += c[1]; b += c[2]; a += 255;
        }
      }
      const i = (y * size + x) * 4;
      const n = a / 255 || 1;
      px.set([r / n, g / n, b / n, a / 16], i);
    }
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#c2410c"/>
<circle cx="256" cy="256" r="150" fill="#fff"/><circle cx="256" cy="256" r="112" fill="#fde8dc"/><circle cx="256" cy="256" r="100" fill="#fff"/>
<g fill="#fff"><rect x="70" y="120" width="10" height="80" rx="5"/><rect x="88" y="120" width="10" height="80" rx="5"/><rect x="106" y="120" width="10" height="80" rx="5"/>
<rect x="70" y="185" width="46" height="40" rx="18"/><rect x="84" y="210" width="18" height="182" rx="9"/>
<rect x="398" y="120" width="38" height="150" rx="19"/><rect x="398" y="140" width="20" height="130"/><rect x="408" y="250" width="18" height="142" rx="9"/></g>
</svg>
`;

writeFileSync(out + 'icon.svg', svg);
writeFileSync(out + 'icon-192.png', render(192, { rounded: false }));
writeFileSync(out + 'icon-512.png', render(512, { rounded: false }));
writeFileSync(out + 'apple-touch-icon.png', render(180, { rounded: false }));
console.log('Icons written to', out);
