// Draws the app icon (a map pin with a check mark in a round, dashed stamp:
// places you have been, stamped like a passport) as SVG and as PNGs.
// No image libraries: shapes are rasterised here with 4×4 supersampling and
// written as PNG with node:zlib. Run with `npm run icons`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../app/icons/', import.meta.url));
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
// The pin: a circle with a point below, made of the circle and the triangle
// between the point and where its sides touch the circle.
const PIN = { cx: 256, cy: 218, r: 96, tipY: 404 };
const tangent = (() => {
  const d = PIN.tipY - PIN.cy;
  const sin = Math.sqrt(1 - (PIN.r / d) ** 2);
  return { dx: PIN.r * sin, y: PIN.cy + (PIN.r * PIN.r) / d };
})();
const triangle = (ax, ay, bx, by, cx, cy) => (x, y) => {
  const side = (px, py, qx, qy) => (qx - px) * (y - py) - (qy - py) * (x - px);
  const d1 = side(ax, ay, bx, by), d2 = side(bx, by, cx, cy), d3 = side(cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const pin = (x, y) => circle(PIN.cx, PIN.cy, PIN.r)(x, y)
  || triangle(PIN.cx - tangent.dx, tangent.y, PIN.cx + tangent.dx, tangent.y, PIN.cx, PIN.tipY)(x, y);
// The stamp: a ring of dashes, and a thin ring inside it.
const ring = (r0, r1) => (x, y) => { const d = Math.hypot(x - 256, y - 256); return d >= r0 && d <= r1; };
const DASHES = 24, DUTY = 0.6;
const dashed = (r0, r1) => (x, y) => {
  if (!ring(r0, r1)(x, y)) return false;
  const turn = ((Math.atan2(y - 256, x - 256) / (2 * Math.PI)) + 1) % 1;
  return (turn * DASHES) % 1 < DUTY;
};
// A check mark: two strokes with round ends.
const CHECK = [[212, 220], [244, 252], [302, 188]];
const CHECK_WIDTH = 26;
const stroke = (points, width) => (x, y) => points.slice(1).some(([bx, by], i) => {
  const [ax, ay] = points[i];
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))) <= width / 2;
});
const layers = [
  [WHITE, dashed(205, 220)],
  [RIM, ring(185, 192)],
  [WHITE, pin],
  [BG, stroke(CHECK, CHECK_WIDTH)],
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

const pinPath = `M ${(PIN.cx - tangent.dx).toFixed(1)} ${tangent.y.toFixed(1)} A ${PIN.r} ${PIN.r} 0 1 1 ${(PIN.cx + tangent.dx).toFixed(1)} ${tangent.y.toFixed(1)} L ${PIN.cx} ${PIN.tipY} Z`;
const dash = (2 * Math.PI * 212.5) / DASHES;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="112" fill="#c2410c"/>
<g transform="translate(256 256) scale(0.8) translate(-256 -256)">
<circle cx="256" cy="256" r="212.5" fill="none" stroke="#fff" stroke-width="15" stroke-dasharray="${(dash * DUTY).toFixed(2)} ${(dash * (1 - DUTY)).toFixed(2)}"/>
<circle cx="256" cy="256" r="188.5" fill="none" stroke="#fde8dc" stroke-width="7"/>
<path d="${pinPath}" fill="#fff"/>
<polyline points="${CHECK.map((p) => p.join(',')).join(' ')}" fill="none" stroke="#c2410c" stroke-width="${CHECK_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/>
</g>
</svg>
`;

writeFileSync(out + 'icon.svg', svg);
writeFileSync(out + 'icon-192.png', render(192, { rounded: false }));
writeFileSync(out + 'icon-512.png', render(512, { rounded: false }));
writeFileSync(out + 'apple-touch-icon.png', render(180, { rounded: false }));
console.log('Icons written to', out);
