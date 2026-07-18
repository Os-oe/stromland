// Finish-Pass über alles: animiertes Film-Grain + Vignette + warmes Schwarz.
// WebGL-Quad-Shader als Overlay-Canvas (mix-blend-mode: overlay).
// Fallback ohne WebGL: vorgerenderte Grain-Kacheln + CSS-Vignette.

import { COMPOSITION } from './config.js';

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision mediump float;
uniform vec2 res;
uniform float t;
uniform float grainAmp;
uniform float vig;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + t) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / res;
  float g = (hash(gl_FragCoord.xy) - 0.5) * grainAmp;
  vec2 d = uv - 0.5;
  float v = smoothstep(0.35, 0.95, length(d) * 1.35) * vig;
  // Overlay-Neutral ist 0.5; Grain moduliert, Vignette senkt ab; warme Tönung minimal
  vec3 col = vec3(0.502 + g + 0.006, 0.5 + g, 0.498 + g - 0.004) - v * 0.22;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Finish {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'grain';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:overlay;';
    container.appendChild(this.canvas);
    this.ok = this.initGL();
    if (!this.ok) this.initFallback();
  }

  initGL() {
    try {
      const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
      if (!gl) return false;
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link failed');
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.gl = gl;
      this.uRes = gl.getUniformLocation(prog, 'res');
      this.uT = gl.getUniformLocation(prog, 't');
      this.uAmp = gl.getUniformLocation(prog, 'grainAmp');
      this.uVig = gl.getUniformLocation(prog, 'vig');
      return true;
    } catch { return false; }
  }

  initFallback() {
    // 3 Grain-Kacheln, zyklisch als Pattern; Vignette via CSS-Overlay
    this.tiles = [];
    for (let k = 0; k < 3; k++) {
      const c = document.createElement('canvas');
      c.width = c.height = 192;
      const g = c.getContext('2d');
      const img = g.createImageData(192, 192);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 118 + Math.random() * 20;
        img.data[i] = v + 2; img.data[i + 1] = v; img.data[i + 2] = v - 1; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.tiles.push(c);
    }
    this.ctx2d = this.canvas.getContext('2d');
    const vig = document.createElement('div');
    vig.style.cssText = `position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, transparent 52%, rgba(10,8,12,${COMPOSITION.vignette}) 100%);`;
    this.canvas.parentElement.appendChild(vig);
    this.frame = 0;
  }

  resize(w, h) {
    // Grain braucht keine volle Auflösung — halbe reicht, spart Füllrate
    const gw = Math.max(2, Math.round(w / 2)), gh = Math.max(2, Math.round(h / 2));
    if (this.canvas.width !== gw || this.canvas.height !== gh) {
      this.canvas.width = gw; this.canvas.height = gh;
      if (this.gl) this.gl.viewport(0, 0, gw, gh);
    }
  }

  render(tMs, breathe = 0) {
    if (this.ok && this.gl) {
      const gl = this.gl;
      gl.uniform2f(this.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uT, (tMs % 10000) / 300);
      gl.uniform1f(this.uAmp, COMPOSITION.grainOpacity * (1 + breathe * 2));
      gl.uniform1f(this.uVig, 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (this.ctx2d) {
      this.frame++;
      if (this.frame % 3 === 0) {
        const tile = this.tiles[(this.frame / 3 | 0) % 3];
        const pat = this.ctx2d.createPattern(tile, 'repeat');
        this.ctx2d.fillStyle = pat;
        this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  }
}
