// Boot + Render-Loop. Adaptives Budget, Atmen (Netzfrequenz), HUD-Takt,
// Intro-Tagesfahrt (kondensierte Fahrt von gestern-Morgengrauen bis jetzt).

import { DataModel, MOCK, SEED, sunElevation } from './data.js';
import { Painter } from './painter.js';
import { Finish } from './grain.js';
import { Hud } from './hud.js';

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });

const qs = new URLSearchParams(location.search);
const NOGRAIN = qs.get('grain') === '0'; // Motion-Gate: Korn aus → Deltas = echte Bewegung
const INTRO_OFF = qs.get('intro') === '0';
// ?q= pinnt das Qualitäts-Budget (Tests: kein adaptiver Statik-Repaint zwischen Frames)
const QPIN = qs.get('q') ? Math.max(0.4, Math.min(1, parseFloat(qs.get('q')) || 1)) : null;
// ?filter=0: globale Brightness-/Saturate-Schicht aus (Motion-Gate misst NUR die
// Bewegung im Gemälde selbst; brightness() arbeitet in linearRGB und ließe sich
// im sRGB-Screenshot nicht sauber herausrechnen)
const NOFILTER = qs.get('filter') === '0';

const data = new DataModel();
const painter = new Painter(SEED);
const finish = new Finish(stage);
const hud = new Hud();

// Barrierefreiheit: reduzierte Bewegung respektieren
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (REDUCED) { painter.quality = 0.5; painter.motionScale = 0.45; }
if (QPIN) painter.quality = QPIN;

const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

let dpr = 1;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    painter.resize(w, h);
    finish.resize(w, h, dpr);
  }
}
addEventListener('resize', resize);

// FPS-Monitor → Qualitätsbudget 0.4..1
const fps = { acc: 0, n: 0, val: 60 };
const QMAX = REDUCED ? 0.5 : 1;
function tuneQuality(dtMs) {
  fps.acc += dtMs; fps.n++;
  if (fps.acc >= 2000) {
    fps.val = 1000 / (fps.acc / fps.n);
    fps.acc = 0; fps.n = 0;
    if (QPIN) return; // gepinnt: fps weiter messen, Budget nicht anfassen
    if (fps.val < 42 && painter.quality > 0.4) painter.quality = Math.max(0.4, painter.quality - 0.15);
    else if (fps.val > 55 && painter.quality < QMAX) painter.quality = Math.min(QMAX, painter.quality + 0.1);
  }
}
// Für Tests einsehbar
window.__stromland = { fps, painter, data, mock: MOCK, ready: false };

let last = performance.now();
let lastSnapAt = 0;
let lastHudAt = 0;
let lastSparkAt = 0;
let snap = null;
const sparkBuf = []; // {t, hz} der letzten ~60 s — HUD-Frequenz-Sparkline

function loop(t) {
  requestAnimationFrame(loop);
  const dt = t - last;
  last = t;
  tuneQuality(dt);
  tickReplay(t);
  tickIntro(t);

  // Snapshot-Takt: 1×/s reicht (15-min-Daten), Replay/Intro setzt öfter
  if (!snap || t - lastSnapAt > 1000 || data.replayOffsetMin != null) {
    snap = data.snapshot();
    painter.setSnapshot(snap);
    lastSnapAt = t;
  }

  const freq = data.freqAt(Date.now());
  // Atmen: Oszillation um 50,00 Hz; Abweichung = Unruhe. Der Wert geht auch an
  // den Maler (Nebel-Glow, Mond-Hof) — Atmung mehr als Licht-Reaktion denn als
  // globale Helligkeit.
  const unrest = Math.min(1, Math.abs(freq.dev) / 0.06);
  const period = 7000 - unrest * 2600;
  // spürbar, nie aufdringlich; bei reduced-motion aus
  const breathe = REDUCED ? 0 :
    Math.sin((t % period) / period * Math.PI * 2) * (0.012 + unrest * 0.018)
    + Math.max(-0.028, Math.min(0.028, freq.dev * 0.24));

  painter.render(ctx, t, dt, freq, breathe);
  const sat = 0.82 + 0.30 * Math.min(1, Math.max(0, snap.share / 100));
  // quantisiert: Style-Recalc nur bei sichtbarer Änderung (~jede 3.-5. Frame)
  const bq = Math.round((1 + breathe) * 400) / 400;
  const sq = Math.round(sat * 200) / 200;
  const filterStr = `brightness(${bq}) saturate(${sq})`;
  if (!NOFILTER && filterStr !== stage._lastFilter) {
    stage.style.filter = filterStr;
    stage._lastFilter = filterStr;
  }
  // Finish-Pass: Korn + Vignette direkt in die Szene (reines 2D, kein
  // mix-blend-mode/WebGL → keine ReadPixels-Stalls)
  if (!NOGRAIN) finish.render(ctx, t, unrest);

  if (t - lastHudAt > (replay || intro ? 120 : 1000)) {
    hud.update(snap, freq);
    lastHudAt = t;
  }
  // Frequenz-Sparkline: 4 Samples/s, Fenster 60 s — der ehrliche Daten-Puls
  if (t - lastSparkAt > 250) {
    const nowMs = Date.now();
    sparkBuf.push({ t: nowMs, hz: freq.hz });
    while (sparkBuf.length && sparkBuf[0].t < nowMs - 62000) sparkBuf.shift();
    hud.drawSpark(sparkBuf);
    lastSparkAt = t;
  }
}

