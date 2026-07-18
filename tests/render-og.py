# Rendert das OG-Bild (1200x630) zur goldenen Stunde aus der Fixture — 0 €.
# Usage: python tests/render-og.py [base_url] [out]
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5317'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'public/og.png'

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1200, 'height': 630}, device_scale_factor=1)
    page.goto(f'{BASE}/?mock=1&at=21:15&seed=7')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(4000)
    # Galerie-Modus: reines Bild + HUD ist Teil des Reizes — HUD sichtbar lassen,
    # aber Buttons ausblenden für das OG
    page.evaluate("document.getElementById('actions').style.display='none'; 1")
    page.wait_for_timeout(300)
    page.screenshot(path=OUT)
    browser.close()
print('og →', OUT)
