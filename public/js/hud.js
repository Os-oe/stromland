// Ambient-HUD: eine Serifenzeile + Hairline-Werte, 40 % Opazität.
// Kein Panel, kein Rahmen, keine Icons.

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli',
  'August', 'September', 'Oktober', 'November', 'Dezember'];

const de = (x, digits = 1) =>
  x.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export class Hud {
  constructor() {
    this.elTitle = document.getElementById('hud-title');
    this.elVals = document.getElementById('hud-values');
    this.elArchive = document.getElementById('hud-archive');
    // Frequenz-Sparkline: persistenter Canvas (überlebt innerHTML-Updates, weil
    // derselbe Knoten re-appended wird — Bitmap bleibt erhalten)
    this.spark = document.createElement('canvas');
    this.spark.id = 'hud-spark';
    this.spark.width = 132;
    this.spark.height = 30;
    this.spark.setAttribute('aria-hidden', 'true');
    this.sctx = this.spark.getContext('2d');
  }

  update(snap, freq) {
    const b = snap.berlin;
    const hh = String(b.h).padStart(2, '0');
    const mm = String(b.mi).padStart(2, '0');
    this.elTitle.textContent = `Stromland — ${b.d}. ${MONTHS[(b.mo || 1) - 1]}, ${hh}:${mm}`;

    const gw = (mw) => de(Math.max(0, mw) / 1000, 1);
    const narrow = matchMedia('(max-width: 520px)').matches;
    const parts = [
      `${narrow ? 'EE' : 'Erneuerbare'} ${de(snap.share, 0)} %`,
      `Wind ${gw(snap.windOn + snap.windOff)} GW`,
      `Solar ${gw(snap.solar)} GW`,
      `${de(freq.hz, 3)} Hz`,
    ];
    this.elVals.innerHTML = parts.map((p) => `<span>${p}</span>`).join('<span class="sep">·</span>');
    this.elVals.appendChild(this.spark); // lebende Hairline neben dem Hz-Wert

    if (snap.archive && snap.fixtureDay) {
      const [, m, d] = snap.fixtureDay.split('-').map(Number);
      this.elArchive.textContent = `Archiv — ${d}. ${MONTHS[m - 1]}`;
      this.elArchive.style.display = '';
    } else {
      this.elArchive.style.display = 'none';
    }
  }

  // Lebende Hairline-Sparkline: die letzten ~60 s Netzfrequenz, zeichnet sich
  // sichtbar weiter — der permanente, ehrliche Daten-Puls neben dem Hz-Wert.
  drawSpark(buf) {
    const c = this.spark, g = this.sctx;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (!buf || buf.length < 2) return;
    const now = buf[buf.length - 1].t;
    const t0 = now - 60000;
    // Skala: mindestens ±20 mHz, sonst größter Ausschlag +15 %
    let dev = 0.02;
    for (const b of buf) dev = Math.max(dev, Math.abs(b.hz - 50) * 1.15);
    // 50,000-Referenz (Hairline)
    g.strokeStyle = 'rgba(239,233,220,0.25)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.stroke();
    // Verlauf
    g.strokeStyle = 'rgba(239,233,220,0.92)';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.beginPath();
    let started = false;
    let lx = 0, ly = H / 2;
    for (const b of buf) {
      const x = ((b.t - t0) / 60000) * W;
      if (x < -2) continue;
      const y = H / 2 - ((b.hz - 50) / dev) * (H / 2 - 2.5);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      lx = x; ly = y;
    }
    g.stroke();
    // Schreibkopf: kleiner Punkt am jüngsten Sample — man SIEHT, dass es weiterläuft
    g.fillStyle = 'rgba(239,233,220,0.95)';
    g.beginPath(); g.arc(Math.min(lx, W - 2), ly, 2.4, 0, Math.PI * 2); g.fill();
  }
}
