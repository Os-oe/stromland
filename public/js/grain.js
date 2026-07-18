// Finish-Pass über alles: animiertes Film-Grain + Vignette + warmes Schwarz.
// Reines Canvas-2D — bewusst KEIN WebGL: der frühere GL-Overlay-Canvas erzwang
// beim Compositing (mix-blend-mode wie drawImage) ReadPixels-Stalls, sobald kein
// Hardware-GL da war. 2D-Pattern + Overlay-Blend kann jede Plattform stallfrei.
//
// Korn: 6 vorgerenderte Interleaved-Gradient-Noise-Kacheln (Blue-Noise-Charakter),
// pro Frame zyklisch + zufällig versetzt = lebendiges Filmkorn. Zellgröße ~1,5
// CSS-px (mit devicePixelRatio skaliert) statt 3-px-TV-Static. Atem-Modulation
// über globalAlpha. Vignette als einmal gecachter Radial-Canvas.

import { COMPOSITION } from './config.js';

// IGN wie im Maler — feinkörnig, geordnet, kein Weißrauschen
const ignv = (x, y) => ((52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1);

const TILE = 256;
const AMP_MAX = 0.14; // in die Kacheln gebackene Maximal-Amplitude (Overlay-Deltas)

export class Finish {
  constructor(container) {
    this.container = container;
    this.canvas = null;   // Kompat: kein eigener Screen-Canvas mehr
    this.tiles = [];
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      const g = c.getContext('2d');
      const img = g.createImageData(TILE, TILE);
      const d = img.data;
      const ox = k * 37.7, oy = k * 91.3;
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const o = (y * TILE + x) * 4;
          const v = 128 + (ignv(x + ox, y + oy) - 0.5) * 255 * AMP_MAX;
          d[o] = v + 2; d[o + 1] = v; d[o + 2] = v - 1; d[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      this.tiles.push(c);
    }
    this.frame = 0;
    this.vigCanvas = null;
    this.w = 0; this.h = 0; this.dpr = 1;
  }

  resize(w, h, dpr = 1) {
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = Math.max(1, dpr);
    // Vignette einmal cachen (Radial-Gradient jede Frame neu = unnötig teuer)
    const c = this.vigCanvas || document.createElement('canvas');
    c.width = Math.max(2, Math.round(w / 2)); c.height = Math.max(2, Math.round(h / 2));
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const grad = g.createRadialGradient(
      c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.30,
      c.width / 2, c.height / 2, Math.hypot(c.width, c.height) * 0.62);
    grad.addColorStop(0, 'rgba(10,8,12,0)');
    grad.addColorStop(0.55, `rgba(10,8,12,${COMPOSITION.vignette * 0.35})`);
    grad.addColorStop(1, `rgba(10,8,12,${COMPOSITION.vignette * 1.7})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    this.vigCanvas = c;
  }

  // zeichnet Korn + Vignette DIREKT in den Szenen-Kontext (kein DOM-Compositing)
  render(ctx, tMs, breathe = 0) {
    if (!this.w) return;
    this.frame++;
    const amp = COMPOSITION.grainOpacity * (1 + breathe * 2);
    const tile = this.tiles[this.frame % this.tiles.length];
    const scale = 1.5 * this.dpr; // Kachel-px → 1,5 CSS-px Kornzelle (dpr-normiert)
    const jx = ((this.frame * 97) % TILE), jy = ((this.frame * 61) % TILE);
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(1, amp / AMP_MAX);
    ctx.imageSmoothingEnabled = false; // crispes Korn, keine Matsch-Interpolation
    ctx.scale(scale, scale);
    ctx.translate(-jx, -jy);
    const pat = ctx.createPattern(tile, 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, this.w / scale + TILE, this.h / scale + TILE);
    ctx.restore();
    // Vignette: normal komposittiert, gecacht
    ctx.drawImage(this.vigCanvas, 0, 0, this.w, this.h);
  }
}
