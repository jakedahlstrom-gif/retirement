/*
 * progress.js — "Progress": are you ahead of or behind plan? Each annual
 * check-in saves where your savings stood and the path the plan expected from
 * there. This compares later check-ins (and your latest balances) with the
 * path from the first one, in that first check-in's dollars.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const PG = (UI.progress = {});

  /** A date as a fractional year (2027.5 = about July 1, 2027). */
  const yearOf = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return y + ((m || 1) - 1 + ((d || 1) - 1) / 31) / 12; };
  /** The expected path as points: the check-in itself, then Jan 1 of each later year. */
  const pathPoints = (e) => [{ x: yearOf(e.date), y: e.path[0][1] }].concat(e.path.slice(1).map(([yr, v]) => ({ x: yr, y: v })));
  function valueAt(pts, x) {
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      if (x >= p.x && x <= q.x) return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x || 1);
    }
    return null;
  }

  /** Everything the view needs, or null before the first tracked check-in. */
  PG.data = function () {
    const st = store().state;
    const tracked = st.history.filter((e) => e.path && e.portfolio != null);
    if (!tracked.length) return null;
    const base = tracked[0];
    const x0 = yearOf(base.date);
    const infl = (st.plan.returns.inflation || 0) / 100;
    const real = (v, x) => v / Math.pow(1 + infl, Math.max(0, x - x0)); // into the first check-in's dollars
    const actual = tracked.map((e) => ({ x: yearOf(e.date), date: e.date, raw: e.portfolio, label: `Check-in, ${fmt.date(e.date)}` }));
    // Balances updated since the last check-in count too.
    const P = RP.engine.resolvePlan(st.plan);
    const asOf = P.balances.asOf;
    if (yearOf(asOf) > actual[actual.length - 1].x + 1 / 365) actual.push({ x: yearOf(asOf), date: asOf, raw: RP.engine.portfolio(RP.engine.initState(P)), label: `Balances, ${fmt.date(asOf)}` });
    for (const p of actual) p.y = real(p.raw, p.x);
    const expAll = pathPoints(base);
    const last = actual[actual.length - 1];
    const expected = expAll.filter((p) => p.x <= Math.max(last.x + 2, x0 + 3));
    const want = valueAt(expAll, last.x);
    return { base, actual, expected, last, want, diff: want == null ? null : last.y - want };
  };

  PG.open = function () {
    const st = store().state;
    const d = PG.data();
    const table = st.history.length ? h('div.card.table-card', h('div.table-scroll', h('table.sum-table',
      h('thead', h('tr', ['Check-in', 'Savings', 'Net worth', 'Success', 'Safe spend'].map((t) => h('th', t)))),
      h('tbody', st.history.slice().reverse().map((e) => h('tr',
        h('td', fmt.date(e.date)), h('td', e.portfolio != null ? fmt.money(e.portfolio) : '—'), h('td', fmt.money(e.summary.netWorth)),
        h('td', fmt.pct(e.summary.success)), h('td', e.summary.safe ? fmt.money(e.summary.safe) : '—'))))))) : null;

    if (!d) {
      UI.sheet.open({
        title: 'Progress',
        body: [
          h('p.tip-text', 'Each annual check-in records where your savings stand and the path your plan expects from there. From the next one on, you’ll see whether you’re ahead of or behind plan.'),
          table ? h('p.tip-text.muted', { style: { fontSize: '14px' } }, 'Earlier check-ins (below) were saved before tracking started, so they can’t be charted.') : null,
          table,
        ],
        actions: [{ label: 'Start a check-in', primary: true, onClick: () => UI.checkin.start() }],
      });
      return;
    }

    const only = d.actual.length < 2;
    const ahead = d.diff != null && d.diff >= 0;
    const since = fmt.date(d.base.date);
    const canvas = h('canvas', { role: 'img', 'aria-label': 'Your savings at each check-in against the path your first tracked plan expected' });
    let chart = null;
    UI.sheet.open({
      title: 'Progress',
      onClose: () => { if (chart) chart.destroy(); },
      body: [
        only
          ? h('div.pg-hero', h('div.value-md', 'Starting point set'), h('div.value-sub', `${fmt.money(d.last.raw)} saved on ${since}. Your next check-in shows how you’re tracking.`))
          : h('div.pg-hero',
            h('div.value-lg' + (ahead ? '.value-pos' : '.value-neg'), (ahead ? '+' : '−') + fmt.money(Math.abs(d.diff))),
            h('div.value-sub', `${ahead ? 'Ahead of' : 'Behind'} what your ${since} plan expected for ${fmt.date(d.last.date)}`),
            h('div.value-sub', `Savings ${fmt.money(d.last.y)} vs. ${fmt.money(d.want)} expected (${ahead ? '+' : '−'}${Math.abs(Math.round((d.diff / d.want) * 100))}%)`)),
        h('div.x-chart', canvas),
        h('div.ss-legend', h('span.lg', h('i.x-sw', { style: { background: 'var(--pos)' } }), 'Your savings'), h('span.lg', h('i.pg-dash'), 'What the plan expected')),
        table ? h('div.subhead', { style: { padding: '14px 2px 6px' } }, 'Check-ins') : null,
        table,
        h('p.x-note', `Savings exclude home equity and 529s. Later amounts are adjusted for ${st.plan.returns.inflation}% inflation into ${since} dollars, so they compare fairly with the plan from then.`),
      ],
      actions: [{ label: 'New check-in', onClick: () => UI.checkin.start() }, { label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
    UI.charts.applyTheme();
    chart = new Chart(canvas.getContext('2d'), UI.charts.builders.progress({ expected: d.expected, actual: d.actual }));
  };
})(globalThis.RP = globalThis.RP || {});
