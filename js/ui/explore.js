/*
 * explore.js — the deep dives, each in its own sheet:
 *
 *   Social Security timing  every pair of claiming ages as a heat map; pick one to use it
 *   Roth conversions        strategies side by side: taxes, health costs, what's left
 *   Replay history          your retirement through every stretch of real markets since 1871
 *
 * Each works on one scenario: the one you're editing, or Compare's focus.
 * The math runs in the background worker (js/engine/explore.js).
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const X = (UI.explore = {});
  let token = 0;
  let cleanup = null; // tears down a chart when its sheet closes

  /** Open a sheet, run the explorer, then draw its result (unless another sheet replaced it). */
  function open(kind, title, scId, draw) {
    const my = ++token;
    const sc = store().scenario(scId);
    const pill = h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name);
    const body = h('div.x-body', h('div.x-head', pill), h('div.x-wait', h('span.busy-dot'), 'Calculating…'));
    UI.sheet.open({ title, body, onClose: () => {
      if (token === my) token++;
      if (cleanup) { cleanup(); cleanup = null; }
    } });
    RP.engineClient.explore(kind, store().planFor(sc.id)).then((res) => {
      if (token !== my) return;
      UI.mount(body, h('div.x-head', pill), draw(res, sc, store().planFor(sc.id)));
    }).catch((e) => {
      if (token !== my) return;
      if (e.message === 'cancelled') { UI.mount(body, h('div.x-head', pill), h('p.tip-text.muted', 'Your plan changed. Open this again to recalculate.')); return; }
      console.error(e);
      UI.mount(body, h('p.tip-text', 'Couldn’t calculate this one.'));
    });
  }
  const note = (text) => h('p.x-note', text);
  const stat = (label, value, cls) => h('div.x-stat', h('div.label', label), h('div.x-val' + (cls ? '.' + cls : ''), value));

  // ------------------------------------------------------------ Social Security
  X.socialSecurity = function (scId) {
    open('ss', 'Social Security timing', scId, (res, sc, P) => {
      const n1 = P.people.p1.name, n2 = P.people.p2.name;
      const cur = res.current;
      const delta = (c) => c.end - cur.end;
      const worst = Math.max(1, ...res.cells.map((c) => Math.abs(delta(c))));
      const detail = h('div.x-detail');
      let picked = res.best;
      const cellFor = (a1, a2) => res.cells.find((c) => c.p1 === a1 && c.p2 === a2);
      const grid = h('div.ss-grid', { style: { gridTemplateColumns: `auto repeat(${res.ages.p2.length}, minmax(0, 1fr))` }, role: 'grid', 'aria-label': 'Claiming ages' });
      const paint = () => {
        UI.mount(grid, h('span.ss-corner'), res.ages.p2.map((a) => h('span.ss-col', String(a))),
          res.ages.p1.map((a1) => [h('span.ss-row', String(a1)), res.ages.p2.map((a2) => {
            const c = cellFor(a1, a2), d = delta(c);
            const k = Math.min(1, Math.abs(d) / worst);
            const bg = c.failYear != null ? 'var(--bad-soft)' : d > 0 ? `color-mix(in srgb, var(--pos) ${Math.round(12 + k * 60)}%, transparent)` : d < 0 ? `color-mix(in srgb, var(--warn) ${Math.round(8 + k * 50)}%, transparent)` : 'var(--inset-2)';
            const mark = c === res.best ? '★' : c === cur ? '•' : '';
            return h('button.ss-cell' + (c === picked ? '.on' : ''), {
              type: 'button', style: { background: bg }, 'aria-label': `${n1} at ${a1}, ${n2} at ${a2}: ${d === 0 ? 'your current choice' : fmt.money(Math.abs(d)) + (d > 0 ? ' more' : ' less')} left at the end`,
              onclick: () => { picked = c; paint(); },
            }, mark);
          })]));
        const d = delta(picked);
        const succ = picked === cur ? `Chance of success: ${fmt.pct(res.success.current)}`
          : picked === res.best ? `Chance of success: ${fmt.pct(res.success.current)} with yours → ${fmt.pct(res.success.best)} with these` : null;
        UI.mount(detail,
          h('div.x-title', `${n1} at ${picked.p1} · ${n2} at ${picked.p2}`, picked === cur ? h('span.pill', 'Yours') : null, picked === res.best ? h('span.pill.accent', 'Most left') : null),
          h('div.x-stats',
            stat('Left at the end', picked.failYear != null ? `Short ${picked.failYear}` : fmt.money(picked.end), picked.failYear != null ? 'neg' : ''),
            stat('vs. yours', d === 0 ? '—' : (d > 0 ? '+' : '−') + fmt.money(Math.abs(d)), d > 0 ? 'pos' : d < 0 ? 'neg' : ''),
            stat('Lifetime benefits', fmt.money(picked.lifetime))),
          succ ? note(`${succ} (${res.runs} market histories).`) : null,
          picked === cur ? null : h('button.btn.primary.block', { style: { marginTop: '12px' }, onclick: () => {
            store().setMany({ 'ss.p1.claimAge': picked.p1, 'ss.p2.claimAge': picked.p2 }, { scenario: sc.id });
            UI.sheet.close();
            UI.toast(`Claiming at ${picked.p1} and ${picked.p2}`, 'Undo', () => store().undo());
          } }, `Use ${picked.p1} and ${picked.p2}`));
      };
      paint();
      const span = res.cells.reduce((m, c) => Math.max(m, delta(c)), 0) - res.cells.reduce((m, c) => Math.min(m, delta(c)), 0);
      return [
        note(`Every pair of claiming ages, on the typical market. Greener squares leave more money at the end of the plan (${P.people[res.horizonPerson].name} at ${res.horizonAge}) than your choice (•); ★ leaves the most. Tap any square.`),
        h('div.ss-axes', h('span', `${n1} claims at ↓`), h('span', `${n2} claims at →`)),
        grid,
        h('div.ss-legend', h('span', 'Less left'), h('span.ss-scale'), h('span', 'More left')),
        detail,
        note(`From best to worst choice is ${fmt.money(span)} by the end of the plan. Benefits are in today’s dollars after your ${P.ss.haircutPct}% haircut from ${P.ss.haircutYear}, with spousal and survivor benefits included. Waiting pays off more the longer you live.`),
      ];
    });
  };

  // ------------------------------------------------------------ Roth conversions
  const ROTH = {
    none: { label: 'No conversions', sub: 'Leave pre-tax money where it is' },
    until65: { label: 'Until Medicare', sub: 'Fill the health-program line, then stop at 65' },
    to12: { label: 'Then the 12% bracket', sub: 'Health-program line before 65, 12% bracket after' },
    to22: { label: 'Then the 22% bracket', sub: 'Health-program line before 65, 22% bracket after' },
    irmaa: { label: 'Then up to IRMAA', sub: 'As much as possible without Medicare surcharges' },
    yours: { label: 'Your current setting', sub: 'As set in Plan › Early access' },
  };
  X.roth = function (scId) {
    open('roth', 'Roth conversions', scId, (res, sc) => {
      const list = res.strategies;
      const cost = (s) => s.incomeTax + s.health + s.penalties;
      const mostLeft = list.slice().sort((a, b) => b.afterTaxEnd - a.afterTaxEnd)[0];
      const leastTax = list.slice().sort((a, b) => cost(a) - cost(b))[0];
      const yours = list.find((s) => s.current);
      const maxConv = Math.max(1, ...list.flatMap((s) => s.yearly.map((y) => y[1])));
      // Sparklines cover only the years any strategy converts, on one shared scale.
      const active = list.flatMap((s) => s.yearly.filter((y) => y[1] > 500).map((y) => y[0]));
      const y1 = Math.min(...active), y2 = Math.max(...active);
      const card = (s) => {
        const t = ROTH[s.key];
        const conv = s.yearly.filter((y) => y[1] > 500);
        const dLeft = s.afterTaxEnd - yours.afterTaxEnd;
        return h('div.card.x-card' + (s.current ? '.mine' : ''),
          h('div.x-title', t.label, s.current ? h('span.pill', 'Yours') : null, s === mostLeft ? h('span.pill.accent', 'Most left') : null, s === leastTax && s !== mostLeft ? h('span.pill.accent', 'Least tax') : null),
          h('div.x-sub', t.sub),
          h('div.x-stats',
            stat('Taxes & health', fmt.money(cost(s))),
            stat('Left after tax', s.failYear != null ? `Short ${s.failYear}` : fmt.money(s.afterTaxEnd), s.failYear != null ? 'neg' : dLeft > 0 ? 'pos' : ''),
            stat('Success', fmt.pct(s.success))),
          active.length ? h('div.x-spark', { 'aria-hidden': 'true' }, s.yearly.filter((y) => y[0] >= y1 && y[0] <= y2)
            .map((y) => h('span', { style: { height: (y[1] > 500 ? Math.max(6, (y[1] / maxConv) * 100) : 0) + '%' } }))) : null,
          h('div.x-sub', conv.length ? `Converts ${fmt.money(s.converted)} from ${conv[0][0]} to ${conv[conv.length - 1][0]}` : 'Converts nothing'),
          s.current ? null : h('button.btn.small.block', { style: { marginTop: '10px' }, onclick: () => {
            store().setMany(s.overrides, { scenario: sc.id });
            UI.sheet.close();
            UI.toast(`Roth conversions: ${t.label.toLowerCase()}`, 'Undo', () => store().undo());
          } }, 'Use this strategy'));
      };
      return [
        note('Each strategy on the typical market. Before 65, conversions always stay under your health-program income line, so coverage stays cheap; they differ mostly in what happens after Medicare.'),
        list.map(card),
        note(`“Taxes & health” adds up income taxes, penalties, extra health premiums and IRMAA over the whole plan. “Left after tax” is what’s left in ${res.endYear}, counting pre-tax money at ${Math.round((1 - RP.engine.HEIR_TAX) * 100)}% because heirs pay tax as they withdraw it. Success uses ${res.runs} market histories. Today’s dollars.`),
      ];
    });
  };

  // ------------------------------------------------------------ history
  const ERAS = [
    [1906, 'The Panic of 1907'], [1929, 'The Great Depression'], [1937, 'The 1937 recession'],
    [1966, 'Stagflation'], [1973, 'The 1973 oil shock'], [2000, 'The dot-com crash'], [2008, 'The 2008 crisis'],
  ];
  let histMode = 'matched';
  X.history = function (scId) {
    open('history', 'Replay history', scId, (res, sc, P) => {
      const wrap = h('div');
      let chart = null;
      const draw = () => {
        const R = res[histMode];
        const runs = R.runs;
        if (!runs.length) { UI.mount(wrap, note('Your plan is longer than the market history on hand, so it can’t be replayed.')); return; }
        const fails = runs.filter((r) => !r.success);
        const worst = runs.slice().sort((a, b) => (a.success === b.success ? (a.success ? a.end - b.end : a.failYear - b.failYear) : a.success ? 1 : -1))[0];
        const canvas = h('canvas', { role: 'img', 'aria-label': `Money left at the end for each historical start year; ${fails.length} of ${runs.length} run short` });
        const pct = R.successRate;
        UI.mount(wrap,
          UI.segmented({ options: [{ value: 'matched', label: 'At your returns' }, { value: 'actual', label: 'Actual returns' }], value: histMode, onChange: (v) => { histMode = v; draw(); } }),
          h('div.x-hero', h('div.value-lg' + (pct >= 0.9 ? '.value-pos' : pct < 0.75 ? '.value-neg' : ''), fmt.pct(pct)),
            h('div', h('div.x-title', `${runs.length - fails.length} of ${runs.length} retirements last`), h('div.x-sub', `Retiring in ${res.retireYear} into the markets of ${runs[0].start}–${runs[runs.length - 1].start}, ${res.span} years each`))),
          h('div.x-chart', canvas),
          h('div.ss-legend', h('span.lg', h('i.x-sw', { style: { background: 'var(--pos)' } }), 'Money left at the end'), h('span.lg', h('i.x-sw', { style: { background: 'var(--bad)' } }), 'Runs short')),
          h('div.subhead', { style: { padding: '14px 2px 4px' } }, 'Hard times'),
          h('div.list', ERAS.map(([y, name]) => {
            const r = runs.find((x) => x.start === y);
            if (!r) return null;
            return h('div.row.sub', h('span.row-label', h('span.txt', `${name} (${y})`)),
              h('span.row-value' + (r.success ? '' : '.x-bad'), r.success ? `${fmt.money(r.end)} left` : `Short ${r.failYear}`));
          }),
          worst && !ERAS.some(([y]) => y === worst.start) ? h('div.row.sub', h('span.row-label', h('span.txt', `Toughest start (${worst.start})`)),
            h('span.row-value' + (worst.success ? '' : '.x-bad'), worst.success ? `${fmt.money(worst.end)} left` : `Short ${worst.failYear}`)) : null),
          note(histMode === 'matched'
            ? `Each run keeps history’s real ups and downs in their real order, scaled so they average the ${fmt.num(res.planReturn * 100, 1)}% your plan assumes in retirement. This tests the order of returns, which is the big risk in early retirement.`
            : `Real returns of a ${res.stocksPct}/${100 - res.stocksPct} stock/bond mix. History has been kinder than your assumptions: ${fmt.num(res.histReturn * 100, 1)}% a year after inflation, vs. the ${fmt.num(res.planReturn * 100, 1)}% your plan assumes.`),
          note('Savings grow at your expected returns until you retire; from then on each run replays a different stretch of US history (S&P 500, 10-year Treasuries, 1871–2022). Only complete stretches are used.'));
        if (chart) chart.destroy();
        UI.charts.applyTheme();
        chart = new Chart(canvas.getContext('2d'), UI.charts.builders.history({ runs }));
        cleanup = () => chart.destroy();
      };
      draw();
      return wrap;
    });
  };

  /** The deep-dive rows, for Compare and the Plan tab. */
  X.rows = function (scId) {
    return [
      UI.row({ label: 'Social Security timing', value: 'Claiming ages', onClick: () => X.socialSecurity(scId) }),
      UI.row({ label: 'Roth conversions', value: 'Strategies', onClick: () => X.roth(scId) }),
      UI.row({ label: 'Replay history', value: 'Since 1871', onClick: () => X.history(scId) }),
    ];
  };
})(globalThis.RP = globalThis.RP || {});
