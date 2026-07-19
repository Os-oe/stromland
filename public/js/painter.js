// Der Maler. Geschichtete Strata-Landschaft aus tausenden kleinen Strichen —
// „Meridian-Strata × Romantik-Dunst". Statische Layer werden offscreen gecacht
// und nur bei Datenwechsel neu gemalt; Partikel/Nebel/Fluss-Schimmer je Frame.
//
// Anti-Patterns (hart): keine Solid-Fills, kein reines Schwarz/Weiß, keine harte
// Kreissonne, keine Icons, max. EIN gesättigter Akzent (Amber = Preis).

import { PALETTES, COMPOSITION, NORMS, AMBER, WARM_BLACK, PARTICLES } from './config.js';
import { Noise2D, mulberry32, ign } from './noise.js';

// ---------- Farb-Helfer ----------
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const PAL = {};
for (const [k, arr] of Object.entries(PALETTES)) PAL[k] = arr.map(hex);
const AMBER_C = hex(AMBER);
const BLACK_C = hex(WARM_BLACK);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// weicher runder Pinsel (einmal gerendert, überall gestempelt)
function makeBrush(size = 64) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

// Debug: ?dbg=noprice,nofog,noveil,noparticles,noshimmer — Layer-Bisect für Tests
const DBG = new Set((new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('dbg') || '').split(',').filter(Boolean));

