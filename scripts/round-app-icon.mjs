#!/usr/bin/env node
// Fix the macOS app icon's black corners.
//
// build/icon.png was a fully-opaque 1024² square: a cream rounded tile drawn on
// a near-black surround, with NO alpha channel. macOS doesn't mask app icons, so
// that opaque black surround showed as black corners around the tile. We add an
// alpha channel and knock the dark surround out to transparency, leaving the
// cream rounded tile floating on transparency — the correct macOS look.
//
// Keyed on luminance: the surround is near-black (luma≈10), the cream tile ≈240
// and the tan potato ≈170, so a luma ramp cleanly drops only the surround while
// keeping a soft anti-aliased tile edge.
//
//   node scripts/round-app-icon.mjs            # rewrites build/icon.png in place
//   node scripts/round-app-icon.mjs out.png    # or write elsewhere (preview)
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'build', 'icon.png');
const out = process.argv[2] || src;

// Luma ramp: <= LO fully transparent (surround), >= HI fully opaque.
const LO = 60;
const HI = 120;

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height, channels } = info; // channels === 4 after ensureAlpha

for (let i = 0; i < data.length; i += channels) {
  const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const t = Math.max(0, Math.min(1, (luma - LO) / (HI - LO)));
  data[i + 3] = Math.round(t * 255);
}

await sharp(data, { raw: { width, height, channels } }).png().toFile(out);
console.log(`✓ wrote ${out} (${width}×${height}, transparent surround)`);
