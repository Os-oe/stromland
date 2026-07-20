# Motion-Gate: Lebendigkeit ist messbar. Zwei Frames im Abstand von 3 s (mock,
# deterministisch, 01:00 UND 13:00) — der mittlere Pixel-Delta in drei Regionen
# (Himmel, Mittelgrund, Fluss) muss deutlich über dem Rausch-Floor liegen.
# Messbedingungen (alles Testparams, Prod unverändert):
#   ?grain=0  — Filmkorn aus: das Korn ist animiert und würde jede Messung fluten
#   ?q=1      — Qualitäts-Budget gepinnt: kein adaptiver Statik-Repaint zw. Frames
#   ?filter=0 — globale Brightness-Atmung aus (CSS-Filter arbeitet in linearRGB,
#               ließe sich im sRGB-Screenshot nicht sauber herausrechnen)
# Downscale 4x (Box) mittelt Antialiasing-Reste weg — was bleibt, ist echte lokale
# Bewegung (Nebel-Drift, Partikel-Trails, Fluss-Glints, Funkeln, Warnlichter).
# Rausch-Floor (alle Dynamik-Layer via ?dbg aus, nur Rotoren drehen):
#   01:00 sky 0.003 · mid 0.002 · river 0.072 / 13:00 sky 0.068 · mid 0.077 · river 0.075
# Zusätzlich: Intro-Tagesfahrt läuft bei frischem Load, HUD-Uhr wandert, Klick
# bricht sofort ab (ohne Galerie-Toggle), ?intro=0 und prefers-reduced-motion aus.
# Usage: python tests/suite-liveliness.py [base_url] [--measure]
import sys
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'http://localhost:5317'
MEASURE = '--measure' in sys.argv
GAP_MS = 3000
TIMES = ['01:00', '13:00']
GATE_PARAMS = '&grain=0&q=1&filter=0'

# Regionen für 1280x800 (Horizont = 520): Himmel-Band (bis knapp über Horizont),
# Mittelgrund-Band, Fluss-Band
REGIONS = {
    'sky':   (80, 60, 1200, 512),
    'mid':   (80, 528, 1200, 648),
    'river': (430, 600, 900, 784),
}
# Gate-Schwellen: kalibriert deutlich über dem Rausch-Floor (s.o.) und mit
# Sicherheitsabstand unter dem gemessenen Ist (3 Läufe je Zeit, 2026-07-20):
#   01:00: sky 0.65–0.90 · mid 0.42–0.61 · river 0.64–0.99
#   13:00: sky 0.20–0.22 · mid 0.41–0.48 · river 0.30–0.65
THRESH = {
    ('01:00', 'sky'): 0.40, ('01:00', 'mid'): 0.28, ('01:00', 'river'): 0.42,
    ('13:00', 'sky'): 0.14, ('13:00', 'mid'): 0.28, ('13:00', 'river'): 0.16,
}

fails = []

def ok(cond, label):
    print(('  ✓ ' if cond else '  ✗ FAIL: ') + label)
    if not cond:
        fails.append(label)

