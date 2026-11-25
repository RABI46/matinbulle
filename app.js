import {
  DAYS,
  EVENING,
  WEEK,
  dayKeyOf,
  daysLabel,
  dawnAt,
  formatClock,
  formatCountdown,
  formatMinutes,
  formatZoneOffset,
  localZone,
  nextAlarmInZone,
  parseTime,
  routineMinutes,
  routineRemaining,
  ROUTINE,
  TIME_ZONES,
  timeLevel,
  zoneOffsetMinutes,
  zonedDate,
} from "./logic.js";
import { SOUNDS, schedulePhrase } from "./sounds.js";

const KEY = "matinbulle.v1";
const APP_VERSION = "1.2.0";
const PROFILES_KEY = "matinbulle.profiles.v1";
const STARS_KEY = "matinbulle.stars.v2";
const PREFS_KEY = "matinbulle.prefs.v1";
let STEPS = ROUTINE;
const THEME = { reveil: "nuit", routine: "jour", widgets: "jour", reglages: "jour" };
const HOLD_MS = 1500;
const RING = 2 * Math.PI * 100;

const $ = (id) => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem(KEY) || "null");
const alarm = {
  time: "07:15",
  days: [...WEEK],
  enabled: true,
  rise: true,
  sound: "bulles",
  tz: localZone(),
  voice: true,
  ...(saved || {}),
};
let step = 0;
let remaining = STEPS[0].seconds;
let running = false;
let started = false;
let finished = false;
let lastFired = "";
/** Instant déjà confié à l'alarme système (0 = annulée). */
let armedKey = "";

const save = () => localStorage.setItem(KEY, JSON.stringify(alarm));

const zoneOf = () => alarm.tz || localZone();
/** Date « murale » : ses getters donnent l'heure du fuseau choisi. */
const wallClock = (real = new Date()) => zonedDate(zoneOf(), real);

/* ---------- profils, préférences et récompenses ---------- */
const STAR_CENTS = 20;
let shownDay = "";

function readJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

const escapeHTML = (value) =>
  String(value).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const defaultProfile = () => ({
  id: "nono",
  name: "Nono",
  steps: ROUTINE.map((s) => ({ ...s })),
  goal: { label: "Une sortie au parc", stars: 20 },
});

function readProfiles() {
  const saved = readJSON(PROFILES_KEY, null);
  if (saved && Array.isArray(saved.list) && saved.list.length) {
    const list = saved.list
      .filter((p) => p && typeof p.id === "string" && Array.isArray(p.steps) && p.steps.length)
      .map((p) => ({
        id: p.id,
        name: String(p.name || "Profil"),
        steps: p.steps.map((s) => ({
          name: String(s.name || "Étape"),
          note: String(s.note || ""),
          seconds: Math.max(60, Math.min(3600, Number(s.seconds) || 300)),
        })),
        goal:
          p.goal && typeof p.goal === "object"
            ? { label: String(p.goal.label || ""), stars: Math.max(1, Number(p.goal.stars) || 20) }
            : { label: "", stars: 20 },
      }));
    if (list.length) {
      return {
        active: list.some((p) => p.id === saved.active) ? saved.active : list[0].id,
        list,
      };
    }
  }
  const profile = defaultProfile();
  return { active: profile.id, list: [profile] };
}

const profiles = readProfiles();
const activeProfile = () =>
  profiles.list.find((p) => p.id === profiles.active) || profiles.list[0];
STEPS = activeProfile().steps;

const saveProfiles = () => localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));

const prefs = { text: "normal", oneThing: false, contrast: false, ...readJSON(PREFS_KEY, {}) };
const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));

function readStars() {
  const saved = readJSON(STARS_KEY, null);
  if (saved && typeof saved === "object") return saved;
  // Reprise de l'ancien historique plat : une seule série, un seul profil.
  const old = readJSON("matinbulle.stars.v1", null);
  if (old && typeof old === "object") return { [profiles.active]: old };
  return {};
}

let stars = readStars();
const saveStars = () => localStorage.setItem(STARS_KEY, JSON.stringify(stars));

const starMap = (profileId = profiles.active) => {
  const map = stars[profileId];
  return map && typeof map === "object" ? map : {};
};

const todayIndexes = () => {
  const list = starMap()[dayStamp()];
  return Array.isArray(list) ? list : [];
};


const dayStamp = (date = wallClock()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;

const euros = (count) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
    (count * STAR_CENTS) / 100,
  );

const longDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** Ne garde que l'historique utile au mois affiché. */
function pruneStars() {
  const today = wallClock();
  const keep = new Set();
  for (let i = 0; i < 45; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    keep.add(dayStamp(day));
  }
  for (const series of Object.values(stars)) {
    if (!series || typeof series !== "object") continue;
    for (const key of Object.keys(series)) if (!keep.has(key)) delete series[key];
  }
}

/** Une étape conclue vaut une étoile, une seule fois par jour et par profil. */
function awardStar(index) {
  const key = dayStamp();
  const map = starMap();
  const got = Array.isArray(map[key]) ? map[key] : [];
  if (got.includes(index)) return;
  stars[profiles.active] = { ...map, [key]: [...got, index].sort((a, b) => a - b) };
  pruneStars();
  try {
    saveStars();
  } catch {
    // Historique non enregistré : la journée reste juste, elle sera perdue.
  }
  renderStars();
  renderEvening();
  const today = $("rewardsToday");
  today.classList.remove("is-earned");
  void today.offsetWidth;
  today.classList.add("is-earned");
  const count = todayIndexes().length;
  announce(count === 1 ? "Première étoile du jour." : `${count} étoiles aujourd'hui.`);
}

