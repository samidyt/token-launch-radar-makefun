"""Capture the token-radar dashboard's three dossier screenshots from the real output.

Serves a main.ts output dir on localhost, renders the dashboard in headless Camoufox
at 1440x900 (long side 1440, short side 900: inside the gate's bounds), and shoots:
  1-board.png    the ranked board
  2-detail.png   the top row's detail view (model arithmetic + farm plan)
  3-filtered.png the board filtered to one category

Usage: TMPDIR=~/workspace/.tmp ~/workspace/.venv-camoufox/bin/python screenshot.py <out-dir> <shots-dir>
"""
import subprocess
import sys
import time
from pathlib import Path

from camoufox.sync_api import Camoufox

OUT = Path(sys.argv[1]).resolve()
SHOTS = Path(sys.argv[2]).resolve()
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8901

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=OUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    base = f"http://127.0.0.1:{PORT}/dashboard/index.html"
    with Camoufox(headless=True, canvas_noise=False) as browser:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
        page = ctx.new_page()

        page.goto(base, wait_until="domcontentloaded")
        page.wait_for_selector("#rows tr", timeout=15000)
        time.sleep(0.5)
        page.screenshot(path=str(SHOTS / "1-board.png"))

        page.goto(base + "#detail=coinbase-bridge", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#detail:not([hidden])", timeout=15000)
        # Frame the shot on the detail view itself: it sits below the full 289-row
        # table, and scrollIntoView({block: 'nearest'}) leaves the board's tail above it.
        page.evaluate("document.getElementById('detail').scrollIntoView({block: 'start'})")
        time.sleep(0.8)
        page.screenshot(path=str(SHOTS / "2-detail.png"))

        page.goto(base + "#cat=Dexs", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#rows tr", timeout=15000)
        page.evaluate("window.scrollTo(0, 0)")  # a reload restores the old scroll position
        time.sleep(0.5)
        page.screenshot(path=str(SHOTS / "3-filtered.png"))
finally:
    server.terminate()

for p in sorted(SHOTS.glob("*.png")):
    print(p.name, p.stat().st_size, "bytes")
