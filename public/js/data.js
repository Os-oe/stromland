// Datenmodell: lädt /api/* (live) oder /fixtures/day.json (?mock=1), unterstützt
// ?at=HH:MM (Zeit-Override), ?seed=N (Noise-Seed). Liefert pro Frame einen Snapshot
// der Momentwerte + Sonnenstand + Frequenz-Puffer-Sample.

import { REFRESH, FREQ_LAG_S } from './config.js';

const qs = new URLSearchParams(location.search);
export const MOCK = qs.get('mock') === '1';
export const SEED = Number(qs.get('seed') || 42) | 0;
const AT = qs.get('at'); // "HH:MM" Berlin

const BERLIN = 'Europe/Berlin';

function berlinParts(date) {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: BERLIN, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
  }).formatToParts(date);
  const g = (t) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: g('year'), mo: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}

// Sonnenstand (Elevation in Grad) — Standardformel, Lat/Lon Mitte DE (51°N, 10.5°E)
export function sunElevation(dateUTC) {
  const lat = 51.0 * Math.PI / 180;
  const lon = 10.5;
  const d = (Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate()) - Date.UTC(dateUTC.getUTCFullYear(), 0, 0)) / 86400000;
  const decl = -23.44 * Math.cos((2 * Math.PI / 365) * (d + 10)) * Math.PI / 180;
  const utcH = dateUTC.getUTCHours() + dateUTC.getUTCMinutes() / 60 + dateUTC.getUTCSeconds() / 3600;
  const solarH = utcH + lon / 15; // grobe Solarzeit
  const hourAngle = (solarH - 12) * 15 * Math.PI / 180;
  const sinE = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  return { elevDeg: Math.asin(Math.max(-1, Math.min(1, sinE))) * 180 / Math.PI, hourAngle };
}

async function getJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

