// Pure logic so it can be checked without a DOM.
export const DAYS = [
  { key: "lun", short: "L", name: "lundi" },
  { key: "mar", short: "M", name: "mardi" },
  { key: "mer", short: "M", name: "mercredi" },
  { key: "jeu", short: "J", name: "jeudi" },
  { key: "ven", short: "V", name: "vendredi" },
  { key: "sam", short: "S", name: "samedi" },
  { key: "dim", short: "D", name: "dimanche" },
];
const KEYS = DAYS.map((d) => d.key);
export const WEEK = ["lun", "mar", "mer", "jeu", "ven"];

/** Routine du matin : une étape à la fois, jamais deux. */
export const ROUTINE = [
  { name: "Se lever", note: "Les deux pieds au sol, puis debout.", seconds: 60 },
  { name: "Se laver", note: "Douche ou gant de toilette, sans traîner.", seconds: 600 },
  { name: "S'habiller", note: "Les vêtements préparés la veille.", seconds: 300 },
  { name: "Petit-déjeuner", note: "Assis, sans écran.", seconds: 600 },
  { name: "Brosser les dents", note: "Deux minutes, en haut, en bas, partout.", seconds: 120 },
  { name: "Cartable", note: "Tout devant la porte.", seconds: 180 },
];

export const routineMinutes = () => ROUTINE.reduce((sum, s) => sum + s.seconds, 0) / 60;

export const dayKeyOf = (date) => KEYS[(date.getDay() + 6) % 7];

export const formatClock = (date) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function parseTime(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value).trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/** Next matching occurrence, or null. A time up to 60s in the past still counts as "now". */
export function nextAlarm(alarm, now = new Date()) {
  const time = parseTime(alarm.time);
  if (!time) return null;
  const days = alarm.days && alarm.days.length ? alarm.days : WEEK;
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + i);
    candidate.setHours(time.hour, time.minute, 0, 0);
    if (!days.includes(dayKeyOf(candidate))) continue;
    if (candidate.getTime() >= now.getTime() - 60_000) return candidate;
  }
  return null;
}

export function formatCountdown(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}

export function daysLabel(days) {
  const list = DAYS.filter((d) => days.includes(d.key));
  if (list.length === 7) return "tous les jours";
  if (list.length === 0) return "aucun jour";
  if (list.length === 6) return `tous les jours sauf ${DAYS.find((d) => !days.includes(d.key)).name}`;
  if (list.length === 5 && WEEK.every((k) => days.includes(k))) return "du lundi au vendredi";
  return list.map((d) => d.name).join(", ");
}

export const formatMinutes = (s) => (s <= 0 ? "C'est l'heure" : `${Math.ceil(s / 60)} min`);

/** Rampé d'aube : 5 paliers sur 12 minutes, interpolation sRGB. */
export const DAWN = [
  { at: 0, hex: "#14181D" },
  { at: 180, hex: "#2A2320" },
  { at: 360, hex: "#3A2A22" },
  { at: 540, hex: "#5A3A29" },
  { at: 720, hex: "#6E4630" },
];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (parts) =>
  "#" + parts.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

export function dawnAt(seconds) {
  const s = Math.max(0, Math.min(DAWN[DAWN.length - 1].at, seconds));
  for (let i = 1; i < DAWN.length; i++) {
    if (s > DAWN[i].at) continue;
    const a = DAWN[i - 1];
    const b = DAWN[i];
    const t = (s - a.at) / (b.at - a.at);
    const A = rgb(a.hex);
    const B = rgb(b.hex);
    return toHex(A.map((v, j) => v + (B[j] - v) * t));
  }
  return DAWN[DAWN.length - 1].hex;
}

/** Trois niveaux : ≥ 15 min « Large », 5–15 « On accélère », < 5 « C'est l'heure ». */
export function timeLevel(minutes) {
  if (minutes < 5) return { key: "partir", word: "C'est l'heure" };
  if (minutes < 15) return { key: "presse", word: "On accélère" };
  return { key: "large", word: "Large" };
}

/** Secondes restantes jusqu'au départ, à partir de l'étape en cours. */
export function routineRemaining(index = 0, remainingSeconds = 0) {
  return ROUTINE.slice(Math.max(0, index) + 1).reduce((sum, s) => sum + s.seconds, remainingSeconds);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
