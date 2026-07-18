// Shared upstream access for all /api/* functions.
// Hard allowlist: only api.energy-charts.info. No user-supplied URLs → no SSRF surface.

const ALLOWED_HOST = 'api.energy-charts.info';
const TIMEOUT_MS = 8000;

// Per-instance memory cache: last good payload per key (survives between warm invocations).
const lastGood = new Map();

export async function fetchUpstream(path, params, cacheKey) {
  const url = new URL(`https://${ALLOWED_HOST}${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, String(v));
  if (url.hostname !== ALLOWED_HOST) throw new Error('upstream host not allowed');

  // Force-offline switch for tests (simulated upstream outage).
  if (process.env.STROMLAND_OFFLINE === '1') throw new Error('forced offline (test)');

  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`upstream HTTP ${res.status}`);
  const data = await res.json();
  if (cacheKey) lastGood.set(cacheKey, { data, ts: Date.now() });
  return data;
}

export function getLastGood(cacheKey) {
  return lastGood.get(cacheKey) || null;
}

export function sendJson(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('access-control-allow-origin', '*');
  if (cacheControl) res.setHeader('cache-control', cacheControl);
  res.end(JSON.stringify(body));
}

export const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