function renderStars() {
  const today = wallClock();
  const map = starMap();
  const cells = [];
  let total = 0;
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const list = map[dayStamp(day)];
    const count = Array.isArray(list) ? list.length : 0;
    total += count;
    const label = `${longDay.format(day)} : ${count} étoile${count > 1 ? "s" : ""}`;
    cells.push(
      `<li class="star-day"${i === 0 ? ' data-today="true"' : ""}${
        count === 0 ? ' data-zero="true"' : ""
      } aria-label="${label}">` +
        `<span class="star-day-num" aria-hidden="true">${day.getDate()}</span>` +
        `<span class="star-day-count" aria-hidden="true">★ ${count}</span>` +
        `</li>`,
    );
  }
  $("starGrid").innerHTML = cells.join("");
  const stored = map[dayStamp(today)];
  const todayCount = Array.isArray(stored) ? stored.length : 0;
  $("rewardsToday").textContent = `Aujourd'hui : ${todayCount} ★ · ${euros(todayCount)}`;
  $("rewardsTotal").textContent = `${total} ★`;
  $("rewardsMoney").textContent = euros(total);
  renderGoal(total);
  shownDay = dayStamp(today);
}

function renderGoal(total) {
  const goal = activeProfile().goal || { label: "", stars: 20 };
  const target = Math.max(1, Number(goal.stars) || 20);
  $("goalLabel").textContent = goal.label ? `Objectif : ${goal.label}` : "Objectif à définir";
  $("goalNote").textContent =
    total >= target
      ? `Objectif atteint : ${total} / ${target} étoiles, bravo !`
      : `${total} / ${target} étoiles · encore ${target - total} à gagner`;
  $("goalBar").style.width = `${Math.min(100, (total / target) * 100)}%`;
}

function renderEvening() {
  const got = todayIndexes();
  $("eveningList").innerHTML = EVENING.map((step, i) => {
    const done = got.includes(100 + i);
    return `<li>
      <span class="evening-name">${step.name}</span>
      <span class="value">${step.note}</span>
      <button class="btn btn--ghost btn--sm" data-evening="${i}"${done ? " disabled" : ""}>${done ? "Fait ✓" : "Terminé"}</button>
    </li>`;
  }).join("");
  $("eveningStars").textContent = `${EVENING.filter((_, i) => got.includes(100 + i)).length} ★`;
}

function announce(text) {
  $("srLive").textContent = text;
}

/* ---------- annonces vocales ---------- */
let spokenVoice = null;

function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices?.() || [];
  return voices.find((v) => /^fr/i.test(v.lang)) || null;
}

if ("speechSynthesis" in window) {
  spokenVoice = pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {
    spokenVoice = pickVoice();
  });
}

function speak(text) {
  if (!alarm.voice || !text || !("speechSynthesis" in window)) return;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 0.95;
    utterance.pitch = 1.05;
    if (spokenVoice) utterance.voice = spokenVoice;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // Pas de synthèse disponible : la routine reste utilisable sans voix.
  }
}

const shutUp = () => {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
};

const spokenMinutes = (seconds) =>
  seconds <= 60 ? "Une minute" : `${Math.round(seconds / 60)} minutes`;
const stepStartText = (index) => {
  const s = STEPS[index];
  return `Étape ${index + 1} sur ${STEPS.length} : ${s.name}. ${spokenMinutes(s.seconds)}.`;
};
const stepEndText = (index) => `${STEPS[index].name} : c'est terminé.`;

/* ---------- onglets & thème ---------- */
function showTab(name) {
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.hidden = panel.id !== `panel-${name}`;
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.dataset.target === name));
  });
  $("phone").dataset.theme = THEME[name];
  $("main").scrollTop = 0;
  if (name !== "reveil") renderGauge(wallClock());
  if (name === "reglages") refreshHealth();
}
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => showTab(tab.dataset.target));
});

/* ---------- réveil ---------- */
function renderDays() {
  $("days").innerHTML = "";
  DAYS.forEach((day) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = day.short;
    chip.setAttribute("aria-label", day.name);
    chip.setAttribute("aria-pressed", String(alarm.days.includes(day.key)));
    chip.addEventListener("click", () => {
      const on = alarm.days.includes(day.key);
      alarm.days = on ? alarm.days.filter((k) => k !== day.key) : [...alarm.days, day.key];
      save();
      renderDays();
      renderAlarm(new Date());
    });
    $("days").append(chip);
  });
}

