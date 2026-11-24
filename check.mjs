import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DAWN,
  dawnAt,
  dayKeyOf,
  daysLabel,
  formatClock,
  formatCountdown,
  formatDuration,
  formatMinutes,
  nextAlarm,
  parseTime,
  ROUTINE,
  routineMinutes,
  routineRemaining,
  timeLevel,
} from "./logic.js";
import { SOUNDS } from "./sounds.js";

// 24 nov. 2026 = mardi
assert.equal(dayKeyOf(new Date(2026, 10, 24)), "mar");
assert.equal(formatClock(new Date(2026, 10, 24, 7, 5)), "07:05");
assert.deepEqual(parseTime("07:15"), { hour: 7, minute: 15 });
assert.equal(parseTime("24:00"), null);
assert.equal(parseTime("7:5"), null);

const samediSoir = new Date(2026, 10, 28, 18, 0);
const semaine = { time: "07:15", days: ["lun", "mar", "mer", "jeu", "ven"] };
const lundi = nextAlarm(semaine, samediSoir);
assert.equal(lundi.getDay(), 1);
assert.equal(lundi.getDate(), 30);

assert.equal(nextAlarm({ time: "20:00", days: ["sam"] }, samediSoir).getHours(), 20);
// mardi 07:30, l'heure est passée : la prochaine sonnerie est mardi suivant
assert.equal(nextAlarm({ time: "07:15", days: ["mar"] }, new Date(2026, 10, 24, 7, 30)).getDate(), 1);
assert.equal(nextAlarm({ time: "07:15", days: [] }, new Date(2026, 10, 24, 9, 0)).getDate(), 25);

assert.equal(formatCountdown((9 * 60 + 12) * 60_000), "9 h 12");
assert.equal(formatCountdown(2 * 3_600_000), "2 h");
assert.equal(formatCountdown(42 * 60_000), "42 min");
assert.equal(formatDuration(60), "01:00");
assert.equal(formatDuration(0), "00:00");

