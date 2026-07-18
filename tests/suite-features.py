# Phase-3-Gate: Replay-Durchlauf, Galerie-Modus, Info-Overlay, Legal-Seiten,
# OG/Meta vorhanden, Mobile-Viewport (390x844) rendert + Screenshot.
# Usage: python tests/suite-features.py [base_url]
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5317'
fails = []

def ok(cond, label):
    print(('  ✓ ' if cond else '  ✗ FAIL: ') + label)
    if not cond:
        fails.append(label)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # --- Desktop: Replay + Galerie + Overlay ---
    errors = []
    page = browser.new_page(viewport={'width': 1280, 'height': 800})
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'{BASE}/?mock=1&at=18:00&seed=7')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(2500)
    ok(page.evaluate('window.__stromland.ready === true'), 'desktop ready')

    # Replay: starten, Zeit muss durchlaufen (HUD-Titel ändert sich), endet von selbst
    t0 = page.text_content('#hud-title')
    page.click('#btn-replay')
    page.wait_for_timeout(6000)
    ok(page.evaluate('window.__stromland.isReplaying()'), 'Replay läuft nach Start')
    t_mid = page.text_content('#hud-title')
    ok(t_mid != t0, f'Replay: HUD-Zeit wandert („{t0}" → „{t_mid}")')
    mins_6s = page.evaluate('window.__stromland.data.replayOffsetMin')
    ok(isinstance(mins_6s, (int, float)) and 0 < mins_6s < 1440, f'Replay-Offset plausibel ({mins_6s:.0f} min nach 6 s)')
    page.wait_for_timeout(37000)  # Rest der 40 s + Puffer
    ok(not page.evaluate('window.__stromland.isReplaying()'), 'Replay endet von selbst nach ~40 s')
    ok(page.evaluate('window.__stromland.data.replayOffsetMin === null'), 'Replay-Offset zurückgesetzt')

    # Galerie-Modus: Klick aufs Bild → HUD weg; ESC → wieder da
    page.click('#scene', position={'x': 400, 'y': 300})
    page.wait_for_timeout(600)
    ok(page.evaluate("document.body.classList.contains('gallery')"), 'Galerie-Modus per Klick')
    hud_op = page.evaluate("getComputedStyle(document.getElementById('hud')).opacity")
    ok(float(hud_op) < 0.05, f'HUD im Galerie-Modus ausgeblendet (opacity={hud_op})')
    page.keyboard.press('Escape')
    page.wait_for_timeout(400)
    ok(not page.evaluate("document.body.classList.contains('gallery')"), 'ESC verlässt Galerie')

    # Info-Overlay
    page.click('#btn-info')
    page.wait_for_timeout(400)
    ok(page.evaluate("document.getElementById('overlay').classList.contains('open')"), 'Overlay öffnet')
    body = page.text_content('#overlay .inner')
    for begriff in ['Solarleistung', 'Windräder', 'Biomasse', 'Wasserkraft', 'Börsenstrompreis',
                    'Netzfrequenz', 'Erneuerbaren', 'energy-charts.info', 'CC BY 4.0', 'Fraunhofer']:
        ok(begriff in body, f'Overlay erklärt: {begriff}')
    ok(page.locator('#overlay a[href="/impressum"]').count() == 1, 'Overlay verlinkt Impressum')
    ok(page.locator('#overlay a[href="/datenschutz"]').count() == 1, 'Overlay verlinkt Datenschutz')
    ok(page.locator('#overlay img[src="/logo-mark.png"]').count() == 1, 'OsAI-Logo im Overlay')
    page.click('#overlay-close')
    page.wait_for_timeout(300)
    ok(not page.evaluate("document.getElementById('overlay').classList.contains('open')"), 'Overlay schließt')

    # Meta/OG
    ok(page.locator('meta[property="og:image"]').count() == 1, 'og:image Meta vorhanden')
    ok(page.locator('link[rel="canonical"]').count() == 1, 'canonical vorhanden')
    ok(len(errors) == 0, f'desktop 0 Konsolen-Fehler ({errors[:3]})')
    page.close()

    # --- Legal-Seiten ---
    page = browser.new_page()
    r = page.goto(f'{BASE}/impressum')
    ok(r.status == 200 and 'Öztopcu' in page.content(), 'Impressum erreichbar + Stammdaten')
    ok('DE462559965' in page.content(), 'USt-IdNr im Impressum')
    r = page.goto(f'{BASE}/datenschutz')
    ok(r.status == 200 and 'keine Cookies' in page.content().replace('setzt keine Cookies', 'keine Cookies'), 'Datenschutz erreichbar + Cookie-Klarheit')
    ok('Vercel' in page.content(), 'Datenschutz nennt Hoster')
    page.close()

    # --- Mobile-Viewport (390x844) ---
    errors_m = []
    page = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page.on('console', lambda m: errors_m.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors_m.append(str(e)))
    page.goto(f'{BASE}/?mock=1&at=21:30&seed=7')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3500)
    ok(page.evaluate('window.__stromland.ready === true'), 'mobile ready')
    ok(len(errors_m) == 0, f'mobile 0 Konsolen-Fehler ({errors_m[:3]})')
    fpsv = page.evaluate('window.__stromland.fps.val')
    ok(fpsv > 20, f'mobile fps-Messung läuft ({fpsv:.0f})')
    page.screenshot(path='shots/gate3-mobile-2130.png')
    page.close()
    browser.close()

print()
print('SUITE GREEN' if not fails else f'SUITE RED — {len(fails)} failure(s)')
sys.exit(0 if not fails else 1)