function renderAlarm(now = new Date()) {
  const next = nextAlarmInZone(alarm, zoneOf(), now);
  $("alarmTime").value = alarm.time;
  $("nextTime").textContent = next ? formatClock(next.wall) : alarm.time;
  $("nextMeta").textContent = alarm.enabled
    ? next
      ? `dans ${formatCountdown(next.at - now)} · ${daysLabel(alarm.days)}`
      : "aucun jour sélectionné"
    : "réveil désactivé";
  $("alarmPill").textContent = alarm.enabled ? "Réveil actif" : "Réveil désactivé";
  $("alarmPill").dataset.off = String(!alarm.enabled);
  $("toggleAlarm").textContent = alarm.enabled ? "Désactiver" : "Activer";
  $("rise").setAttribute("aria-checked", String(alarm.rise));
  $("voice").setAttribute("aria-checked", String(alarm.voice));
  $("soundName").textContent = currentSound().name;

  $("wSmallTime").textContent = alarm.time;
  $("wSmallCount").textContent = alarm.enabled && next ? `dans ${formatCountdown(next.at - now)}` : "désactivé";
  $("wMidTime").textContent = alarm.time;
  $("wMidDays").textContent = daysLabel(alarm.days);
  $("wLargeTime").textContent = alarm.time;
  $("wLargeCount").textContent = alarm.enabled && next ? `dans ${formatCountdown(next.at - now)}` : "désactivé";
      $("wLargeSteps").innerHTML = STEPS.map(
      (s, i) =>
        `<span data-current="${i === step && !finished}">${i + 1}. ${escapeHTML(s.name)}</span>`,
    ).join("");

    armNative(alarm.enabled ? next : null);
    renderZone(now);
    pushWidget();
}

/** Heure murale visée, telle que la page l'a calculée : « 2026-11-25T07:15 ». */
const wallKey = (wall) =>
  `${wall.getFullYear()}-${String(wall.getMonth() + 1).padStart(2, "0")}-${String(
    wall.getDate(),
  ).padStart(2, "0")}T${formatClock(wall)}`;

/**
 * Confie la prochaine sonnerie au système : elle sonne même l'app fermée.
 * L'heure murale accompagne l'instant, pour qu'un redémarrage dans un autre
 * fuseau sonne à la même heure de montre, pas au même instant absolu.
 */
function armNative(next) {
  const at = next ? next.at.getTime() : 0;
  const wall = next ? wallKey(next.wall) : "";
  const key = `${at}|${wall}|${alarm.sound}|${alarm.rise}`;
  if (key === armedKey || !window.AndroidBridge?.arm) return;
  armedKey = key;
  try {
    if (at) window.AndroidBridge.arm(at, wall, alarm.sound, alarm.rise);
    else window.AndroidBridge.disarm();
  } catch {
    // Pas de pont (navigateur) : la page reste seule à surveiller l'heure.
    armedKey = "";
  }
}

/* ---------- fuseau horaire ---------- */
function renderZone(now = new Date()) {
  const zone = zoneOf();
  const home = localZone();
  const list = [home, ...TIME_ZONES.filter((z) => z !== home)];
  if (!list.includes(zone)) list.unshift(zone);
  const select = $("alarmZone");
  if (select.options.length !== list.length) {
    select.innerHTML = list
      .map((z) => `<option value="${z}">${z.replace(/_/g, " ")}</option>`)
      .join("");
  }
  select.value = zone;
  const offset = formatZoneOffset(zoneOffsetMinutes(zone, now));
  $("zoneHint").textContent = `Il est ${formatClock(wallClock(now))} · ${offset}`;
}

$("alarmTime").addEventListener("change", (event) => {
  if (!parseTime(event.target.value)) return;
  alarm.time = event.target.value;
  save();
  renderAlarm(new Date());
});

$("toggleAlarm").addEventListener("click", () => {
  alarm.enabled = !alarm.enabled;
  save();
  renderAlarm(new Date());
});

$("rise").addEventListener("click", () => {
  alarm.rise = !alarm.rise;
  save();
  renderAlarm(new Date());
});

$("voice").addEventListener("click", () => {
  alarm.voice = !alarm.voice;
  save();
  renderAlarm(new Date());
  if (alarm.voice) speak("Annonces vocales activées.");
  else shutUp();
});

$("alarmZone").addEventListener("change", (event) => {
  alarm.tz = event.target.value || localZone();
  save();
  renderAlarm(new Date());
  renderGauge(wallClock());
});

/* ---------- son ---------- */
let ctx = null;
let master = null;
let loopTimer = null;

function ensureAudio() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
  }
  return ctx;
}

// Un navigateur n'autorise le son qu'après un geste : on débloque à la première touche.
function armAudio() {
  const audio = ensureAudio();
  if (audio && audio.state === "suspended") audio.resume().catch(() => {});
}
window.addEventListener("pointerdown", armAudio);
document.addEventListener("keydown", armAudio);

const currentSound = () => SOUNDS.find((s) => s.id === alarm.sound) || SOUNDS[0];

function previewSound(sound) {
  const audio = ensureAudio();
  if (!audio) return;
  audio.resume().catch(() => {});
  const gain = audio.createGain();
  gain.gain.value = 0.4;
  gain.connect(audio.destination);
  try {
    schedulePhrase(audio, gain, sound);
  } catch {
    // Pas de son possible : la sélection reste enregistrée.
  }
  setTimeout(() => gain.disconnect(), (sound.length + 1) * 1000);
}

function loopSound() {
  clearTimeout(loopTimer);
  loopTimer = null;
  if (!ctx) return;
  if (ctx.state !== "running") {
    loopTimer = setTimeout(loopSound, 400);
    return;
  }
  const sound = currentSound();
  try {
    schedulePhrase(ctx, master, sound, ctx.currentTime + 0.06);
  } catch {
    return;
  }
  loopTimer = setTimeout(loopSound, Math.max(1300, sound.length * 1000));
}

