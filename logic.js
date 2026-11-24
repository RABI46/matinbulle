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

/* ---------- fuseaux horaires ---------- */

/** Fuseaux proposés au choix ; le fuseau local de l'appareil est ajouté en tête. */
export const TIME_ZONES = [
  "Europe/Paris",
  "Europe/London",
  "Europe/Lisbon",
  "Africa/Casablanca",
  "Africa/Dakar",
  "America/New_York",
  "America/Toronto",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const zoneFormatters = new Map();
function zoneFormatter(zone) {
  let formatter = zoneFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zoneFormatters.set(zone, formatter);
  }
  return formatter;
}

/** Décalage du fuseau à cet instant, en minutes (heure d'été comprise). */
export function zoneOffsetMinutes(zone, date = new Date()) {
  const parts = {};
  for (const { type, value } of zoneFormatter(zone).formatToParts(date)) parts[type] = value;
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** « UTC+01:00 », « UTC-05:00 ». */
export function formatZoneOffset(minutes) {
  const abs = Math.abs(minutes);
  const sign = minutes < 0 ? "-" : "+";
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Date dont les getters locaux donnent l'heure murale du fuseau choisi. */
export function zonedDate(zone, date = new Date()) {
  return new Date(date.getTime() + zoneOffsetMinutes(zone, date) * 60_000);
}

/**
 * Prochaine sonnerie dans un fuseau : `wall` pour l'afficher, `at` pour le
 * compte à rebours — l'heure d'été peut changer entre-temps.
 */
export function nextAlarmInZone(alarm, zone, now = new Date()) {
  const offNow = zoneOffsetMinutes(zone, now);
  const wallNow = new Date(now.getTime() + offNow * 60_000);
  const wall = nextAlarm(alarm, wallNow);
  if (!wall) return null;
  const offThen = zoneOffsetMinutes(zone, new Date(wall.getTime() - offNow * 60_000));
  return { wall, at: new Date(wall.getTime() - offThen * 60_000) };
}
