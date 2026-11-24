import {
  DAYS,
  WEEK,
  dayKeyOf,
  daysLabel,
  dawnAt,
  formatClock,
  formatCountdown,
  formatMinutes,
  nextAlarm,
  parseTime,
  routineMinutes,
  routineRemaining,
  ROUTINE,
  timeLevel,
} from "./logic.js";
import { SOUNDS, schedulePhrase } from "./sounds.js";

const KEY = "matinbulle.v1";
const STEPS = ROUTINE;
const THEME = { reveil: "nuit", routine: "jour", widgets: "jour" };
const HOLD_MS = 1500;
const RING = 2 * Math.PI * 100;

const $ = (id) => document.getElementById(id);
const saved = JSON.parse(localStorage.getItem(KEY) || "null");
const alarm = { time: "07:15", days: [...WEEK], enabled: true, rise: true, sound: "bulles", ...(saved || {}) };
let step = 0;
let remaining = STEPS[0].seconds;
let running = false;
let started = false;
let finished = false;
let lastFired = "";

const save = () => localStorage.setItem(KEY, JSON.stringify(alarm));

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
  if (name !== "reveil") renderGauge(new Date());
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

function renderAlarm(now) {
  const next = nextAlarm(alarm, now);
  $("alarmTime").value = alarm.time;
  $("nextTime").textContent = next ? formatClock(next) : alarm.time;
  $("nextMeta").textContent = alarm.enabled
    ? next
      ? `dans ${formatCountdown(next - now)} · ${daysLabel(alarm.days)}`
      : "aucun jour sélectionné"
    : "réveil désactivé";
  $("alarmPill").textContent = alarm.enabled ? "Réveil actif" : "Réveil désactivé";
  $("alarmPill").dataset.off = String(!alarm.enabled);
  $("toggleAlarm").textContent = alarm.enabled ? "Désactiver" : "Activer";
  $("rise").setAttribute("aria-checked", String(alarm.rise));
  $("soundName").textContent = currentSound().name;

  $("wSmallTime").textContent = alarm.time;
  $("wSmallCount").textContent = alarm.enabled && next ? `dans ${formatCountdown(next - now)}` : "désactivé";
  $("wMidTime").textContent = alarm.time;
  $("wMidDays").textContent = daysLabel(alarm.days);
  $("wLargeTime").textContent = alarm.time;
  $("wLargeCount").textContent = alarm.enabled && next ? `dans ${formatCountdown(next - now)}` : "désactivé";
  $("wLargeSteps").innerHTML = STEPS.map(
    (s, i) => `<span data-current="${i === step && !finished}">${i + 1}. ${s.name}</span>`,
  ).join("");
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
    return `<li data-state="${state}"><span class="step-dot" aria-hidden="true">${state === "done" ? "✓" : i + 1}</span><span>${s.name}</span><span class="step-dur">${s.seconds / 60} min</span></li>`;
  }).join("");

  renderGauge(new Date());
}

function renderGauge(now) {
  const left = finished ? 0 : routineRemaining(step, remaining);
  const minutes = Math.ceil(left / 60);
  const level = timeLevel(minutes);
  const total = routineMinutes() * 60;

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
    step += 1;
    remaining = STEPS[step].seconds;
    running = true;
    pulse();
  } else {
    finished = true;
    running = false;
    celebrate(18);
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
  $("ringTime").textContent = formatClock(new Date());
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

function startRing() {
  clearTimeout(loopTimer);
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
  if (!ctx || ctx.state !== "running") {
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
  $("standTime").textContent = formatClock(new Date());
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

/* ---------- horloge ---------- */
const todayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function dueNow(now) {
  const time = parseTime(alarm.time);
  if (!alarm.enabled || !time) return false;
  const days = alarm.days.length ? alarm.days : WEEK;
  return days.includes(dayKeyOf(now)) && now.getHours() === time.hour && now.getMinutes() === time.minute;
}

function tick() {
  const now = new Date();
  $("today").textContent = todayFmt.format(now);
  renderAlarm(now);
  if (running) {
    remaining = Math.max(0, remaining - 1);
    if (remaining === 0) {
      running = false;
      navigator.vibrate?.(20);
    }
    renderRoutine();
  }
  if ($("ring").hidden) {
    const stamp = formatClock(now) + now.getDate();
    if (dueNow(now) && stamp !== lastFired) {
      lastFired = stamp;
      openRing();
    }
  }
}

renderDays();
renderSounds();
renderRoutine();
tick();
setInterval(tick, 1000);
