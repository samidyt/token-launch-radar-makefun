// Token Radar dashboard: renders window.RADAR (written by main.ts from the sealed snapshot).
// No framework, no network: sort, filter, search and detail views all run on the local data.
//
// Views: the ranked board (sortable, filterable, searchable), the live-token comparables (every
// protocol whose record carries a token), the coverage view (the whole-universe partition: ranked,
// live-token, set aside with reasons), and the model page, which states the formula and the
// calibration the snapshot produced.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) {
    document.body.insertAdjacentHTML('beforeend', '<p class="empty">No radar data loaded.</p>');
    return;
  }

  // ---------------------------------------------------------------- formatting

  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function pctClass(n) {
    if (n === null || n === undefined || !isFinite(n) || n === 0) return 'flat';
    return n > 0 ? 'up' : 'down';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Split a farm step ("<action> Cost: <cost>. Time: <time>.") into its parts for display.
  function splitStep(s) {
    var m = s.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/);
    if (!m) return { text: s, cost: '', time: '' };
    return { text: m[1], cost: m[2], time: m[3] };
  }

  // ---------------------------------------------------------------- header + stats

  document.getElementById('asof').textContent = 'Snapshot as of ' + D.as_of;
  // The snapshot's source line names its fetch URL and timestamp; the header shows the short form.
  var fetched = D.source.match(/fetched (\d{4}-\d{2}-\d{2})/);
  document.getElementById('source').textContent = 'DefiLlama' + (fetched ? ' · fetched ' + fetched[1] : '');
  document.getElementById('modelver').textContent = D.model_version;
  // The calibration's comps are the live-token protocols with a market cap the multiples were
  // computed from — not the whole live list, most of which records no market cap.
  var calComps = D.calibration.reduce(function (sum, c) { return sum + c.comps; }, 0);
  document.getElementById('globalmed').textContent =
    'Global median multiple ×' + D.global_median_multiple.toFixed(3) + ', from ' + calComps +
    ' live-token protocols with a market cap.';

  var totalImplied = D.rows.reduce(function (sum, r) { return sum + r.implied_value_usd; }, 0);
  var cov = D.coverage;
  document.getElementById('stats').innerHTML =
    stat('Protocols scanned', String(D.protocols_scanned), cov.ranked + ' ranked + ' + cov.live + ' live + ' + cov.set_aside + ' set aside') +
    stat('Board rows', String(D.board_size), D.watchlist_size + ' watchlist + ' + D.early_size + ' early') +
    stat('Live tokens', String(cov.live), cov.live_with_mcap + ' with a market cap, ' + cov.live_no_mcap + ' without one') +
    stat('Set aside', String(cov.set_aside), cov.set_aside_exchange + ' exchanges · ' + cov.set_aside_versioned + ' versioned') +
    stat('Total implied value', money(totalImplied), 'across the whole board', true);
  function stat(k, v, s, accent) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v' + (accent ? ' accent' : '') + '">' +
      esc(v) + '</div><div class="s">' + esc(s) + '</div></div>';
  }

  // ---------------------------------------------------------------- tabs

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () { showTab(tab.getAttribute('data-tab')); });
  });
  function showTab(name) {
    tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  }

  // ---------------------------------------------------------------- board state

  var state = { q: '', cat: '', chain: '', watchOnly: false, sort: 'rank', dir: 1, selected: null };

  var cats = [];
  var chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  var chainSel = document.getElementById('chain');
  chains.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    chainSel.appendChild(o);
  });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.watchOnly && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    rows.sort(function (a, b) {
      var va = a[key];
      var vb = b[key];
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'string') return dir * (va < vb ? -1 : va > vb ? 1 : 0);
      if (va !== vb) return dir * (va - vb);
      return a.rank - b.rank;
    });
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    document.getElementById('count').textContent =
      'Showing ' + rows.length + ' of ' + D.rows.length + ' ranked protocols' +
      (state.watchOnly ? ' (watchlist only)' : '') + '.';
    var tbody = document.getElementById('rows');
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">No protocol matches these filters.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span>' +
        (r.category ? '<br><span class="badge">' + esc(r.category) + '</span>' : '') +
        (r.watchlist ? ' <span class="badge watch">Watchlist</span>' : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + pctClass(r.change_7d) + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num model-mini">×' + r.category_multiple.toFixed(2) +
        ' · ×' + r.growth_multiplier.toFixed(2) +
        ' · ×' + r.maturity_multiplier.toFixed(2) +
        ' · ×' + r.breadth_multiplier.toFixed(2) + '</td>' +
        '</tr>';
    }).join('');
    Array.prototype.slice.call(tbody.querySelectorAll('tr[data-slug]')).forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
    document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
      var k = th.getAttribute('data-sort');
      th.classList.toggle('sorted', state.sort === k);
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (state.sort === k ? (state.dir === 1 ? ' ▲' : ' ▼') : '');
    });
  }

  // ---------------------------------------------------------------- detail view

  function select(slug) {
    state.selected = slug;
    renderBoard();
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
    var box = document.getElementById('detail');
    if (!r) { box.hidden = true; return; }
    var arith = moneyFull(r.tvl_usd) + ' × ' + r.category_multiple.toFixed(3) +
      ' (category) × ' + r.growth_multiplier.toFixed(3) +
      ' (growth) × ' + r.maturity_multiplier.toFixed(3) +
      ' (maturity) × ' + r.breadth_multiplier.toFixed(3) +
      ' (breadth) = <b>' + moneyFull(r.implied_value_usd) + '</b>';
    box.innerHTML =
      '<button class="close-detail" type="button" id="closedetail">Close ×</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + (r.category ? ' · ' + esc(r.category) : '') +
      (r.watchlist ? ' · <span class="badge watch">Watchlist</span>' : ' · <span class="badge">Radar find</span>') +
      ' · Records no token.</p>' +
      '<div class="facts">' +
      fact('TVL', moneyFull(r.tvl_usd)) +
      fact('7-day change', pct(r.change_7d)) +
      fact('Age', (r.age_days === null ? 'Unknown' : r.age_days + ' days') + (r.listed_at ? ' · listed ' + r.listed_at : '')) +
      fact('Chains', r.chains.length ? esc(r.chains.join(', ')) : '—') +
      '</div>' +
      '<h3>Implied value — the arithmetic</h3>' +
      '<div class="arith">' + arith + '</div>' +
      '<h3>Farm plan — ' + r.farm_steps.length + ' steps</h3>' +
      '<ol class="steps">' + r.farm_steps.map(function (s) {
        var p = splitStep(s);
        return '<li>' + esc(p.text) +
          (p.cost || p.time ? '<br><span class="meta">Cost: ' + esc(p.cost) + ' · Time: ' + esc(p.time) + '</span>' : '') + '</li>';
      }).join('') + '</ol>';
    box.hidden = false;
    document.getElementById('closedetail').addEventListener('click', function () {
      box.hidden = true;
      state.selected = null;
      renderBoard();
    });
    box.scrollIntoView({ block: 'nearest' });
  }
  function fact(k, v) {
    return '<div class="fact"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
  }

  // ---------------------------------------------------------------- live + coverage + calibration

  document.getElementById('livecount').textContent =
    'All ' + D.live.length + ' protocols whose record carries a token, by market cap — ' +
    cov.live_with_mcap + ' record a market cap, ' + cov.live_no_mcap + ' record a token but no market cap.';
  document.getElementById('liverows').innerHTML = D.live.map(function (p) {
    var ratio = (p.mcap_usd !== null && p.tvl_usd) ? (p.mcap_usd / p.tvl_usd).toFixed(2) + '×' : '—';
    return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span>' +
      (p.category ? '<br><span class="badge">' + esc(p.category) + '</span>' : '') + '</td>' +
      '<td class="num">' + (p.symbol ? esc(p.symbol) : '—') + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + ratio + '</td>' +
      '<td class="num ' + pctClass(p.change_7d) + '">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  document.getElementById('coverrows').innerHTML =
    coverRow('Ranked', cov.ranked, 'Pre-token protocols the board ranks, with a farm plan each.') +
    coverRow('Live-token', cov.live, 'Records a token already; shown with the market\u2019s own values.') +
    coverRow('Set aside', cov.set_aside, 'Pre-token, but an exchange or a versioned pool — listed below with the reason.') +
    '<tr><td><span class="name">Total</span></td><td class="num"><b>' + cov.total + '</b></td><td>Every protocol in the snapshot. ' +
    cov.ranked + ' + ' + cov.live + ' + ' + cov.set_aside + ' = ' + cov.total + '.</td></tr>';
  function coverRow(bucket, n, meaning) {
    return '<tr><td><span class="name">' + esc(bucket) + '</span></td><td class="num">' + n + '</td><td>' + esc(meaning) + '</td></tr>';
  }

  var reasonLabel = {
    exchange: 'Exchange — a centralised exchange, not a launch candidate.',
    versioned: 'Versioned pool — a version of another protocol, not a standalone launch.',
  };
  document.getElementById('setasidecount').textContent =
    cov.set_aside + ' protocols: ' + cov.set_aside_exchange + ' exchanges, ' + cov.set_aside_versioned + ' versioned.';
  document.getElementById('setasiderows').innerHTML = D.set_aside.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span>' +
      (p.category ? '<br><span class="badge">' + esc(p.category) + '</span>' : '') + '</td>' +
      '<td>' + esc(reasonLabel[p.reason] || p.reason) + '</td></tr>';
  }).join('');

  document.getElementById('calrows').innerHTML = D.calibration.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">×' + c.multiple.toFixed(3) + '</td><td class="num">' + c.comps + '</td></tr>';
  }).join('');

  // ---------------------------------------------------------------- controls + hash routing

  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('watchonly').addEventListener('change', function (e) { state.watchOnly = e.target.checked; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = (state.sort === 'name') ? 1 : -1;
    if (state.sort === 'rank') state.dir = 1;
    renderBoard();
  });
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) { state.dir = -state.dir; } else { state.sort = k; state.dir = (k === 'name' || k === 'rank') ? 1 : -1; }
      var sel = document.getElementById('sort');
      if (sel.querySelector('option[value="' + k + '"]')) sel.value = k;
      renderBoard();
    });
  });

  // Deep links, so a detail view or a filter is one address: #detail=<slug>, #cat=<category>, #watch=1.
  function fromHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = decodeURIComponent(kv[0] || '');
      var v = decodeURIComponent(kv[1] || '');
      if (k === 'detail' && v) select(v);
      if (k === 'cat' && v) { state.cat = v; catSel.value = v; }
      if (k === 'chain' && v) { state.chain = v; chainSel.value = v; }
      if (k === 'watch' && v === '1') { state.watchOnly = true; document.getElementById('watchonly').checked = true; }
      if (k === 'q' && v) { state.q = v; document.getElementById('q').value = v; }
      if (k === 'tab' && (v === 'live' || v === 'coverage' || v === 'model')) showTab(v);
    });
  }

  renderBoard();
  fromHash();
  renderBoard();
  // A hash that changes without a reload (a deep link clicked from elsewhere) opens its view too.
  window.addEventListener('hashchange', function () { fromHash(); renderBoard(); });
})();
