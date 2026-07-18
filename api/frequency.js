// GET /api/frequency — grid frequency (1-s data, measured at Fraunhofer ISE, Freiburg).
// Server-side trimmed to the last ~15 minutes (upstream full-day payload is ~1.4 MB!).
// Upstream requires region=DE-Freiburg AND a start+end unix range (start alone → 1 point).

import { fetchUpstream, getLastGood, sendJson } from './_lib/upstream.js';
import fixture from './_lib/fixture-data.js';

const CACHE = 's-maxage=10, stale-while-revalidate=30';
const WINDOW_S = 15 * 60;

export default async function handler(req, res) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - WINDOW_S;
  try {
    const raw = await fetchUpstream('/frequency', { region: 'DE-Freiburg', start, end }, 'frequency');
    if (!Array.isArray(raw.data) || raw.data.length < 10) throw new Error('too few samples');
    sendJson(res, 200, {
      source: 'live',
      updated: end,
      unix_seconds: raw.unix_seconds,
      data: raw.data,
    }, CACHE);
  } catch {
    const cached = getLastGood('frequency');
    if (cached && Array.isArray(cached.data?.data) && cached.data.data.length >= 10) {
      sendJson(res, 200, {
        source: 'cache',
        updated: Math.floor(cached.ts / 1000),
        unix_seconds: cached.data.unix_seconds,
        data: cached.data.data,
      }, CACHE);
      return;
    }
    sendJson(res, 200, {
      source: 'fixture',
      updated: null,
      fixture_day: fixture.meta.day,
      unix_seconds: fixture.frequency.unix_seconds,
      data: fixture.frequency.data,
    }, 's-maxage=30');
  }
}
