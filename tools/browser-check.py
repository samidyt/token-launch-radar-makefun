"""Exercise the token-radar dashboard in a real browser and assert what it renders.

Serves a main.ts output dir on localhost, renders the dashboard in headless Camoufox
at 1440x900, and runs 18 checks across every view: the ranked board (rows, search,
category/chain/watchlist filters, sorting, detail view), the live-token view (all 416),
the set-aside view (53 with reasons), the model page (calibration + accounting), hash
deep links, and zero JavaScript errors anywhere.

Expected counts come from parsing the output's own data.js in Python, not from the
page's globals: Camoufox's evaluate runs in a different realm from the page's scripts,
so window.RADAR reads as None there. Assertions read the DOM; evaluate is only used
for scrolling.

Usage: TMPDIR=~/workspace/.tmp ~/workspace/.venv-camoufox/bin/python browser-check.py <out-dir>
Exit 0 when all 18 checks pass.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from camoufox.sync_api import Camoufox

OUT = Path(sys.argv[1]).resolve()
PORT = 8902

# The output's own data, parsed in Python: the source of every expected count.
src = (OUT / "data.js").read_text(encoding="utf-8")
assert src.startswith("window.RADAR="), "data.js does not start with window.RADAR="
DATA = json.loads(src[len("window.RADAR="):].rstrip().rstrip(";"))
ROWS = DATA["rows"]
LIVE = DATA["live"]
ASIDE = DATA["aside"]
P = DATA["partition"]

CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append((name, bool(ok)))
    print(("PASS" if ok else "FAIL"), name, ("— " + detail) if detail else "")


def main():
    errors = []
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=OUT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        base = f"http://127.0.0.1:{PORT}/dashboard/index.html"
        with Camoufox(headless=True, canvas_noise=False) as browser:
            ctx = browser.new_context(viewport={"width": 1440, "height": 900}, ignore_https_errors=True)
            page = ctx.new_page()
            page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
            page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)

            page.goto(base, wait_until="domcontentloaded")
            page.wait_for_selector("#rows tr[data-slug]", timeout=15000)
            time.sleep(0.3)

            # 1. The board renders every ranked row.
            n = page.locator("#rows tr[data-slug]").count()
            check("board rows", n == len(ROWS) == 289, f"{n} rows")

            # 2. The accounting headline names the whole snapshot.
            headline = page.locator("#accounting").inner_text()
            want = "All 758 snapshot protocols accounted for: 289 ranked · 416 live-token · 53 set aside (42 exchanges, 11 versioned pools)."
            check("accounting headline", headline.strip() == want, headline.strip()[:80])

            # 3. The stat cards show the snapshot, the watchlist, the board and the model.
            stats = page.locator(".stat .v").all_inner_texts()
            check("stat cards", stats[:3] == ["758", "40", "289"] and stats[4] == "radar-3",
                  " / ".join(stats))

            # 4. The top row is rank 1, coinbase-bridge.
            first = page.locator("#rows tr[data-slug]").first
            check("top row", first.locator("td").first.inner_text() == "1" and
                  "coinbase-bridge" in first.locator(".slug").inner_text(),
                  first.locator(".slug").inner_text())

            # 5. Clicking a row opens its detail view: arithmetic + 7 farm steps.
            first.click()
            page.wait_for_selector("#detail:not([hidden])", timeout=10000)
            steps = page.locator("#detail .steps li").count()
            arith = page.locator("#detail .arith").inner_text()
            check("detail view", steps == 7 and "coinbase" not in arith.lower() and "=" in arith,
                  f"{steps} steps, arithmetic shown")

            # 6. Closing the detail view hides it again.
            page.locator("#closedetail").click()
            time.sleep(0.2)
            check("detail close", page.locator("#detail").is_hidden())

            # 7. Search narrows to matching rows only.
            page.fill("#q", "coinbase")
            time.sleep(0.3)
            slugs = page.locator("#rows tr[data-slug] .slug").all_inner_texts()
            check("search", len(slugs) >= 1 and all("coinbase" in s for s in slugs),
                  f"{len(slugs)} row(s): {', '.join(slugs)}")
            page.fill("#q", "")
            time.sleep(0.3)

            # 8. The category filter shows exactly the Dexs rows.
            page.select_option("#cat", "Dexs")
            time.sleep(0.3)
            want_dexs = sum(1 for r in ROWS if r["category"] == "Dexs")
            n = page.locator("#rows tr[data-slug]").count()
            check("category filter", n == want_dexs, f"{n} Dexs rows")
            page.select_option("#cat", "")
            time.sleep(0.3)

            # 9. The chain filter shows exactly the rows on that chain.
            page.select_option("#chain", "Ethereum")
            time.sleep(0.3)
            want_eth = sum(1 for r in ROWS if "Ethereum" in r["chains"])
            n = page.locator("#rows tr[data-slug]").count()
            check("chain filter", n == want_eth, f"{n} Ethereum rows")
            page.select_option("#chain", "")
            time.sleep(0.3)

            # 10. Watchlist-only shows exactly the 40 watchlist rows.
            page.check("#watchonly")
            time.sleep(0.3)
            n = page.locator("#rows tr[data-slug]").count()
            check("watchlist filter", n == 40, f"{n} rows")
            page.uncheck("#watchonly")
            time.sleep(0.3)

            # 11. Sorting by TVL puts the biggest protocol first.
            page.select_option("#sort", "tvl_usd")
            time.sleep(0.3)
            top_tvl = max(ROWS, key=lambda r: r["tvl_usd"])["slug"]
            first_slug = page.locator("#rows tr[data-slug] .slug").first.inner_text()
            check("sort by TVL", first_slug == top_tvl, first_slug)

            # 12. Sorting by name puts the alphabetically first protocol first.
            page.select_option("#sort", "name")
            time.sleep(0.3)
            first_name = min(ROWS, key=lambda r: r["name"])["name"]
            shown = page.locator("#rows tr[data-slug] .name").first.inner_text()
            check("sort by name", shown == first_name, shown)
            page.select_option("#sort", "rank")
            time.sleep(0.3)

            # 13. The live-token view holds all 416, biggest market cap first.
            page.locator('.tab[data-tab="live"]').click()
            time.sleep(0.3)
            n = page.locator("#liverows tr").count()
            top_mcap = max(LIVE, key=lambda r: r["mcap_usd"] or 0)["slug"]
            first_slug = page.locator("#liverows tr .slug").first.inner_text()
            check("live view", n == len(LIVE) == 416 and first_slug == top_mcap,
                  f"{n} rows, first {first_slug}")

            # 14. The set-aside view holds all 53, with 42 exchange and 11 versioned-pool reasons.
            page.locator('.tab[data-tab="aside"]').click()
            time.sleep(0.3)
            n = page.locator("#asiderows tr").count()
            cex = page.locator("#asiderows .badge.aside-cex").count()
            ver = page.locator("#asiderows .badge.aside-ver").count()
            check("set-aside view", n == len(ASIDE) == 53 and cex == 42 and ver == 11,
                  f"{n} rows, {cex} exchange / {ver} versioned pool")

            # 15. The model page states the true calibration: 128 comps, median x0.214.
            page.locator('.tab[data-tab="model"]').click()
            time.sleep(0.3)
            cal = page.locator("#calrows tr").count()
            med = page.locator("#globalmed").inner_text()
            check("calibration", cal == len(DATA["calibration"]) == 34 and "128" in med and "0.214" in med,
                  f"{cal} categories; {med}")

            # 16. The model page states the partition arithmetic.
            part = page.locator("#partitionline").inner_text()
            check("partition line", "289 + 416 + 53 = 758" in part, part[:90])

            # 17. Hash deep links open their views: a tab, then a detail.
            page.goto(base + "#tab=aside", wait_until="domcontentloaded")
            page.reload(wait_until="domcontentloaded")
            time.sleep(0.3)
            aside_open = page.locator("#tab-aside").is_visible()
            page.goto(base + "#detail=coinbase-bridge", wait_until="domcontentloaded")
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector("#detail:not([hidden])", timeout=10000)
            check("hash deep links", aside_open and page.locator("#detail").is_visible(),
                  "tab=aside + detail=coinbase-bridge")

            # 18. No JavaScript error anywhere in the run.
            check("zero JS errors", len(errors) == 0,
                  f"{len(errors)} error(s)" if errors else "no pageerror, no console.error")
            for e in errors[:5]:
                print("   ", e)
    finally:
        server.terminate()

    passed = sum(1 for _, ok in CHECKS if ok)
    print(f"\n{passed}/{len(CHECKS)} browser checks pass.")
    return 0 if passed == len(CHECKS) else 1


if __name__ == "__main__":
    sys.exit(main())
