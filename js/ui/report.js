/*
 * report.js — the printable plan report: one or two pages you can print or
 * save as a PDF to share with a spouse or advisor.
 *
 *   UI.report.build(analysis, metrics)   the report as a DOM node (div.rpt)
 *   UI.report.open()                     preview it in a sheet, with Print / Save as PDF
 *
 * It's a document, not a screen: white paper and dark ink in fixed colors that
 * ignore the app theme. Everything is assembled from builders that already
 * exist (insights, paycheck phases, the playbook, the plan score) so the
 * numbers always match the app. The chart is inline SVG so it prints crisply.
 * Printing copies the node into #print-root; the print CSS hides the rest of
 * the page (see "9. Print: the plan report" in app.css).
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const R = (UI.report = {});
  const NS = 'http://www.w3.org/2000/svg';
  const money = (v) => fmt.money(Math.round(v / 100) * 100);
  const sum = (o, keys) => keys.reduce((t, k) => t + (o[k] || 0), 0);

  function svg(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  /** A short dollar label for the chart's y axis: $1.2M, $850k. */
  const axisMoney = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M' : v >= 1e3 ? '$' + Math.round(v / 1e3) + 'k' : '$' + Math.round(v));

  /** The savings projection: the 10th–90th percentile band, the typical path, a marker at retirement. */
  function chart(a) {
    const rows = a.rows, bands = a.mc && a.mc.bands;
    const W = 640, H = 230, L = 46, Rt = 10, T = 12, B = 24;
    const typ = rows.map((r) => r.balances.total);
    const hi = bands && bands.p90 ? bands.p90 : typ, lo = bands && bands.p10 ? bands.p10 : typ;
    // Cap the top so a huge good-market path doesn't flatten the typical line.
    const cap = Math.max(1, Math.min(Math.max(...hi), Math.max(...typ) * 2));
    const mag = Math.pow(10, Math.floor(Math.log10(cap)));
    const top = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].map((m) => m * mag).find((v) => v >= cap) || cap;
    const n = rows.length;
    const x = (i) => L + (n < 2 ? 0 : (i / (n - 1)) * (W - L - Rt));
    const y = (v) => T + (1 - Math.min(Math.max(v, 0), top) / top) * (H - T - B);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'rpt-chart', role: 'img', 'aria-label': 'Projected savings by year: the typical path and the range from poor to good markets' });
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4;
      s.appendChild(svg('line', { x1: L, x2: W - Rt, y1: y(v), y2: y(v), stroke: '#d9dce3', 'stroke-width': 1 }));
      s.appendChild(svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#555b6b' }, axisMoney(v)));
    }
    const pts = (arr) => arr.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    s.appendChild(svg('polygon', { points: [...pts(hi), ...pts(lo).reverse()].join(' '), fill: '#c9d6f5', stroke: 'none' }));
    const ri = rows.findIndex((r) => r.year === a.schedule.retireYear);
    if (ri > 0) {
      const flip = ri > n * 0.7;
      s.appendChild(svg('line', { x1: x(ri), x2: x(ri), y1: T, y2: H - B, stroke: '#b4471f', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      s.appendChild(svg('text', { x: x(ri) + (flip ? -5 : 5), y: T + 10, 'text-anchor': flip ? 'end' : 'start', 'font-size': 11, fill: '#b4471f' }, `Retire ${rows[ri].year}`));
    }
    s.appendChild(svg('polyline', { points: pts(typ).join(' '), fill: 'none', stroke: '#1d3f9e', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    const step = Math.max(1, Math.ceil(n / 6));
    for (let i = 0; i < n - 1; i += step) {
      if (n - 1 - i < step * 0.6) continue; // don't crowd the last label
      s.appendChild(svg('text', { x: x(i), y: H - 7, 'text-anchor': i === 0 ? 'start' : 'middle', 'font-size': 11, fill: '#555b6b' }, rows[i].year));
    }
    s.appendChild(svg('text', { x: x(n - 1), y: H - 7, 'text-anchor': 'end', 'font-size': 11, fill: '#555b6b' }, rows[n - 1].year));
    return s;
  }

  const stat = (label, value, sub) => h('div.rpt-stat', h('div.rpt-stat-l', label), h('div.rpt-stat-v', value), sub ? h('div.rpt-stat-s', sub) : null);
  const section = (title, ...kids) => h('section.rpt-sec', h('h2', title), ...kids);
  const spendOf = (r) => r.spending.core + r.spending.medicalGrowth + r.spending.mortgageAdj + r.spending.extras + r.spending.health + r.spending.daycare + r.spending.college;

  R.build = function (a, metrics) {
    metrics = metrics || {};
    const P = a.plan, S = a.schedule, sm = a.summary, rows = a.rows;
    const sc = RP.store.scenario();
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const age1 = S.retireYear - 1 - P.people.p1.birthYear, age2 = S.retireYear - 1 - P.people.p2.birthYear;
    const retired = S.retireYear <= S.y0;
    const safe = metrics.safe;
    const score = safe ? RP.engine.planScore(a, safe) : null;
    const today = new Date().toISOString().slice(0, 10);

    // ---- header and headline numbers
    const head = h('header.rpt-head',
      h('div', h('h1', 'Retirement plan'), h('div.rpt-names', `${n1} & ${n2}`)),
      h('div.rpt-meta', h('div', sc.name), h('div', fmt.date(today)), h('div', `Balances as of ${fmt.date(P.balances.asOf)}`)));
    const stats = h('div.rpt-stats',
      stat(retired ? 'Retired since' : 'Retire', retired ? String(S.retireYear) : `${n1} ${age1}`, retired ? '' : `${S.retireYear}, ${n2} ${age2}`),
      stat('Chance of success', sm.successRate != null ? fmt.pct(sm.successRate) : '—', `${a.mc.runs.toLocaleString()} market scenarios`),
      stat('Safe spending', safe ? fmt.safe(safe) : 'Calculating…', safe ? 'a year' : ''),
      stat('Savings today', money(sm.portfolioToday != null ? sm.portfolioToday : sm.netWorthToday)),
      stat('At retirement', sm.balanceAtRetirement ? money(sm.balanceAtRetirement) : '—', retired ? '' : `in ${S.retireYear}`),
      score ? stat('Plan score', `${score.score} · ${score.grade}`, 'out of 100') : null);

    // ---- chart
    const chartSec = section('Where your savings are headed',
      h('div.rpt-chartbox', chart(a)),
      h('div.rpt-legend', h('span', h('i.rpt-key.line'), 'Typical market'), h('span', h('i.rpt-key.band'), 'Poor to good markets (10th to 90th percentile)')));

    const para = h('p');
    para.innerHTML = UI.insights.summary(a, metrics); // names are escaped by the builder
    const brief = section('Your plan in brief', para);

    // ---- assumptions
    const Rt = P.returns, hz = P.household;
    const claim = (p) => `${P.people[p].name} ${P.ss[p].claimAge}`;
    const A = Rt.allocation;
    // How returns are set: replayed history, a stock/bond mix, or one number for working years and one for retirement.
    const returns = Rt.source === 'historical' ? ['Returns', `Real market history, ${A.stocks}% stocks`]
      : A.enabled ? ['Returns above inflation', `Stocks ${A.stockReturn}%, bonds ${A.bondReturn}% (${A.stocks}% stocks)`]
        : ['Returns, working / retired', `${Rt.working}% / ${Rt.retired}% above inflation`];
    const kv = [
      ['Spending in retirement', `${money(P.spending.retirement)} a year`],
      ['Spending while working', `${money(P.spending.working)} a year`],
      returns,
      Rt.source === 'historical' ? null : ['Market ups and downs', `${A.enabled ? A.stockVol : Rt.volatility}% a year${A.enabled ? ' for stocks' : ''}`],
      ['Inflation assumption', `${Rt.inflation}%`],
      ['Social Security claims at', `${claim('p1')}, ${claim('p2')}`],
      ['Social Security cut', P.ss.haircutPct ? `${P.ss.haircutPct}% from ${P.ss.haircutYear}` : 'None'],
      ['Plan runs to', `${P.people[hz.horizonPerson].name} age ${hz.horizonAge}`],
      ['State income tax', hz.state === 'MN' ? 'Minnesota' : hz.stateTaxPct ? `${hz.stateTaxPct}% flat` : 'None'],
    ].filter(Boolean);
    const assume = section('Key assumptions', h('div.rpt-kv', kv.map(([k, v]) => h('div.rpt-kv-r', h('span.k', k), h('span.v', v)))));

    // ---- key dates
    const ms = UI.insights.milestones(a, metrics).filter((m) => !(retired && m.key === 'retired')); // (its age is meaningless once you're already retired)
    const dates = section('Key dates', h('ul.rpt-dates', ms.map((m) => h('li', h('b', String(m.year)), ' ' + m.title))));

    // ---- retirement paycheck (same math as the Home card)
    const ph = UI.paycheck.phases(a);
    const mo = (v) => fmt.money(v / 12, { full: true });
    const pay = ph.length ? section('Retirement paycheck',
      h('table.rpt-tbl', h('thead', h('tr', ['Phase', 'Spend a month', 'Tax a month', 'Mostly paid by'].map((t, i) => h('th' + (i === 1 || i === 2 ? '.n' : ''), t)))),
        h('tbody', ph.map((p) => {
          const r = p.row, { ins, outs } = UI.flow.items(r, P);
          const spend = outs.filter((o) => !['tax', 'pen'].includes(o.key) && !o.key.startsWith('save')).reduce((t, o) => t + o.value, 0);
          const tax = outs.filter((o) => o.key === 'tax' || o.key === 'pen').reduce((t, o) => t + o.value, 0);
          return h('tr', h('td', `${p.label}, ${r.year}`), h('td.n', mo(spend)), h('td.n', mo(tax)), h('td', ins.slice(0, 3).map((x) => `${x.label} ${mo(x.value)}`).join(', ')));
        })))) : null;

    // ---- playbook
    const py = UI.playbook.defaultYear(a), pb = py != null ? UI.playbook.build(a, py) : null;
    const play = pb && pb.groups.length ? section(`What to do in ${pb.year}`,
      pb.partial ? h('p.rpt-note', 'The plan picks up partway through this year, so amounts are full-year rates.') : null,
      pb.groups.map((g) => h('div.rpt-grp', h('h3', g.title),
        g.items.map((it) => h('div.rpt-item', h('div.rpt-item-h', h('span', it.title), it.value ? h('b', it.value) : null), it.detail ? h('div.rpt-detail', it.detail) : null))))) : null;
    if (play) play.classList.add('rpt-play');

    // ---- watch list
    const al = UI.insights.alerts(a, metrics);
    const watch = section('Watch list', al.length
      ? al.map((x) => h('div.rpt-alert.' + x.level, h('b', x.title), ' ' + x.text, x.fix ? h('div.rpt-detail', 'Next step: ' + x.fix) : null))
      : h('p', 'Nothing needs attention.'));

    // ---- year by year: every 5 years, plus the retirement year and the last
    const last = rows[rows.length - 1].year;
    const pick = rows.filter((r, i) => i === 0 || r.year === S.retireYear || r.year === last || (r.year - rows[0].year) % 5 === 0);
    const tbl = section('Year by year',
      h('table.rpt-tbl.rpt-years', h('thead', h('tr', ['Year', 'Ages', 'Income', 'Spending', 'Taxes', 'Withdrawals', 'Savings'].map((t, i) => h('th' + (i > 1 ? '.n' : ''), t)))),
        h('tbody', pick.map((r) => h('tr' + (r.year === S.retireYear ? '.hl' : ''),
          h('td', String(r.year)), h('td', `${r.ages.p1} · ${r.ages.p2}`),
          h('td.n', money(r.income.wages + r.income.partTime + r.income.ss + (r.income.windfall || 0) + (r.income.ui || 0) + (r.income.disability || 0))),
          h('td.n', money(spendOf(r))), h('td.n', money(sum(r.taxes, ['federal', 'state', 'fica', 'penalty']))),
          h('td.n', money(sum(r.src, ['cash', 'rothBasis', 'rothConversions', 'rothEarnings', 'preTax', 'hsa', 'penalty']))),
          h('td.n', money(r.balances.total)))))),
      h('p.rpt-note', 'Typical market, today’s dollars. Retirement year highlighted. Withdrawals are money taken out of savings that year.'));

    return h('div.rpt', head, stats, chartSec, brief,
      h('div.rpt-cols', assume, dates), pay, play, watch, tbl,
      h('footer.rpt-foot', 'Horizon · typical market unless noted · today’s dollars · an educational estimate, not financial advice.'));
  };

  // ---------------------------------------------------------------- printing
  let printTimer = 0;
  function cleanup() {
    clearTimeout(printTimer);
    const old = document.getElementById('print-root');
    if (old) old.remove();
    document.body.classList.remove('rpt-printing');
  }

  /** Copy the report into #print-root, open the print dialog, and clean up afterwards. */
  R.print = function (node) {
    cleanup();
    const root = h('div#print-root');
    root.appendChild(node.cloneNode(true));
    document.body.appendChild(root);
    document.body.classList.add('rpt-printing'); // the print CSS only hides the app while a report is being printed
    window.addEventListener('afterprint', cleanup, { once: true });
    printTimer = setTimeout(cleanup, 120000); // fallback: some browsers never fire afterprint
    window.print();
  };

  R.open = function () {
    const a = RP.app.last;
    if (!a) { UI.toast('Still calculating…'); return; }
    const node = R.build(a, RP.app.metrics);
    UI.sheet.open({
      title: 'Plan report',
      body: [h('div.rpt-preview', node), h('p.x-note', 'Print or save as PDF to share. Choose “Save as PDF” in the print dialog.')],
      actions: [{ label: 'Print or PDF', primary: true, onClick: () => R.print(node) }, { label: 'Done', onClick: () => UI.sheet.close() }],
    });
  };
})(globalThis.RP = globalThis.RP || {});
