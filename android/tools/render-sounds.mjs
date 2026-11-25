// Rend les vingt sonneries de sounds.js en WAV mono 22 050 Hz, pour que le
// service natif puisse jouer le son choisi sans dépendre de la WebView.
// Appelé par android/build.sh : node android/tools/render-sounds.mjs <dossier>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SOUNDS } from "../../sounds.js";

const RATE = 22050;
const outDir = process.argv[2];
if (!outDir) throw new Error("dossier de sortie manquant");
mkdirSync(outDir, { recursive: true });

const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

/** Forme d'onde d'un oscillateur à la phase donnée (0..1). */
function wave(name, phase) {
  const p = phase - Math.floor(phase);
  if (name === "square") return p < 0.5 ? 0.6 : -0.6;
  if (name === "sawtooth") return 1.2 * (2 * p - 1);
  if (name === "triangle") return (4 / Math.PI) * Math.asin(Math.sin(TAU * p));
  return Math.sin(TAU * p);
}

/** Enveloppe exponentielle : 0,0001 → peak à l'attaque → 0,0001 à la fin. */
function envelope(t, dur, peak) {
  const attack = Math.min(0.04, dur * 0.2);
  if (t < 0 || t > dur) return 0;
  if (t <= attack) {
    const u = attack === 0 ? 1 : t / attack;
    return 0.0001 * (peak / 0.0001) ** u;
  }
  const u = (t - attack) / Math.max(0.001, dur - attack);
  return peak * (0.0001 / peak) ** u;
}

function render(sound) {
  const frames = Math.ceil((sound.length + 0.15) * RATE);
  const mix = new Float32Array(frames);
  const peak = sound.gain ?? 0.45;

  for (const [freq, at, dur, glide, form = sound.wave || "sine", gain = 1] of sound.notes || []) {
    const start = Math.floor(at * RATE);
    const count = Math.ceil((dur + 0.05) * RATE);
    let phase = 0;
    for (let i = 0; i < count; i++) {
      const t = i / RATE;
      if (t > dur) break;
      const glideAt = Math.min(1, t / Math.max(0.001, dur * 0.9));
      const f = glide ? freq * (glide / freq) ** glideAt : freq;
      phase += f / RATE;
      const index = start + i;
      if (index < frames) mix[index] += wave(form, phase) * envelope(t, dur, peak * gain);
    }
  }

  for (const [at, dur, from, to, type = "lowpass", gain = 1] of sound.noise || []) {
    const start = Math.floor(at * RATE);
    const count = Math.ceil((dur + 0.05) * RATE);
    let seed = 0x9e3779b9;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    for (let i = 0; i < count; i++) {
      const t = i / RATE;
      if (t > dur) break;
      if (i % 32 === 0) {
        const u = Math.min(1, t / Math.max(0.001, dur));
        const f = clamp(lerp(from, to, u), 40, RATE * 0.45);
        const w0 = (TAU * f) / RATE;
        const cos = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * 0.707);
        const a0 = 1 + alpha;
        if (type === "highpass") {
          b0 = (1 + cos) / 2;
          b1 = -(1 + cos);
          b2 = b0;
        } else {
          b0 = (1 - cos) / 2;
          b1 = 1 - cos;
          b2 = b0;
        }
        a1 = -2 * cos;
        a2 = 1 - alpha;
        b0 /= a0;
        b1 /= a0;
        b2 /= a0;
        a1 /= a0;
        a2 /= a0;
      }
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 0xffffffff) * 2 - 1;
      const filtered = b0 * white + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = white;
      y2 = y1;
      y1 = filtered;
      const index = start + i;
      if (index < frames) mix[index] += filtered * envelope(t, dur, peak * gain);
    }
  }

  let loudest = 0;
  for (const v of mix) loudest = Math.max(loudest, Math.abs(v));
  const scale = loudest > 0.98 ? 0.98 / loudest : 1;

  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(clamp(mix[i] * scale, -1, 1) * 32767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

let bytes = 0;
for (const sound of SOUNDS) {
  const wav = render(sound);
  bytes += wav.length;
  writeFileSync(join(outDir, `${sound.id}.wav`), wav);
}
console.log(`${SOUNDS.length} sonneries rendues — ${Math.round(bytes / 1024)} Kio`);
