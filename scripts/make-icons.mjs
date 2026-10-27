// Genera le icone PNG dell'estensione (16, 32, 48, 128) senza dipendenze.
// Uso: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SS = 4; // sovracampionamento per l'antialias

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const TEAL = [23, 168, 154], CORAL = [255, 132, 96], WHITE = [255, 255, 255];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// colore del punto (u, v) in coordinate 0..1, oppure null se trasparente
function sample(u, v, size) {
  if (!inRoundRect(u, v, 0.03, 0.03, 0.97, 0.97, 0.24)) return null;
  let c = mix(TEAL, CORAL, Math.min(1, Math.max(0, (u + v) / 2 * 1.1 - 0.05)));
  // riflesso del vetro in alto
  const hl = Math.max(0, 1 - Math.hypot(u - 0.2, v - 0.05) / 0.75) * 0.35;
  c = mix(c, WHITE, hl);
  // tre cursori verticali con la manopola a altezze diverse
  const cols = [0.3, 0.5, 0.7], knobs = [0.62, 0.36, 0.52];
  const tw = size <= 16 ? 0.07 : 0.045, kw = size <= 16 ? 0.13 : 0.11, kh = size <= 16 ? 0.11 : 0.08;
  for (let i = 0; i < 3; i++) {
    if (inRoundRect(u, v, cols[i] - tw / 2, 0.2, cols[i] + tw / 2, 0.8, tw / 2)) c = mix(c, WHITE, 0.55);
    if (inRoundRect(u, v, cols[i] - kw / 2, knobs[i] - kh / 2, cols[i] + kw / 2, knobs[i] + kh / 2, kh / 2)) c = WHITE;
  }
  return c;
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, size);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (y * size + x) * 4;
    if (a) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = 255 * a / (SS * SS); }
  }
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), png(size, buf));
}
console.log("icone create in icons/");
