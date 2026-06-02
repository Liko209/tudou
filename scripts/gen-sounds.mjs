#!/usr/bin/env node
// Generate Tudou's bundled session sound cues as small 16-bit mono WAVs, one
// file per catalog entry (see shared/sound-catalog.ts): <kind>-<id>.wav.
// All clips are SYNTHESIZED here (sine / triangle / FM + envelope), so they're
// original and license-free — safe to bundle and redistribute. Swap any with a
// CC0 clip from the libraries in docs/sound-effects.md (keep the filename).
//
//   node scripts/gen-sounds.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'public', 'sounds');

/** One enveloped note. type: sine | tri | fm. */
function tone(freq, dur, o = {}) {
  const { attack = 0.005, tau = dur * 0.4, type = 'sine', harm = 0.3, index = 0, ratio = 2, indexTau = tau, vibrato = 0, vibFreq = 6 } = o;
  const n = Math.floor(SR * dur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const a = t < attack ? t / attack : 1; // linear attack, no click
    const d = Math.exp(-t / tau); // exponential decay
    const vib = vibrato ? 1 + vibrato * Math.sin(2 * Math.PI * vibFreq * t) : 1;
    const ph = 2 * Math.PI * freq * vib * t;
    const idx = index * Math.exp(-t / indexTau);
    let s;
    if (type === 'fm') s = Math.sin(ph + idx * Math.sin(ph * ratio));
    else if (type === 'tri') s = (2 / Math.PI) * Math.asin(Math.sin(ph));
    else s = Math.sin(ph) + harm * Math.sin(2 * ph);
    out[i] = a * d * s;
  }
  return out;
}

/** Mix notes (each placed at `at` seconds) into one normalized buffer. */
function render(events, total, peakTarget = 0.78) {
  const N = Math.floor(SR * total);
  const buf = new Float32Array(N);
  for (const e of events) {
    const s = tone(e.freq, e.dur, e);
    const off = Math.floor(SR * (e.at ?? 0));
    for (let i = 0; i < s.length && off + i < N; i++) buf[off + i] += s[i] * (e.gain ?? 1);
  }
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? peakTarget / peak : 1;
  for (let i = 0; i < N; i++) buf[i] *= g;
  return buf;
}

function wav(samples) {
  const N = samples.length;
  const b = Buffer.alloc(44 + N * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + N * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(N * 2, 40);
  for (let i = 0; i < N; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    b.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return b;
}

// Keep ids in sync with shared/sound-catalog.ts.
const CUES = {
  // complete — a session finished, it's your turn (warm, resolving)
  'complete-chime': render([
    { freq: 659.25, dur: 0.2, tau: 0.12 },
    { freq: 987.77, dur: 0.34, tau: 0.16, at: 0.12 },
  ], 0.5),
  'complete-soft': render([
    { freq: 587.33, dur: 0.22, tau: 0.16 },
    { freq: 880.0, dur: 0.36, tau: 0.2, at: 0.13, vibrato: 0.004, vibFreq: 5 },
  ], 0.5, 0.62),
  'complete-marimba': render([
    { freq: 783.99, dur: 0.18, tau: 0.08, type: 'tri', attack: 0.002 },
    { freq: 1046.5, dur: 0.32, tau: 0.13, type: 'tri', at: 0.1, attack: 0.002 },
  ], 0.46),
  'complete-arp': render([
    { freq: 523.25, dur: 0.16, tau: 0.09, harm: 0.25 },
    { freq: 659.25, dur: 0.16, tau: 0.09, harm: 0.25, at: 0.08 },
    { freq: 783.99, dur: 0.34, tau: 0.16, harm: 0.25, at: 0.16 },
  ], 0.52),
  'complete-bell': render([
    { freq: 880, dur: 0.55, tau: 0.3, type: 'fm', index: 4, indexTau: 0.1, ratio: 3.5, attack: 0.002 },
  ], 0.6),

  // alert — a session needs you (crisper, more insistent)
  'alert-double': render([
    { freq: 880.0, dur: 0.12, tau: 0.05 },
    { freq: 932.33, dur: 0.18, tau: 0.06, at: 0.14 },
  ], 0.34, 0.8),
  'alert-triple': render([
    { freq: 1000, dur: 0.07, tau: 0.035, type: 'tri' },
    { freq: 1000, dur: 0.07, tau: 0.035, type: 'tri', at: 0.11 },
    { freq: 1000, dur: 0.1, tau: 0.045, type: 'tri', at: 0.22 },
  ], 0.36, 0.8),
  'alert-knock': render([
    { freq: 440, dur: 0.08, tau: 0.03, type: 'tri' },
    { freq: 440, dur: 0.1, tau: 0.035, type: 'tri', at: 0.11 },
  ], 0.24, 0.82),
  'alert-pingpong': render([
    { freq: 987.77, dur: 0.1, tau: 0.05 },
    { freq: 739.99, dur: 0.16, tau: 0.06, at: 0.13 },
  ], 0.32, 0.8),
};

mkdirSync(OUT, { recursive: true });
for (const [name, buf] of Object.entries(CUES)) writeFileSync(join(OUT, `${name}.wav`), wav(buf));
console.log(`✓ wrote ${Object.keys(CUES).length} cues to ${OUT}`);
