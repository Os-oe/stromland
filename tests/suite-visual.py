# Phase-2-Gate: 4 Tageszeiten rendern (mock, deterministisch), HUD==API prüfen,
# Konsole fehlerfrei, Stimmungen paarweise unterscheidbar (Pixel-Distanz).
# Usage: python tests/suite-visual.py [base_url]   (Server muss laufen)
import json, sys, re
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5317'
TIMES = ['05:30', '13:00', '21:30', '01:00']
fails = []

def ok(cond, label):
    print(('  ✓ ' if cond else '  ✗ FAIL: ') + label)
    if not cond:
        fails.append(label)

fixture = json.load(open('public/fixtures/day.json'))
ts = fixture['power']['unix_seconds']
S = fixture['power']['series']

def fixture_at(minutes):
    t = ts[0] + minutes * 60
    i = max(0, max((k for k, v in enumerate(ts) if v <= t), default=0))
    def val(arr):
        j = i
        while j >= 0 and arr[j] is None: j -= 1
        return arr[j] if j >= 0 else 0
    return {k: val(S[k]) for k in S}

from decimal import Decimal, ROUND_HALF_UP

def de(x, digits=1):
    # JS Intl rundet half-up — Python f-string rundet half-even; angleichen!
    q = Decimal(1).scaleb(-digits)
    d = Decimal(str(x)).quantize(q, rounding=ROUND_HALF_UP)
    s = f'{d:,.{digits}f}'
    return s.replace(',', 'X').replace('.', ',').replace('X', '.')

shots = {}
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for at in TIMES:
        errors = []
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'{BASE}/?mock=1&at={at}&seed=7')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)

        label = f'[{at}]'
        ok(page.evaluate('window.__stromland.ready === true'), f'{label} ready')
        ok(len(errors) == 0, f'{label} 0 Konsolen-Fehler ({errors[:3]})')

        snap = page.evaluate('window.__stromland.data.snapshot()')
        mins = int(at[:2]) * 60 + int(at[3:])
        fx = fixture_at(mins)
        for key, fkey in [('solar', 'solar'), ('windOn', 'wind_onshore'), ('windOff', 'wind_offshore'),
                          ('fossil', 'fossil'), ('hydro', 'hydro'), ('biomass', 'biomass')]:
            ok(abs(snap[key] - fx[fkey]) < 0.01, f'{label} snapshot.{key} == fixture ({snap[key]} vs {fx[fkey]})')
        ok(abs(snap['share'] - fx['re_share']) < 0.01, f"{label} share == fixture re_share ({snap['share']})")

        hud_title = page.text_content('#hud-title')
        hud_vals = page.text_content('#hud-values')
        hh = at if at != '01:00' else '01:00'
        ok(hh in hud_title, f'{label} HUD-Titel zeigt {hh} („{hud_title}")')
        exp_solar = de(max(0, snap['solar']) / 1000, 1)
        exp_wind = de(max(0, snap['windOn'] + snap['windOff']) / 1000, 1)
        exp_share = de(snap['share'], 0)
        ok(f'Solar {exp_solar} GW' in hud_vals, f'{label} HUD Solar == API ({exp_solar})')
        ok(f'Wind {exp_wind} GW' in hud_vals, f'{label} HUD Wind == API ({exp_wind})')
        ok(f'Erneuerbare {exp_share} %' in hud_vals, f'{label} HUD EE% == API ({exp_share})')
        m = re.search(r'(\d{2},\d{3}) Hz', hud_vals)
        ok(m is not None and 49.5 < float(m.group(1).replace(',', '.')) < 50.5, f'{label} HUD Hz plausibel ({m.group(1) if m else "?"})')
        ok(('Archiv' in (page.text_content('#hud-archive') or '')), f'{label} Archiv-Zeile sichtbar (mock)')

        shot = f'shots/gate2-{at.replace(":", "")}.png'
        page.screenshot(path=shot)
        shots[at] = shot
        page.close()
    browser.close()

# Stimmungs-Distanz: mittlere RGB-Differenz paarweise
from PIL import Image
import itertools
imgs = {at: Image.open(f).convert('RGB').resize((160, 100)) for at, f in shots.items()}
for a, b in itertools.combinations(TIMES, 2):
    pa, pb = imgs[a].tobytes(), imgs[b].tobytes()
    diff = sum(abs(x - y) for x, y in zip(pa, pb)) / len(pa)
    ok(diff > 12, f'Stimmung {a} vs {b} klar unterschiedlich (Δ={diff:.1f})')

print()
print('SUITE GREEN' if not fails else f'SUITE RED — {len(fails)} failure(s)')
sys.exit(0 if not fails else 1)