function renderSounds() {
  $("soundList").innerHTML = "";
  SOUNDS.forEach((sound) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sound-opt";
    button.setAttribute("aria-pressed", String(sound.id === alarm.sound));
    button.innerHTML = `<span class="sound-wave" aria-hidden="true"></span><span>${sound.name}</span>`;
    button.addEventListener("click", () => {
      alarm.sound = sound.id;
      save();
      renderSounds();
      renderAlarm(new Date());
      previewSound(sound);
    });
    $("soundList").append(button);
  });
}

$("soundOpen").addEventListener("click", () => {
  renderSounds();
  $("soundSheet").showModal();
});
$("soundClose").addEventListener("click", () => $("soundSheet").close());

/* ---------- célébration : une seule, 600 ms ---------- */
const CONFETTI = ["#C2410C", "#F2C078", "#3E9C7F", "#DE6A4E"];

function celebrate(count = 14) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const host = $("fx");
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("i");
    piece.className = "confetti";
    piece.style.cssText = `--x:${15 + Math.random() * 70}%;--dx:${(Math.random() - 0.5) * 120}px;--rot:${Math.random() * 400}deg;--c:${CONFETTI[i % CONFETTI.length]};animation-delay:${Math.random() * 0.1}s`;
    host.append(piece);
    setTimeout(() => piece.remove(), 750);
  }
}

/* ---------- routine ---------- */
function renderRoutine() {
  const current = STEPS[step];
  const done = finished;
  $("stepIndex").textContent = done ? "Terminé" : `Étape ${step + 1} sur ${STEPS.length}`;
  $("stepName").textContent = done ? "Routine terminée" : current.name;
  $("stepNote").textContent = done ? "Sortie prête. Bonne journée." : current.note;
  $("stepTimer").textContent = done ? "C'est l'heure" : formatMinutes(remaining);
  $("stepTimer").dataset.done = String(remaining === 0 || done);
  $("stepBar").style.width = done || !current ? "0%" : `${(remaining / current.seconds) * 100}%`;
  $("stepNext").textContent = done ? "Revenir au début" : started ? "Étape suivante" : "Démarrer";

  $("stepsList").innerHTML = STEPS.map((s, i) => {
    const state = done || i < step ? "done" : i === step && started ? "current" : "next";
    return `<li data-state="${state}"><span class="step-dot" aria-hidden="true">${state === "done" ? "✓" : i + 1}</span><span>${escapeHTML(s.name)}</span><span class="step-dur">${Math.round(s.seconds / 60)} min</span></li>`;
  }).join("");

  $("phone").dataset.focus = prefs.oneThing && started && !finished ? "on" : "off";
  renderGauge(wallClock());
}

function renderGauge(now) {
  const left = finished ? 0 : routineRemaining(step, remaining, STEPS);
  const minutes = Math.ceil(left / 60);
  const level = timeLevel(minutes);
  const total = routineMinutes(STEPS) * 60;

  $("gaugeCard").dataset.level = level.key;
  $("lvlWord").textContent = level.word;
  $("gaugeLeft").textContent = `${minutes} min`;
  $("gaugeFill").style.height = `${Math.max(0, Math.min(100, (left / total) * 100))}%`;
  $("gaugeDep").textContent = `Départ à ${formatClock(new Date(now.getTime() + left * 1000))}`;
  $("gauge").setAttribute(
    "aria-label",
    `Temps restant avant le départ : ${minutes} minutes, ${level.word}`,
  );
}

function pulse() {
  const card = $("stepCard");
  card.classList.remove("is-validated");
  void card.offsetWidth;
  card.classList.add("is-validated");
  navigator.vibrate?.(20);
}

function startRoutine() {
  finished = false;
  started = true;
  running = true;
  step = 0;
  remaining = STEPS[0].seconds;
  renderRoutine();
  renderAlarm(new Date());
  speak(stepStartText(0));
  announce(stepStartText(0));
}

$("stepNext").addEventListener("click", () => {
  if (finished) {
    step = 0;
    remaining = STEPS[0].seconds;
    started = false;
    running = false;
    finished = false;
  } else if (!started) {
    startRoutine();
    return;
  } else if (step < STEPS.length - 1) {
    const ended = step;
    awardStar(ended);
    step += 1;
    remaining = STEPS[step].seconds;
    running = true;
    pulse();
    speak(`${stepEndText(ended)} ${stepStartText(step)}`);
    announce(stepStartText(step));
  } else {
    awardStar(step);
    finished = true;
    running = false;
    celebrate(18);
    speak(`${stepEndText(step)} Routine terminée. Bonne journée.`);
    announce("Routine terminée. Bonne journée.");
  }
  renderRoutine();
  renderAlarm(new Date());
});

$("stepReset").addEventListener("click", () => {
  step = 0;
  remaining = STEPS[0].seconds;
  started = false;
  running = false;
  finished = false;
  shutUp();
  renderRoutine();
  renderAlarm(new Date());
});

/* ---------- sonnerie : maintien 1,5 s ---------- */
let holdTimer = null;
let dawnTimer = null;
let dawnStart = 0;

