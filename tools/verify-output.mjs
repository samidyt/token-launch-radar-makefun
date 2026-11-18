// Replicates the token-radar-01 gate's seven rows against a built /output, locally, plus
// an eighth row of this entry's own: the snapshot partition (ranked + live-token + set-aside
// accounts for every protocol, disjoint and complete). The server grades every entry
// (RULES.txt: "There is no local grade"), so this is a pre-submit rehearsal, not the grade:
// it reads the same files the sealed scorer reads and applies the rules RULES.txt states,
// including a byte comparison of dossier.json against a fresh buildDossier call with the
// gate's own caps ({text_max_bytes: 65536}).
//
// Usage: node tools/verify-output.mjs <out-dir> <snapshot.json>
// Exit 0 when all eight rows pass; prints each row PASS/FAIL with its detail.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const out = process.argv[2];
const snapshotPath = process.argv[3];
if (!out || !snapshotPath) {
  console.error('usage: node tools/verify-output.mjs <out-dir> <snapshot.json>');
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const slugSet = new Set(snapshot.protocols.map((p) => p.slug));
const results = [];
function row(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// 1. dashboard_files: index.html + >=1 .css + >=1 .js, <=400 files, <=4 MiB, regular files,
//    and no http(s) address anywhere in the source (stricter than the gate, which allows
//    URLs in visible text; this entry carries none at all).
{
  const dir = join(out, 'dashboard');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.'));
  const files = names.filter((n) => statSync(join(dir, n)).isFile());
  const bytes = files.reduce((s, n) => s + statSync(join(dir, n)).size, 0);
  let offending = null;
  for (const n of files) {
    if (/\.(html|css|js|mjs)$/.test(n)) {
      const text = readFileSync(join(dir, n), 'utf8');
      if (text.includes('http://') || text.includes('https://')) { offending = n; break; }
    }
  }
  const ok = files.includes('index.html') && files.some((n) => n.endsWith('.css')) &&
    files.some((n) => n.endsWith('.js')) && files.length <= 400 && bytes <= 4 * 1024 * 1024 &&
    offending === null;
  row('dashboard_files', ok, `${files.length} files, ${bytes} bytes${offending ? `, ${offending} names a URL` : ''}`);
}

// 2. board_file: 100..4000 rows, known slugs, non-empty names, whole positive ranks and
//    implied values (<= 1e14), farm_steps arrays, <= 8 MiB.
let board;
{
  const raw = readFileSync(join(out, 'board.json'));
  const parsed = JSON.parse(raw.toString('utf8'));
  board = Array.isArray(parsed) ? parsed : parsed.rows;
  let bad = null;
  for (const r of board) {
    if (!slugSet.has(r.slug)) { bad = `unknown slug ${r.slug}`; break; }
    if (typeof r.name !== 'string' || r.name.trim() === '') { bad = `empty name for ${r.slug}`; break; }
    if (!Number.isInteger(r.rank) || r.rank <= 0) { bad = `bad rank for ${r.slug}`; break; }
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) { bad = `bad implied value for ${r.slug}`; break; }
    if (!Array.isArray(r.farm_steps)) { bad = `no farm_steps for ${r.slug}`; break; }
  }
  const ok = board.length >= 100 && board.length <= 4000 && raw.length <= 8 * 1024 * 1024 && bad === null;
  row('board_file', ok, `${board.length} rows, ${raw.length} bytes${bad ? `, ${bad}` : ''}`);
}

// 3. sorted_by_value: ranks exactly 1..N once each, implied non-rising with rank, not all equal.
{
  const ranks = new Set(board.map((r) => r.rank));
  const ranksOk = ranks.size === board.length && board.every((r) => r.rank >= 1 && r.rank <= board.length);
  const sortedOk = board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd);
  const distinctOk = new Set(board.map((r) => r.implied_value_usd)).size > 1;
  row('sorted_by_value', ranksOk && sortedOk && distinctOk, `top ${board[0].slug} $${board[0].implied_value_usd}, bottom ${board[board.length - 1].slug} $${board[board.length - 1].implied_value_usd}`);
}

// 4. coverage: every slug in the snapshot's watchlist appears among the rows.
{
  const have = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !have.has(s));
  row('coverage', missing.length === 0, `${snapshot.watchlist.length - missing.length}/${snapshot.watchlist.length} watchlist slugs covered${missing.length ? `, missing ${missing.slice(0, 3).join(', ')}` : ''}`);
}

