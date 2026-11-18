"""Check the token-radar dashboard for JavaScript errors in a real browser.

Serves a main.ts output dir on localhost, renders the dashboard in headless Camoufox
at 1440x900, opens every view (board, a detail view, a filtered board, the live-token
tab, the coverage tab and the model tab), and collects console errors and page errors.
Exit 0 when zero errors were seen on every view; exit 1 otherwise, printing each one.

Usage: TMPDIR=~/workspace/.tmp ~/workspace/.venv-camoufox/bin/python browser-check.py <out-dir>
"""
import subprocess
import sys
import time
from pathlib import Path

from camoufox.sync_api import Camoufox

OUT = Path(sys.argv[1]).resolve()
PORT = 8902

VIEWS = [
    ("board", ""),
    ("detail", "#detail=coinbase-bridge"),
    ("filtered", "#cat=Dexs"),
    ("live", "#tab=live"),
    ("coverage", "#tab=coverage"),
    ("model", "#tab=model"),
]

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=OUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
errors = []
try:
    base = f"http://127.0.0.1:{PORT}/dashboard/index.html"
    with Camoufox(headless=True, canvas_noise=False) as browser:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        for name, frag in VIEWS:
            before = len(errors)
            page.goto(base + frag, wait_until="domcontentloaded")
            page.reload(wait_until="domcontentloaded")
            # Each view waits for its own visible content: the board panel is hidden on the
            # live, coverage and model tabs, so a board selector would never become visible there.
            if name in ("board", "detail", "filtered"):
                page.wait_for_selector("#rows tr", timeout=15000)
            if name == "detail":
                page.wait_for_selector("#detail:not([hidden])", timeout=15000)
            if name == "live":
                page.wait_for_selector("#liverows tr", timeout=15000)
            if name == "coverage":
                page.wait_for_selector("#setasiderows tr", timeout=15000)
            if name == "model":
                page.wait_for_selector("#calrows tr", timeout=15000)
            time.sleep(0.4)
            print(f"{name}: {len(errors) - before} new error(s)")
finally:
    server.terminate()

if errors:
    print(f"\n{len(errors)} JavaScript error(s):")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("\n0 JavaScript errors across all views.")