function updateDawn() {
  const seconds = (Date.now() - dawnStart) / 1000;
  $("ring").style.setProperty("--aube", dawnAt(seconds));
}

function openRing() {
  $("ringTime").textContent = formatClock(wallClock());
  $("ring").hidden = false;
  $("phone").inert = true;
  document.documentElement.classList.add("is-ringing");
  dawnStart = Date.now();
  updateDawn();
  clearInterval(dawnTimer);
  dawnTimer = setInterval(updateDawn, 1000);
  holdReset();
  startRing();
  $("hold").focus({ preventScroll: true });
}

/* Dans l'APK, le son est tenu par RingService jusqu'à l'acquittement : la page
   ne joue pas sa propre sonnerie, sinon deux sons se superposeraient et
   l'application balayée emporterait le seul qui reste. */
function nativeAlarmOwnsSound() {
  return Boolean(window.AndroidBridge?.nativeAlarm?.());
}

function startRing() {
  clearTimeout(loopTimer);
  if (nativeAlarmOwnsSound()) return;
  const audio = ensureAudio();
  if (!audio) return;
  audio
    .resume()
    .then(() => {
      if (!master) return;
      const t = audio.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(0.0001, t);
      master.gain.exponentialRampToValueAtTime(alarm.rise ? 0.1 : 0.4, t + 0.8);
      if (alarm.rise) master.gain.exponentialRampToValueAtTime(0.45, t + 90);
      loopSound();
    })
    .catch(() => {});
  navigator.vibrate?.([220, 320, 220]);
}

function stopRing() {
  clearTimeout(loopTimer);
  loopTimer = null;
  if (ctx && master) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
  }
  navigator.vibrate?.(0);
  window.AndroidBridge?.ringDone?.();
}

function holdReset() {
  clearTimeout(holdTimer);
  holdTimer = null;
  $("hold").classList.remove("is-holding");
  $("holdFill").style.transition = "stroke-dashoffset 300ms ease-out";
  $("holdFill").style.strokeDashoffset = `${RING}`;
}

function holdStart() {
  if (holdTimer || $("ring").hidden) return;
  $("hold").classList.add("is-holding");
  $("holdFill").style.transition = `stroke-dashoffset ${HOLD_MS}ms linear`;
  $("holdFill").style.strokeDashoffset = "0";
  navigator.vibrate?.(15);
  if (!nativeAlarmOwnsSound() && (!ctx || ctx.state !== "running")) {
    armAudio();
    setTimeout(() => {
      if (ctx?.state === "running" && !loopTimer) loopSound();
    }, 120);
  }
  holdTimer = setTimeout(holdDone, HOLD_MS);
}

function holdCancel() {
  if (!holdTimer) return;
  holdReset();
}

function holdDone() {
  holdTimer = null;
  stopRing();
  navigator.vibrate?.(40);
  clearInterval(dawnTimer);
  $("ring").hidden = true;
  $("standTime").textContent = formatClock(wallClock());
  $("stand").hidden = false;
  $("imUp").focus({ preventScroll: true });
}

$("hold").addEventListener("pointerdown", (event) => {
  event.preventDefault();
  holdStart();
});
["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
  $("hold").addEventListener(type, holdCancel);
});
$("hold").addEventListener("contextmenu", (event) => event.preventDefault());
$("hold").addEventListener("click", (event) => event.preventDefault());
$("hold").addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    holdStart();
  }
});
$("hold").addEventListener("keyup", (event) => {
  if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    holdCancel();
  }
});

$("imUp").addEventListener("click", () => {
  $("stand").hidden = true;
  $("phone").inert = false;
  document.documentElement.classList.remove("is-ringing");
  showTab("routine");
  startRoutine();
});

$("tryNow").addEventListener("click", openRing);

/* ---------- profils, routine et objectif ---------- */
function resetRoutine() {
  step = 0;
  remaining = STEPS[0].seconds;
  started = false;
  running = false;
  finished = false;
}

function renderProfile() {
  const profile = activeProfile();
  $("profileSelect").innerHTML = profiles.list
    .map((p) => `<option value="${p.id}">${escapeHTML(p.name)}</option>`)
    .join("");
  $("profileSelect").value = profile.id;
  $("profileName").value = profile.name;
  $("profileDelete").disabled = profiles.list.length <= 1;
  $("stepEdit").innerHTML = profile.steps
    .map(
      (s, i) => `<li class="step-edit-row">
        <input type="text" class="step-name-input" data-i="${i}" value="${escapeHTML(s.name)}" maxlength="40" aria-label="Nom de l'étape ${i + 1}" />
        <input type="number" class="step-min-input" data-i="${i}" value="${Math.max(1, Math.round(s.seconds / 60))}" min="1" max="60" inputmode="numeric" aria-label="Durée de l'étape ${i + 1} en minutes" />
        <button class="icon-btn" data-remove="${i}" aria-label="Supprimer l'étape ${i + 1}"${profile.steps.length <= 1 ? " disabled" : ""}>✕</button>
      </li>`,
    )
    .join("");
  $("routineLede").textContent = `Une étape à la fois. ${routineMinutes(STEPS)} minutes jusqu'au départ.`;
}