function lastIdxAtOrBefore(tsArr, t) {
  let lo = 0, hi = tsArr.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tsArr[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function valAt(tsArr, arr, t) {
  if (!tsArr?.length || !arr?.length) return null;
  let i = lastIdxAtOrBefore(tsArr, t);
  // letzter nicht-null Wert bei/vor t
  while (i >= 0 && arr[i] == null) i--;
  if (i < 0) { i = 0; while (i < arr.length && arr[i] == null) i++; }
  return i < arr.length ? arr[i] : null;
}

export class DataModel {
  constructor() {
    this.power = null;      // {source, unix_seconds, series}
    this.context = null;    // {source, share:{...}, price:{...}}
    this.freq = null;       // {source, unix_seconds, data}
    this.freqFetchedAt = 0;
    this.archive = false;   // Archiv-Modus (irgendeine Quelle = fixture)
    this.fixtureDay = null;
    this.atOverride = null; // {h, mi}
    if (AT && /^\d{1,2}:\d{2}$/.test(AT)) {
      const [h, mi] = AT.split(':').map(Number);
      this.atOverride = { h: Math.min(23, h), mi: Math.min(59, mi) };
    }
    this.replayOffsetMin = null; // gesetzt vom Replay-Modus (Phase 3)
  }

  async load() {
    if (MOCK) {
      const fx = await getJSON('/fixtures/day.json');
      this.fixture = fx;
      this.power = { source: 'fixture', unix_seconds: fx.power.unix_seconds, series: fx.power.series };
      this.context = {
        source: 'fixture',
        share: { unix_seconds: fx.power.unix_seconds, share: fx.power.series.re_share },
        price: fx.price,
      };
      this.freq = { source: 'fixture', unix_seconds: fx.frequency.unix_seconds, data: fx.frequency.data };
      this.archive = true;
      this.fixtureDay = fx.meta.day;
      return;
    }
    const [p, c, f] = await Promise.all([
      getJSON('/api/power').catch(() => null),
      getJSON('/api/context').catch(() => null),
      getJSON('/api/frequency').catch(() => null),
    ]);
    // Selbst wenn /api komplett tot ist: eingebaute Fixture direkt vom Static-Host.
    if (!p || !c || !f) {
      const fx = await getJSON('/fixtures/day.json').catch(() => null);
      if (fx) {
        this.power = p || { source: 'fixture', unix_seconds: fx.power.unix_seconds, series: fx.power.series };
        this.context = c || { source: 'fixture', share: { unix_seconds: fx.power.unix_seconds, share: fx.power.series.re_share }, price: fx.price };
        this.freq = f || { source: 'fixture', unix_seconds: fx.frequency.unix_seconds, data: fx.frequency.data };
        this.fixtureDay = fx.meta.day;
      }
    } else {
      this.power = p; this.context = c; this.freq = f;
    }
    this.freqFetchedAt = Date.now();
    const srcs = [this.power?.source, this.context?.source, this.freq?.source];
    this.archive = srcs.some((s) => s === 'fixture') || srcs.every((s) => s == null);
    this.fixtureDay = this.fixtureDay || this.power?.fixture_day || this.context?.fixture_day || null;
    this.scheduleRefresh();
  }

  scheduleRefresh() {
    if (this._scheduled || MOCK) return;
    this._scheduled = true;
    setInterval(() => { getJSON('/api/power').then((p) => { this.power = p; this.updateArchive(); }).catch(() => {}); }, REFRESH.power);
    setInterval(() => { getJSON('/api/context').then((c) => { this.context = c; this.updateArchive(); }).catch(() => {}); }, REFRESH.context);
    setInterval(() => { getJSON('/api/frequency').then((f) => { this.freq = f; this.freqFetchedAt = Date.now(); }).catch(() => {}); }, REFRESH.frequency);
  }

  updateArchive() {
    const srcs = [this.power?.source, this.context?.source, this.freq?.source];
    this.archive = srcs.some((s) => s === 'fixture');
  }

  // "Jetzt" der Szene als Unix-Sekunden — mit at-Override/Replay auf den Datentag gemappt
  sceneNowUnix() {
    const ts = this.power?.unix_seconds;
    if (!ts?.length) return Math.floor(Date.now() / 1000);
    const dayStart = ts[0]; // 00:00 Berlin des Datentags
    if (this.replayOffsetMin != null) return dayStart + Math.floor(this.replayOffsetMin * 60);
    if (this.atOverride) return dayStart + this.atOverride.h * 3600 + this.atOverride.mi * 60;
    if (MOCK || this.power?.source === 'fixture') {
      // Archiv: reale Uhrzeit auf den Fixture-Tag projizieren
      const now = berlinParts(new Date());
      return dayStart + now.h * 3600 + now.mi * 60 + now.s;
    }
    return Math.floor(Date.now() / 1000);
  }

  // Momentwerte für den Maler
  snapshot() {
    const t = this.sceneNowUnix();
    const p = this.power, c = this.context;
    const s = p?.series || {};
    const ts = p?.unix_seconds || [];
    const v = (arr) => valAt(ts, arr, t) ?? 0;
    const price = c ? valAt(c.price.unix_seconds, c.price.value, t) : null;
    const share = c ? valAt(c.share.unix_seconds, c.share.share, t) : null;

    // Szenen-Zeit (Berlin) für Palette/Sonne: aus t rekonstruieren
    const sceneDate = new Date(t * 1000);
    const bp = berlinParts(sceneDate);
    const sun = sunElevation(sceneDate);

    return {
      tUnix: t,
      berlin: bp,
      minutes: bp.h * 60 + bp.mi + bp.s / 60,
      sunElev: sun.elevDeg,
      solar: v(s.solar),
      windOn: v(s.wind_onshore),
      windOff: v(s.wind_offshore),
      biomass: v(s.biomass),
      hydro: v(s.hydro),
      pumpedGen: v(s.pumped_gen),
      pumpedCons: v(s.pumped_consumption), // negativ
      fossil: v(s.fossil),
      load: v(s.load),
      price: price ?? 0,
      share: share ?? 50,
      archive: this.archive,
      fixtureDay: this.fixtureDay,
      source: p?.source || 'none',
    };
  }

  // Frequenz-Sample: Puffer läuft FREQ_LAG_S hinter Echtzeit; Mock: zyklisch
  freqAt(nowMs) {
    const f = this.freq;
    if (!f?.data?.length) return { hz: 50.0, dev: 0 };
    const ts = f.unix_seconds, data = f.data;
    let target;
    if (MOCK || f.source === 'fixture') {
      const span = ts[ts.length - 1] - ts[0];
      target = ts[0] + (Math.floor(nowMs / 1000) % Math.max(1, span));
    } else {
      target = Math.floor(nowMs / 1000) - FREQ_LAG_S;
      if (target > ts[ts.length - 1]) target = ts[ts.length - 1];
      if (target < ts[0]) target = ts[0];
    }
    const i = lastIdxAtOrBefore(ts, target);
    const hz = data[i] ?? 50.0;
    return { hz, dev: hz - 50.0 };
  }
}