// 5. farm_steps: 3..12 strings per row, each 20..600 characters once trimmed.
{
  let bad = null;
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) { bad = `${r.slug}: ${r.farm_steps.length} steps`; break; }
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) { bad = `${r.slug}: step of ${len} chars`; break; }
    }
    if (bad) break;
  }
  row('farm_steps', bad === null, bad ?? `${board.length} rows × ${board[0].farm_steps.length} steps`);
}

// 6. screenshots: 3..4 whole PNG/JPEG images, <= 512 KiB each, long side <= 1440,
//    short side >= 800 pixels.
function pngDims(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buf.subarray(buf.length - 12).toString('ascii', 4, 8) !== 'IEND') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpegDims(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[buf.length - 2] !== 0xff || buf[buf.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xda) return null;
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
{
  const dir = join(out, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  let bad = null;
  const dims = [];
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    if (buf.length > 512 * 1024) { bad = `${n}: ${buf.length} bytes over 512 KiB`; break; }
    const d = /\.png$/i.test(n) ? pngDims(buf) : /\.jpe?g$/i.test(n) ? jpegDims(buf) : null;
    if (d === null) { bad = `${n}: not a whole PNG or JPEG`; break; }
    const long = Math.max(d.w, d.h);
    const short = Math.min(d.w, d.h);
    if (long > 1440 || short < 800) { bad = `${n}: ${d.w}x${d.h}`; break; }
    dims.push(`${n} ${d.w}x${d.h} ${buf.length}B`);
  }
  const ok = names.length >= 3 && names.length <= 4 && bad === null;
  row('screenshots', ok, bad ?? dims.join('; '));
}

// 7. dossier_matches: byte for byte what buildDossier writes with the gate's caps, <= 1.5 MiB.
{
  const written = readFileSync(join(out, 'dossier.json'));
  let rebuilt = null;
  let err = null;
  try {
    rebuilt = buildDossier(out, { text_max_bytes: 65536 });
  } catch (e) {
    err = String(e);
  }
  const match = rebuilt !== null && Buffer.from(rebuilt).equals(written);
  row('dossier_matches', match && written.length <= 1.5 * 1024 * 1024,
    err ?? `dossier.json ${written.length} bytes, ${match ? 'byte-identical to a fresh buildDossier' : 'DIFFERS from a fresh buildDossier'}`);
}

// 8. partition (this entry's own row, not the gate's): data.js accounts for the whole snapshot —
//    ranked + live-token + set-aside, disjoint and complete, and the header counts agree.
{
  const text = readFileSync(join(out, 'data.js'), 'utf8');
  const prefix = 'window.RADAR=';
  let bad = null;
  let detail = '';
  if (!text.startsWith(prefix)) {
    bad = 'data.js does not start with window.RADAR=';
  } else {
    const radar = JSON.parse(text.slice(prefix.length).replace(/;\s*$/, ''));
    const buckets = [
      ['ranked', radar.rows ?? []],
      ['live', radar.live ?? []],
      ['aside', radar.aside ?? []],
    ];
    const seen = new Set();
    for (const [name, arr] of buckets) {
      for (const r of arr) {
        if (seen.has(r.slug)) { bad = `${r.slug} in two buckets (${name})`; break; }
        seen.add(r.slug);
      }
      if (bad) break;
    }
    if (!bad) {
      const missing = [...slugSet].filter((s) => !seen.has(s));
      if (missing.length > 0) bad = `${missing.length} snapshot protocols unaccounted for: ${missing.slice(0, 3).join(', ')}`;
    }
    if (!bad && radar.model_version !== 'radar-3') bad = `model_version is ${radar.model_version}, not radar-3`;
    if (!bad && (radar.board_size !== radar.rows.length || radar.live_size !== radar.live.length ||
      radar.aside_size !== radar.aside.length || radar.protocols_scanned !== snapshot.protocols.length)) {
      bad = 'header counts disagree with the bucket lengths';
    }
    if (!bad) {
      const reasons = {};
      for (const p of radar.aside) reasons[p.reason] = (reasons[p.reason] ?? 0) + 1;
      detail = `${radar.rows.length} ranked + ${radar.live.length} live + ${radar.aside.length} set aside ` +
        `(${reasons.exchange ?? 0} exchanges, ${reasons['versioned-pool'] ?? 0} versioned pools) = ${seen.size}/${snapshot.protocols.length}`;
    }
  }
  row('partition', bad === null, bad ?? detail);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? `\n8/8 gate rows pass.` : `\n${8 - failed.length}/8 gate rows pass.`);
process.exit(failed.length === 0 ? 0 : 1);