$("profileSelect").addEventListener("change", (event) => {
  profiles.active = event.target.value;
  saveProfiles();
  STEPS = activeProfile().steps;
  resetRoutine();
  renderProfile();
  renderRoutine();
  renderStars();
  renderAlarm(new Date());
  announce(`Profil ${activeProfile().name}.`);
});

$("profileName").addEventListener("change", (event) => {
  activeProfile().name = event.target.value.trim() || "Profil";
  saveProfiles();
  renderProfile();
  renderAlarm(new Date());
});

$("profileAdd").addEventListener("click", () => {
  const profile = {
    ...defaultProfile(),
    id: `p${Date.now()}`,
    name: "Nouveau profil",
    goal: { label: "", stars: 20 },
  };
  profiles.list.push(profile);
  profiles.active = profile.id;
  saveProfiles();
  STEPS = profile.steps;
  resetRoutine();
  renderProfile();
  renderRoutine();
  renderStars();
  renderAlarm(new Date());
  announce("Nouveau profil créé.");
});

$("profileDelete").addEventListener("click", () => {
  if (profiles.list.length <= 1) return;
  if (!window.confirm(`Supprimer le profil ${activeProfile().name} et ses étoiles ?`)) return;
  const id = profiles.active;
  profiles.list = profiles.list.filter((p) => p.id !== id);
  profiles.active = profiles.list[0].id;
  delete stars[id];
  saveProfiles();
  saveStars();
  STEPS = activeProfile().steps;
  resetRoutine();
  renderProfile();
  renderRoutine();
  renderStars();
  renderAlarm(new Date());
  announce("Profil supprimé.");
});

$("stepEdit").addEventListener("change", (event) => {
  const target = event.target;
  const index = Number(target.dataset.i);
  if (!Number.isInteger(index)) return;
  const s = activeProfile().steps[index];
  if (!s) return;
  if (target.classList.contains("step-name-input")) {
    s.name = target.value.trim() || "Étape";
  } else if (target.classList.contains("step-min-input")) {
    const minutes = Math.max(1, Math.min(60, Math.round(Number(target.value) || 5)));
    s.seconds = minutes * 60;
    target.value = String(minutes);
  } else {
    return;
  }
  saveProfiles();
  STEPS = activeProfile().steps;
  resetRoutine();
  renderProfile();
  renderRoutine();
  renderAlarm(new Date());
});

$("stepEdit").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  const steps = activeProfile().steps;
  if (steps.length <= 1) return;
  steps.splice(Number(button.dataset.remove), 1);
  saveProfiles();
  STEPS = steps;
  resetRoutine();
  renderProfile();
  renderRoutine();
  renderAlarm(new Date());
});

$("stepAdd").addEventListener("click", () => {
  activeProfile().steps.push({ name: "Nouvelle étape", note: "", seconds: 300 });
  saveProfiles();
  STEPS = activeProfile().steps;
  resetRoutine();
  renderProfile();
  renderRoutine();
  renderAlarm(new Date());
});

$("eveningList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-evening]");
  if (!button || button.disabled) return;
  const index = Number(button.dataset.evening);
  awardStar(100 + index);
  speak(`${EVENING[index].name} : c'est noté.`);
});

$("goalEdit").addEventListener("click", () => {
  const form = $("goalForm");
  form.hidden = !form.hidden;
  if (form.hidden) return;
  const goal = activeProfile().goal;
  $("goalName").value = goal.label;
  $("goalStars").value = String(goal.stars);
  $("goalName").focus();
});

$("goalSave").addEventListener("click", () => {
  const label = $("goalName").value.trim();
  const target = Math.max(1, Math.min(99, Math.round(Number($("goalStars").value) || 20)));
  activeProfile().goal = { label, stars: target };
  saveProfiles();
  $("goalForm").hidden = true;
  renderStars();
  announce("Objectif enregistré.");
});

/* ---------- confort ---------- */
function applyPrefs() {
  const text = ["normal", "grand", "max"].includes(prefs.text) ? prefs.text : "normal";
  prefs.text = text;
  $("phone").dataset.text = text;
  $("phone").dataset.contrast = String(Boolean(prefs.contrast));
  $("textSize").value = text;
  $("oneThing").setAttribute("aria-checked", String(Boolean(prefs.oneThing)));
  $("contrast").setAttribute("aria-checked", String(Boolean(prefs.contrast)));
}

$("textSize").addEventListener("change", (event) => {
  prefs.text = event.target.value;
  savePrefs();
  applyPrefs();
});

$("oneThing").addEventListener("click", () => {
  prefs.oneThing = !prefs.oneThing;
  savePrefs();
  applyPrefs();
  renderRoutine();
});

$("contrast").addEventListener("click", () => {
  prefs.contrast = !prefs.contrast;
  savePrefs();
  applyPrefs();
});

/* ---------- santé du réveil ---------- */
const HEALTH_ROWS = [
  { key: "notifications", label: "Notifications", setting: "notifications", hint: "Sans elles, aucune alerte visible." },
  { key: "exact", label: "Alarme exacte", setting: "exact", hint: "Sans elle, Android peut retarder la sonnerie." },
  { key: "fullScreen", label: "Plein écran", setting: "fullscreen", hint: "L'écran de réveil par-dessus le verrouillage." },
  { key: "battery", label: "Batterie", setting: "battery", hint: "Sans optimisation, le réveil tient mieux." },
];

