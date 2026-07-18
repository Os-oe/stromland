# FPS-Messung: lädt die Szene, lässt sie N Sekunden laufen, liest den fps-Monitor.
# Usage: python tests/fps.py [base_url] [at] [w] [h] [seconds]
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5317'
AT = sys.argv[2] if len(sys.argv) > 2 else '13:00'
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1600
H = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
SECS = int(sys.argv[5]) if len(sys.argv) > 5 else 10

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-gpu-rasterization'])
    page = browser.new_page(viewport={'width': W, 'height': H}, device_scale_factor=1)
    page.goto(f'{BASE}/?mock=1&at={AT}&seed=7')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(SECS * 1000)
    fps = page.evaluate('window.__stromland.fps.val')
    q = page.evaluate('window.__stromland.painter.quality')
    n = page.evaluate('window.__stromland.painter.particles.length')
    browser.close()
print(f'at={AT} {W}x{H}: fps={fps:.1f} quality={q} particles={n}')