def region_delta(img_a, img_b, box):
    """Downscale 4x (Box) gegen AA-Reste, dann mittlerer |Δ| pro Subpixel."""
    a = img_a.crop(box)
    b = img_b.crop(box)
    w, h = a.size
    a = a.resize((max(1, w // 4), max(1, h // 4)), Image.BOX)
    b = b.resize((max(1, w // 4), max(1, h // 4)), Image.BOX)
    pa, pb = a.tobytes(), b.tobytes()
    return sum(abs(x - y) for x, y in zip(pa, pb)) / len(pa)

report_lines = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # --- Motion-Gate: 2 Frames, 3 s Abstand, 3 Regionen, nachts UND mittags ---
    for at in TIMES:
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=1)
        page.goto(f'{BASE}/?mock=1&seed=7&at={at}{GATE_PARAMS}')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(3000)
        ok(page.evaluate('window.__stromland.ready === true'), f'[{at}] ready')
        tag = 'night' if at == '01:00' else 'noon'
        pa = f'shots/iter4/iter4-{tag}-frameA.png'
        pb = f'shots/iter4/iter4-{tag}-frameB.png'
        page.screenshot(path=pa)
        page.wait_for_timeout(GAP_MS)
        page.screenshot(path=pb)
        page.close()
        img_a = Image.open(pa).convert('RGB')
        img_b = Image.open(pb).convert('RGB')
        for name, box in REGIONS.items():
            d = region_delta(img_a, img_b, box)
            line = f'[{at}] {name}: delta={d:.3f} (Schwelle {THRESH[(at, name)]})'
            report_lines.append(line)
            if MEASURE:
                print('  · ' + line)
            else:
                ok(d > THRESH[(at, name)], f'{line} — Bewegung nachweisbar')

    # --- Intro-Tagesfahrt ---
    if not MEASURE:
        # 1) Frischer Load ohne at → Intro läuft, HUD-Uhr wandert in den ersten 5 s
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.goto(f'{BASE}/?mock=1&seed=7')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1200)
        ok(page.evaluate('window.__stromland.introActive()'), 'Intro läuft nach frischem Load')
        t0 = page.text_content('#hud-title')
        page.wait_for_timeout(3000)
        t1 = page.text_content('#hud-title')
        ok(t0 != t1, f'Intro: HUD-Uhr wandert („{t0}" → „{t1}")')
        # 2) Klick bricht sofort zum Live-Modus ab — ohne Galerie-Toggle
        page.mouse.click(640, 400)
        page.wait_for_timeout(700)
        ok(not page.evaluate('window.__stromland.introActive()'), 'Klick bricht Intro ab')
        ok(page.evaluate('window.__stromland.data.replayOffsetMin === null'), 'Offset nach Abbruch zurückgesetzt')
        ok(not page.evaluate("document.body.classList.contains('gallery')"), 'Abbruch-Klick togglet NICHT die Galerie')
        # Nach dem Abbruch muss Szene/HUD SOFORT im Jetzt sein — nicht bis zu 2 s
        # auf dem letzten Fahrt-Moment stehen (forceRefresh-Regression)
        import datetime
        snap_min = page.evaluate('window.__stromland.data.snapshot().minutes')
        try:
            from zoneinfo import ZoneInfo
            now_b = datetime.datetime.now(ZoneInfo('Europe/Berlin'))
        except Exception:
            now_b = datetime.datetime.now()
        now_min = now_b.hour * 60 + now_b.minute
        drift = min(abs(snap_min - now_min), 1440 - abs(snap_min - now_min))
        ok(drift < 3, f'Nach Abbruch zeigt die Szene das Jetzt (Δ={drift:.1f} min)')
        hud_now = page.text_content('#hud-title')
        ok(f'{now_b.hour:02d}:' in hud_now or f'{(now_b.hour + (1 if now_b.minute == 59 else 0)) % 24:02d}:' in hud_now,
           f'HUD-Uhr nach Abbruch im Jetzt („{hud_now}")')
        page.close()

        # 3) Intro läuft komplett durch → settelt im Jetzt, Live-Hint erscheint
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.goto(f'{BASE}/?mock=1&seed=7')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(14500)
        ok(not page.evaluate('window.__stromland.introActive()'), 'Intro endet von selbst (~13,5 s)')
        ok(page.evaluate('window.__stromland.data.replayOffsetMin === null'), 'Nach Settle: Live-Modus (Offset null)')
        ok(page.evaluate("document.getElementById('live-hint').classList.contains('show')"),
           'Settle-Hint „Jetzt — das Bild malt live weiter" sichtbar')
        page.close()

        # 4) ?intro=0 → kein Intro
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        page.goto(f'{BASE}/?mock=1&seed=7&intro=0')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1500)
        ok(not page.evaluate('window.__stromland.introActive()'), '?intro=0 unterdrückt Intro')
        page.close()

        # 5) prefers-reduced-motion → kein Intro
        page = browser.new_page(viewport={'width': 1280, 'height': 800}, reduced_motion='reduce')
        page.goto(f'{BASE}/?mock=1&seed=7')
        page.wait_for_load_state('networkidle')
        page.wait_for_timeout(1500)
        ok(not page.evaluate('window.__stromland.introActive()'), 'prefers-reduced-motion unterdrückt Intro')
        page.close()

    browser.close()

with open('shots/iter4/last-motion-run.txt', 'w') as f:
    f.write('\n'.join(report_lines) + '\n')

print()
if MEASURE:
    print('MEASURE ONLY — Deltas oben, kein Gate.')
    sys.exit(0)
print('SUITE GREEN' if not fails else f'SUITE RED — {len(fails)} failure(s)')
sys.exit(0 if not fails else 1)