function refreshHealth() {
  const bridge = window.AndroidBridge;
  if (!bridge?.health) {
    $("healthList").innerHTML =
      '<p class="note">Les contrôles sont disponibles dans l’application Android. Ici, le réveil est simulé par la page.</p>';
    $("healthTest").disabled = true;
    $("healthLog").innerHTML = '<li class="note">Journal disponible dans l’APK.</li>';
    return;
  }
  let data = null;
  try {
    data = JSON.parse(bridge.health() || "null");
  } catch {
    data = null;
  }
  if (!data) {
    $("healthList").innerHTML = '<p class="note">Contrôle impossible.</p>';
    return;
  }
  const rows = HEALTH_ROWS.map((row) => {
    const ok = Boolean(data[row.key]);
    return `<div class="health-row" data-ok="${ok}">
      <div><p>${row.label}</p><p class="value">${ok ? "OK" : row.hint}</p></div>
      <button class="btn btn--ghost btn--sm" data-setting="${row.setting}">${ok ? "Réglage" : "Corriger"}</button>
    </div>`;
  });
  const volume = Number(data.volume);
  const max = Number(data.volumeMax);
  const soundOk = volume > 0;
  const volumeText = volume >= 0 ? `${volume} / ${max}` : "Inconnu";
  rows.push(`<div class="health-row" data-ok="${soundOk}">
    <div><p>Volume du réveil</p><p class="value">${soundOk ? volumeText : "À zéro : le réveil serait muet"}</p></div>
    <button class="btn btn--ghost btn--sm" data-setting="sound">Régler</button>
  </div>`);
  $("healthList").innerHTML = rows.join("");
  if (data.version) $("appVersion").textContent = data.version;
  renderLog(data.log);
}

function renderLog(events) {
  if (!Array.isArray(events) || !events.length) {
    $("healthLog").innerHTML = '<li class="note">Aucun événement enregistré.</li>';
    return;
  }
  const labels = {
    ARM: "programmé",
    DISARM: "annulé",
    FIRE: "déclenché",
    ACK: "acquitté",
    MISSED: "manqué",
    TEST: "test programmé",
    TEST_FIRE: "test déclenché",
    INEXACT: "approximatif",
    TIMEOUT: "sans réponse",
  };
  $("healthLog").innerHTML = events
    .slice()
    .reverse()
    .map((event) => {
      const when = new Date(Number(event.at) || Date.now());
      const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      const detail = event.detail ? ` · ${escapeHTML(event.detail)}` : "";
      return `<li><time>${time}</time><span>${labels[event.type] || escapeHTML(event.type)}${detail}</span></li>`;
    })
    .join("");
}

$("healthList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-setting]");
  if (!button) return;
  try {
    window.AndroidBridge?.openSetting?.(button.dataset.setting);
  } catch {
    // Aucun réglage système à ouvrir ici.
  }
});

$("healthRefresh").addEventListener("click", refreshHealth);

$("healthTest").addEventListener("click", () => {
  try {
    window.AndroidBridge?.testAlarm?.();
    $("healthNote").textContent =
      "Test programmé : le réveil sonnera dans 2 minutes, même application fermée.";
    announce("Test du réveil programmé dans deux minutes.");
    refreshHealth();
  } catch {
    $("healthNote").textContent = "Le test n'est disponible que dans l'application Android.";
  }
});

/* ---------- sauvegarde, restauration, impression ---------- */
function backupText() {
  return JSON.stringify(
    {
      app: "matinbulle",
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      alarm,
      profiles,
      stars,
      prefs,
    },
    null,
    2,
  );
}

$("exportData").addEventListener("click", () => {
  const text = backupText();
  const bridge = window.AndroidBridge;
  if (bridge?.share) {
    try {
      bridge.share("matinbulle-sauvegarde.json", text);
      $("dataNote").textContent = "Sauvegarde envoyée au partage.";
      return;
    } catch {
      // Repli sur le téléchargement du navigateur.
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "matinbulle-sauvegarde.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  $("dataNote").textContent = "Sauvegarde téléchargée.";
});

$("importBtn").addEventListener("click", () => {
  try {
    const data = JSON.parse($("importData").value);
    if (!data || typeof data !== "object") throw new Error("format");
    if (data.profiles && Array.isArray(data.profiles.list) && data.profiles.list.length) {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(data.profiles));
    }
    if (data.stars && typeof data.stars === "object") {
      localStorage.setItem(STARS_KEY, JSON.stringify(data.stars));
    }
    if (data.prefs && typeof data.prefs === "object") {
      localStorage.setItem(PREFS_KEY, JSON.stringify(data.prefs));
    }
    if (data.alarm && typeof data.alarm === "object") {
      localStorage.setItem(KEY, JSON.stringify(data.alarm));
    }
    $("dataNote").textContent = "Sauvegarde restaurée, rechargement…";
    setTimeout(() => location.reload(), 600);
  } catch {
    $("dataNote").textContent = "JSON illisible : rien n'a été modifié.";
  }
});

function renderPrintSheet() {
  const today = wallClock();
  const map = starMap();
  let total = 0;
  const rows = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const list = map[dayStamp(day)];
    const count = Array.isArray(list) ? list.length : 0;
    total += count;
    rows.push(
      `<tr><td>${longDay.format(day)}</td><td class="num">${count}</td><td class="num">${euros(count)}</td></tr>`,
    );
  }
  const goal = activeProfile().goal;
  $("printSheet").innerHTML = `
    <h1>Matinbulle — ${escapeHTML(activeProfile().name)}</h1>
    <p>30 derniers jours · ${total} étoiles · ${euros(total)}</p>
    <p>Objectif : ${escapeHTML(goal.label || "à définir")} (${goal.stars} étoiles)</p>
    <table>
      <thead><tr><th>Jour</th><th class="num">Étoiles</th><th class="num">Valeur</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
    <p>Fait avec ♥ pour nono</p>`;
}

