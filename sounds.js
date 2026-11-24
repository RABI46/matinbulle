// Vingt sonneries, synthétisées à la volée : aucun fichier à charger.
// Format d'une note : [fréquence, décalage, durée, glissando?, forme?, volume?]
// Format d'un bruit  : [décalage, durée, fréquence de départ, fréquence d'arrivée, filtre?, volume?]
const buffers = new WeakMap();

function noiseBuffer(ctx) {
  let buffer = buffers.get(ctx);
  if (buffer) return buffer;
  buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  buffers.set(ctx, buffer);
  return buffer;
}

export function schedulePhrase(ctx, dest, sound, start = ctx.currentTime) {
  const peak = sound.gain ?? 0.45;

  for (const [at, dur, from, to, type = "lowpass", gain = 1] of sound.noise || []) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    const t = start + at;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * gain), t + dur * 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  for (const [freq, at, dur, glide, wave, gain = 1] of sound.notes || []) {
    const t = start + at;
    const osc = ctx.createOscillator();
    osc.type = wave || sound.wave || "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur * 0.9);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * gain), t + Math.min(0.04, dur * 0.2));
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return start + sound.length;
}

export const SOUNDS = [
  {
    id: "bulles",
    name: "Bulles de savon",
    length: 2.4,
    notes: [
      [660, 0, 0.3],
      [880, 0.22, 0.3],
      [990, 0.48, 0.3],
      [1320, 0.74, 0.35],
      [1760, 1.06, 0.45],
    ],
  },
  {
    id: "gouttes",
    name: "Gouttes de pluie",
    length: 2.6,
    notes: [
      [1568, 0, 0.14],
      [2093, 0.2, 0.14],
      [1319, 0.38, 0.14],
      [1760, 0.6, 0.14],
      [1568, 0.86, 0.14],
      [1976, 1.08, 0.18],
    ],
  },
  {
    id: "oiseau",
    name: "Oiseau du matin",
    length: 2.4,
    wave: "triangle",
    notes: [
      [1200, 0, 0.14, 1650],
      [1350, 0.18, 0.14, 1900],
      [1200, 0.36, 0.14, 1700],
      [1600, 0.62, 0.16, 2100],
      [1400, 0.82, 0.16, 1850],
    ],
  },
  {
    id: "clochette",
    name: "Clochette douce",
    length: 3.2,
    gain: 0.3,
    notes: [
      [1046, 0, 1.2],
      [1318, 0.14, 1.2],
      [1568, 0.28, 1.5],
    ],
  },
  {
    id: "boite",
    name: "Boîte à musique",
    length: 3.6,
    wave: "triangle",
    notes: [
      [784, 0, 0.5],
      [988, 0.3, 0.5],
      [1175, 0.6, 0.5],
      [988, 0.9, 0.5],
      [784, 1.2, 0.6],
      [659, 1.5, 0.9],
    ],
  },
  {
    id: "xylophone",
    name: "Xylophone",
    length: 2.2,
    wave: "triangle",
    notes: [
      [523, 0, 0.2],
      [659, 0.16, 0.2],
      [784, 0.32, 0.2],
      [1046, 0.48, 0.26],
      [784, 0.7, 0.2],
      [659, 0.86, 0.2],
      [523, 1.02, 0.3],
    ],
  },
  {
    id: "ukulele",
    name: "Ukulélé",
    length: 3,
    wave: "triangle",
    notes: [
      [392, 0, 0.4],
      [523, 0.3, 0.4],
      [659, 0.6, 0.4],
      [784, 0.9, 0.5],
      [659, 1.2, 0.4],
      [523, 1.5, 0.7],
    ],
  },
  {
    id: "train",
    name: "Petit train",
    length: 2.6,
    wave: "square",
    gain: 0.22,
    notes: [
      [330, 0, 0.16],
      [330, 0.24, 0.16],
      [440, 0.5, 0.3],
      [330, 0.95, 0.16],
      [392, 1.2, 0.16],
      [523, 1.44, 0.45],
    ],
  },
  {
    id: "chaton",
    name: "Ronron du chaton",
    length: 3,
    gain: 0.5,
    noise: [[0, 3, 220, 150, "lowpass", 0.6]],
  },
  {
    id: "vagues",
    name: "Vagues de la mer",
    length: 4,
    gain: 0.45,
    noise: [
      [0, 1.7, 260, 1300, "lowpass", 0.8],
      [1.8, 2.1, 1200, 260, "lowpass", 0.5],
    ],
  },
  {
    id: "harpe",
    name: "Harpe magique",
    length: 3,
    notes: [
      [523, 0, 0.8],
      [659, 0.18, 0.8],
      [784, 0.36, 0.8],
      [1046, 0.54, 0.9],
      [1318, 0.74, 1.1],
    ],
  },
  {
    id: "marimba",
    name: "Marimba",
    length: 2.4,
    wave: "triangle",
    notes: [
      [392, 0, 0.35],
      [523, 0.22, 0.35],
      [587, 0.44, 0.35],
      [784, 0.66, 0.55],
    ],
  },
  {
    id: "carillon",
    name: "Carillon d'étoiles",
    length: 2.6,
    notes: [
      [1318, 0, 0.5],
      [1568, 0.2, 0.5],
      [1975, 0.4, 0.6],
      [1568, 0.62, 0.5],
      [1318, 0.86, 0.8],
    ],
  },
  {
    id: "fanfare",
    name: "Petite fanfare",
    length: 2.4,
    wave: "triangle",
    gain: 0.32,
    notes: [
      [523, 0, 0.16],
      [523, 0.18, 0.16],
      [659, 0.36, 0.16],
      [784, 0.54, 0.55],
      [1046, 0.9, 0.5],
    ],
  },
  {
    id: "piano",
    name: "Piano qui monte",
    length: 3,
    wave: "triangle",
    notes: [
      [262, 0, 0.5],
      [330, 0.26, 0.5],
      [392, 0.52, 0.5],
      [523, 0.78, 0.6],
      [659, 1.04, 0.95],
    ],
  },
  {
    id: "tambourin",
    name: "Tambourin léger",
    length: 2,
    gain: 0.3,
    noise: [
      [0, 0.1, 4000, 6000, "highpass"],
      [0.18, 0.1, 4000, 6500, "highpass"],
      [0.36, 0.1, 4200, 6800, "highpass"],
      [0.54, 0.1, 4000, 6000, "highpass"],
      [0.72, 0.1, 4400, 7000, "highpass"],
      [0.9, 0.14, 4000, 6200, "highpass"],
    ],
  },
  {
    id: "coucou",
    name: "Coucou de la forêt",
    length: 2.6,
    notes: [
      [880, 0, 0.35],
      [660, 0.42, 0.6],
      [880, 1.2, 0.35],
      [660, 1.62, 0.7],
    ],
  },
  {
    id: "fusee",
    name: "Fusée qui décolle",
    length: 2.6,
    wave: "sawtooth",
    gain: 0.2,
    notes: [
      [180, 0, 1.3, 900],
      [900, 1.1, 0.5, 1200],
    ],
    noise: [[0, 1.4, 300, 2400, "lowpass", 0.35]],
  },
  {
    id: "grenouille",
    name: "Grenouille",
    length: 2.2,
    wave: "square",
    gain: 0.2,
    notes: [
      [150, 0, 0.1, 100],
      [110, 0.14, 0.12, 90],
      [150, 0.32, 0.1, 100],
      [110, 0.46, 0.12, 90],
      [160, 0.66, 0.1, 105],
      [115, 0.8, 0.16, 85],
    ],
  },
  {
    id: "soleil",
    name: "Soleil qui brille",
    length: 2.8,
    notes: [
      [659, 0, 0.5],
      [784, 0.16, 0.5],
      [988, 0.32, 0.5],
      [1318, 0.48, 0.8],
      [1568, 0.72, 0.6],
      [1975, 0.94, 0.9],
    ],
  },
];