assert.equal(daysLabel(["lun", "mar", "mer", "jeu", "ven"]), "du lundi au vendredi");
assert.equal(daysLabel(["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]), "tous les jours");
assert.equal(daysLabel(["lun", "mer"]), "lundi, mercredi");
assert.equal(daysLabel(["lun", "mar", "mer", "jeu", "ven", "sam"]), "tous les jours sauf dimanche");

// routine : laver 10 min, dents 2 min, 31 minutes en tout
assert.equal(ROUTINE.length, 6);
assert.equal(ROUTINE.find((s) => s.name === "Se laver").seconds, 600);
assert.equal(ROUTINE.find((s) => s.name === "Brosser les dents").seconds, 120);
assert.equal(routineMinutes(), 31);

// 20 sonneries, identifiants uniques, durée positive
assert.equal(SOUNDS.length, 20);
assert.equal(new Set(SOUNDS.map((s) => s.id)).size, 20);
SOUNDS.forEach((s) => {
  assert.ok(s.name.length > 2, s.id);
  assert.ok(s.length > 0, s.id);
  assert.ok((s.notes || []).length + (s.noise || []).length > 0, s.id);
  const end = Math.max(
    ...(s.notes || []).map(([f, at, dur]) => at + dur),
    ...(s.noise || []).map(([at, dur]) => at + dur),
  );
  assert.ok(end <= s.length, `${s.id} dépasse sa durée`);
});

// durée lisible sans chiffres qui filent
assert.equal(formatMinutes(600), "10 min");
assert.equal(formatMinutes(59), "1 min");
assert.equal(formatMinutes(0), "C'est l'heure");

// rampé d'aube : 5 paliers, 12 minutes, interpolation continue
assert.equal(DAWN.length, 5);
assert.equal(DAWN[0].hex, "#14181D");
assert.equal(DAWN[4].hex, "#6E4630");
assert.equal(dawnAt(0), "#14181D");
assert.equal(dawnAt(180), "#2A2320");
assert.equal(dawnAt(720), "#6E4630");
assert.equal(dawnAt(900), "#6E4630", "plafonne après 12 min");
const red = (hex) => parseInt(hex.slice(1, 3), 16);
assert.ok(red(dawnAt(90)) > red(dawnAt(0)) && red(dawnAt(90)) < red(dawnAt(180)), "interpole entre deux paliers");

// 3 niveaux de temps, un mot chacun
assert.deepEqual(timeLevel(31), { key: "large", word: "Large" });
assert.equal(timeLevel(15).key, "large");
assert.equal(timeLevel(14).key, "presse");
assert.equal(timeLevel(5).key, "presse");
assert.equal(timeLevel(4).key, "partir");
assert.equal(timeLevel(0).word, "C'est l'heure");

// temps restant jusqu'au départ
assert.equal(routineRemaining(0, 60), 31 * 60);
assert.equal(routineRemaining(5, 180), 180);
assert.equal(routineRemaining(5, 0), 0);

// ---------- ratios WCAG AA des tokens réellement utilisés ----------
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const tokens = {};
for (const [, name, hex] of css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) {
  if (!(name in tokens)) tokens[name] = hex;
}
const hexRGB = (h) => h.replace("#", "").match(/../g).map((x) => parseInt(x, 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (h) => {
  const [r, g, b] = hexRGB(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const tok = (name) => {
  assert.ok(tokens[name], `token ${name} absent de styles.css`);
  return tokens[name];
};
const need = (fg, bg, min, label) => {
  const r = ratio(tok(fg), tok(bg));
  assert.ok(r >= min, `${label} : ${r.toFixed(2)}:1 < ${min}:1 (${fg} sur ${bg})`);
};

// Nuit / Aube
need("--creme-nuit", "--nuit-900", 14, "texte principal de nuit");
need("--creme-nuit-2", "--nuit-900", 9, "texte secondaire de nuit");
need("--creme-nuit-3", "--nuit-900", 6, "légende de nuit");
need("--ambre-400", "--nuit-900", 10, "heure sur fond nuit");
need("--ambre-400", "--nuit-800", 9, "heure sur carte de nuit");
need("--peche-300", "--nuit-900", 8, "pêche sur nuit");
need("--creme-nuit-2", "--nuit-800", 8, "métadonnée sur carte de nuit");
need("--creme-nuit", "--aube-900", 11, "palier 6 min");
need("--creme-nuit", "--aube-800", 8, "palier 9 min");
need("--creme-nuit", "--aube-700", 6.5, "palier 12 min");
need("--temps-large-nuit", "--nuit-700", 5, "pastille active de nuit");

// Jour
need("--encre-900", "--jour-50", 15, "texte principal de jour");
need("--encre-700", "--jour-50", 9, "sous-titre de jour");
need("--encre-500", "--jour-50", 5, "métadonnée de jour");
need("--encre-500", "--carte", 5, "métadonnée sur carte");
need("--encre-900", "--carte", 15, "texte sur carte");
need("--boite-jour", "--carte", 4, "contour de commande de jour");

// Action unique
need("--sur-action-jour", "--action-jour", 4.5, "libellé du bouton principal (jour)");
need("--sur-action-jour", "--action-jour-press", 5, "libellé du bouton pressé (jour)");
need("--sur-action-nuit", "--action-nuit", 8, "libellé du bouton principal (nuit)");

// Temps : 3 niveaux
need("--temps-large", "--temps-large-fond", 6, "niveau large");
need("--temps-presse", "--temps-presse-fond", 6, "niveau se dépêcher");
need("--temps-partir", "--temps-partir-fond", 5.5, "niveau partir");
need("--temps-large-barre", "--carte", 3, "barre large sur carte");
need("--temps-presse-barre", "--carte", 4.5, "barre se dépêcher sur carte");
need("--temps-partir-barre", "--carte", 3, "barre partir sur carte");
need("--temps-large-nuit", "--nuit-900", 7, "mot large sur nuit");
need("--temps-presse-nuit", "--nuit-900", 9, "mot se dépêcher sur nuit");
need("--temps-partir-nuit", "--nuit-900", 7, "mot partir sur nuit");

// Widget « Défi » : brun aube, l'accent reste au bouton
need("--creme-nuit", "--aube-800", 8, "texte du widget défi");
need("--creme-nuit-2", "--aube-800", 5, "légende du widget défi");
need("--ambre-400", "--aube-800", 4.5, "chiffre du widget défi");

// Contours de commande
need("--piste-nuit", "--nuit-800", 3, "piste de switch de nuit");
need("--commande-nuit", "--nuit-800", 3, "contour de commande sur carte de nuit");
need("--piste-jour", "--carte", 3, "piste de switch de jour");
need("--temps-large", "--carte", 3, "switch actif de jour");
need("--temps-large-nuit", "--nuit-800", 3, "switch actif de nuit");

// ---------- le geste d'arrêt est bien un maintien de 1,5 s ----------
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
assert.ok(html.includes('id="hold"'), "bouton de maintien présent");
assert.ok(!html.includes('class="stars"'), "les étoiles ont disparu");
assert.match(app, /const HOLD_MS = 1500;/, "maintien de 1500 ms");
assert.match(html, /id="stand"[\s\S]*Je suis levé/, "mode cerveau endormi : une seule action après l'arrêt");
assert.match(html, /data-theme="nuit"/, "thème nuit présent");

console.log(`checks ok — ${Object.keys(tokens).length} tokens, ratios mesurés`);
