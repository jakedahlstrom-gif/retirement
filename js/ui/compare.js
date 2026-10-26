/*
 * compare.js — the Compare tab.
 *
 *  • Toggle chips pick 1–4 scenarios to overlay.
 *  • A swipeable carousel of eight charts. Charts that only make sense for one
 *    scenario use the "focus" scenario (its 10th–90th percentile band is also
 *    the one shaded on the balance chart).
 *  • Tap a chart for that year's details. Event markers sit on the x axis.
 *  • Summary table, "Share snapshot", and a Quick Adjust sheet.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt, C = UI.charts;
  const store = () => RP.store;
  const Cmp = (UI.compare = {});

  const CARDS = [
    { key: 'balance', title: 'Portfolio balance', sub: (f) => `Typical path · band: 10th–90th percentile for ${f}`, tip: 'balRet', build: 'balance', multi: true },
    { key: 'success', title: 'Chance of success', sub: () => 'Share of market scenarios where money lasts', tip: 'success', build: 'success', multi: true, bars: true },
    { key: 'safe', title: 'Safe annual spending', sub: () => `Most you could spend at your success target`, tip: 'safeSpend', build: 'safeSpend', multi: true, bars: true, needs: 'safe' },
    { key: 'sources', title: 'Where each dollar comes from', sub: (f) => `${f} · spending sources by year`, tip: 'magi', build: 'sources' },
    { key: 'accounts', title: 'Account balances by type', sub: (f) => `${f} · typical path`, tip: 'rothLadder', build: 'accounts' },
    { key: 'magi', title: 'Income vs. health-program lines', sub: () => 'MAGI each year until Medicare', tip: 'mncare', build: 'magi', multi: true },
    { key: 'taxes', title: 'Taxes and penalties', sub: (f) => `${f} · per year`, tip: 'penalty', build: 'taxes' },
    { key: 'byAge', title: 'Success by retirement age', sub: () => 'If you retired at each age from 45 to 65', tip: 'retireAge', build: 'byAge', multi: true, needs: 'byAge' },
  ];

  const cache = new Map(); // plan JSON → { a, safe, byAge }
  const charts = {};
  let root = null, els = {}, focusId = null, slide = 0, building = 0;

  function selected() { return store().state.compare.map((id) => store().scenario(id)).filter(Boolean); }
  function focus() {
    const sel = selected();
    if (!sel.find((s) => s.id === focusId)) focusId = sel[0] ? sel[0].id : 'base';
    return store().scenario(focusId);
  }
  function keyFor(id) { return JSON.stringify(store().planFor(id)); }
  function entry(id) { const k = keyFor(id); if (!cache.has(k)) cache.set(k, {}); return cache.get(k); }

  // ------------------------------------------------------------------ layout
  Cmp.render = function (el) {
    root = el || root;
    if (!root) return;
    C.applyTheme();
    for (const k of Object.keys(charts)) { charts[k].destroy(); delete charts[k]; }
    const sel = selected();
    const f = focus();
    els = {};
    els.chips = h('div.chips', store().state.scenarios.map((s) => {
      const on = sel.some((x) => x.id === s.id);
      return h('button.chip' + (on ? '.on' : ''), {
        style: { '--c': `var(--s${s.color})` },
        onclick: () => {
          if (!store().toggleCompare(s.id)) UI.toast('Compare up to 4 at a time');
          else if (store().state.compare.includes(s.id)) focusId = s.id;
        },
      }, h('span.dot'), C.short(s.name, 22));
    }), h('button.chip.add', { onclick: () => UI.scenarios.manage(), 'aria-label': 'Manage scenarios' }, UI.icon('plus')));

    els.focusBtn = h('button.scenario-pill', { onclick: pickFocus },
      h('span.dot', { style: { background: `var(--s${f.color})` } }), h('span', C.short(f.name, 20)), UI.icon('chevronDown', 'chev'));
    els.focusBtn.querySelector('svg').style.cssText = 'width:14px;height:14px;color:var(--muted)';

    els.track = h('div.carousel', { onscroll: onScroll });
    els.dots = h('div.dots');
    CARDS.forEach((c, i) => {
      const canvas = h('canvas', { role: 'img', 'aria-label': c.title });
      const legend = h('div.legend');
      const sub = h('div.chart-sub', c.sub(f.name));
      const status = h('div.chart-status');
      const card = h('div.card.slide', { 'data-key': c.key },
        h('div.chart-head', h('div', h('div.chart-title', c.title, UI.tipButton(c.tip)), sub),
          c.key === 'sources' ? h('button.btn.small', { onclick: () => yearTable(), style: { height: '32px', padding: '0 10px' } }, 'Table') : null,
          h('button.icon-btn', { 'aria-label': 'Share snapshot', onclick: () => share(c.key) }, UI.icon('share'))),
        h('div.chart-box', canvas, status), legend);
      els[c.key] = { card, canvas, legend, sub, status };
      els.track.appendChild(card);
      els.dots.appendChild(h('button', { 'aria-label': `Chart ${i + 1}`, onclick: () => goSlide(i) }));
    });
    els.table = h('div');
    els.hint = h('p.chart-hint', 'Tap a chart for that year’s details. Swipe for more charts.');

    UI.mount(root,
      h('div.compare-head', h('h1.large-title', 'Compare'),
        h('button.btn.small', { onclick: Cmp.quickAdjust }, UI.icon('sliders'), 'Quick Adjust')),
      els.chips,
      h('div.focus-row', h('span.label', 'Focus'), els.focusBtn),
      els.track, els.dots, els.hint,
      h('div.section-label', 'Summary'),
      els.table,
      h('div.section-label', 'Deep dives'),
      h('div.list', UI.explore.rows(f.id)),
      h('p.footer-note', 'Results are educational estimates, not financial advice.'));
    requestAnimationFrame(() => { els.track.scrollLeft = slide * els.track.clientWidth; paintDots(); });
    load();
  };

  function pickFocus() {
    const sel = selected();
    UI.sheet.open({
      title: 'Focus scenario',
      body: [h('p.tip-text.muted', { style: { marginTop: 0 } }, 'Single-scenario charts and the shaded range use this one. Quick Adjust edits it too.'),
        h('div.list', sel.map((s) => h('button.row', { onclick: () => { focusId = s.id; UI.sheet.close(); Cmp.render(); } },
          h('span.row-label', h('span.badge-diff', { style: { background: `var(--s${s.color})`, width: '10px', height: '10px' } }), h('span.txt', s.name)),
          h('span.row-value', s.id === focusId ? '✓' : ''))))],
    });
  }

  function onScroll() {
    const i = Math.round(els.track.scrollLeft / Math.max(1, els.track.clientWidth));
    if (i !== slide) { slide = i; paintDots(); ensureCharts(); }
  }
  function goSlide(i) {
    slide = i;
    els.track.scrollTo({ left: i * els.track.clientWidth, behavior: UI.reducedMotion() ? 'auto' : 'smooth' });
    paintDots(); ensureCharts();
  }
  function paintDots() { els.dots && els.dots.querySelectorAll('button').forEach((d, i) => d.classList.toggle('on', i === slide)); }

  // ------------------------------------------------------------------ data
  /** Fetch analyses (and the slower extras) for every selected scenario. */
  function load() {
    const my = ++building;
    const sel = selected();
    const jobs = sel.map((s) => {
      const e = entry(s.id);
      if (e.a) return Promise.resolve();
      if (s.id === store().state.active && RP.app.last && JSON.stringify(RP.app.last.plan) === JSON.stringify(RP.engine.resolvePlan(store().planFor(s.id)))) {
        e.a = RP.app.last; return Promise.resolve();
      }
      return RP.engineClient.analyze(store().planFor(s.id), {}, 'cmp-' + s.id).then((a) => { e.a = a; }).catch(() => {});
    });
    Promise.all(jobs).then(() => {
      if (my !== building) return;
      ensureCharts(true);
      renderTable();
      loadExtras(my);
    });
  }

  /** Safe spending and success-by-age, one scenario at a time in the background. */
  async function loadExtras(my) {
    for (const s of selected()) {
      if (my !== building) return;
      const e = entry(s.id);
      if (!e.safe) {
        try { const m = await RP.engineClient.metricsOn('cmp', store().planFor(s.id), ['safe'], null, 300); e.safe = m.safe; } catch (err) { return; }
        if (my !== building) return;
        refreshChart('safe'); renderTable();
      }
    }
    for (const s of selected()) {
      if (my !== building) return;
      const e = entry(s.id);
      if (!e.byAge) {
        try { e.byAge = await RP.engineClient.byAge(store().planFor(s.id), { runs: 200 }); } catch (err) { return; }
        if (my !== building) return;
        refreshChart('byAge');
      }
    }
  }

  Cmp.invalidate = function () {
    // Cached results are keyed by the full plan, so old ones simply stop matching.
    if (cache.size > 40) cache.clear();
    if (RP.app.tab() === 'compare' && root) { building++; setTimeout(() => Cmp.render(), 0); }
  };
  Cmp.onActiveResult = function () { /* the active scenario's result is reused in load() */ };

  function series() {
    return selected().map((sc) => { const e = entry(sc.id); return { sc, a: e.a, m: { safe: e.safe }, byAge: e.byAge }; }).filter((x) => x.a);
  }

  // ------------------------------------------------------------------ charts
  function markersFor(a) {
    const S = a.schedule, P = a.plan;
    const m = [{ x: S.retireYear, label: 'Retire', color: C.css('--accent'), row: 0 }];
    const u1 = S.unlock.p1, u2 = S.unlock.p2;
    const unlock1 = u1.rule55Year != null ? Math.min(u1.rule55Year, u1.year59) : u1.year59;
    m.push({ x: unlock1, label: `${P.people.p1.name} 401k`, color: C.css('--faint'), row: 1 });
    m.push({ x: u2.year59, label: '59½', color: C.css('--faint'), row: 2 });
    m.push({ x: u1.medicareYear, label: 'Medicare', color: C.css('--faint'), row: 0 });
    m.push({ x: S.ssDetail.p1.claimYear, label: 'SS', color: C.css('--faint'), row: 1 });
    const alerts = UI.insights.alerts(a, null).filter((x) => x.level !== 'info');
    const seen = new Set();
    for (const al of alerts) for (const y of al.years.slice(0, 6)) {
      if (seen.has(y)) continue; seen.add(y);
      m.push({ x: y, color: al.level === 'bad' ? C.css('--bad') : C.css('--warn') });
    }
    return m;
  }

  function ensureCharts(force) {
    for (let k = 0; k < CARDS.length; k++) {
      if (Math.abs(k - slide) <= 1 || force === 'all') build(CARDS[k], force);
    }
  }
  function refreshChart(key) { const c = CARDS.find((x) => x.key === key); if (c && Math.abs(CARDS.indexOf(c) - slide) <= 1) build(c, true); else if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

  function build(card, force) {
    const el = els[card.key];
    if (!el) return;
    if (charts[card.key] && !force) return;
    const ser = series();
    const f = focus();
    const fe = entry(f.id);
    if (!fe.a || !ser.length) { el.status.textContent = 'Calculating…'; return; }
    if (card.needs === 'safe' && !ser.some((s) => s.m.safe)) { el.status.textContent = 'Calculating safe spending…'; }
    else if (card.needs === 'byAge' && !ser.some((s) => s.byAge)) { el.status.textContent = 'Testing each retirement age…'; }
    else el.status.textContent = '';
    const inp = {
      series: ser, focus: { sc: f, a: fe.a }, markers: markersFor(fe.a),
      onClick: (evt, elements, chart) => onChartTap(card, evt, elements, chart),
    };
    let cfg;
    try { cfg = C.builders[card.build](inp); } catch (e) { console.error(e); el.status.textContent = 'Couldn’t draw this chart.'; return; }
    if (charts[card.key]) charts[card.key].destroy();
    charts[card.key] = new Chart(el.canvas.getContext('2d'), cfg);
    // Legend: scenario names for multi-scenario charts, categories otherwise.
    const items = cfg.legend || (card.multi ? ser.map((s) => ({ label: s.sc.name, color: C.scenarioColor(s.sc.color) })) : []);
    if (card.key === 'balance' && fe.a.mc) items.push({ label: '10th–90th percentile', color: C.alpha(C.scenarioColor(f.color), 0.35), band: true });
    UI.mount(el.legend, (card.multi && ser.length < 2 && !cfg.legend && card.key !== 'balance') ? [] : items.map((it) =>
      h('span.lg', h('span.sw' + (it.dashed ? '.dash' : '') + (it.band ? '.band' : ''), { style: { background: it.dashed ? 'transparent' : it.color, borderColor: it.color } }), it.label)));
    el.sub.textContent = card.sub(f.name);
  }

  function onChartTap(card, evt, elements, chart) {
    if (card.bars) {
      // Tapping a bar makes that scenario the focus.
      if (elements && elements.length) {
        const s = series()[elements[0].index];
        if (s) { focusId = s.sc.id; Cmp.render(); UI.toast(`Focus: ${s.sc.name}`); }
      }
      return;
    }
    if (card.key === 'byAge') {
      const age = Math.round(chart.scales.x.getValueForPixel(evt.x));
      const pts = series().map((s) => {
        const p = s.byAge && s.byAge.find((q) => q.age === age);
        return p ? h('div.row', h('span.row-label', h('span.badge-diff', { style: { background: C.scenarioColor(s.sc.color) } }), h('span.txt', s.sc.name)), h('span.row-value', fmt.pct(p.success))) : null;
      });
      UI.sheet.open({ title: `Retire at ${age}`, body: h('div.list', pts) });
      return;
    }
    const year = Math.round(chart.scales.x.getValueForPixel(evt.x));
    Cmp.showYear(entry(focus().id).a, year, focus());
  }

  /** Bottom sheet with everything about one year of one scenario. */
  Cmp.showYear = function (a, year, sc) {
    if (!a) return;
    const r = a.rows.find((x) => x.year === year);
    if (!r) return;
    const P = a.plan;
    const line = (label, v, opts) => (Math.abs(v) < 1 && !(opts && opts.always) ? null :
      h('div.row.sub', h('span.row-label', h('span.txt', label)), h('span.row-value' + (opts && opts.strong ? '.strong' : ''), fmt.money(v, { full: true }))));
    const inMN = P.household.state === 'MN' && !(P.housing.move.enabled && year >= P.housing.move.year);
    const statusName = fmt.coverage(r.health.status);
    const inn = [
      line('Paychecks & severance', r.income.wages), line('Part-time work', r.income.partTime), line('Social Security', r.income.ss),
      line('Unemployment', r.income.ui), line('Disability benefit', r.income.disability), line('Windfalls', r.income.windfall),
      line('Cash & brokerage', r.src.cash), line('Roth contributions', r.src.rothBasis), line('Roth conversions (5+ yrs old)', r.src.rothConversions),
      line('Roth growth', r.src.rothEarnings), line('401k / IRA (no penalty)', r.src.preTax), line('HSA', r.src.hsa),
      line('Penalty withdrawals', r.src.penalty),
    ];
    const out = [
      line('Everyday spending', r.spending.core), line('Daycare', r.spending.daycare), line('Extra health costs', r.spending.health),
      line('College', r.spending.college), line('Extras (cars, events…)', r.spending.extras), line('Mortgage change', r.spending.mortgageAdj),
      line('Federal tax', r.taxes.federal), line(inMN ? 'Minnesota tax' : 'State tax', r.taxes.state), line('Payroll tax', r.taxes.fica), line('Penalties', r.taxes.penalty),
      line('Saved to retirement accounts', r.saving.pre401k + r.saving.match + r.saving.hsa + r.saving.rothIra + r.saving.mega),
      line('Saved to brokerage', r.saving.taxable + r.saving.leftover),
    ];
    const capTxt = r.health.lines && ['mncare', 'aca'].includes(r.capKind)
      ? `${fmt.money(r.magi)} of the ${fmt.money(r.capKind === 'mncare' ? r.health.lines.mncare : r.health.lines.aca)} ${r.capKind === 'mncare' ? 'MinnesotaCare' : 'ACA'} line`
      : fmt.money(r.magi);
    // Step through the years without closing the sheet
    const first = a.rows[0].year, last = a.rows[a.rows.length - 1].year;
    const step = (d, label) => h('button.btn.small' + (d < 0 ? '.yr-prev' : '.yr-next'), { disabled: year + d < first || year + d > last, onclick: () => Cmp.showYear(a, year + d, sc), 'aria-label': `${label}: ${year + d}` },
      d < 0 ? [UI.icon('chevron', 'flip'), String(year + d)] : [String(year + d), UI.icon('chevron')]);
    UI.sheet.open({
      title: `${year}`,
      body: [
        h('div.yr-nav', step(-1, 'Previous year'), step(1, 'Next year')),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } },
          h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name),
          h('span.pill', `${P.people.p1.name} ${r.ages.p1}${r.alive.p1 ? '' : ' †'} · ${P.people.p2.name} ${r.ages.p2}${r.alive.p2 ? '' : ' †'}`),
          h('span.pill' + (r.working ? '' : '.accent'), r.working ? 'Working' : 'Retired'),
          h('span.pill', statusName)),
        h('div.subhead', { style: { padding: '8px 2px 4px' } }, 'Where the money went'),
        h('div.card.flow-card', UI.flow.diagram(r, P), h('div.flow-axis', h('span', 'In'), h('span', 'Out'))),
        h('div.subhead', { style: { padding: '8px 2px 4px' } }, 'Money in'), h('div.list', inn),
        h('div.subhead', { style: { padding: '8px 2px 4px' } }, 'Money out'), h('div.list', out),
        h('div.subhead', { style: { padding: '8px 2px 4px' } }, 'Income & conversions'),
        h('div.list',
          h('div.row.sub', h('span.row-label', h('span.txt', 'MAGI'), UI.tipButton('magi')), h('span.row-value', fmt.money(r.magi, { full: true }))),
          ['mncare', 'aca'].includes(r.capKind) ? h('div.row-note', { style: { paddingTop: '0', marginTop: '0' } }, capTxt) : null,
          line('Roth conversions this year', r.converted, { always: true })),
        h('div.subhead', { style: { padding: '8px 2px 4px' } }, 'Balances at year end'),
        h('div.list', line('Pre-tax 401k/IRA', r.balances.preTax, { always: true }), line('Roth', r.balances.roth, { always: true }),
          line('HSA', r.balances.hsa, { always: true }), line('Cash & taxable', r.balances.taxable, { always: true }),
          line('Total savings', r.balances.total, { always: true, strong: true })),
      ],
    });
  };

  /** Year-by-year table: where each dollar comes from, for the focus scenario. */
  function yearTable() {
    const f = focus(); const a = entry(f.id).a;
    if (!a) return;
    const k = (v) => (Math.abs(v) < 500 ? '–' : fmt.money(v));
    const cols = [
      ['Year', (r) => String(r.year)], ['Ages', (r) => `${r.ages.p1}/${r.ages.p2}`],
      ['Paychecks', (r) => k(r.income.wages)], ['Part-time', (r) => k(r.income.partTime)], ['Soc. Sec.', (r) => k(r.income.ss)],
      ['Cash & brok.', (r) => k(r.src.cash)], ['Roth', (r) => k(r.src.rothBasis + r.src.rothConversions + r.src.rothEarnings)],
      ['401k/IRA', (r) => k(r.src.preTax)], ['HSA', (r) => k(r.src.hsa)], ['Penalty w/d', (r) => k(r.src.penalty)],
      ['Converted', (r) => k(r.converted)], ['MAGI', (r) => k(r.magi)], ['Taxes', (r) => k(r.taxes.federal + r.taxes.state + r.taxes.fica)],
      ['Penalties', (r) => k(r.taxes.penalty)], ['Savings', (r) => fmt.money(r.balances.total)],
    ];
    UI.sheet.open({
      title: 'Year by year',
      body: [h('div', { style: { marginBottom: '10px' } }, h('span.pill', { style: { color: `var(--s${f.color})` } }, f.name)),
        h('div.card.table-card', h('div.table-scroll', { style: { maxHeight: '62dvh', overflowY: 'auto' } }, h('table.sum-table.year-table',
          h('thead', h('tr', cols.map(([t]) => h('th', t)))),
          h('tbody', a.rows.map((r) => h('tr' + (r.year === a.schedule.retireYear ? '.hl' : ''), { onclick: () => Cmp.showYear(a, r.year, f) }, cols.map(([, fn]) => h('td', fn(r))))))))),
        h('p.tip-text.muted', { style: { fontSize: '13px' } }, 'Typical market path, today’s dollars. Tap a year for details.')],
      actions: [
        { label: 'Export .csv', onClick: () => RP.app.exportCsv(a, f.name) },
        { label: 'Done', primary: true, onClick: () => UI.sheet.close() },
      ],
    });
  }

  // ------------------------------------------------------------------ table
  function renderTable() {
    const ser = series();
    if (!ser.length) { UI.mount(els.table); return; }
    const head = ['Scenario', 'Success', 'Safe spend', 'At retirement', 'Penalties', 'MinnesotaCare through', 'At 70'];
    const rows = ser.map(({ sc, a, m }) => [
      h('span.tcell-name', h('span.badge-diff', { style: { background: C.scenarioColor(sc.color) } }), C.short(sc.name, 16)),
      fmt.pct(a.summary.successRate), m.safe ? fmt.money(m.safe.amount) : '…', fmt.money(a.summary.balanceAtRetirement),
      fmt.money(a.summary.totalPenalties), a.summary.lastMnCareYear ? String(a.summary.lastMnCareYear) : '—', fmt.money(a.summary.balanceAt70),
    ]);
    UI.mount(els.table, h('div.card.table-card', h('div.table-scroll', h('table.sum-table',
      h('thead', h('tr', head.map((t) => h('th', t)))),
      h('tbody', rows.map((r, i) => h('tr', { onclick: () => { focusId = ser[i].sc.id; Cmp.render(); } }, r.map((c) => h('td', c)))))))));
  }

  // ------------------------------------------------------------------ share
  async function share(key) {
    const ch = charts[key];
    const card = CARDS.find((c) => c.key === key);
    if (!ch) { UI.toast('Chart is still loading'); return; }
    const scale = 2, W = 390 * scale, pad = 22 * scale;
    const src = ch.canvas;
    const chartH = (src.height / src.width) * (W - pad * 2);
    const H = Math.round(pad * 2 + 70 * scale + chartH + 40 * scale);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = C.css('--card'); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = C.css('--fg'); ctx.font = `600 ${18 * scale}px ${C.css('--font')}`;
    ctx.fillText(card.title, pad, pad + 18 * scale);
    ctx.fillStyle = C.css('--muted'); ctx.font = `${12 * scale}px ${C.css('--font')}`;
    ctx.fillText(els[key].sub.textContent, pad, pad + 40 * scale);
    ctx.drawImage(src, pad, pad + 56 * scale, W - pad * 2, chartH);
    ctx.font = `${11 * scale}px ${C.css('--font')}`;
    ctx.fillText('Educational estimate, not financial advice · ' + new Date().toLocaleDateString(), pad, H - pad / 1.5);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    const how = await RP.app.saveFile(blob, `${key}-${new Date().toISOString().slice(0, 10)}.png`, card.title);
    if (how === 'downloaded') UI.toast('Snapshot saved');
  }

  // ------------------------------------------------------------------ quick adjust
  /** One compact slider row: label + live value + slider. */
  function sliderRow({ label, value, min, max, step, format, onChange, tip }) {
    // Widen the range to fit the current value, so a nudge never clamps it.
    min = Math.min(min, value); max = Math.max(max, value);
    const val = h('span.qa-val', format(value));
    const s = h('input.slider', { type: 'range', min, max, step: step || 1, value, 'aria-label': label });
    const paint = () => s.style.setProperty('--fill', ((s.value - min) / (max - min)) * 100 + '%');
    const commit = UI.debounce((v) => onChange(v), 120);
    s.addEventListener('input', () => { paint(); val.textContent = format(Number(s.value)); commit(Number(s.value)); });
    paint();
    return h('div.qa-row', h('div.qa-top', h('span.qa-label', label, tip ? UI.tipButton(tip) : null), val), s);
  }

  Cmp.quickAdjust = function () {
    const f = focus();
    const id = f.id;
    const P = store().planFor(id);
    const set = (path, v) => store().set(path, v, { scenario: id });
    const yr = (v) => String(v);
    const thisYear = new Date().getFullYear();
    const body = h('div');
    const draw = () => {
      const Q = store().planFor(id);
      const n1 = Q.people.p1.name, n2 = Q.people.p2.name;
      const spend = Q.spending.retirement;
      UI.mount(body,
        h('div', { style: { marginBottom: '6px' } },
          h('span.pill', { style: { color: `var(--s${f.color})` } }, f.name),
          h('div.value-sub', f.id === 'base' ? 'Baseline: changes flow into the other scenarios.' : 'Changes apply only to this scenario.')),
        sliderRow({ label: `${n1} retires at`, value: Q.retirement.p1Age, min: 45, max: 65, format: yr, tip: 'retireAge', onChange: (v) => set('retirement.p1Age', v) }),
        UI.toggleRow({ label: 'Retire together', checked: Q.retirement.together, tip: 'together', onChange: (on) => {
          if (!on) set('retirement.p2Age', Q.people.p1.birthYear + Q.retirement.p1Age - Q.people.p2.birthYear);
          set('retirement.together', on); setTimeout(draw, 50);
        } }),
        !Q.retirement.together ? sliderRow({ label: `${n2} retires at`, value: Q.retirement.p2Age, min: 40, max: 65, format: yr, onChange: (v) => set('retirement.p2Age', v) }) : null,
        UI.toggleRow({ label: `${n1} job loss`, checked: Q.jobLoss.p1.enabled, tip: 'jobLoss', onChange: (on) => { set('jobLoss.p1.enabled', on); setTimeout(draw, 50); } }),
        Q.jobLoss.p1.enabled ? sliderRow({ label: 'Year', value: Q.jobLoss.p1.year, min: thisYear, max: thisYear + 19, format: yr, onChange: (v) => set('jobLoss.p1.year', v) }) : null,
        UI.toggleRow({ label: `${n2} job loss`, checked: Q.jobLoss.p2.enabled, onChange: (on) => { set('jobLoss.p2.enabled', on); setTimeout(draw, 50); } }),
        Q.jobLoss.p2.enabled ? sliderRow({ label: 'Year', value: Q.jobLoss.p2.year, min: thisYear, max: thisYear + 19, format: yr, onChange: (v) => set('jobLoss.p2.year', v) }) : null,
        sliderRow({ label: 'Retirement spending', value: spend, min: Math.min(60000, Math.floor((spend * 0.7) / 5000) * 5000), max: Math.max(120000, Math.ceil((spend * 1.4) / 5000) * 5000), step: 1000, format: (v) => fmt.money(v), tip: 'safeSpend', onChange: (v) => set('spending.retirement', v) }),
        sliderRow({ label: 'Return while working', value: Q.returns.working, min: 2, max: 8, step: 0.25, format: (v) => v.toFixed(2).replace(/0$/, '') + '%', tip: 'returns', onChange: (v) => set('returns.working', v) }),
        sliderRow({ label: 'Return in retirement', value: Q.returns.retired, min: 2, max: 8, step: 0.25, format: (v) => v.toFixed(2).replace(/0$/, '') + '%', onChange: (v) => set('returns.retired', v) }),
        h('div.qa-row', h('div.qa-top', h('span.qa-label', 'Roth conversions', UI.tipButton('conversions'))),
          UI.segmented({ options: [{ value: 'healthCap', label: 'Health cap' }, { value: 'bracket', label: 'Bracket' }, { value: 'fixed', label: 'Fixed' }, { value: 'none', label: 'None' }], value: Q.conversions.strategy, onChange: (v) => set('conversions.strategy', v) })),
        UI.toggleRow({ label: '72(t) payments', checked: Q.sepp.enabled, tip: 'sepp', onChange: (on) => set('sepp.enabled', on) }),
        sliderRow({ label: `${n1} claims Social Security at`, value: Q.ss.p1.claimAge, min: 62, max: 70, format: yr, tip: 'ssClaim', onChange: (v) => set('ss.p1.claimAge', v) }),
        sliderRow({ label: `${n2} claims at`, value: Q.ss.p2.claimAge, min: 62, max: 70, format: yr, onChange: (v) => set('ss.p2.claimAge', v) }),
        sliderRow({ label: 'Social Security haircut', value: Q.ss.haircutPct, min: 0, max: 50, format: (v) => v + '%', tip: 'ssHaircut', onChange: (v) => set('ss.haircutPct', v) }));
    };
    void P;
    draw();
    UI.sheet.open({
      title: 'Quick Adjust', body,
      actions: [
        f.id !== 'base'
          ? { label: f.preset ? 'Reset scenario' : 'Match Baseline', onClick: () => { store().resetScenario(id); draw(); UI.toast(f.preset ? 'Reset to preset' : 'Matches Baseline'); } }
          : { label: 'Undo', onClick: () => { store().undo(); draw(); } },
        { label: 'Done', primary: true, onClick: () => UI.sheet.close() },
      ],
    });
  };

  // Redraw charts if the phone switches between light and dark.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      C.applyTheme();
      for (const k of Object.keys(charts)) { charts[k].destroy(); delete charts[k]; }
      if (RP.app.tab() === 'compare') Cmp.render();
    });
  }
})(globalThis.RP = globalThis.RP || {});