export class Painter {
  constructor(seed = 42) {
    this.seed = seed;
    this.noise = new Noise2D(seed);
    this.rand = mulberry32(seed ^ 0x9e3779b9);
    this.brush = makeBrush(64);
    this.layers = {};      // name -> {c, ctx, key}
    this.particles = [];
    this.turbineAngle = 0;
    this.w = 0; this.h = 0;
    this.quality = 1;      // 0.4..1 — adaptives Budget (main.js)
    this.snap = null;
    this.norm = null;
    this.riverPath = null; // [{x,y,w}]
    this.ridges = null;
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const name of ['sky', 'celestial', 'far', 'mid', 'river', 'fore']) {
      const scale = name === 'sky' ? 0.5 : 1;
      const c = makeCanvas(Math.max(2, Math.round(w * scale)), Math.max(2, Math.round(h * scale)));
      this.layers[name] = { c, ctx: c.getContext('2d'), key: null, scale };
    }
    // Partikel-Canvas mit Nachleuchten
    this.pc = makeCanvas(w, h);
    this.pctx = this.pc.getContext('2d');
    // Statik-Composite: sky+celestial+far+mid+river in EINEM Canvas (Perf)
    this.staticC = makeCanvas(w, h);
    this.staticCtx = this.staticC.getContext('2d');
    this.buildGeometry();
    for (const l of Object.values(this.layers)) l.key = null; // alles neu
  }

  // ---------- Geometrie (seed-stabil) ----------
  buildGeometry() {
    const { w, h } = this;
    const R = mulberry32(this.seed ^ 0x51ed270b);
    const hor = h * COMPOSITION.horizon;
    const N = this.noise;

    // 6 Ridgelines: 2 hinten (über Horizont), 3 mittig, 1 Vordergrund-Stratum
    const mk = (baseY, amp, freq, yOff, phase) => {
      const pts = [];
      const n = 160;
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * w;
        const y = baseY
          + N.fbm(i / n * freq + phase, phase * 2.7, 4) * amp
          + N.at(i / n * freq * 3.7 + phase * 9, phase) * amp * 0.35
          + yOff;
        pts.push([x, y]);
      }
      return pts;
    };

    this.ridges = {
      back: [
        { pts: mk(hor - h * 0.075, h * 0.052, 2.1, 0, 3.17), depth: 0.9 },
        { pts: mk(hor - h * 0.030, h * 0.040, 2.9, 0, 7.61), depth: 0.72 },
      ],
      mid: [
        { pts: mk(hor + h * 0.035, h * 0.030, 3.4, 0, 11.4), depth: 0.5 },
        { pts: mk(hor + h * 0.105, h * 0.038, 2.6, 0, 17.9), depth: 0.32 },
        { pts: mk(hor + h * 0.190, h * 0.046, 2.2, 0, 23.3), depth: 0.18 },
      ],
      fore: [
        { pts: mk(h * 0.905, h * 0.05, 1.7, 0, 31.7), depth: 0.05 },
      ],
    };

    // Fluss: mäandriert aus Bildmitte am Horizont nach vorn
    const path = [];
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;                       // 0=Horizont, 1=unten
      const y = hor + t * (h - hor) * 1.02;
      const persp = Math.pow(t, 1.45);
      const meander = N.fbm(t * 2.6 + 40.2, 8.8, 3) * w * 0.16 * Math.pow(t, 0.7)
        + Math.sin(t * 5.2 + 1.4) * w * 0.045 * t;
      const x = w * 0.505 + meander;
      const wd = lerp(w * 0.0022, w * 0.16, persp); // Basisbreite, Hydro skaliert
      path.push({ x, y, wd, t });
    }
    this.riverPath = path;

    // Windräder: klein, Mittelgrund (vorderster Kamm überm Talband → Silhouette
    // gegen das Horizontlicht), nie vorn, nie groß
    const ridge = this.ridges.mid[0].pts;
    const xs = [0.14, 0.205, 0.263, 0.69, 0.755, 0.83];
    this.turbines = xs.map((fx, i) => {
      const x = fx * w + (R() - 0.5) * w * 0.02;
      const idx = Math.round((x / w) * (ridge.length - 1));
      const y = ridge[Math.max(0, Math.min(ridge.length - 1, idx))][1] + h * 0.004;
      // mehr Größenvarianz + je Gruppe ein „vorderes" Rad etwas größer — auf dem
      // Desktop Charaktere statt haarfeiner Kratzer (bleiben klein: Stil-Anker)
      const boost = (i === 1 || i === 4) ? 1.3 : 1;
      return { x, y, s: h * (0.030 + R() * 0.020) * boost, phase: R() * Math.PI * 2, dir: i % 2 ? 1 : -1 };
    });

    // Offshore-Mini-Turbinen am Meeresband
    this.offshoreMasts = Array.from({ length: 12 }, (_, i) => ({
      x: w * (0.045 + i * 0.028 + (R() - 0.5) * 0.008),
      h: h * (0.006 + R() * 0.005),
    }));

    // Sterne (Positionen fix pro Seed)
    this.stars = Array.from({ length: 420 }, () => ({
      x: R() * w, y: R() * hor * 0.92, m: R(), tw: R() * Math.PI * 2,
    }));

    // Sicht-Region der See: alles OBERHALB des vordersten Mittelgrund-Kamms.
    // Dynamischer Offshore-Glitzer wird hierauf geclippt — nie über Hügeln/Turbinen.
    this.seaClip = new Path2D();
    const m0 = this.ridges.mid[0].pts;
    this.seaClip.moveTo(0, 0);
    for (const [x, y] of m0) this.seaClip.lineTo(x, y);
    this.seaClip.lineTo(w, 0);
    this.seaClip.closePath();

    this.particles = [];
  }

  // ---------- Daten-Update ----------
  setSnapshot(s) {
    this.snap = s;
    const n = {
      solar: clamp01(s.solar / NORMS.solar),
      windOn: clamp01(s.windOn / NORMS.wind_onshore),
      windOff: clamp01(s.windOff / NORMS.wind_offshore),
      fossil: clamp01(s.fossil / NORMS.fossil),
      biomass: clamp01(s.biomass / NORMS.biomass),
      hydro: clamp01(s.hydro / NORMS.hydro),
      price: clamp01((s.price - NORMS.price[0]) / (NORMS.price[1] - NORMS.price[0])),
      clarity: clamp01(s.share / 100),
      pumping: s.pumpedCons < -400 && Math.abs(s.pumpedCons) > s.pumpedGen,
    };
    this.norm = n;
    this.paletteMix = this.computePalette(s);
  }

  computePalette(s) {
    const e = s.sunElev;
    const isMorning = s.minutes < 12 * 60;
    let wDay = smooth(3, 15, e);
    let wNight = smooth(-5, -15, e);
    let wTwi = clamp01(1 - wDay - wNight);
    const sum = wDay + wNight + wTwi || 1;
    wDay /= sum; wNight /= sum; wTwi /= sum;
    const twi = isMorning ? PAL.dawn : PAL.dusk;
    const out = [];
    for (let i = 0; i < 7; i++) {
      out.push([
        PAL.day[i][0] * wDay + PAL.night[i][0] * wNight + twi[i][0] * wTwi,
        PAL.day[i][1] * wDay + PAL.night[i][1] * wNight + twi[i][1] * wTwi,
        PAL.day[i][2] * wDay + PAL.night[i][2] * wNight + twi[i][2] * wTwi,
      ]);
    }
    out.weights = { wDay, wNight, wTwi, isMorning };
    return out;
  }

  sunPos() {
    const s = this.snap;
    const { w, h } = this;
    const hor = h * COMPOSITION.horizon;
    const dayFrac = clamp01((s.minutes - 300) / (1320 - 300));
    const x = lerp(w * 0.12, w * 0.88, dayFrac);
    const y = hor - (s.sunElev / 62) * h * 0.56;
    return { x, y, dayFrac };
  }

  moonPos() {
    const s = this.snap;
    const { w, h } = this;
    const hor = h * COMPOSITION.horizon;
    const nf = clamp01(((s.minutes - 1290 + 1440) % 1440) / 480);
    const x = lerp(w * 0.78, w * 0.2, nf);
    const y = hor - Math.sin(nf * Math.PI) * h * 0.4 - h * 0.03;
    return { x, y, nf };
  }

  // ---------- Statische Layer ----------
  // coarse=true (Replay): gröbere Quantisierung → weniger Layer-Neuzeichnungen.
  // Live q=40 (0,025-Stufen): mit Dither unsichtbar, halbiert Repaint-Takt in der
  // Dämmerung (dichtere Strichlagen = teurere Repaints).
  key(...vals) {
    const q = this.coarse ? 25 : 40;
    return vals.map((v) => (typeof v === 'number' ? Math.round(v * q) / q : v)).join('|');
  }

  ensureLayers() {
    const n = this.norm, s = this.snap, p = this.paletteMix;
    const pk = this.key(p.weights.wDay, p.weights.wNight, p.weights.isMorning ? 1 : 0);
    const L = this.layers;

    let changed = false;
    const sunP = this.sunPos();
    const skyKey = this.key(pk, Math.round(sunP.x / this.w * 40), Math.round(s.sunElev), n.solar, n.clarity);
    if (L.sky.key !== skyKey) { this.paintSky(); L.sky.key = skyKey; changed = true; }

    const celKey = this.key(pk, n.solar, Math.round(s.sunElev * 2) / 2, Math.round(s.minutes / 4), n.clarity);
    if (L.celestial.key !== celKey) { this.paintCelestial(); L.celestial.key = celKey; changed = true; }

    const farKey = this.key(pk, n.fossil, n.windOff);
    if (L.far.key !== farKey) { this.paintFar(); L.far.key = farKey; changed = true; }

    const midKey = this.key(pk, n.biomass, n.fossil, n.solar);
    if (L.mid.key !== midKey) { this.paintMid(); L.mid.key = midKey; changed = true; }

    const rivKey = this.key(pk, n.hydro, n.price);
    if (L.river.key !== rivKey) { this.paintRiver(); L.river.key = rivKey; changed = true; }

    const foreKey = this.key(pk);
    if (L.fore.key !== foreKey) { this.paintFore(); L.fore.key = foreKey; changed = true; }

    if (changed) {
      const sc = this.staticCtx;
      sc.drawImage(L.sky.c, 0, 0, this.w, this.h);
      sc.drawImage(L.celestial.c, 0, 0);
      sc.drawImage(L.far.c, 0, 0);
      sc.drawImage(L.mid.c, 0, 0);
      sc.drawImage(L.river.c, 0, 0);
    }
  }

  // Himmel: vertikaler 4-Stop-Gradient, per Pixel mit IGN-Dither (halbe Auflösung)
  paintSky() {
    const { c, ctx } = this.layers.sky;
    const W = c.width, H = c.height;
    const p = this.paletteMix;
    const horF = COMPOSITION.horizon;
    const img = ctx.createImageData(W, H);
    const d = img.data;
    // Solar-Triumph: hohe Sonne + klare Luft = gesättigtes Zenit-Blau statt
    // Weißschleier. Basis-Palette bleibt eingefroren — das ist Daten-Modulation
    // (Solar = Licht, EE-Anteil = Klarheit), kein neuer Farb-Anker.
    const nrm = this.norm || { solar: 0, clarity: 0.5 };
    const zenBoost = (this.paletteMix.weights.wDay) * (0.2 + 0.6 * nrm.solar) * (0.35 + 0.65 * nrm.clarity);
    const deepZen = [p[0][0] * 0.60, p[0][1] * 0.82, Math.min(255, p[0][2] * 1.07)];
    const zen0 = mix(p[0], deepZen, clamp01(zenBoost));
    const zen1 = mix(p[1], mix(p[1], deepZen, 0.5), clamp01(zenBoost) * 0.55);
    // klare Luft drückt auch den Weißschleier überm Horizont zusammen — der Dunst
    // bleibt (ehrlich), aber er frisst nicht mehr die halbe Himmelshöhe
    const midSky = mix(p[2], mix(p[1], deepZen, 0.30), clamp01(zenBoost) * 0.62);
    // Triumph-Stunde: hohe UND starke Sonne bei klarer Luft staucht das Dunstband —
    // Blau hält tiefer hinab, der Übergang wird färbig (Warmblau → Hellgold), Weiß
    // bleibt ein schmaler Saum direkt am Horizont. tri==0 außerhalb des Mittags
    // (wDay·high·solar·clarity) → Dawn/Dusk/Nacht pixelidentisch.
    const high = smooth(8, 30, this.snap.sunElev);
    const tri = this.paletteMix.weights.wDay * high * nrm.solar * (0.35 + 0.65 * nrm.clarity);
    const zen1T = mix(zen1, mix(p[1], deepZen, 0.60), tri * 0.6);
    const midSkyT = mix(midSky, mix(mix(p[1], deepZen, 0.50), [255, 226, 172], 0.32), tri * 0.95);
    const x1 = lerp(0.14, 0.19, tri) * horF;
    const x2 = lerp(0.46, 0.63, tri) * horF;
    const x3 = lerp(0.82, 0.90, tri) * horF;
    const stops = [
      // Zenit hält seinen Ton bis 14 % — satterer Himmel oben, mehr Tiefe am Tag
      [0.0, zen0], [x1, zen0], [x2, zen1T], [x3, midSkyT], [horF, p[3]], [1, p[3]],
    ];
    if (tri > 0.02) {
      // Hellgold-Saum kurz überm Horizont — Farbe kontinuierlich aus der natürlichen
      // Interpolation entwickelt (kein Pop, wenn tri die Schwelle quert)
      const q = 0.962 * horF;
      const f = clamp01((q - x3) / Math.max(1e-6, horF - x3));
      const ss = f * f * (3 - 2 * f);
      stops.splice(4, 0, [q, mix(mix(midSkyT, p[3], ss), [255, 238, 192], 0.52 * tri)]);
    }
    const rowColor = (fy) => {
      let i = 0;
      while (i < stops.length - 2 && fy > stops[i + 1][0]) i++;
      const [f0, c0] = stops[i], [f1, c1] = stops[i + 1];
      const t = clamp01((fy - f0) / Math.max(1e-6, f1 - f0));
      const tt = t * t * (3 - 2 * t);
      return mix(c0, c1, tt);
    };
    for (let y = 0; y < H; y++) {
      const col = rowColor(y / H);
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        const dth = (ign(x, y) - 0.5) * 5; // ±2.5 Stufen bricht Banding
        d[o] = col[0] + dth; d[o + 1] = col[1] + dth; d[o + 2] = col[2] + dth; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // dezentes horizontales Licht Richtung Sonne/Mond (weich, geringe Alpha)
    const s = this.snap;
    if (s.sunElev > -14) {
      const sp = this.sunPos();
      const g = ctx.createRadialGradient(sp.x / 2, Math.min(sp.y, this.h * horF) / 2, 0, sp.x / 2, Math.min(sp.y, this.h * horF) / 2, W * 0.55);
      const warm = mix(p[3], p[4], 0.6);
      const twiBoost = this.paletteMix.weights.wTwi ?? 0;
      g.addColorStop(0, rgba(warm, (0.20 + 0.14 * twiBoost) * clamp01((20 - Math.abs(s.sunElev)) / 20 + 0.3)));
      g.addColorStop(1, rgba(warm, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H * horF + 4);
    }
  }

  // Sonne/Godrays ODER Mond/Sterne — Licht, nie Scheiben-Clipart
  paintCelestial() {
    const { c, ctx } = this.layers.celestial;
    ctx.clearRect(0, 0, c.width, c.height);
    const { w, h } = this;
    const s = this.snap, n = this.norm, p = this.paletteMix;
    const hor = h * COMPOSITION.horizon;
    const nightW = p.weights.wNight;

    // Sterne (nur nachts, Klarheit moduliert Anzahl)
    if (nightW > 0.05) {
      const count = Math.floor(this.stars.length * nightW * (0.35 + 0.65 * n.clarity));
      for (let i = 0; i < count; i++) {
        const st = this.stars[i];
        const a = (0.25 + 0.75 * st.m) * nightW * 0.8;
        ctx.fillStyle = rgba(mix([200, 208, 235], p[3], 0.25), a);
        const r = st.m > 0.92 ? 1.6 : st.m > 0.6 ? 1.1 : 0.7;
        ctx.fillRect(st.x, st.y, r, r);
      }
    }

    // Sonne: Glut + Godrays (solar > 0 und über Horizont). 45 GW Sommer-Peak muss
    // TRIUMPHAL lesen: großzügige Glut, Gold-Wash über den Himmel, präsente Rays.
    if (s.sunElev > -6 && s.solar > 50) {
      const sp = this.sunPos();
      const coreY = Math.min(sp.y, hor - h * 0.01);
      const glow = mix(p[4], [255, 242, 200], 0.6 + 0.2 * n.solar);
      const core = mix(glow, [255, 250, 232], 0.7);
      const intensity = 0.3 + 0.75 * n.solar;
      const high = smooth(8, 30, s.sunElev); // hohe Sonne = Mittagslicht
      // Gold-Wash: warmes Licht flutet den Himmel (entsättigt genug — kein 2. Akzent)
      if (high > 0.05 && n.solar > 0.15) {
        const gold = [255, 236, 188];
        const wash = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, w * 0.72);
        wash.addColorStop(0, rgba(gold, 0.18 * n.solar * high));
        wash.addColorStop(0.5, rgba(gold, 0.08 * n.solar * high));
        wash.addColorStop(1, rgba(gold, 0));
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, w, h);
      }
      // heller Kern (nie harte Scheibe: Gradient bis 0) + weiche Höfe — Radius
      // wächst mit der Solarleistung. Mittags-Triumph (hohe Sonne × Solar): Kern
      // heller/etwas größer/dichter, innerer Hof wärmer — „man blinzelt", keine Scheibe.
      const coreBoost = high * n.solar;
      const rScale = 1 + 0.5 * n.solar * (0.4 + 0.6 * high);
      const hot = mix(core, [255, 251, 236], 0.68 * coreBoost);
      const hofC = mix(glow, [255, 216, 150], 0.38 * coreBoost);
      for (const [rad, al, col, dense] of [
        [0.022 * (1 + 0.55 * coreBoost), 1.15 + 0.5 * coreBoost, hot, 1],
        [0.06 * (1 + 0.25 * coreBoost), 0.78 + 0.24 * coreBoost, hofC, 0.6],
        [0.15, 0.46, glow, 0], [0.38, 0.20, glow, 0]]) {
        const g = ctx.createRadialGradient(sp.x, coreY, 0, sp.x, coreY, w * rad * rScale);
        const a0 = Math.min(1, al * intensity);
        g.addColorStop(0, rgba(col, a0));
        // dichterer Abfall nur bei Triumph: Stop bei 0.32 startet exakt auf der
        // linearen Rampe (0.68·a0) und hebt sich kontinuierlich mit coreBoost
        if (dense * coreBoost > 0.02) g.addColorStop(0.32, rgba(col, a0 * Math.min(1, 0.68 + 0.24 * dense * coreBoost)));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // Godrays: schmale Keile RUND um die Sonne (bei tiefer Sonne himmelwärts
      // gewichtet), Alpha fällt nach außen — bei Zenit-Sonne subtil, sonst Kratzer
      const rays = 11;
      const R = mulberry32(this.seed ^ 0x77aa11);
      const rayA = (0.14 - 0.06 * high) * intensity;
      ctx.save();
      ctx.translate(sp.x, coreY);
      for (let i = 0; i < rays; i++) {
        const spreadF = 1 + high * 1.6; // hohe Sonne: voller Kranz statt Fächer
        const baseA = -Math.PI / 2 + (i - rays / 2) * 0.23 * spreadF + (R() - 0.5) * 0.12;
        const len = h * (0.30 + R() * 0.4) * (0.4 + 0.6 * n.solar) * (1 - high * 0.35);
        const wdt = 0.05 + R() * 0.05;
        const g = ctx.createLinearGradient(0, 0, Math.cos(baseA) * len, Math.sin(baseA) * len);
        g.addColorStop(0, rgba(glow, rayA));
        g.addColorStop(1, rgba(glow, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, len, baseA - wdt, baseA + wdt);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Mond (Nacht): weiche Scheibe + Hof, kein hartes Weiß
    if (nightW > 0.25) {
      const mp = this.moonPos();
      if (mp.y < hor) {
        const moonC = mix([225, 226, 238], p[3], 0.18);
        const r = h * 0.022;
        // Halo: geeaste Stops (nichtlinearer Abfall) — kein sichtbarer Banding-Ring
        const halo = ctx.createRadialGradient(mp.x, mp.y, 0, mp.x, mp.y, r * 7);
        halo.addColorStop(0, rgba(moonC, 0.30 * nightW));
        halo.addColorStop(0.28, rgba(moonC, 0.13 * nightW));
        halo.addColorStop(0.58, rgba(moonC, 0.045 * nightW));
        halo.addColorStop(0.85, rgba(moonC, 0.012 * nightW));
        halo.addColorStop(1, rgba(moonC, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(mp.x - r * 7, mp.y - r * 7, r * 14, r * 14);
        const disc = ctx.createRadialGradient(mp.x - r * 0.3, mp.y - r * 0.3, r * 0.1, mp.x, mp.y, r);
        disc.addColorStop(0, rgba(moonC, 0.95 * nightW));
        disc.addColorStop(0.85, rgba(mix(moonC, p[2], 0.4), 0.85 * nightW));
        disc.addColorStop(1, rgba(moonC, 0));
        ctx.fillStyle = disc;
        ctx.beginPath(); ctx.arc(mp.x, mp.y, r, 0, Math.PI * 2); ctx.fill();
        // Mare-Andeutung: 2 kaum merkliche Schattierungen, keine „Augen"
        ctx.fillStyle = rgba(mix(moonC, p[1], 0.45), 0.11 * nightW);
        ctx.beginPath(); ctx.arc(mp.x - r * 0.22, mp.y - r * 0.08, r * 0.26, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(mp.x + r * 0.28, mp.y + r * 0.22, r * 0.16, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Strich-Füllung eines Bandes zwischen ridgeline und unterer Grenze.
  // Auflösungs-normiert: Dichte pro FLÄCHE, Länge/Breite pro Bildbreite — 1440px+
  // bekommt dieselbe Malerei-Dichte wie 1280px (Zancan: Dichte gewinnt).
  // Striche folgen dem Kammverlauf (Kontur), Ton-Jitter zweiseitig (Licht UND
  // Schatten), Strata-Bänder über vertikal feines Noise — Gouache-Lagen statt Grieß.
  strokeFill(ctx, pts, bottomY, baseColor, opts = {}) {
    const { w, h } = this;
    const areaF = Math.min(2.2, (w * h) / (1280 * 800));
    const sizeF = Math.max(0.85, w / 1500);
    const coarseF = this.coarse ? 0.45 : 1;
    const count = Math.floor((opts.count || 2600) * this.quality * areaF * coarseF);
    const R = mulberry32((opts.seed || 1) ^ this.seed);
    const N = this.noise;
    const yAt = (x) => {
      const i = clamp01(x / w) * (pts.length - 1);
      const i0 = Math.floor(i), f = i - i0;
      const a = pts[Math.min(i0, pts.length - 1)][1];
      const b = pts[Math.min(i0 + 1, pts.length - 1)][1];
      return a + (b - a) * f;
    };
    ctx.save();
    // Clip auf Band
    ctx.beginPath();
    ctx.moveTo(0, bottomY);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(w, bottomY);
    ctx.closePath();
    ctx.clip();
    // Grundton (gebrochen, nie solid wirkend — Striche liegen darüber)
    ctx.fillStyle = rgba(baseColor, 0.88);
    ctx.fill();
    ctx.lineCap = 'round';
    const contour = opts.contour !== false;
    const baseAng = opts.angle ?? -0.12;
    const lenBase = (opts.len || 9) * sizeF;
    const lightTone = opts.light || mix(baseColor, [255, 250, 240], 0.35);
    const shadeTone = opts.shade || mix(baseColor, BLACK_C, 0.45);
    const lightAmt = opts.lightAmt ?? 0.5;
    const alphaB = opts.alpha || 0.16;
    for (let i = 0; i < count; i++) {
      const x = R() * w;
      const yTop = yAt(x);
      const y = yTop + R() * Math.max(4, bottomY - yTop);
      if (y > bottomY) continue;
      // Strata: horizontal gestreckte, vertikal feine Ton-Lagen
      const nz = N.fbm(x * 0.002 / sizeF, y * 0.014 / sizeF, 3);
      const jit = nz * 1.1 + (R() - 0.5) * 0.55;
      const tone = jit >= 0
        ? mix(baseColor, lightTone, Math.min(1, jit) * lightAmt)
        : mix(baseColor, shadeTone, Math.min(1, -jit) * 0.55);
      let ang = baseAng + (R() - 0.5) * 0.22;
      if (contour) {
        const d = w * 0.006;
        const slope = (yAt(x + d) - yAt(x - d)) / (2 * d);
        const depthT = clamp01((y - yTop) / Math.max(1, bottomY - yTop));
        ang += Math.atan(slope) * (1 - depthT * 0.6) + nz * 0.18;
      } else {
        ang += nz * 0.55;
      }
      const len = lenBase * (0.6 + R() * 1.1);
      ctx.strokeStyle = rgba(tone, alphaB * (0.55 + R() * 0.75));
      ctx.lineWidth = (0.8 + R() * (opts.width || 1.6)) * sizeF;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Hintere Kämme (Fossil = Masse/Dunkelheit) + Rauch-Dunst + Meeresband (Offshore)
  paintFar() {
    const { c, ctx } = this.layers.far;
    ctx.clearRect(0, 0, c.width, c.height);
    const { w, h } = this;
    const s = this.snap, n = this.norm, p = this.paletteMix;
    const hor = h * COMPOSITION.horizon;

    // Rauch-Dunstschichten HINTER den Kämmen (nur bei Fossil-Last sichtbar) —
    // driftende Schwaden mit Lücken, nie eine durchgehende Scheibe
    if (n.fossil > 0.03) {
      const smokeC = mix(mix(p[5], [90, 78, 70], 0.5), p[2], 0.35);
      const R = mulberry32(this.seed ^ 0x50a0);
      const puffs = 46;
      for (let i = 0; i < puffs; i++) {
        const fx = R();
        const x = fx * w;
        const lift = Math.pow(R(), 1.7); // die meisten Schwaden tief, wenige hoch
        const yy = hor - h * (0.055 + lift * 0.16) + this.noise.fbm(fx * 5.1, lift * 9, 3) * h * 0.03;
        const gate = 0.5 + 0.5 * this.noise.at(fx * 6.7, lift * 4.2);
        if (gate < 0.40) continue;
        const bw = w * (0.05 + R() * 0.09);
        ctx.globalAlpha = n.fossil * 0.13 * (1 - lift * 0.75) * gate;
        this.stampBrush(ctx, x, yy, bw, h * (0.012 + R() * 0.02), smokeC);
      }
      ctx.globalAlpha = 1;
    }

    // Meeres-Schimmerband exakt am Horizont (Wind offshore) — gebrochene Lichtkante,
    // keine durchgezogene Linie
    const seaC = mix(p[3], p[2], 0.35);
    {
      const Rs = mulberry32(this.seed ^ 0x5ea);
      const segs = 90;
      for (let i = 0; i < segs; i++) {
        const x0 = (i / segs) * w + Rs() * w * 0.006;
        const gate = 0.5 + 0.5 * this.noise.at(i * 0.53, 8.1);
        if (gate < 0.42) continue;
        ctx.fillStyle = rgba(seaC, (0.22 + 0.5 * n.windOff) * gate);
        ctx.fillRect(x0, hor - h * 0.0025 + (Rs() - 0.5) * h * 0.003, w / segs * (0.4 + Rs() * 0.7), h * 0.0035);
      }
    }
    // winzige Offshore-Masten
    if (n.windOff > 0.02) {
      ctx.strokeStyle = rgba(mix(p[5], BLACK_C, 0.4), 0.5);
      ctx.lineWidth = Math.max(0.6, w / 2200);
      for (const m of this.offshoreMasts) {
        ctx.beginPath();
        ctx.moveTo(m.x, hor);
        ctx.lineTo(m.x, hor - m.h * (0.7 + 0.5 * n.windOff));
        ctx.stroke();
      }
    }

    // Hintere Bergkämme: Fossil = dunkler + massiger
    const fossilDark = 0.25 + n.fossil * 0.5;
    for (let k = 0; k < this.ridges.back.length; k++) {
      const r = this.ridges.back[k];
      const atmos = mix(mix(p[5], BLACK_C, fossilDark * (k === 0 ? 0.75 : 1)), p[2], r.depth * (0.55 - n.fossil * 0.25));
      // Fossil skaliert die Amplitude (Masse) — Punkte on the fly skalieren
      const scale = 0.75 + n.fossil * 0.45;
      const pts = r.pts.map(([x, y]) => [x, hor - (hor - y) * scale]);
      this.strokeFill(ctx, pts, hor + 2, atmos, {
        count: 1900, seed: 100 + k, alpha: 0.13, len: 8, angle: -0.10, lightAmt: 0.3,
        light: mix(atmos, p[3], 0.5), shade: mix(atmos, BLACK_C, 0.4),
      });
    }

    // Atmosphärische Auflösung: die Kammbasen lösen sich zum Horizont in denselben
    // Dunst auf, mit dem der Talboden beginnt — keine messerscharfe hor-Kante mehr.
    {
      const hazeC = mix(mix(p[2], p[3], 0.5), p[5], 0.22);
      const hz = ctx.createLinearGradient(0, hor - h * 0.035, 0, hor + 1);
      hz.addColorStop(0, rgba(hazeC, 0));
      hz.addColorStop(0.7, rgba(hazeC, 0.26));
      hz.addColorStop(1, rgba(hazeC, 0.5));
      ctx.fillStyle = hz;
      ctx.fillRect(0, hor - h * 0.035, w, h * 0.035 + 1);
    }
  }

  // Mittelgrund-Kämme: Vegetation (Biomasse) + Nebelraum für Windräder
  paintMid() {
    const { c, ctx } = this.layers.mid;
    ctx.clearRect(0, 0, c.width, c.height);
    const { w, h } = this;
    const n = this.norm, p = this.paletteMix;
    const hor = h * COMPOSITION.horizon;

    // Talboden: beginnt am Horizont als kühler, heller DISTANZ-DUNST (Wasser/Luft,
    // Himmelslicht-Reflex) und wird nach vorn dunkler und wärmer — atmosphärische
    // Perspektive. Kein Amber im Grundton (Khaki-Band-Bug), keine harte Kante bei hor.
    const wDayVal = this.paletteMix.weights.wDay;
    // Mittagslicht-Gewicht: hohe starke Sonne — 0 außerhalb des Mittags
    const noon = wDayVal * (n.solar ?? 0) * smooth(10, 32, this.snap.sunElev);
    // vor Sonnenaufgang/nachts liegt das Land fast in Silhouette
    const duskDark = 0.30 * (1 - wDayVal);
    const hazeC = mix(mix(p[2], p[3], 0.5), p[5], 0.22);
    // mittags goldgrün gelüftet (besonntes Tal), sonst identisch (noon==0)
    const valleyTop = mix(mix(mix(p[5], p[2], 0.24), BLACK_C, duskDark * 0.8), [206, 206, 150], 0.20 * noon);
    const valleyBot = mix(mix(mix(p[6], BLACK_C, 0.15), BLACK_C, duskDark), [170, 176, 122], 0.08 * noon);
    const vg = ctx.createLinearGradient(0, hor, 0, h);
    vg.addColorStop(0, rgba(mix(hazeC, valleyTop, 0.25), 1));
    vg.addColorStop(0.09, rgba(mix(hazeC, valleyTop, 0.62), 1));
    vg.addColorStop(0.28, rgba(valleyTop, 1));
    vg.addColorStop(0.62, rgba(mix(valleyTop, valleyBot, 0.62), 1));
    vg.addColorStop(1, rgba(valleyBot, 1));
    ctx.fillStyle = vg;
    ctx.fillRect(0, hor - 1, w, h - hor + 2);
    // beleuchtetes Becken: Licht sammelt sich um die Flussmündung. Abgeflachte
    // Ellipse, Zentrum UNTER dem Horizont, Ausläufer bluten weich über hor hinweg —
    // keine Rect-Schnittkante durchs Gradient-Zentrum (Schimmerband-Bug).
    {
      const wDay = wDayVal;
      const cx = w * 0.505;
      const rr = w * (0.40 + 0.22 * wDay);
      const sunLit = wDay * (this.norm?.solar ?? 0); // Mittagssonne flutet das Tal
      const lit = mix(valleyTop, mix(mix(p[3], p[4], wDay), [255, 240, 205], 0.30 * sunLit), 0.26 + 0.10 * sunLit);
      ctx.save();
      ctx.translate(cx, hor + h * 0.035);
      ctx.scale(1, 0.42);
      const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
      lg.addColorStop(0, rgba(lit, 0.20 + 0.26 * wDay + 0.16 * sunLit));
      lg.addColorStop(0.55, rgba(lit, 0.07 + 0.08 * wDay + 0.06 * sunLit));
      lg.addColorStop(1, rgba(lit, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
      ctx.restore();
      const dk = ctx.createLinearGradient(0, hor + h * 0.04, 0, h);
      dk.addColorStop(0, rgba(mix(valleyTop, BLACK_C, 0.4), 0));
      dk.addColorStop(0.68, rgba(mix(valleyTop, BLACK_C, 0.48), 0.20));
      dk.addColorStop(1, rgba(mix(valleyTop, BLACK_C, 0.5), 0.24));
      ctx.fillStyle = dk;
      ctx.fillRect(0, hor + h * 0.04, w, h - hor - h * 0.04);
    }
    // Strichtextur über den Talboden (bricht die Fläche) — horizontale Lagen;
    // mittags goldgrün angehoben (besonnter Talboden)
    this.strokeFill(ctx, [[0, hor - 1], [w, hor - 1]], h + 2, valleyTop, {
      count: 1700, seed: 555, alpha: 0.09 + 0.04 * noon, len: 14, angle: -0.04, lightAmt: 0.35 + 0.20 * noon,
      light: mix(mix(valleyTop, p[3], 0.6), [242, 232, 158], 0.35 * noon), shade: mix(valleyTop, BLACK_C, 0.4),
    });

    const sizeF = Math.max(0.85, w / 1500);
    const areaF01 = Math.min(2.2, (w * h) / (1280 * 800));
    for (let k = 0; k < this.ridges.mid.length; k++) {
      const r = this.ridges.mid[k];
      const bottom = k < this.ridges.mid.length - 1 ? Math.max(...this.ridges.mid[k + 1].pts.map((q) => q[1])) + h * 0.02 : h + 2;
      const dayW = this.paletteMix.weights.wDay;

      // Dunstschicht ZWISCHEN den Kämmen (vor Kamm k+1 gestempelt, dessen Silhouette
      // beißt sich durch den Dunst → lesbare Tiefe statt totem Mittelband)
      if (k > 0) {
        const fogC2 = mix(hazeC, p[3], 0.15);
        const Rf = mulberry32(this.seed ^ (900 + k));
        const stamps = 26;
        for (let i = 0; i < stamps; i++) {
          const fx = (i + Rf()) / stamps;
          const idx = Math.floor(fx * (r.pts.length - 1));
          const [sx, sy] = r.pts[idx];
          const gate = 0.5 + 0.5 * this.noise.at(fx * 5.5, k * 7.7);
          if (gate < 0.4) continue;
          ctx.globalAlpha = (0.09 + 0.10 * gate) * (1 - k * 0.22);
          this.stampBrush(ctx, sx, sy - h * 0.006, w * (0.06 + Rf() * 0.10), h * (0.012 + Rf() * 0.016), fogC2);
        }
        ctx.globalAlpha = 1;
      }

      // Wertetrennung: hinten hell/kühl (Fernlicht-Haze), vorn dunkler/wärmer
      const atmo = mix(hazeC, p[3], 0.12);
      const tone = mix(
        mix(
          mix(mix(p[5], p[6], 0.22 + k * 0.26), atmo, r.depth * 0.62),
          BLACK_C, (0.10 + 0.08 * k) * (1 - dayW)),
        [196, 200, 142], (0.05 + 0.04 * k) * noon); // vorn wärmer als hinten (Luftperspektive)
      const sunLitR = dayW * (n.solar ?? 0);
      // Mittagslicht: hohe starke Sonne hebt die Strichlagen goldgrün an — das Land
      // liest „besonnt" statt kühl-diesig. noon==0 außerhalb des Mittags.
      this.strokeFill(ctx, r.pts, bottom, tone, {
        count: 2800, seed: 200 + k, alpha: 0.15 + 0.05 * noon, len: 10 + k * 3, angle: -0.10,
        lightAmt: 0.22 + 0.3 * dayW + 0.22 * sunLitR + 0.24 * noon, // nachts kaum Lichtstriche — keine Speckles
        light: mix(mix(mix(tone, p[4], 0.3 + 0.25 * dayW), [250, 240, 210], 0.25 * sunLitR), [242, 232, 158], 0.62 * noon),
        shade: mix(tone, BLACK_C, 0.5),
      });

      // Vegetations-Büschel (Biomasse): 1-3 Strich-Fächer je Büschel, in Noise-
      // Clustern über den Hang gestreut, nie als gleichmäßige Reihe (kein „Zaun")
      const veg = Math.floor((120 + 700 * n.biomass) * this.quality * areaF01) * (k === 2 ? 0.5 : 1);
      const R = mulberry32(this.seed ^ (300 + k));
      // Tags grünlich, nachts dunkle Silhouetten-Tupfer — nie Amber (bleibt dem Preis)
      const wDayV = this.paletteMix.weights.wDay;
      const vegC = mix(mix(tone, BLACK_C, 0.35), mix(tone, [66, 92, 66], 0.55), wDayV);
      ctx.lineCap = 'round';
      for (let i = 0; i < veg; i++) {
        const fx = R();
        const cluster = this.noise.fbm(fx * 7.3 + k * 19, 2.2, 2);
        if (cluster < -0.12) continue; // Lücken lassen
        const idx = Math.floor(fx * (r.pts.length - 1));
        const [x, yTop] = r.pts[idx];
        const y = yTop + h * 0.004 + Math.pow(R(), 1.6) * h * 0.05;
        // nachts kürzer + leiser: Silhouetten-Tupfer, kein Stachelteppich vor hellem Tal
        const len = (1.6 + R() * R() * 5.0) * sizeF * (0.8 + n.biomass * 1.1) * (1 + cluster * 0.8) * (0.62 + 0.38 * wDayV);
        const fan = 1 + ((R() * 2.4) | 0);
        for (let b = 0; b < fan; b++) {
          const spread = (b - (fan - 1) / 2) * 0.4 + (R() - 0.5) * 0.18;
          ctx.strokeStyle = rgba(mix(vegC, p[6], R() * 0.5), (0.16 + R() * 0.30) * (0.75 + 0.45 * wDayV));
          ctx.lineWidth = (0.6 + R() * 0.9) * sizeF;
          ctx.beginPath();
          ctx.moveTo(x + (R() - 0.5) * 3 * sizeF, y);
          ctx.lineTo(x + spread * len * 0.8 + (R() - 0.5) * 2, y - len * (0.75 + R() * 0.4));
          ctx.stroke();
        }
      }
    }

    // Mittagslicht ÜBER dem Land: hohe Sonne + viel Solar = die Landschaft liegt
    // wirklich in der Sonne (warmer, transluzenter Wash — Striche bleiben sichtbar)
    {
      const sunWash = noon;
      if (sunWash > 0.04) {
        const warmL = [253, 242, 200];
        const gWash = ctx.createLinearGradient(0, hor, 0, h);
        gWash.addColorStop(0, rgba(warmL, 0.30 * sunWash));
        gWash.addColorStop(0.5, rgba(warmL, 0.14 * sunWash));
        gWash.addColorStop(1, rgba(warmL, 0.03 * sunWash));
        ctx.fillStyle = gWash;
        ctx.fillRect(0, hor - 1, w, h - hor + 2);
      }
    }
  }

  // Flussband: Breite+Glanz = Wasserkraft; Ukiyo-e-Strichlagen, keine Blau-Fläche
  paintRiver() {
    const { c, ctx } = this.layers.river;
    ctx.clearRect(0, 0, c.width, c.height);
    const { w, h } = this;
    const n = this.norm, p = this.paletteMix;
    const widthF = 0.6 + n.hydro * 0.7;
    const R = mulberry32(this.seed ^ 0x51e152);
    const skyRef = mix(p[2], p[3], 0.5);
    const deep = mix(p[6], p[1], 0.35);

    // Flusskörper aus Längs-Strichlagen (3 Tonlagen) — Spiegel des Himmels, kein
    // Weißband; nachts hebt die Himmelsspiegelung das Wasser vom dunklen Land ab
    const nightLift = (this.paletteMix.weights.wNight || 0) * 0.12;
    for (const [tone, aBase, wF] of [[deep, 0.55, 1.0], [mix(deep, skyRef, 0.4), 0.4, 0.72], [mix(skyRef, p[3], 0.35), 0.22 + n.hydro * 0.2 + nightLift, 0.38]]) {
      const strokes = Math.floor(300 * this.quality);
      for (let i = 0; i < strokes; i++) {
        const t0 = Math.pow(R(), 0.8) * 0.96;
        const seg = 0.025 + R() * 0.05;
        const p0 = this.riverAt(t0), p1 = this.riverAt(Math.min(1, t0 + seg));
        const off = (R() - 0.5) * p0.wd * widthF * wF;
        ctx.strokeStyle = rgba(tone, aBase * (0.25 + R() * 0.5));
        ctx.lineWidth = Math.max(0.7, p0.wd * widthF * 0.06 * (0.4 + R()));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p0.x + off, p0.y);
        ctx.lineTo(p1.x + off * 0.92, p1.y);
        ctx.stroke();
      }
    }
    // Ufer-Dunkelkante
    for (const side of [-1, 1]) {
      ctx.strokeStyle = rgba(mix(p[6], BLACK_C, 0.3), 0.5);
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const q = this.riverAt(t);
        const x = q.x + side * q.wd * widthF * 0.52;
        if (i === 0) ctx.moveTo(x, q.y); else ctx.lineTo(x, q.y);
      }
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  riverAt(t) {
    const path = this.riverPath;
    const i = clamp01(t) * (path.length - 1);
    const i0 = Math.floor(i), f = i - i0;
    const a = path[Math.min(i0, path.length - 1)], b = path[Math.min(i0 + 1, path.length - 1)];
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), wd: lerp(a.wd, b.wd, f) };
  }

  // Vordergrund-Strata: dunkel, rahmt die Komposition
  paintFore() {
    const { c, ctx } = this.layers.fore;
    ctx.clearRect(0, 0, c.width, c.height);
    const { h } = this;
    const p = this.paletteMix;
    const r = this.ridges.fore[0];
    const tone = mix(p[6], BLACK_C, 0.35);
    this.strokeFill(ctx, r.pts, h + 2, tone, {
      count: 1800, seed: 400, alpha: 0.16, len: 14, angle: -0.08, lightAmt: 0.25,
      light: mix(tone, p[5], 0.6), shade: mix(tone, BLACK_C, 0.55),
    });
  }

  stampBrush(ctx, x, y, w, h, color) {
    // Brush ist weiß — via globalCompositeOperation einfärben wäre teuer; wir nutzen
    // einen eingefärbten Offscreen-Stempel-Cache pro Farbe (gerundet).
    const key = `${color[0] | 0},${color[1] | 0},${color[2] | 0}`;
    this._brushCache = this._brushCache || new Map();
    let b = this._brushCache.get(key);
    if (!b) {
      b = makeCanvas(64, 64);
      const g = b.getContext('2d');
      g.drawImage(this.brush, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = rgba(color, 1);
      g.fillRect(0, 0, 64, 64);
      if (this._brushCache.size < 64) this._brushCache.set(key, b);
    }
    ctx.drawImage(b, x - w / 2, y - h / 2, w, h);
  }

  // ---------- Dynamik (je Frame) ----------
  render(ctx, tMs, dtMs, freq) {
    if (!this.snap) return;
    this.ensureLayers();
    const { w, h } = this;
    const s = this.snap, n = this.norm, p = this.paletteMix;
    const hor = h * COMPOSITION.horizon;
    const dt = Math.min(0.1, dtMs / 1000);
    const unrest = clamp01(Math.abs(freq.dev) / 0.06);

    // Statik-Komposit (sky+celestial+far+mid+river) in einem Zug
    ctx.drawImage(this.staticC, 0, 0);

    // Offshore-Schimmer (dynamisch flackernd) — nur im Horizont-Spalt sichtbar:
    // geclippt auf die Region über dem vordersten Mittelgrund-Kamm, nie über Hügeln.
    if (n.windOff > 0.02) {
      const seaC = mix(p[3], [255, 250, 235], 0.3);
      const dashes = Math.floor(30 * this.quality + n.windOff * 60);
      ctx.save();
      ctx.clip(this.seaClip);
      for (let i = 0; i < dashes; i++) {
        const x = ((i * 97.31 + tMs * 0.004 * (1 + n.windOff)) % (w * 1.1)) - w * 0.05;
        const fl = 0.5 + 0.5 * Math.sin(tMs * 0.003 + i * 2.17);
        // weiches Auslaufen zu den Bildrändern (Gradient-Maske statt harter Streifen)
        const edge = Math.min(1, Math.min(x + w * 0.05, w * 1.05 - x) / (w * 0.18));
        ctx.fillStyle = rgba(seaC, (0.10 + 0.4 * n.windOff * fl) * Math.max(0, edge));
        ctx.fillRect(x, hor - 1.5 + Math.sin(i * 3.7) * 1.5, 3 + n.windOff * 9, 1);
      }
      ctx.restore();
    }

    // Windräder (Silhouetten, Drehzahl = Wind onshore)
    this.turbineAngle += dt * (0.25 + n.windOn * 2.6) * Math.PI * 2 * 0.16;
    const tC = mix(mix(p[5], BLACK_C, 0.62), p[2], 0.12);
    for (const tb of this.turbines) {
      const a = this.turbineAngle * tb.dir + tb.phase;
      ctx.strokeStyle = rgba(tC, 0.85);
      ctx.lineWidth = Math.max(1.2, tb.s * 0.07);
      ctx.beginPath(); ctx.moveTo(tb.x, tb.y); ctx.lineTo(tb.x, tb.y - tb.s); ctx.stroke();
      // Gondel: winziger Punkt verankert die Blätter optisch am Mast
      ctx.fillStyle = rgba(tC, 0.9);
      ctx.beginPath(); ctx.arc(tb.x, tb.y - tb.s, Math.max(1, tb.s * 0.045), 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1.0, tb.s * 0.05);
      for (let b = 0; b < 3; b++) {
        const ba = a + b * (Math.PI * 2 / 3);
        ctx.beginPath();
        ctx.moveTo(tb.x, tb.y - tb.s);
        ctx.lineTo(tb.x + Math.cos(ba) * tb.s * 0.62, tb.y - tb.s + Math.sin(ba) * tb.s * 0.62);
        ctx.stroke();
      }
    }

    if (!DBG.has('noshimmer')) this.renderRiverShimmer(ctx, tMs);

    // Klarheits-Schleier VOR dem Vordergrund: Dunst gehört in die Distanz
    const smogEarly = 1 - n.clarity;
    if (smogEarly > 0.05 && !DBG.has('noveil')) {
      // nachts dunklerer Dunst — Schleier hellt die Nacht nicht künstlich auf;
      // mittags warm durchleuchtet (Sonnendunst statt Grauband), noon==0 sonst
      const noonV = p.weights.wDay * n.solar * smooth(10, 32, s.sunElev);
      const veilC = mix(
        mix(mix(mix(p[2], [128, 120, 110], 0.5), p[5], 0.3), BLACK_C, 0.35 * (1 - p.weights.wDay)),
        [232, 218, 172], 0.40 * noonV);
      const y0 = hor - h * 0.3, y1 = hor + h * 0.14;
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, rgba(veilC, 0));
      g.addColorStop(0.62, rgba(veilC, 0.26 * smogEarly));
      g.addColorStop(1, rgba(veilC, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, w, y1 - y0);
    }

    ctx.drawImage(this.layers.fore.c, 0, 0);

    // Amber-Glut (Preis) — DER eine gesättigte Akzent. Elliptisch, eng am Horizont —
    // eine Glut, kein Band.
    if (n.price > 0.04 && !DBG.has('noprice')) {
      const sp = this.sunPos();
      const gx = s.sunElev > 0 ? sp.x : w * 0.5;
      const flick = 0.85 + 0.15 * this.noise.at(tMs * 0.0006, 3.3);
      const a = n.price * 0.38 * flick;
      const r = w * 0.20;
      ctx.save();
      ctx.translate(gx, hor);
      ctx.scale(1, 0.22); // flache Ellipse: Glut liegt AUF dem Horizont
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, rgba(AMBER_C, Math.min(0.85, a * 1.5)));
      g.addColorStop(0.4, rgba(AMBER_C, a * 0.5));
      g.addColorStop(1, rgba(AMBER_C, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
      // Glut-Reflex im Fluss: länglicher Lichtpfad die Flussachse hinab
      const glowLen = 0.16;
      for (let i = 0; i < 7; i++) {
        const t = 0.02 + (i / 7) * glowLen;
        const q = this.riverAt(t);
        const rr = q.wd * (2.2 - i * 0.22);
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.scale(1, 0.35);
        const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, rr);
        g2.addColorStop(0, rgba(AMBER_C, a * 0.55 * (1 - i / 8)));
        g2.addColorStop(1, rgba(AMBER_C, 0));
        ctx.fillStyle = g2;
        ctx.fillRect(-rr, -rr, rr * 2, rr * 2);
        ctx.restore();
      }
    }

    // Wind-Partikel (Flow-Field) auf persistentem Canvas mit Nachleuchten
    if (!DBG.has('noparticles')) {
      this.renderParticles(tMs, dt, unrest);
      ctx.drawImage(this.pc, 0, 0);
    }

    // Nebelbänder (Atmen: Unruhe aus Netzfrequenz; Smog bei niedriger Klarheit)
    if (!DBG.has('nofog')) this.renderFog(ctx, tMs, unrest);
  }

  renderRiverShimmer(ctx, tMs) {
    const n = this.norm, p = this.paletteMix, s = this.snap;
    const dir = n.pumping ? -1 : 1; // Pumpspeicher: „Wasser fließt bergauf"
    const count = Math.floor((26 + n.hydro * 40) * this.quality);
    const speed = 0.06 * dir * (0.5 + n.hydro);
    // Gegenlicht: steht die Sonne tief, fängt das Wasser den Himmel — warmer Sheen
    const lowSun = Math.max(0, Math.min(1, (16 - Math.abs(s.sunElev - 6)) / 16)) * (s.sunElev > -8 ? 1 : 0);
    // Nachts fängt der Fluss das Mondlicht: kühler Silber-Glint statt dunkler Riss
    const nightW = p.weights.wNight;
    const moonGlint = nightW * (0.35 + 0.65 * n.hydro);
    const gloss = mix(
      mix(mix(p[3], [255, 252, 242], 0.4), mix(p[3], p[4], 0.5), lowSun * 0.7),
      [198, 205, 228], nightW * 0.65);
    const glossBoost = 1 + lowSun * 0.9 + moonGlint * 0.7;
    const widthF = 0.6 + n.hydro * 0.7;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const base = (i / count + tMs / 1000 * speed) % 1;
      const t = ((base % 1) + 1) % 1;
      const q = this.riverAt(t);
      const off = Math.sin(i * 12.9898) * q.wd * widthF * 0.34;
      const len = q.wd * widthF * (0.12 + 0.1 * Math.sin(i * 3.1 + tMs * 0.001));
      const a = (0.10 + 0.04 * moonGlint + 0.25 * n.hydro * (0.4 + 0.6 * Math.sin(tMs * 0.002 + i * 1.7) ** 2)) * glossBoost;
      ctx.strokeStyle = rgba(gloss, Math.min(0.6, a));
      ctx.lineWidth = Math.max(0.6, q.wd * widthF * 0.035);
      ctx.beginPath();
      ctx.moveTo(q.x + off - len / 2, q.y);
      ctx.lineTo(q.x + off + len / 2, q.y + (dir < 0 ? -q.wd * 0.02 : q.wd * 0.02));
      ctx.stroke();
    }
  }

  renderParticles(tMs, dt, unrest) {
    const { w, h } = this;
    const n = this.norm, p = this.paletteMix;
    const pctx = this.pctx;
    // Nachleuchten ausblenden
    pctx.globalCompositeOperation = 'destination-out';
    pctx.fillStyle = 'rgba(0,0,0,0.10)';
    pctx.fillRect(0, 0, w, h);
    pctx.globalCompositeOperation = 'source-over';

    const isMobile = w < 760;
    const maxBudget = (isMobile ? PARTICLES.mobileMax : PARTICLES.max) * this.quality;
    const target = Math.floor(PARTICLES.min + (maxBudget - PARTICLES.min) * Math.pow(n.windOn, 0.8));
    const R = this.rand;
    while (this.particles.length < target) {
      this.particles.push({
        x: R() * w, y: R() * h * 0.92,
        age: R() * 6, maxAge: 3 + R() * 6,
      });
    }
    if (this.particles.length > target) this.particles.length = target;

    const speed = (18 + 150 * n.windOn) * (1 + unrest * 0.35);
    const fieldT = tMs * 0.00004;
    const windC = mix(mix(p[3], [255, 252, 244], 0.3), p[2], 0.3);
    pctx.lineCap = 'round';
    for (const pt of this.particles) {
      const a = this.noise.fbm(pt.x * 0.0016, pt.y * 0.0021 + fieldT, 3) * Math.PI * 1.6;
      const vx = Math.cos(a) * 0.35 + 1.0; // Grunddrift W→O
      const vy = Math.sin(a) * 0.30;
      const nx = pt.x + vx * speed * dt;
      const ny = pt.y + vy * speed * dt * 0.7;
      const heightFade = pt.y < h * COMPOSITION.horizon ? 1 : 0.45;
      const lifeFade = Math.sin(clamp01(pt.age / pt.maxAge) * Math.PI);
      pctx.strokeStyle = rgba(windC, (0.065 + 0.13 * n.windOn) * lifeFade * heightFade);
      pctx.lineWidth = pt.y > h * 0.5 ? 1.25 : 0.9;
      pctx.beginPath();
      pctx.moveTo(pt.x, pt.y);
      pctx.lineTo(nx, ny);
      pctx.stroke();
      pt.x = nx; pt.y = ny;
      pt.age += dt;
      if (pt.x > w + 8) {
        // rechts raus → links wieder rein (Fluss des Windes)
        pt.x = -6; pt.y = Math.pow(R(), 1.4) * h * 0.9; pt.age = 0; pt.maxAge = 3 + R() * 6;
      } else if (pt.age > pt.maxAge || pt.y < -8 || pt.y > h) {
        // Alterstod → irgendwo neu (keine Links-Häufung)
        pt.x = R() * w; pt.y = Math.pow(R(), 1.4) * h * 0.9; pt.age = 0; pt.maxAge = 3 + R() * 6;
      }
    }
  }

  renderFog(ctx, tMs, unrest) {
    const { w, h } = this;
    const p = this.paletteMix;
    const hor = h * COMPOSITION.horizon;
    // gedeckter Dunstton: Himmel×Kamm mit nur einem Hauch Glutlicht (bei Dusk sonst orange)
    const fogC = mix(mix(p[2], p[5], 0.5), p[4], 0.18);
    const bands = [
      { y: hor + h * 0.026, hh: h * 0.026, sp: 6, a: 0.06 },
      { y: hor + h * 0.085, hh: h * 0.034, sp: 10, a: 0.07 },
      { y: hor - h * 0.024, hh: h * 0.018, sp: 4, a: 0.05 },
    ];
    const stamps = Math.floor(22 * this.quality);
    for (let b = 0; b < bands.length; b++) {
      const bd = bands[b];
      const drift = tMs * 0.001 * bd.sp * (1 + unrest * 2.2);
      for (let i = 0; i < stamps; i++) {
        // unregelmäßig: Position, Breite und Alpha je Stamp aus Noise — nie ein
        // durchgehender Streifen
        const nz = this.noise.at(i * 3.31 + b * 17, 2.9);
        const x = ((i / stamps) * w * 1.35 + i * i * 13.7 % w * 0.2 + drift * (0.7 + nz * 0.4)) % (w * 1.35) - w * 0.175;
        const jitterY = this.noise.fbm(i * 0.6 + b * 11, tMs * 0.00018, 2) * bd.hh * (2.2 + unrest * 5);
        const bw = w * (0.09 + 0.13 * Math.abs(this.noise.at(i * 1.7, b * 7)));
        const gate = 0.5 + 0.5 * this.noise.at(i * 2.2 + b * 3, tMs * 0.00025);
        if (gate < 0.35) continue; // Lücken
        ctx.globalAlpha = bd.a * gate * (0.85 + unrest * 0.6);
        this.stampBrush(ctx, x, bd.y + jitterY, bw, bd.hh * (1.6 + nz), fogC);
      }
    }
    ctx.globalAlpha = 1;
  }
}
