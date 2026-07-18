// Phase-1 gate suite: structural validation of all 3 /api/* endpoints,
// in live mode AND with simulated upstream outage (fixture must kick in).
// Spawns its own dev servers on test ports. Exit 0 = green.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ FAIL: ${label}`); }
};

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts/dev-server.js'), String(port)], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  return child;
}

async function waitUp(port) {
  // poll a static path, NOT /api/* — polling the API hammers the upstream and flakes the suite
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(3000) }); return; }
    catch { await sleep(250); }
  }
  throw new Error('dev server did not come up on ' + port);
}

const isNumArr = (a) => Array.isArray(a) && a.length > 0 && a.every((v) => v == null || typeof v === 'number');

function checkPower(p, modeLabel, expectSources) {
  ok(expectSources.includes(p.source), `${modeLabel} power.source=${p.source} ∈ ${expectSources}`);
  ok(isNumArr(p.unix_seconds), `${modeLabel} power.unix_seconds numeric[]`);
  const s = p.series || {};
  for (const key of ['solar', 'wind_onshore', 'wind_offshore', 'biomass', 'hydro', 'pumped_gen', 'pumped_consumption', 'fossil', 'load', 're_share']) {
    ok(isNumArr(s[key]) && s[key].length === p.unix_seconds.length, `${modeLabel} power.series.${key} aligned (${(s[key] || []).length})`);
  }
}

function checkFrequency(f, modeLabel, expectSources) {
  ok(expectSources.includes(f.source), `${modeLabel} freq.source=${f.source} ∈ ${expectSources}`);
  ok(isNumArr(f.data) && f.data.length >= 60, `${modeLabel} freq.data ≥60 samples (${(f.data || []).length})`);
  ok(isNumArr(f.unix_seconds) && f.unix_seconds.length === f.data.length, `${modeLabel} freq ts aligned`);
  const inBand = f.data.every((v) => v > 49.5 && v < 50.5);
  ok(inBand, `${modeLabel} freq values within 49.5–50.5 Hz`);
  if (f.source === 'live') {
    const lag = Math.floor(Date.now() / 1000) - f.unix_seconds[f.unix_seconds.length - 1];
    ok(lag < 600, `${modeLabel} freq last sample <10 min behind now (lag ${lag}s)`);
  }
}

function checkContext(c, modeLabel, expectSources) {
  ok(expectSources.includes(c.source), `${modeLabel} context.source=${c.source} ∈ ${expectSources}`);
  ok(isNumArr(c.share?.unix_seconds) && isNumArr(c.share?.share), `${modeLabel} context.share arrays`);
  ok(isNumArr(c.price?.unix_seconds) && isNumArr(c.price?.value), `${modeLabel} context.price arrays`);
  ok(typeof c.price?.unit === 'string' && c.price.unit.includes('MWh'), `${modeLabel} price unit (${c.price?.unit})`);
  // NOTE: /signal share = renewable share OF LOAD — legitimately exceeds 100 % on windy/sunny days.
  const shareVals = c.share.share.filter((v) => v != null);
  ok(shareVals.every((v) => v >= 0 && v <= 250), `${modeLabel} share sane (0–250 %)`);
}

async function run() {
  console.log('— PASS A: live mode (port 5411) —');
  const live = startServer(5411);
  try {
    await waitUp(5411);
    // sequential + retry-once: upstream throttles bursts; a transient non-live source
    // is retried after backoff before we call it a failure.
    const getLive = async (path) => {
      let j = await fetch(`http://localhost:5411${path}`).then((r) => r.json());
      if (j.source !== 'live') {
        await sleep(4000);
        j = await fetch(`http://localhost:5411${path}`).then((r) => r.json());
      }
      return j;
    };
    const p = await getLive('/api/power');
    const f = await getLive('/api/frequency');
    const c = await getLive('/api/context');
    // live preferred; cache/fixture acceptable only if upstream flakes mid-test
    checkPower(p, 'live', ['live', 'cache', 'fixture']);
    ok(p.source === 'live', 'live power actually from live upstream');
    checkFrequency(f, 'live', ['live', 'cache', 'fixture']);
    ok(f.source === 'live', 'live freq actually from live upstream');
    checkContext(c, 'live', ['live', 'cache', 'fixture']);
    ok(c.source === 'live', 'live context actually from live upstream');
  } finally { live.kill(); }

  console.log('— PASS B: simulated upstream outage (port 5412, STROMLAND_OFFLINE=1) —');
  const off = startServer(5412, { STROMLAND_OFFLINE: '1' });
  try {
    await waitUp(5412);
    const [p, f, c] = await Promise.all([
      fetch('http://localhost:5412/api/power').then((r) => r.json()),
      fetch('http://localhost:5412/api/frequency').then((r) => r.json()),
      fetch('http://localhost:5412/api/context').then((r) => r.json()),
    ]);
    checkPower(p, 'offline', ['fixture']);
    checkFrequency(f, 'offline', ['fixture']);
    checkContext(c, 'offline', ['fixture']);
    ok(typeof p.fixture_day === 'string', `offline fixture_day present (${p.fixture_day})`);
    // HTTP status must be 200 — no error screen material
    const st = await fetch('http://localhost:5412/api/power');
    ok(st.status === 200, 'offline power still HTTP 200 (no error surface)');
  } finally { off.kill(); }

  console.log(failures === 0 ? '\nSUITE GREEN' : `\nSUITE RED — ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error('suite crashed:', e); process.exit(1); });