// ---------- Features: Replay · Galerie · Info-Overlay ----------
const REPLAY_MS = 40000;
let replay = null; // {t0, startMin, endMin}

// "Dieser Tag": Mitternacht des jüngsten Datentags → Szenen-Jetzt. Das Daten-
// fenster reicht inzwischen bis zum Vortag zurück — der Offset ist relativ ts[0].
function replayRange() {
  const ts = data.power?.unix_seconds;
  if (!ts?.length) return { startMin: 0, endMin: 60 };
  const startMin = (data.sceneDayStart() - ts[0]) / 60;
  const endMin = Math.max(startMin + 30, (data.liveNowUnix() - ts[0]) / 60);
  return { startMin, endMin: Math.min(endMin, startMin + 1439) };
}

function startReplay() {
  if (intro) endIntro(false);
  replay = { t0: performance.now(), ...replayRange() };
  painter.coarse = true;
  document.body.classList.add('replaying');
  document.getElementById('btn-replay').textContent = 'Jetzt';
}

function stopReplay() {
  replay = null;
  data.replayOffsetMin = null;
  painter.coarse = false;
  document.body.classList.remove('replaying');
  document.getElementById('btn-replay').textContent = 'Dieser Tag';
  forceRefresh();
}

// Snapshot + HUD im NÄCHSTEN Frame erneuern — nach Replay-/Intro-Ende darf das
// Bild nicht bis zu 2 s auf dem letzten Fahrt-Moment stehen bleiben
function forceRefresh() {
  lastSnapAt = -1e9;
  lastHudAt = -1e9;
}

function tickReplay(t) {
  if (!replay) return;
  const prog = (t - replay.t0) / REPLAY_MS;
  if (prog >= 1) { stopReplay(); return; }
  // sanfte Beschleunigung am Anfang/Ende
  const e = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
  data.replayOffsetMin = replay.startMin + e * (replay.endMin - replay.startMin);
  document.getElementById('replay-bar').style.width = (e * 100).toFixed(1) + '%';
}

// ---------- Intro-Tagesfahrt ----------
// Beim Öffnen: kondensierte Fahrt von gestern-Morgengrauen durch Mittag/Abend
// bis zum JETZT (~13,5 s). Nutzt die Replay-Mechanik (data.replayOffsetMin);
// verweilt an Sonnenauf-/-untergang, eilt durch die Nacht, settelt sanft im Jetzt.
// Jede Interaktion bricht sofort zum Live-Modus ab. Aus bei ?at=, ?intro=0,
// prefers-reduced-motion.
const INTRO_MS = 13500;
let intro = null; // {t0, startUnix, endUnix, cdf, N}
let firstHintDone = false;
let swallowClickUntil = 0;

function introTimeline() {
  const ts = data.power?.unix_seconds;
  if (!ts?.length) return null;
  const endUnix = data.liveNowUnix();
  // gestern-Morgengrauen: Vortags-Mitternacht, dann erster Sonnenstand > −8°
  const yMid = data.dayStartOf(endUnix) - 86400;
  let dawn = yMid + 4 * 3600;
  for (let m = 0; m <= 720; m += 10) {
    if (sunElevation(new Date((yMid + m * 60) * 1000)).elevDeg > -8) {
      dawn = yMid + Math.max(0, m - 20) * 60;
      break;
    }
  }
  if (endUnix - dawn < 3600) return null; // absurd kurze Fahrt: lieber gar keine
  // Gewichtete Zeitachse: hohes Gewicht = die Fahrt verweilt dort
  const N = 240;
  const w = [];
  for (let i = 0; i <= N; i++) {
    const u = dawn + (endUnix - dawn) * (i / N);
    const e = sunElevation(new Date(u * 1000)).elevDeg;
    const twi = Math.exp(-((e / 7) ** 2));            // Sonnenauf-/-untergang
    const day = Math.min(1, Math.max(0, e / 12));     // Tag ruhig, Nacht schnell
    w.push((0.28 + 2.6 * twi + 0.9 * day) * (1 + 2.5 * smooth01(0.93, 1, i / N)));
  }
  const cdf = [0];
  for (let i = 1; i <= N; i++) cdf.push(cdf[i - 1] + (w[i - 1] + w[i]) / 2);
  return { startUnix: dawn, endUnix, cdf, N };
}

function startIntro() {
  const tl = introTimeline();
  if (!tl) return false;
  intro = { t0: performance.now(), ...tl };
  painter.coarse = true;
  document.body.classList.add('introing');
  document.getElementById('hud').classList.add('wake'); // die Uhr soll man LESEN
  return true;
}

