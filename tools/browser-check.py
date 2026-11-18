"""Exercise the token-radar dashboard in a real headless browser and fail loudly.

Serves a main.ts output dir on localhost, loads the dashboard in headless Camoufox,
and checks every view renders from the real data with ZERO console errors and ZERO
page errors:
  - board tab: stats cards, ranked rows, the top row's values
  - detail view: opens for the top row, shows the arithmetic and the 7 farm steps
  - live tab: every live-token row renders
  - set-aside tab: every set-aside row renders with its reason
  - model tab: the calibration table renders
  - filters: a category filter narrows the board; watchlist-only narrows it to 40

Every assertion reads the DOM (locators and inner text) or data.js parsed in Python.
Nothing reads page JavaScript globals through evaluate: this Camoufox build evaluates
in a realm where the page scripts' globals are not visible (verified 2026-11-19: an
inline script's window.FOO reads back as None through evaluate while the DOM it wrote
is fully visible), so evaluate is used only for scrolling.

Usage: TMPDIR=~/workspace/.tmp ~/workspace/.venv-camoufox/bin/python browser-check.py <out-dir>
Exit 0 when every check passes; prints each check PASS/FAIL with its detail.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from camoufox.sync_api import Camoufox

OUT = Path(sys.argv[1]).resolve()
PORT = 8902

failures = []
total = [0]


def check(name, ok, detail=""):
    total[0] += 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    if not ok:
        failures.append(name)


# The dataset, parsed in Python: the expectations the DOM must match.
data_text = (OUT / "data.js").read_text(encoding="utf-8")
assert data_text.startswith("window.RADAR="), "data.js does not start with window.RADAR="
D = json.loads(data_text[len("window.RADAR="):].rstrip().rstrip(";"))
N_ROWS = len(D["rows"])
N_LIVE = len(D["live"])
N_ASIDE = len(D["aside"])
N_CAL = len(D["calibration"])
TOP = D["rows"][0]
TOP_FULL = f"${TOP['implied_value_usd']:,}"
check("data.js parses", True,
      f"{N_ROWS} ranked + {N_LIVE} live + {N_ASIDE} aside = "
      f"{N_ROWS + N_LIVE + N_ASIDE}/{D['protocols_scanned']}, model {D['model_version']}")
check("partition sums to the snapshot",
      N_ROWS + N_LIVE + N_ASIDE == D["protocols_scanned"])
check("top row is coinbase-bridge", TOP["slug"] == "coinbase-bridge",
      f"top {TOP['slug']} {TOP_FULL}")

server = subprocess.Popen(
    [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
    cwd=OUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    base = f"http://127.0.0.1:{PORT}/dashboard/index.html"
    with Camoufox(headless=True, canvas_noise=False) as browser:
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        page.goto(base, wait_until="domcontentloaded")
        page.wait_for_selector("#rows tr", timeout=15000)
        time.sleep(0.3)

        stats = page.locator(".stat .v").all_inner_texts()
        check("stats cards render", len(stats) == 5, " | ".join(stats))
        check("stats show the 758 accounting",
              stats[0] == str(D["protocols_scanned"]) and stats[1] == str(N_ROWS) and
              stats[2] == str(N_LIVE) and stats[3] == str(N_ASIDE),
              " | ".join(stats))
        board_rows = page.locator("#rows tr").count()
        check("board rows render", board_rows == N_ROWS, f"{board_rows} rows in the DOM")
        check("count line agrees", page.locator("#count").inner_text().startswith(f"Showing {N_ROWS} of"))
        first = page.locator("#rows tr").first.inner_text()
        check("first rendered row is the top row",
              "Coinbase Bridge" in first and "$2.62B" in first, first.split("\n")[0])

        # Detail view for the top row.
        page.goto(base + "#detail=coinbase-bridge", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#detail:not([hidden])", timeout=15000)
        time.sleep(0.3)
        detail_h2 = page.locator("#detail h2").inner_text()
        steps = page.locator("#detail .steps li").count()
        arith = page.locator("#detail .arith").inner_text()
        check("detail view opens", detail_h2.startswith("#1"), detail_h2)
        check("detail shows 7 farm steps", steps == 7, f"{steps} steps")
        check("detail shows the arithmetic", TOP_FULL in arith, arith[:80] + "...")

        # Live tab: every live row renders.
        page.goto(base + "#tab=live", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#liverows tr", timeout=15000)
        live_rows = page.locator("#liverows tr").count()
        check("live rows render", live_rows == N_LIVE, f"{live_rows} rows in the DOM")

        # Set-aside tab: every set-aside row renders with a reason.
        page.goto(base + "#tab=aside", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#asiderows tr", timeout=15000)
        aside_rows = page.locator("#asiderows tr").count()
        reasons = page.locator("#asiderows .reason").all_inner_texts()
        check("set-aside rows render", aside_rows == N_ASIDE, f"{aside_rows} rows in the DOM")
        check("set-aside reasons stated",
              len(reasons) == N_ASIDE and all(r.strip() for r in reasons),
              f"{len(reasons)} reasons")

        # Model tab: the calibration table renders.
        page.goto(base + "#tab=model", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#calrows tr", timeout=15000)
        cal_rows = page.locator("#calrows tr").count()
        check("calibration rows render", cal_rows == N_CAL, f"{cal_rows} rows in the DOM")

        # Filters: Dexs narrows the board; watchlist-only narrows it to 40.
        page.goto(base + "#cat=Dexs", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#rows tr", timeout=15000)
        dex_count = page.locator("#count").inner_text()
        dex_rows = page.locator("#rows tr").count()
        check("category filter narrows the board", 0 < dex_rows < N_ROWS, dex_count)
        page.goto(base + "#watch=1", wait_until="domcontentloaded")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector("#rows tr", timeout=15000)
        watch_rows = page.locator("#rows tr").count()
        check("watchlist-only shows 40 rows", watch_rows == 40, f"{watch_rows} rows")

        check("zero console/page errors", len(errors) == 0,
              "; ".join(errors[:3]) if errors else "no errors recorded")
finally:
    server.terminate()

print(f"\n{total[0] - len(failures)}/{total[0]} browser checks pass." if not failures else f"\n{len(failures)} browser check(s) failed.")
sys.exit(0 if not failures else 1)
