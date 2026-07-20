// GET /api/power — German public net power production, yesterday 00:00 → now, 15-min grid.
// Reshaped into named series; falls back to last-good cache, then to the built-in fixture.
// Fenster inkl. Vortag: die Intro-Tagesfahrt (gestern-Morgengrauen → jetzt) braucht
// echte Gestern-Daten, und der Nach-Mitternacht-404 (leerer neuer Tag) entfällt damit.

import { fetchUpstream, getLastGood, sendJson, round, berlinDayStart } from './_lib/upstream.js';
import fixture from './_lib/fixture-data.js';

const CACHE = 's-maxage=120, stale-while-revalidate=300';

function reshape(raw) {
  const byName = {};
  for (const t of raw.production_types) byName[t.name] = t.data;
  const n = raw.unix_seconds.length;
  const sum = (...names) =>
    raw.unix_seconds.map((_, i) => {
      let s = 0;
      for (const nm of names) { const v = (byName[nm] || [])[i]; if (v != null) s += v; }
      return round(s);
    });
  const one = (name) => (byName[name] || new Array(n).fill(null)).map((v) => round(v));

  return {
    unix_seconds: raw.unix_seconds,
    series: {
      solar: one('Solar'),
      wind_onshore: one('Wind onshore'),
      wind_offshore: one('Wind offshore'),
      biomass: one('Biomass'),
      hydro: sum('Hydro Run-of-River', 'Hydro water reservoir'),
      pumped_gen: one('Hydro pumped storage'),
      pumped_consumption: one('Hydro pumped storage consumption'),
      fossil: sum('Fossil brown coal / lignite', 'Fossil hard coal', 'Fossil gas', 'Fossil oil', 'Fossil coal-derived gas'),
      load: one('Load'),
      re_share: (byName['Renewable share of generation'] || new Array(n).fill(null)).map((v) => round(v, 1)),
    },
  };
}

export default async function handler(req, res) {
  try {
    // Immer expliziter Bereich: Vortags-Mitternacht (Berlin) → jetzt. Ohne Range
    // defaultet der Upstream auf "heute" und liefert direkt nach Mitternacht 404
    // (leerer Tag) — mit dem Vortag im Fenster gibt es immer Datenpunkte.
    const end = Math.floor(Date.now() / 1000);
    let raw;
    try {
      raw = await fetchUpstream('/public_power', { country: 'de', start: berlinDayStart() - 86400, end }, 'power');
      if (!raw?.unix_seconds?.length) throw new Error('empty power payload');
    } catch (eToday) {
      // Sicherheitsnetz gegen Upstream-Kanten: einmal einen Tag weiter zurück retrien.
      raw = await fetchUpstream('/public_power', { country: 'de', start: berlinDayStart() - 2 * 86400, end }, 'power');
      if (!raw?.unix_seconds?.length) throw new Error('empty power payload (retry)');
    }
    sendJson(res, 200, { source: 'live', updated: end, ...reshape(raw) }, CACHE);
  } catch (e) {
    console.error('power upstream failed:', String(e && e.message || e));
    const cached = getLastGood('power');
    if (cached) {
      sendJson(res, 200, { source: 'cache', updated: Math.floor(cached.ts / 1000), ...reshape(cached.data) }, CACHE);
      return;
    }
    sendJson(res, 200, {
      source: 'fixture',
      updated: null,
      fixture_day: fixture.meta.day,
      unix_seconds: fixture.power.unix_seconds,
      series: fixture.power.series,
    }, 's-maxage=30');
  }
}
