// Builds the menubar tray icon from the app logo (build/icon.png) and
// embeds it as base64 @1x/@2x data URLs in electron/tray-icon.ts.
//
// We emit a macOS *template* icon (monochrome silhouette, recolored by the
// OS to match the menubar — like every other well-behaved menubar icon)
// rather than the full-color logo. The art has three regions that are easy
// to separate by warmth (R−B): the black surround (R−B≈0), the cream tile
// (R−B≈17) and the tan potato (R−B≈106). We key on R−B so ONLY the potato
// becomes opaque; tile + surround go transparent. RGB is forced to black —
// template images use the alpha channel for shape and ignore color.
//
// Run:  node scripts/gen-tray-icon.mjs   (re-run if the logo changes)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'build', 'icon.png');

// Warmth (R−B) → opacity ramp. Cream tile ≈17, potato ≈106, so this band
// keeps only the potato (with a soft anti-aliased edge).
const CHROMA_LO = 35; // <= fully transparent (tile / surround)
const CHROMA_HI = 85; // >= fully opaque (potato)

// ---- PNG decode (8-bit, color type 2 RGB or 6 RGBA, non-interlaced) ----
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buf) {
  let o = 8;
  let w = 0;
  let h = 0;
  let colorType = 6;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    o += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3; // bytes per pixel
  const stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const x = raw[p++];
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let recon;
      switch (filter) {
        case 1: recon = x + a; break;
        case 2: recon = x + b; break;
        case 3: recon = x + ((a + b) >> 1); break;
        case 4: recon = x + paeth(a, b, c); break;
        default: recon = x;
      }
      cur[i] = recon & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, bpp, pixels: out };
}

// ---- PNG encode (RGBA) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodeRgba(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    rows[o++] = 0;
    rgba.copy(rows, o, y * w * 4, (y + 1) * w * 4);
    o += w * 4;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Fraction of the icon left as empty margin around the glyph. The potato
// otherwise occupies only part of the source square (centered in the tile),
// so it looked tiny next to neighbors — we crop to its bounds and scale it
// up to nearly fill the icon.
const MARGIN_FRAC = 0.06;
const WORK_SIZE = 128; // hi-res working buffer for clean area-averaged downscale

// Chroma-key the source at WORK_SIZE → a float alpha map (0..1) of the potato.
function keyedAlpha() {
  const tmp = join(root, '.tray-work.png');
  execFileSync('sips', ['-z', String(WORK_SIZE), String(WORK_SIZE), src, '--out', tmp], {
    stdio: 'ignore',
  });
  const { w, h, bpp, pixels } = decodePng(readFileSync(tmp));
  rmSync(tmp);
  const alpha = new Float32Array(w * h);
  for (let i = 0, j = 0; i < w * h; i++, j += bpp) {
    const chroma = pixels[j] - pixels[j + 2];
    alpha[i] = Math.max(0, Math.min(1, (chroma - CHROMA_LO) / (CHROMA_HI - CHROMA_LO)));
  }
  return { w, h, alpha };
}

// Tight bounding box of the keyed glyph.
function bounds(w, h, alpha, thr = 0.15) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x] > thr) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

// Crop to the glyph bounds and scale (aspect-preserving, centered) to fill
// `size` minus a small margin. Area-average downscale keeps edges smooth.
function templateDataUrl(size, work) {
  const { w, h, alpha } = work;
  const bb = bounds(w, h, alpha);
  const bw = bb.maxX - bb.minX + 1;
  const bh = bb.maxY - bb.minY + 1;
  const margin = Math.round(size * MARGIN_FRAC);
  const content = size - 2 * margin;
  const scale = content / Math.max(bw, bh);
  const offX = (size - bw * scale) / 2;
  const offY = (size - bh * scale) / 2;
  const rgba = Buffer.alloc(size * size * 4);
  for (let oy = 0; oy < size; oy++) {
    for (let ox = 0; ox < size; ox++) {
      // Source footprint of this output pixel, then average its coverage.
      const fx0 = bb.minX + (ox - offX) / scale;
      const fx1 = bb.minX + (ox + 1 - offX) / scale;
      const fy0 = bb.minY + (oy - offY) / scale;
      const fy1 = bb.minY + (oy + 1 - offY) / scale;
      const ix0 = Math.max(0, Math.floor(fx0));
      const ix1 = Math.min(w - 1, Math.ceil(fx1) - 1);
      const iy0 = Math.max(0, Math.floor(fy0));
      const iy1 = Math.min(h - 1, Math.ceil(fy1) - 1);
      let sum = 0;
      let cnt = 0;
      for (let sy = iy0; sy <= iy1; sy++) {
        for (let sx = ix0; sx <= ix1; sx++) {
          sum += alpha[sy * w + sx];
          cnt++;
        }
      }
      const a = cnt > 0 ? sum / cnt : 0;
      const o = (oy * size + ox) * 4;
      rgba[o + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255); // RGB stays 0 (template)
    }
  }
  return `data:image/png;base64,${encodeRgba(size, size, rgba).toString('base64')}`;
}

const work = keyedAlpha();
const url16 = templateDataUrl(16, work);
const url32 = templateDataUrl(32, work);

const ts = `// AUTO-GENERATED by scripts/gen-tray-icon.mjs — do not edit by hand.
// Monochrome template icon: the logo's potato silhouette (keyed by warmth)
// on transparency, @1x/@2x, for the menubar tray. Used with
// nativeImage.setTemplateImage(true) so macOS recolors it per the menubar.
export const TRAY_ICON_DATA_URL_1X = '${url16}';
export const TRAY_ICON_DATA_URL_2X = '${url32}';
`;
writeFileSync(join(root, 'electron', 'tray-icon.ts'), ts);
console.log(`wrote electron/tray-icon.ts from ${src} (1x ${url16.length}b, 2x ${url32.length}b)`);
