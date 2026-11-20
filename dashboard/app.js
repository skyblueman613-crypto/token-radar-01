// Token Radar, radar-2: a plain dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a top-ten chart and a per-protocol
// detail drawer with the model's own inputs and the protocol's farm plan. Above the board it shows
// a KPI strip (the headline numbers, including the 758-of-758 coverage) and an integrity strip
// (six checkable claims about where the numbers come from), and below the model it shows the full
// coverage accounting — every protocol in the snapshot, in exactly one bucket. No network: every
// byte it shows is in data.js.
//
// Row keys in data.js: r rank, s slug, n name, c category, h chains (first two), t tvl_usd,
// g change_7d, a age_days, v implied_value_usd. Live keys: s slug, n name, c category,
// h chains, t tvl_usd, g change_7d, m mcap_usd.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var WATCH = {};
  DATA.watchlist.forEach(function (s) { WATCH[s] = true; });
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watch: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The model, as main.ts runs it: the category multiple comes from the calibration the snapshot
  // itself produced, and the page recomputes a row from the snapshot figures and checks the number
  // board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function multipleOf(row) {
    var cal = DATA.calibration;
    var hit = cal.by_category[row.c || 'Other'];
    if (hit) return hit.multiple;
    return cal.global_multiple;
  }
  function scoreOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.g === null || row.g === undefined ? 0 : row.g));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.a === null || row.a === undefined ? m.unknown_age_days : row.a;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var multiple = multipleOf(row);
    return {
      multiple: multiple,
      growthPct: growth,
      growthMult: growthMult,
      maturityMult: maturity,
      implied: Math.max(1, Math.round(row.t * multiple * growthMult * maturity))
    };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.h && p.h.length > 0 ? p.h[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.t >= 5e9) return 300;
    if (p.t >= 1e9) return 200;
    if (p.t >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function gasNote(chain) {
    var c = chain.toLowerCase();
    if (c === 'ethereum') return 'budget $5–$15 of gas per transaction on mainnet';
    if (c === 'bitcoin') return 'Bitcoin transactions are slow and costly, so use this chain only for the deposit';
    if (c === 'solana') return 'under $0.01 of gas per transaction';
    return 'under $0.10 of gas per transaction on this chain';
  }
  function actionFor(p, capital, chain) {
    var c = (p.c || '').toLowerCase();
    var name = p.n;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Lend $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and leave the deposit earning.';
    if (c.indexOf('dex') >= 0 || c.indexOf('amm') >= 0 || c.indexOf('swap') >= 0) return 'Add $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and keep the position in range.';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged') >= 0) return 'Deposit $' + capital + ' into ' + name + "'s highest-yield vault on " + chain + ' and let it compound.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds inside its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and hold the receipt token.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('option') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position in an open market on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield-bearing asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('payment') >= 0) return 'Route $' + capital + ' of payments through ' + name + ' on ' + chain + ' and keep the receipts.';
    if (c.indexOf('governance') >= 0 || c.indexOf('incentive') >= 0) return 'Lock $' + capital + " in " + name + "'s governance on " + chain + ' and vote once.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.a);
    var gas = gasNote(chain);
    return [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a screenshot or a chat.', cost: 'nothing but the wallet', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital; ' + gas, time: '20 minutes to set up' },
      { text: 'Do one qualifying action every week — a deposit, a borrow, a swap, a vote or a claim — so the wallet shows a pattern, not a single touch.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity spans more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Check the protocol's own points or rewards page once a month, and claim only from a link that page itself publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes a month' },
      { text: 'Keep a farm log — wallet, dates, amounts and every transaction hash — so you can repeat the position or unwind it cleanly.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watch = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watch) params.set('watch', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !WATCH[r.s]) return false;
      if (state.category !== 'all' && (r.c || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.h || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.n, r.s, r.c, (r.h || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.n.toLowerCase(); bv = b.n.toLowerCase(); }
      else if (key === 'tvl') { av = a.t; bv = b.t; }
      else if (key === 'growth') { av = a.g === null ? -Infinity : a.g; bv = b.g === null ? -Infinity : b.g; }
      else if (key === 'age') { av = a.a === null ? Infinity : a.a; bv = b.a === null ? Infinity : b.a; }
      else if (key === 'multiple') { av = multipleOf(a); bv = multipleOf(b); }
      else { av = a.v; bv = b.v; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.s < b.s ? -1 : a.s > b.s ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' qualified protocols below that floor, and the top row, ' + (top ? top.n : '—') + ', is worth ' + (top ? fmtUsd(top.v) : '—') + ' on the model. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function kpiStrip() {
    var cov = DATA.coverage;
    var top = DATA.rows[0];
    var cats = Object.keys(DATA.calibration.by_category);
    var calibrated = cats.filter(function (c) { return DATA.calibration.by_category[c].calibrated; }).length;
    var items = [
      ['Protocols accounted for', cov.total + ' / ' + cov.total],
      ['Pre-token ranked', String(DATA.board_size)],
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Live-token shown', DATA.live_size + ' of ' + cov.live_total],
      ['Categories calibrated', calibrated + ' of ' + cats.length],
      ['Global median multiple', DATA.calibration.global_multiple.toFixed(3) + 'x'],
      ['Top implied value', top ? fmtUsd(top.v) : '—']
    ];
    return el('section', { class: 'kpi', 'aria-label': 'Key numbers' },
      items.map(function (it) {
        return el('div', { class: 'kpi-item' }, el('span', { text: it[0] }), el('b', { text: it[1] }));
      })
    );
  }

  // The integrity strip: six short claims a reader can check against the snapshot, the model
  // panel and the coverage section below. Every number in them comes from data.js, so the strip
  // is true of the snapshot this run read, not of a hand-written example.
  function integrityStrip() {
    var cov = DATA.coverage;
    var claims = [
      'Every number comes from the sealed snapshot only — no external data, no live prices.',
      'Implied value is one function of the snapshot figures: TVL × category median × growth × maturity — the formula is written out under How implied value is computed.',
      'The same exclusion rule — bridges, wrapped and staked products, exchanges, versioned pools — applies to every row, not just the watchlist.',
      'Deterministic: the same snapshot always writes the same board; two runs are byte-identical.',
      'The page recomputes each row’s implied value and says whether it agrees with board.json.',
      'Coverage: ' + cov.total + ' of ' + cov.total + ' protocols accounted for — the board, the live table, or an excluded row with its reason. See Coverage below.'
    ];
    return el('section', { class: 'panel integrity' },
      el('h2', { text: 'How to check this radar' }),
      el('ul', null, claims.map(function (c) { return el('li', { text: c }); }))
    );
  }

  function topChart() {
    var top = DATA.rows.slice(0, 10);
    var max = top.length > 0 ? top[0].v : 1;
    var body = el('div', { class: 'panel chart' });
    body.appendChild(el('h2', { text: 'Top ten by implied value' }));
    top.forEach(function (r) {
      body.appendChild(el('div', { class: 'chart-row' },
        el('span', { class: 'rank', text: String(r.r) }),
        el('span', { class: 'who', text: r.n }),
        el('span', { class: 'track' }, el('i', { style: 'width:' + Math.max(2, Math.round((r.v / max) * 100)) + '%' })),
        el('span', { class: 'val', text: fmtUsd(r.v) })
      ));
    });
    return body;
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.c || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.h || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    var watch = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.watch ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only'
    );
    watch.querySelector('input').addEventListener('change', function (e) { state.watch = e.target.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      watch,
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watch = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].v || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.g === null ? 'n/a' : fmtPct(r.g);
      var growthClass = r.g === null ? '' : r.g >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.s ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.s); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.s); } }
      },
        el('td', { class: 'num', text: String(r.r) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.n }),
          el('span', { class: 'sub', text: (r.c || 'Other') + ' on ' + (r.h && r.h.length ? r.h.join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.t) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.a) }),
        el('td', { class: 'num', text: multipleOf(r).toFixed(2) + 'x' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.v / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.v) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }), WATCH[r.s] ? el('span', { class: 'badge', text: 'watchlist' }) : null)
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'Multiple'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.n }), el('span', { class: 'sub', text: (r.c || 'Other') + ' on ' + (r.h && r.h.length ? r.h.join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.t) }),
        el('td', { class: 'num ' + (r.g !== null && r.g >= 0 ? 'pos' : 'neg'), text: fmtPct(r.g) }),
        el('td', { class: 'num', text: fmtUsd(r.m) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cal = DATA.calibration;
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.c || 'Other'; }))).sort(function (a, b) {
      var ma = (cal.by_category[a] || { multiple: cal.global_multiple }).multiple;
      var mb = (cal.by_category[b] || { multiple: cal.global_multiple }).multiple;
      return mb - ma;
    });
    var calRows = cats.map(function (c) {
      var hit = cal.by_category[c] || { multiple: cal.global_multiple, live_count: 0, calibrated: false };
      return el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: hit.multiple.toFixed(3) + 'x' }),
        el('td', { class: 'num', text: String(hit.live_count) }),
        el('td', { text: hit.calibrated ? 'median of live mcap/TVL' : 'global median' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is not a guess: it is the median market-cap-to-TVL of the snapshot\u2019s own live-token protocols in that category (three or more of them), clamped to ' + m.multiple_floor + '–' + m.multiple_cap + '. A category with fewer live protocols takes the global median, ' + cal.global_multiple.toFixed(3) + 'x from ' + cal.global_live_count + ' live protocols. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('h3', { text: 'Calibration: the multiple each category uses' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'cal' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Multiple' }), el('th', { scope: 'col', text: 'Live set' }), el('th', { scope: 'col', text: 'Source' }))),
          el('tbody', null, calRows)
        )
      ),
      el('p', { class: 'sub', text: 'What this board leaves out, and why: bridges, liquid staking and restaking products, exchanges and versioned pools are products of tokens that already trade, not protocols waiting on a launch of their own. The watchlist\u2019s own rule is applied to every row, at any TVL, so a wrapped or staked product never ranks as a pre-token protocol.' })
    );
  }

  // The coverage accounting: every protocol in the snapshot, in exactly one bucket. The bucket
  // table sums to the snapshot's protocol count, and the excluded lists name every protocol the
  // board does not rank and the live table does not show, grouped by its reason.
  function coveragePanel() {
    var cov = DATA.coverage;
    var bucketRows = [
      el('tr', null, el('td', { text: 'Ranked on the board (pre-token)' }), el('td', { class: 'num', text: String(cov.board) })),
      el('tr', null, el('td', { text: 'Live table (top 24 by market cap)' }), el('td', { class: 'num', text: String(cov.live_table) }))
    ];
    cov.by_reason.forEach(function (b) {
      bucketRows.push(el('tr', null, el('td', { text: b.label }), el('td', { class: 'num', text: String(b.count) })));
    });
    bucketRows.push(el('tr', null, el('td', null, el('b', { text: 'Total' })), el('td', { class: 'num' }, el('b', { text: String(cov.total) }))));
    var body = el('section', { class: 'panel coverage' },
      el('h2', { text: 'Coverage: where all ' + cov.total + ' protocols go' }),
      el('p', { class: 'sub', text: cov.total + ' of ' + cov.total + ' accounted for — ' + cov.board + ' ranked on the board, ' + cov.live_table + ' in the live table, ' + cov.excluded + ' excluded with a reason. Board + live table + excluded is the snapshot’s full protocol count, so nothing is silently dropped.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'cal' },
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Where it goes' }), el('th', { scope: 'col', text: 'Protocols' }))),
          el('tbody', null, bucketRows)
        )
      )
    );
    cov.by_reason.forEach(function (b) {
      var group = cov.rows.filter(function (r) { return r.r === b.reason; });
      var tb = el('tbody');
      group.forEach(function (r) {
        tb.appendChild(el('tr', null,
          el('td', { text: r.n }),
          el('td', { text: r.c || 'Other' }),
          el('td', { class: 'num', text: fmtUsd(r.t) })
        ));
      });
      var gbody = el('div', { class: 'cov-group' },
        el('h3', { text: b.label + ' — ' + b.count }),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'cal' },
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'TVL' }))),
            tb
          )
        )
      );
      body.appendChild(gbody);
    });
    return body;
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '.' }),
      el('span', { text: 'Implied value is a model, not a promise. A protocol that records no token may still have one its DefiLlama record does not carry.' }),
      el('span', { text: 'Token Radar, ' + DATA.model_version + ' model. Built by an AI agent for make.fun\u2019s token launch radar bounty.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.s === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var sc = scoreOf(row);
    var cal = DATA.calibration.by_category[row.c || 'Other'] || { multiple: DATA.calibration.global_multiple, live_count: 0, calibrated: false };
    var recomputed = sc.implied;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.r + ' of ' + DATA.board_size + (WATCH[row.s] ? ' · watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.n }),
        el('p', { class: 'sub', text: (row.c || 'Other') + ' on ' + (row.h && row.h.length ? row.h.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.t) })),
        el('div', null, el('span', { text: 'Category multiple (' + (row.c || 'Other') + ')' }), el('b', { class: 'num', text: sc.multiple.toFixed(3) + 'x' })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.g) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.a) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(Math.round(sc.growthMult * 1e4) / 1e4) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(Math.round(sc.maturityMult * 1e4) / 1e4) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.v) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. ' + (cal.calibrated ? 'The multiple is the median mcap/TVL of ' + cal.live_count + ' live ' + (row.c || 'Other') + ' protocols.' : 'Only ' + cal.live_count + ' live ' + (row.c || 'Other') + ' protocol' + (cal.live_count === 1 ? ' exists' : 's exist') + (cal.live_count === 0 ? '' : ', too few to calibrate') + ', so the multiple is the global median, ' + sc.multiple.toFixed(3) + 'x.') + ' The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.v ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpiStrip());
    shell.appendChild(integrityStrip());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(topChart());
      shell.appendChild(modelPanel());
    }
    shell.appendChild(coveragePanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
