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
      return { x, y, s: h * (0.034 + R() * 0.014), phase: R() * Math.PI * 2, dir: i % 2 ? 1 : -1 };
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
  // coarse=true (Replay): gröbere Quantisierung → weniger Layer-Neuzeichnungen
  key(...vals) {
    const q = this.coarse ? 25 : 100;
    return vals.map((v) => (typeof v === 'number' ? Math.round(v * q) / q : v)).join('|');
  }

  ensureLayers() {
    const n = this.norm, s = this.snap, p = this.paletteMix;
    const pk = this.key(p.weights.wDay, p.weights.wNight, p.weights.isMorning ? 1 : 0);
    const L = this.layers;

    let changed = false;
    const sunP = this.sunPos();
    const skyKey = this.key(pk, Math.round(sunP.x / this.w * 40), Math.round(s.sunElev));
    if (L.sky.key !== skyKey) { this.paintSky(); L.sky.key = skyKey; changed = true; }

    const celKey = this.key(pk, n.solar, Math.round(s.sunElev * 2) / 2, Math.round(s.minutes / 4), n.clarity);
    if (L.celestial.key !== celKey) { this.paintCelestial(); L.celestial.key = celKey; changed = true; }

    const farKey = this.key(pk, n.fossil, n.windOff);
    if (L.far.key !== farKey) { this.paintFar(); L.far.key = farKey; changed = true; }

    const midKey = this.key(pk, n.biomass, n.fossil);
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
    const stops = [
      // Zenit hält seinen Ton bis 14 % — satterer Himmel oben, mehr Tiefe am Tag
      [0.0, p[0]], [0.14 * horF, p[0]], [0.42 * horF, p[1]], [0.80 * horF, p[2]], [horF, p[3]], [1, p[3]],
    ];
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

    // Sonne: Glut + Godrays (solar > 0 und über Horizont)
    if (s.sunElev > -6 && s.solar > 50) {
      const sp = this.sunPos();
      const coreY = Math.min(sp.y, hor - h * 0.01);
      const glow = mix(p[4], [255, 242, 200], 0.6 + 0.2 * n.solar);
      const core = mix(glow, [255, 250, 232], 0.7);
      const intensity = 0.3 + 0.75 * n.solar;
      // heller, kleiner Kern (nie harte Scheibe: Gradient bis 0) + 2 weiche Höfe
      for (const [rad, al, col] of [[0.022, 1.15, core], [0.06, 0.75, glow], [0.15, 0.42, glow], [0.38, 0.18, glow]]) {
        const g = ctx.createRadialGradient(sp.x, coreY, 0, sp.x, coreY, w * rad);
        g.addColorStop(0, rgba(col, Math.min(1, al * intensity)));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // Godrays: schmale Keile, Alpha fällt nach außen
      const rays = 9;
      const R = mulberry32(this.seed ^ 0x77aa11);
      ctx.save();
      ctx.translate(sp.x, coreY);
      for (let i = 0; i < rays; i++) {
        const baseA = -Math.PI / 2 + (i - rays / 2) * 0.23 + (R() - 0.5) * 0.1;
        const len = h * (0.3 + R() * 0.35) * (0.4 + 0.6 * n.solar);
        const wdt = 0.05 + R() * 0.05;
        const g = ctx.createLinearGradient(0, 0, Math.cos(baseA) * len, Math.sin(baseA) * len);
        g.addColorStop(0, rgba(glow, 0.10 * intensity));
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
        const halo = ctx.createRadialGradient(mp.x, mp.y, 0, mp.x, mp.y, r * 7);
        halo.addColorStop(0, rgba(moonC, 0.30 * nightW));
        halo.addColorStop(1, rgba(moonC, 0));
        ctx.fillStyle = halo;
        ctx.fillRect(mp.x - r * 7, mp.y - r * 7, r * 14, r * 14);
        const disc = ctx.createRadialGradient(mp.x - r * 0.3, mp.y - r * 0.3, r * 0.1, mp.x, mp.y, r);
        disc.addColorStop(0, rgba(moonC, 0.95 * nightW));
        disc.addColorStop(0.85, rgba(mix(moonC, p[2], 0.4), 0.85 * nightW));
        disc.addColorStop(1, rgba(moonC, 0));
        ctx.fillStyle = disc;
        ctx.beginPath(); ctx.arc(mp.x, mp.y, r, 0, Math.PI * 2); ctx.fill();
        // Mare-Andeutung: 2 dunklere Tupfer
        ctx.fillStyle = rgba(mix(moonC, p[1], 0.5), 0.25 * nightW);
        ctx.beginPath(); ctx.arc(mp.x - r * 0.25, mp.y - r * 0.1, r * 0.32, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(mp.x + r * 0.3, mp.y + r * 0.25, r * 0.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Strich-Füllung eines Bandes zwischen ridgeline und unterer Grenze
  strokeFill(ctx, pts, bottomY, baseColor, opts = {}) {
    const { w } = this;
    const count = Math.floor((opts.count || 2600) * this.quality);
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
    const ang = opts.angle ?? -0.32;
    const lenBase = opts.len || 9;
    for (let i = 0; i < count; i++) {
      const x = R() * w;
      const yTop = yAt(x);
      const y = yTop + R() * Math.max(4, bottomY - yTop);
      if (y > bottomY) continue;
      const nz = N.fbm(x * 0.006, y * 0.006, 3);
      const tone = mix(baseColor, opts.light || mix(baseColor, [255, 250, 240], 0.35), clamp01(0.5 + nz * 0.9) * (opts.lightAmt ?? 0.5));
      const a2 = ang + nz * 0.55 + (R() - 0.5) * 0.3;
      const len = lenBase * (0.6 + R() * 0.9);
      ctx.strokeStyle = rgba(tone, (opts.alpha || 0.16) * (0.6 + R() * 0.7));
      ctx.lineWidth = 0.8 + R() * (opts.width || 1.6);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a2) * len, y + Math.sin(a2) * len);
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
        count: 1900, seed: 100 + k, alpha: 0.10, len: 7, angle: -0.25, lightAmt: 0.3,
        light: mix(atmos, p[3], 0.5),
      });
    }
  }

  // Mittelgrund-Kämme: Vegetation (Biomasse) + Nebelraum für Windräder
  paintMid() {
    const { c, ctx } = this.layers.mid;
    ctx.clearRect(0, 0, c.width, c.height);
    const { w, h } = this;
    const n = this.norm, p = this.paletteMix;
    const hor = h * COMPOSITION.horizon;

    // Talboden: Land vom Horizont abwärts — LAND-Töne mit nur einem Hauch Himmelslicht
    // (nie die gesättigten Akzent-Stops: Anti-Pattern „Neon flächig").
    const wDayVal = this.paletteMix.weights.wDay;
    // vor Sonnenaufgang/nachts liegt das Land fast in Silhouette
    const duskDark = 0.30 * (1 - wDayVal);
    const valleyTop = mix(mix(mix(p[5], p[4], 0.18), p[2], 0.10), BLACK_C, duskDark);
    const valleyBot = mix(mix(p[6], BLACK_C, 0.15), BLACK_C, duskDark);
    const vg = ctx.createLinearGradient(0, hor, 0, h);
    vg.addColorStop(0, rgba(valleyTop, 1));
    vg.addColorStop(0.45, rgba(mix(valleyTop, valleyBot, 0.55), 1));
    vg.addColorStop(1, rgba(valleyBot, 1));
    ctx.fillStyle = vg;
    ctx.fillRect(0, hor - 1, w, h - hor + 2);
    // beleuchtetes Becken: Licht sammelt sich um die Flussmündung, Ränder fallen ab
    {
      const wDay = this.paletteMix.weights.wDay;
      const cx = w * 0.505;
      const rr = w * (0.40 + 0.22 * wDay);
      const lg = ctx.createRadialGradient(cx, hor, 0, cx, hor, rr);
      const lit = mix(valleyTop, mix(p[3], p[4], wDay), 0.26);
      lg.addColorStop(0, rgba(lit, 0.18 + 0.26 * wDay));
      lg.addColorStop(0.55, rgba(lit, 0.06 + 0.08 * wDay));
      lg.addColorStop(1, rgba(lit, 0));
      ctx.fillStyle = lg;
      ctx.fillRect(cx - rr, hor - 2, rr * 2, h - hor + 2);
      const dk = ctx.createLinearGradient(0, hor, 0, h * 0.8);
      dk.addColorStop(0, rgba(mix(valleyTop, BLACK_C, 0.4), 0));
      dk.addColorStop(1, rgba(mix(valleyTop, BLACK_C, 0.5), 0.22));
      ctx.fillStyle = dk;
      ctx.fillRect(0, hor, w, h * 0.8 - hor);
    }
    // Strichtextur über den Talboden (bricht die Fläche)
    this.strokeFill(ctx, [[0, hor - 1], [w, hor - 1]], h + 2, valleyTop, {
      count: 1500, seed: 555, alpha: 0.06, len: 10, angle: -0.12, lightAmt: 0.35,
      light: mix(valleyTop, p[3], 0.6),
    });

    for (let k = 0; k < this.ridges.mid.length; k++) {
      const r = this.ridges.mid[k];
      const bottom = k < this.ridges.mid.length - 1 ? Math.max(...this.ridges.mid[k + 1].pts.map((q) => q[1])) + h * 0.02 : h + 2;
      const dayW = this.paletteMix.weights.wDay;
      const tone = mix(mix(mix(p[5], p[6], 0.25 + k * 0.18), p[2], r.depth * 0.45), BLACK_C, 0.22 * (1 - dayW));
      this.strokeFill(ctx, r.pts, bottom, tone, {
        count: 2400, seed: 200 + k, alpha: 0.13, len: 8 + k * 2, angle: -0.35,
        lightAmt: 0.2 + 0.3 * dayW, // nachts kaum Lichtstriche — keine Speckles
        light: mix(tone, p[4], 0.3 + 0.25 * dayW),
      });

      // Vegetations-Striche (Biomasse): in Noise-Clustern über den Hang gestreut,
      // nie als gleichmäßige Reihe (kein „Zaun"-Effekt)
      const veg = Math.floor((140 + 850 * n.biomass) * this.quality) * (k === 2 ? 0.5 : 1);
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
        const len = (1.2 + R() * R() * 4.5) * (0.8 + n.biomass * 1.1) * (1 + cluster * 0.8);
        ctx.strokeStyle = rgba(mix(vegC, p[6], R() * 0.5), (0.18 + R() * 0.34) * (0.75 + 0.45 * wDayV));
        ctx.lineWidth = 0.6 + R() * 1.0;
        ctx.beginPath();
        ctx.moveTo(x + (R() - 0.5) * 3, y);
        ctx.lineTo(x + (R() - 0.5) * 3, y - len);
        ctx.stroke();
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

    // Flusskörper aus Längs-Strichlagen (3 Tonlagen) — Spiegel des Himmels, kein Weißband
    for (const [tone, aBase, wF] of [[deep, 0.55, 1.0], [mix(deep, skyRef, 0.4), 0.4, 0.72], [mix(skyRef, p[3], 0.35), 0.22 + n.hydro * 0.2, 0.38]]) {
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
      count: 1600, seed: 400, alpha: 0.12, len: 12, angle: -0.18, lightAmt: 0.25,
      light: mix(tone, p[5], 0.6),
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

    // Offshore-Schimmer (dynamisch flackernd)
    if (n.windOff > 0.02) {
      const seaC = mix(p[3], [255, 250, 235], 0.3);
      const dashes = Math.floor(30 * this.quality + n.windOff * 60);
      for (let i = 0; i < dashes; i++) {
        const x = ((i * 97.31 + tMs * 0.004 * (1 + n.windOff)) % (w * 1.1)) - w * 0.05;
        const fl = 0.5 + 0.5 * Math.sin(tMs * 0.003 + i * 2.17);
        ctx.fillStyle = rgba(seaC, 0.10 + 0.4 * n.windOff * fl);
        ctx.fillRect(x, hor - 1.5 + Math.sin(i * 3.7) * 1.5, 3 + n.windOff * 9, 1);
      }
    }

    // Windräder (Silhouetten, Drehzahl = Wind onshore)
    this.turbineAngle += dt * (0.25 + n.windOn * 2.6) * Math.PI * 2 * 0.16;
    const tC = mix(mix(p[5], BLACK_C, 0.62), p[2], 0.12);
    for (const tb of this.turbines) {
      const a = this.turbineAngle * tb.dir + tb.phase;
      ctx.strokeStyle = rgba(tC, 0.74);
      ctx.lineWidth = Math.max(0.9, tb.s * 0.05);
      ctx.beginPath(); ctx.moveTo(tb.x, tb.y); ctx.lineTo(tb.x, tb.y - tb.s); ctx.stroke();
      ctx.lineWidth = Math.max(0.7, tb.s * 0.035);
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
      // nachts dunklerer Dunst — Schleier hellt die Nacht nicht künstlich auf
      const veilC = mix(mix(mix(p[2], [128, 120, 110], 0.5), p[5], 0.3), BLACK_C, 0.35 * (1 - p.weights.wDay));
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
    const gloss = mix(mix(p[3], [255, 252, 242], 0.4), mix(p[3], p[4], 0.5), lowSun * 0.7);
    const glossBoost = 1 + lowSun * 0.9;
    const widthF = 0.6 + n.hydro * 0.7;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const base = (i / count + tMs / 1000 * speed) % 1;
      const t = ((base % 1) + 1) % 1;
      const q = this.riverAt(t);
      const off = Math.sin(i * 12.9898) * q.wd * widthF * 0.34;
      const len = q.wd * widthF * (0.12 + 0.1 * Math.sin(i * 3.1 + tMs * 0.001));
      const a = (0.10 + 0.25 * n.hydro * (0.4 + 0.6 * Math.sin(tMs * 0.002 + i * 1.7) ** 2)) * glossBoost;
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
      pctx.strokeStyle = rgba(windC, (0.05 + 0.11 * n.windOn) * lifeFade * heightFade);
      pctx.lineWidth = pt.y > h * 0.5 ? 1.1 : 0.8;
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
