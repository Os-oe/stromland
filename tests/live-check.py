# Inhaltlicher Live-Check (Ship-Gate): Live-Seite OHNE mock laden, HUD-Werte
# gegen die Live-API derselben Domain vergleichen. Nicht nur HTTP 200.
# Usage: python tests/live-check.py [base_url]
import sys, json, re, urllib.request
from decimal import Decimal, ROUND_HALF_UP
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'https://stromland.demo.osai.solutions'
fails = []

def ok(cond, label):
    print(('  ✓ ' if cond else '  ✗ FAIL: ') + label)
    if not cond:
        fails.append(label)

def de(x, digits=1):
    q = Decimal(1).scaleb(-digits)
    d = Decimal(str(x)).quantize(q, rounding=ROUND_HALF_UP)
    s = f'{d:,.{digits}f}'
    return s.replace(',', 'X').replace('.', ',').replace('X', '.')

def api(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read())

power = api('/api/power')
ctxd = api('/api/context')
ok(power['source'] in ('live', 'cache'), f"api/power source={power['source']} (live/cache)")
ok(ctxd['source'] in ('live', 'cache'), f"api/context source={ctxd['source']}")

import time

def at_now(ts, arr):
    # Wert bei/vor JETZT — /signal enthält Zukunfts-Forecast, letzter Wert wäre morgen!
    now = time.time()
    best = None
    for t, v in zip(ts, arr):
        if t <= now and v is not None:
            best = v
    if best is None:
        best = next((v for v in arr if v is not None), 0)
    return best

exp_solar_gw = de(max(0, at_now(power['unix_seconds'], power['series']['solar'])) / 1000, 1)
exp_wind_gw = de(max(0, at_now(power['unix_seconds'], power['series']['wind_onshore'])
                     + at_now(power['unix_seconds'], power['series']['wind_offshore'])) / 1000, 1)
exp_share = de(at_now(ctxd['share']['unix_seconds'], ctxd['share']['share']), 0)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    errors = []
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(4000)
    ok(page.evaluate('window.__stromland && window.__stromland.ready === true'), 'live Seite ready')
    ok(len(errors) == 0, f'live 0 Konsolen-Fehler ({errors[:3]})')
    snap = page.evaluate('window.__stromland.data.snapshot()')
    ok(snap['source'] in ('live', 'cache'), f"Frontend nutzt Live-Daten (source={snap['source']})")
    hud = page.text_content('#hud-values')
    ok(f'Solar {exp_solar_gw} GW' in hud, f'HUD Solar == Live-API ({exp_solar_gw} GW) — HUD: „{hud}"')
    ok(f'Wind {exp_wind_gw} GW' in hud, f'HUD Wind == Live-API ({exp_wind_gw} GW)')
    ok(f'Erneuerbare {exp_share} %' in hud, f'HUD EE% == Live-API ({exp_share} %)')
    m = re.search(r'(\d{2},\d{3}) Hz', hud)
    ok(m and 49.5 < float(m.group(1).replace(',', '.')) < 50.5, f'HUD Hz live plausibel ({m.group(1) if m else "?"})')
    archive_visible = page.evaluate("document.getElementById('hud-archive').style.display !== 'none'")
    ok(not archive_visible, 'kein Archiv-Hinweis im Live-Modus')
    # Legal live
    ok('Öztopcu' in page.evaluate("fetch('/impressum').then(r=>r.text())"), '') if False else None
    page.goto(BASE + '/impressum')
    ok('Öztopcu' in page.content() and 'DE462559965' in page.content(), 'Impressum live vollständig')
    page.goto(BASE + '/datenschutz')
    ok('Vercel' in page.content(), 'Datenschutz live')
    # OG-Bild erreichbar
    st = page.evaluate(f"fetch('{BASE}/og.png').then(r=>r.status)")
    ok(st == 200, f'og.png erreichbar ({st})')
    page.screenshot(path='shots/live-now.png')
    page.close()
    browser.close()

print()
print('LIVE-CHECK GREEN' if not fails else f'LIVE-CHECK RED — {len(fails)} failure(s)')
sys.exit(0 if not fails else 1)
