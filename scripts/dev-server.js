// Local dev server: serves public/ statically and mounts the Vercel-style /api handlers.
// Usage: node scripts/dev-server.js [port]   (default 5317)
// Env: STROMLAND_OFFLINE=1 simulates a dead upstream (fixture fallback path).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import power from '../api/power.js';
import frequency from '../api/frequency.js';
import context from '../api/context.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUB = join(ROOT, 'public');
const PORT = Number(process.argv[2] || 5317);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const API = { '/api/power': power, '/api/frequency': frequency, '/api/context': context };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (API[path]) {
    req.query = Object.fromEntries(url.searchParams);
    try {
      await API[path](req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // static: cleanUrls-ish — try exact file, then +.html, then index.html
  let rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '') rel = '/index.html';
  const candidates = [join(PUB, rel), join(PUB, rel + '.html')];
  for (const file of candidates) {
    if (!file.startsWith(PUB)) break;
    try {
      const data = await readFile(file);
      res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
      res.end(data);
      return;
    } catch { /* try next */ }
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(PORT, () => console.log(`stromland dev → http://localhost:${PORT} (offline=${process.env.STROMLAND_OFFLINE === '1'})`));
