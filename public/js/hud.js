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
  }

  update(snap, freq) {
    const b = snap.berlin;
    const hh = String(b.h).padStart(2, '0');
    const mm = String(b.mi).padStart(2, '0');
    this.elTitle.textContent = `Stromland — ${b.d}. ${MONTHS[(b.mo || 1) - 1]}, ${hh}:${mm}`;

    const gw = (mw) => de(Math.max(0, mw) / 1000, 1);
    const parts = [
      `Erneuerbare ${de(snap.share, 0)} %`,
      `Wind ${gw(snap.windOn + snap.windOff)} GW`,
      `Solar ${gw(snap.solar)} GW`,
      `${de(freq.hz, 3)} Hz`,
    ];
    this.elVals.innerHTML = parts.map((p) => `<span>${p}</span>`).join('<span class="sep">·</span>');

    if (snap.archive && snap.fixtureDay) {
      const [, m, d] = snap.fixtureDay.split('-').map(Number);
      this.elArchive.textContent = `Archiv — ${d}. ${MONTHS[m - 1]}`;
      this.elArchive.style.display = '';
    } else {
      this.elArchive.style.display = 'none';
    }
  }
}
