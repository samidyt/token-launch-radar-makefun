# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/samidyt/token-launch-radar-makefun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/samidyt/token-launch-radar-makefun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A [make.fun](https://make.fun) `token-radar-01` entry: a dashboard that finds protocols
whose token does not exist yet, ranks them by an implied launch value, and shows a reader how
to farm each one. Built for make.fun — referral code `yza5v0ew`.

## What it does

`main.ts` reads a sealed DefiLlama snapshot (`/input/snapshot.json` in the grader, or
`--input <file|dir>`), scores every rankable pre-token protocol with the model in `lib/model.ts`,
and writes to `/output` (or `MAKEFUN_OUTPUT_DIR`):

- `board.json` — the ranked board: 289 rows on this snapshot, every one of the snapshot's
  40 watchlist protocols covered, each row with a 7-step farm plan.
- `data.js` — the board, the live-token list and the set-aside list, compact, for the dashboard.
- `dashboard/` — a static page (no framework, no network): sortable, filterable, searchable
  board; a detail view per protocol with the model arithmetic and the farm plan; every
  live-token protocol with the market's own values; a Coverage view that accounts for all 758
  protocols in the snapshot (289 ranked + 416 live-token + 53 set aside with reasons); and a
  page stating the model and its calibration in full.
- `screenshots/` — three captures of the dashboard: the board, a detail view, a filtered view.
- `dossier.json` — built with the vendored `vendor/makefun-board.ts`, byte-identical to what
  the gate rebuilds.

## The model (radar-3)

One formula scores every row; no protocol is special-cased:

```
implied = TVL × category multiple × growth × maturity × breadth
```

- **Category multiple** — the median market-cap / TVL of the snapshot's live-token protocols
  in the same category, shrunk toward the global median (weight n / (n + 5)) and clamped to
  [0.03, 2.50]. A category with no live comps takes the global median. On this snapshot the
  global median is ×0.169.
- **Growth** — `1 + clamp(change_7d, −60, +120) / 100 × 0.5`.
- **Maturity** — `0.6 + min(age_days, 1095) / 1095 × 0.4`; age unknown counts as 365 days.
- **Breadth** — `1 + 0.03 × min(chains − 1, 4)`, at most +12%.

The board ranks **all** rankable pre-token protocols in the snapshot (289 here), not just the
watchlist and a fixed top-up: a radar that only shows the biggest protocols misses the early
finds the board exists for. "Records no token" is the snapshot's own wording — a record can
miss a token, and wrapped, staked or bridged products of tokens that already trade are left
out of the board's claims.

## Coverage — the whole snapshot, accounted for

radar-3's change over radar-2 is accounting, not a new ranking: the ranking formula is
unchanged, and the board it produces is byte-identical to radar-2's. What changed is that no
protocol is silently dropped any more. Every protocol in the snapshot lands in exactly one
bucket, and the build asserts the partition at runtime (`buildRadar` refuses to ship unless
ranked + live + set aside = protocols scanned; `tools/verify-output.mjs` re-derives it from
the snapshot as its eighth row):

| Bucket | On this snapshot | What it is |
| --- | --- | --- |
| Ranked | 289 | Pre-token, not an exchange, not a versioned pool. The board. |
| Live-token | 416 | The record carries a token (a market cap, a CoinGecko id, or a symbol). Shown with the market's own values, never mixed into the board. 144 record a market cap; 272 record a token but no market cap. |
| Set aside | 53 | Pre-token, but not ranked: 42 centralised exchanges and 11 versioned pools, each listed on the Coverage tab with its reason. |

Farm plans are generic steps derived from each protocol's category, chains, TVL and age —
with a cost and a time for every step. They are not financial advice.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22+, standard library only. The run is deterministic: the same snapshot in gives the
same bytes out.

## Layout

```
main.ts                  entrypoint: read the snapshot, write /output
lib/model.ts             the radar-3 model, the snapshot parser, the farm plans, the partition
dashboard/               index.html, app.css, app.js — the static dashboard
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
vendor/makefun-board.ts  the kit's dossier library, vendored unchanged
tools/screenshot.py      recaptures screenshots/ from a built output (Camoufox)
tools/browser-check.py   renders every dashboard view in a real browser, fails on any JS error
tools/verify-output.mjs  gate rehearsal: the gate's seven rows plus the partition row (8/8)
```

## Screenshots

Captured at 1440×900 from a real run of this entry on the kit snapshot
(`tools/screenshot.py <out-dir> <shots-dir>`); each is 119–133 KB, inside the gate's
512 KiB cap and the dossier's 1.5 MiB budget.

## Honest limits

- The model cannot know whether or when a protocol issues a token; a high implied value
  means the launch would be worth a lot *if* the protocol's record stayed as it is.
- The top of the board is dominated by large bridges and wrapped-BTC products, because
  they hold the largest TVL among protocols whose records carry no token. That is the
  snapshot's shape, not a judgement about which launches are likeliest.
- Farm plans are category templates, not protocol-specific research; a plan's first chain
  or first action may fit its protocol loosely.
- The dashboard is a static snapshot: it does not update, and it never fetches live data.
- The snapshot itself has quirks the entry shows as recorded rather than smoothing over:
  272 of the 416 live-token protocols record a token but no market cap, and one
  (`autofinance`) records a market cap of −$1. Its live row shows −$1; the calibration only
  uses protocols with a positive market cap, so it is unaffected.
