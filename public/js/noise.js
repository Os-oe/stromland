// Seeded PRNG (mulberry32) + 2D-Value-Noise + fbm — klein, deterministisch, ausreichend
// für Flow-Fields und Strich-Jitter.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise2D {
  constructor(seed = 42) {
    const rand = mulberry32(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.grad = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.grad[i] = rand() * 2 - 1;
  }

  // value noise, smooth-interpolated, [-1, 1]
  at(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const h = (X, Y) => this.grad[this.perm[(this.perm[X & 255] + (Y & 255)) & 255]];
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    const top = a + u * (b - a);
    const bot = c + u * (d - c);
    return top + v * (bot - top);
  }

  fbm(x, y, octaves = 4, lac = 2.0, gain = 0.5) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x * freq, y * freq);
      norm += amp;
      amp *= gain; freq *= lac;
    }
    return sum / norm;
  }
}

// Interleaved Gradient Noise — Dither gegen Sky-Banding (pro Pixel, [0,1))
export function ign(x, y) {
  return ((52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1);
}
