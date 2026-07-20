// GET /api/context — bundles /signal (renewable share) + /price (day-ahead spot) in one call.

import { fetchUpstream, getLastGood, sendJson, round, berlinDayStart } from './_lib/upstream.js';
import fixture from './_lib/fixture-data.js';

const CACHE = 's-maxage=300, stale-while-revalidate=600';

// NOTE: /signal share = renewable share OF LOAD (not generation) — can legitimately exceed 100 %.
function shapeSignal(sig) {
  return { unix_seconds: sig.unix_seconds, share: sig.share.map((v) => round(v, 1)) };
}
function shapePrice(pr) {
  return { unix_seconds: pr.unix_seconds, value: pr.price.map((v) => round(v, 2)), unit: pr.unit };
}

// Fixture share: computed from the recorded power day (signal endpoint has no past data).
function fixtureShare() {
  return { unix_seconds: fixture.power.unix_seconds, share: fixture.power.series.re_share };
}

export default async function handler(req, res) {
  // Preis mit Vortag im Fenster (Intro-Tagesfahrt); /signal kennt kein start/end.
  const results = await Promise.allSettled([
    fetchUpstream('/signal', { country: 'de' }, 'signal'),
    fetchUpstream('/price', { bzn: 'DE-LU', start: berlinDayStart() - 86400, end: Math.floor(Date.now() / 1000) }, 'price'),
  ]);

  const [sigR, priR] = results;
  let share, price, sources = [];

  if (sigR.status === 'fulfilled') { share = shapeSignal(sigR.value); sources.push('live'); }
  else {
    const c = getLastGood('signal');
    if (c) { share = shapeSignal(c.data); sources.push('cache'); }
    else { share = fixtureShare(); sources.push('fixture'); }
  }

  if (priR.status === 'fulfilled') { price = shapePrice(priR.value); sources.push('live'); }
  else {
    const c = getLastGood('price');
    if (c) { price = shapePrice(c.data); sources.push('cache'); }
    else { price = { unix_seconds: fixture.price.unix_seconds, value: fixture.price.value, unit: fixture.price.unit }; sources.push('fixture'); }
  }

  const source = sources.includes('fixture') ? 'fixture' : (sources.includes('cache') ? 'cache' : 'live');
  sendJson(res, 200, {
    source,
    updated: Math.floor(Date.now() / 1000),
    ...(source === 'fixture' ? { fixture_day: fixture.meta.day } : {}),
    share,
    price,
  }, source === 'live' ? CACHE : 's-maxage=30');
}
