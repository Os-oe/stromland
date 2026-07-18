// Boot + Render-Loop. Adaptives Budget, Atmen (Netzfrequenz), HUD-Takt.

import { DataModel, MOCK, SEED } from './data.js';
import { Painter } from './painter.js';
import { Finish } from './grain.js';
import { Hud } from './hud.js';

const stage = document.getElementById('stage');
const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d', { alpha: false });

const data = new DataModel();
const painter = new Painter(SEED);
const finish = new Finish(stage);
const hud = new Hud();

// Barrierefreiheit: reduzierte Bewegung respektieren
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (REDUCED) painter.quality = 0.5;

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
    if (fps.val < 42 && painter.quality > 0.4) painter.quality = Math.max(0.4, painter.quality - 0.15);
    else if (fps.val > 55 && painter.quality < QMAX) painter.quality = Math.min(QMAX, painter.quality + 0.1);
  }
}
// Für Tests einsehbar
window.__stromland = { fps, painter, data, mock: MOCK, ready: false };

let last = performance.now();
let lastSnapAt = 0;
let lastHudAt = 0;
let snap = null;

function loop(t) {
  requestAnimationFrame(loop);
  const dt = t - last;
  last = t;
  tuneQuality(dt);
  tickReplay(t);

  // Snapshot-Takt: 1×/s reicht (15-min-Daten), Replay setzt öfter
  if (!snap || t - lastSnapAt > 1000 || data.replayOffsetMin != null) {
    snap = data.snapshot();
    painter.setSnapshot(snap);
    lastSnapAt = t;
  }

  const freq = data.freqAt(Date.now());

  painter.render(ctx, t, dt, freq);
  // Atmen: globale Helligkeits-Oszillation um 50,00 Hz; Abweichung = Unruhe
  const unrest = Math.min(1, Math.abs(freq.dev) / 0.06);
  const period = 7000 - unrest * 2600;
  // spürbar, nie aufdringlich; bei reduced-motion aus
  const breathe = REDUCED ? 0 :
    Math.sin((t % period) / period * Math.PI * 2) * (0.011 + unrest * 0.016)
    + Math.max(-0.028, Math.min(0.028, freq.dev * 0.24));
  const sat = 0.82 + 0.30 * Math.min(1, Math.max(0, snap.share / 100));
  // quantisiert: Style-Recalc nur bei sichtbarer Änderung (~jede 3.-5. Frame)
  const bq = Math.round((1 + breathe) * 400) / 400;
  const sq = Math.round(sat * 200) / 200;
  const filterStr = `brightness(${bq}) saturate(${sq})`;
  if (filterStr !== stage._lastFilter) {
    stage.style.filter = filterStr;
    stage._lastFilter = filterStr;
  }
  // Finish-Pass: Korn + Vignette direkt in die Szene (reines 2D, kein
  // mix-blend-mode/WebGL → keine ReadPixels-Stalls)
  finish.render(ctx, t, unrest);

  if (t - lastHudAt > (replay ? 120 : 1000)) {
    hud.update(snap, freq);
    lastHudAt = t;
  }
}

// ---------- Features: Replay · Galerie · Info-Overlay ----------
const REPLAY_MS = 40000;
let replay = null; // {t0}

function replayMaxMinutes() {
  const ts = data.power?.unix_seconds;
  if (!ts?.length) return 1440;
  return Math.max(60, Math.min(1439, (ts[ts.length - 1] - ts[0]) / 60));
}

function startReplay() {
  replay = { t0: performance.now() };
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
}

function tickReplay(t) {
  if (!replay) return;
  const prog = (t - replay.t0) / REPLAY_MS;
  if (prog >= 1) { stopReplay(); return; }
  // sanfte Beschleunigung am Anfang/Ende
  const e = prog < 0.5 ? 2 * prog * prog : 1 - Math.pow(-2 * prog + 2, 2) / 2;
  data.replayOffsetMin = e * replayMaxMinutes();
  document.getElementById('replay-bar').style.width = (e * 100).toFixed(1) + '%';
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

  // Erstbesuch-Hint: nur im natürlichen Live-Modus (nicht bei ?at/?mock — Determinismus)
  const natural = !MOCK && !data.atOverride;
  let seen = false;
  try { seen = localStorage.getItem('stromland-seen') === '1'; } catch { /* private mode */ }
  if (natural && !seen) {
    const hint = document.getElementById('first-hint');
    setTimeout(() => hint.classList.add('show'), 1800);
    setTimeout(() => {
      hint.classList.remove('show');
      try { localStorage.setItem('stromland-seen', '1'); } catch { /* egal */ }
    }, 11000);
  }
}

boot();
