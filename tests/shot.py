# Screenshot-Werkzeug: rendert Stromland bei gegebener Zeit/Viewport, sammelt Konsole.
# Usage: python tests/shot.py <url> <outfile> [width] [height] [settle_ms]
import sys
from playwright.sync_api import sync_playwright

url = sys.argv[1]
out = sys.argv[2]
w = int(sys.argv[3]) if len(sys.argv) > 3 else 1600
h = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
settle = int(sys.argv[5]) if len(sys.argv) > 5 else 3500

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
    page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.goto(url)
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(settle)
    ready = page.evaluate('window.__stromland && window.__stromland.ready === true')
    page.screenshot(path=out)
    browser.close()

lines = [f'ready={ready} shot={out}']
if errors:
    lines.append('CONSOLE ISSUES:')
    lines += ['   ' + e for e in errors[:20]]
else:
    lines.append('console clean')
report = '\n'.join(lines)
print(report)
with open(out + '.txt', 'w') as f:
    f.write(report + '\n')