$("printData").addEventListener("click", () => {
  renderPrintSheet();
  try {
    if (window.AndroidBridge?.printPage) window.AndroidBridge.printPage();
    else window.print();
  } catch {
    $("dataNote").textContent = "Impression indisponible ici.";
  }
});

/* ---------- version et mise à jour ---------- */
function newerThan(tag) {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const next = parse(tag);
  const mine = parse(APP_VERSION);
  for (let i = 0; i < 3; i++) {
    if ((next[i] || 0) > (mine[i] || 0)) return true;
    if ((next[i] || 0) < (mine[i] || 0)) return false;
  }
  return false;
}

$("checkUpdate").addEventListener("click", async () => {
  $("updateNote").textContent = "Recherche de la dernière version…";
  try {
    const response = await fetch("https://api.github.com/repos/RABI46/matinbulle/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error("réseau");
    const release = await response.json();
    if (newerThan(release.tag_name)) {
      $("updateNote").textContent = `Nouvelle version ${release.tag_name} disponible. `;
      const link = document.createElement("button");
      link.className = "btn btn--ghost btn--sm";
      link.textContent = "Télécharger";
      link.addEventListener("click", () => {
        if (window.AndroidBridge?.openUrl) window.AndroidBridge.openUrl(release.html_url);
        else window.open(release.html_url, "_blank", "noopener");
      });
      $("updateNote").append(link);
    } else {
      $("updateNote").textContent = `Matinbulle ${APP_VERSION} est à jour.`;
    }
  } catch {
    $("updateNote").textContent = "Vérification impossible (hors ligne ou réseau bloqué).";
  }
});

/* ---------- widgets Android ---------- */
let lastWidget = "";
function pushWidget() {
  const bridge = window.AndroidBridge;
  if (!bridge?.widget) return;
  const next = nextAlarmInZone(alarm, zoneOf(), new Date());
  const data = JSON.stringify({
    time: alarm.time,
    meta: alarm.enabled && next ? daysLabel(alarm.days) : "Réveil désactivé",
    stars: todayIndexes().length,
    steps: STEPS.slice(0, 4).map((s, i) => `${i + 1}. ${s.name}`),
  });
  if (data === lastWidget) return;
  lastWidget = data;
  try {
    bridge.widget(data);
  } catch {
    // Un widget absent ne doit rien casser.
  }
}

/* ---------- horloge ---------- */
const todayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const GRACE = 10 * 60_000;

function dueNow(now) {
  if (!alarm.enabled) return null;
  // Un réveil manqué pendant que la page dormait sonne encore, avec du retard.
  const next = nextAlarmInZone(alarm, zoneOf(), new Date(now.getTime() - GRACE));
  return next && next.at.getTime() <= now.getTime() ? next : null;
}

function tick() {
  const now = new Date();
  const wall = wallClock(now);
  $("today").textContent = todayFmt.format(wall);
  if (dayStamp(wall) !== shownDay) renderStars();
  renderAlarm(now);
  if (running) {
    remaining = Math.max(0, remaining - 1);
    if (remaining === 0) {
      running = false;
      navigator.vibrate?.(20);
      speak(stepEndText(step));
    }
    renderRoutine();
  }
  if ($("ring").hidden) {
    const due = dueNow(now);
    if (due && due.at.toISOString() !== lastFired) {
      lastFired = due.at.toISOString();
      openRing();
    }
  }
}

// Déclenchée par l'alarme système (bridge) ou par le retour de veille de la page.
const ringIfIdle = () => {
  if ($("ring").hidden) openRing();
};
window.matinbulleRing = ringIfIdle;
document.addEventListener("matinbulle:ring", ringIfIdle);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

/* ---------- retour tactile : tous les boutons ---------- */
function tap(button) {
  if (!button || button.classList.contains("hold")) return;
  button.classList.remove("is-tapped");
  void button.offsetWidth;
  button.classList.add("is-tapped");
}
document.addEventListener("pointerdown", (event) => {
  const button = event.target.closest?.("button");
  if (button) tap(button);
});
// Activation au clavier : pas de pointerdown, mais un click sans coordonnées.
document.addEventListener("click", (event) => {
  if (event.detail !== 0) return;
  const button = event.target.closest?.("button");
  if (button) tap(button);
});
document.addEventListener("animationend", (event) => {
  if (event.animationName === "tap-pop") event.target.classList.remove("is-tapped");
});

applyPrefs();
renderProfile();
renderDays();
renderSounds();
renderRoutine();
renderStars();
renderEvening();
$("appVersion").textContent = APP_VERSION;
refreshHealth();
tick();
setInterval(tick, 1000);