function endIntro(settled) {
  if (!intro) return;
  intro = null;
  data.replayOffsetMin = null;
  if (!replay) painter.coarse = false;
  document.body.classList.remove('introing');
  document.getElementById('hud').classList.remove('wake');
  forceRefresh();
  if (settled) {
    const lh = document.getElementById('live-hint');
    lh.classList.add('show');
    setTimeout(() => lh.classList.remove('show'), 3800);
  }
  scheduleFirstHint(settled ? 5200 : 1600);
}

function tickIntro(t) {
  if (!intro) return;
  const prog = (t - intro.t0) / INTRO_MS;
  if (prog >= 1) { endIntro(true); return; }
  const cdf = intro.cdf, N = intro.N;
  const target = prog * cdf[N];
  let lo = 0, hi = N - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid + 1] < target) lo = mid + 1; else hi = mid;
  }
  const f = (target - cdf[lo]) / Math.max(1e-9, cdf[lo + 1] - cdf[lo]);
  const u = intro.startUnix + (intro.endUnix - intro.startUnix) * ((lo + f) / N);
  data.replayOffsetMin = (u - data.power.unix_seconds[0]) / 60;
}

// Jede Interaktion bricht die Fahrt sofort ab — und der Abbruch-Klick darf
// NICHT zusätzlich die Galerie togglen (Click nach Pointerdown schlucken).
function introInteract(e) {
  if (!intro) return;
  if (e.type === 'pointerdown' || e.type === 'touchstart') {
    swallowClickUntil = performance.now() + 800;
  }
  e.stopPropagation();
  endIntro(false);
}
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
  addEventListener(ev, introInteract, { capture: true, passive: true });
}
addEventListener('click', (e) => {
  if (performance.now() < swallowClickUntil) { e.stopPropagation(); swallowClickUntil = 0; }
}, { capture: true });

// Erstbesuch-Hint: nur im natürlichen Live-Modus (nicht bei ?at/?mock — Determinismus)
function scheduleFirstHint(delayMs) {
  if (firstHintDone) return;
  const natural = !MOCK && !data.atOverride;
  let seen = false;
  try { seen = localStorage.getItem('stromland-seen') === '1'; } catch { /* private mode */ }
  if (!natural || seen) return;
  firstHintDone = true;
  const hint = document.getElementById('first-hint');
  setTimeout(() => hint.classList.add('show'), delayMs);
  setTimeout(() => {
    hint.classList.remove('show');
    try { localStorage.setItem('stromland-seen', '1'); } catch { /* egal */ }
  }, delayMs + 9200);
}

const overlay = document.getElementById('overlay');
function openOverlay() { overlay.classList.add('open'); }
function closeOverlay() { overlay.classList.remove('open'); }

function wireUI() {
  document.getElementById('btn-replay').addEventListener('click', (e) => {
    e.stopPropagation();
    replay ? stopReplay() : startReplay();
  });
  document.getElementById('btn-info').addEventListener('click', (e) => {
    e.stopPropagation();
    openOverlay();
  });
  document.getElementById('overlay-close').addEventListener('click', closeOverlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
  // Galerie-Modus: Tap/Klick aufs Bild blendet ALLES aus
  canvas.addEventListener('click', () => {
    if (overlay.classList.contains('open')) return;
    const on = document.body.classList.toggle('gallery');
    // Exit-Hint einmal pro Sitzung — der Modus soll keine Falle sein
    if (on && !window.__stromland._galleryHinted) {
      window.__stromland._galleryHinted = true;
      const gh = document.getElementById('gallery-hint');
      gh.classList.add('show');
      setTimeout(() => gh.classList.remove('show'), 2600);
    }
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeOverlay(); document.body.classList.remove('gallery'); }
    if (e.key === 'g') document.body.classList.toggle('gallery');
    if (e.key === 'r') replay ? stopReplay() : startReplay();
    if (e.key === 'i') overlay.classList.contains('open') ? closeOverlay() : openOverlay();
  });
}

window.__stromland.startReplay = startReplay;
window.__stromland.stopReplay = stopReplay;
window.__stromland.isReplaying = () => replay != null;
window.__stromland.introActive = () => intro != null;

async function boot() {
  resize();
  wireUI();
  try {
    await data.load();
  } catch (e) {
    console.warn('data load failed, painting with defaults', e);
  }
  snap = data.snapshot();
  painter.setSnapshot(snap);
  hud.update(snap, data.freqAt(Date.now()));
  window.__stromland.ready = true;
  document.getElementById('stage').classList.add('ready');
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });

  // Intro-Tagesfahrt bei jedem normalen Laden; sonst direkt der Erstbesuch-Hint
  const canIntro = !INTRO_OFF && !REDUCED && !data.atOverride && !document.hidden;
  const started = canIntro && startIntro();
  if (!started) scheduleFirstHint(1800);
}

boot();
