/*
 * timeline.js — the Timeline tab: your life phases from today to the end of
 * the plan (daycare → power savings → retire → bridge → 59½ → Medicare →
 * Social Security), everyone's ages at each step, life events, the Social
 * Security gap, and the Roth conversion ladder.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const TL = (UI.timeline = {});

  function agesAt(P, y) {
    const parts = [`${P.people.p1.name} ${y - P.people.p1.birthYear}`, `${P.people.p2.name} ${y - P.people.p2.birthYear}`];
    for (const k of P.kids || []) { const a = y - k.birthYear; if (a >= 0 && a <= 30) parts.push(`${k.name} ${a}`); }
    return parts.join(' · ');
  }

  /** Build the list of timeline events from an analysis. */
  TL.events = function (a) {
    const P = a.plan, S = a.schedule, rows = a.rows;
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const ev = [];
    const add = (year, title, text, kind, icon) => ev.push({ year, title, text, kind: kind || 'event', icon: icon || 'flag' });
    const now = S.y0;
    add(now, 'Today', `${fmt.money(a.summary.portfolioToday)} saved · net worth ${fmt.money(a.summary.netWorthToday)}`, 'now', 'target');

    const dcRows = rows.filter((r) => r.spending.daycare > 0);
    if (dcRows.length) add(dcRows[dcRows.length - 1].year + (P.spending.daycare.lastYearFraction < 1 ? 0 : 1), 'Daycare ends', 'Youngest starts kindergarten. Power savings begin.', 'milestone', 'sparkle');
    if (P.contributions.mega.enabled) add(P.contributions.mega.firstYear, 'Mega backdoor Roth starts', `${fmt.money(P.contributions.mega.amount)}/yr into ${P.people[P.contributions.mega.person].name}’s Roth 401k.`, 'event', 'piggy');
    for (const t of P.contributions.taxable || []) add(t.firstYear, 'Bridge-fund savings', `${fmt.money(t.amount)}/yr into the brokerage${t.lastYear ? ` through ${t.lastYear}` : ' until retirement'}.`, 'event', 'wallet');

    for (const pid of ['p1', 'p2']) {
      const jl = P.jobLoss[pid];
      if (jl.enabled) add(jl.year, `${P.people[pid].name} loses job (${fmt.monthName(jl.month)})`, `${fmt.money(jl.severance)} severance${jl.reemploy.enabled ? `, new job after ${jl.reemploy.afterMonths} months at ${fmt.money(jl.reemploy.salary)}` : ', no new job'}.`, 'warn', 'alert');
      const nj = P.income[pid].newJob;
      if (nj && nj.enabled) add(nj.year, `${P.people[pid].name} changes jobs`, `New salary ${fmt.money(nj.salary)}.`, 'event', 'briefcase');
      const pt = P.partTime[pid];
      if (pt.enabled) add(pt.firstYear, `${P.people[pid].name} works part-time`, `${fmt.money(pt.amount)}/yr through ${pt.lastYear}.`, 'event', 'briefcase');
    }
    if (P.disability.enabled) add(P.disability.year, `${P.people[P.disability.person].name} disabled`, `Paycheck stops; insurance pays ${P.disability.benefitPct}% of salary to age ${P.disability.untilAge}.`, 'warn', 'heart');

    const ry = S.retireYear;
    add(ry, 'Retire', `Full-time work ends after ${ry - 1}. ${fmt.money(a.summary.balanceAtRetirement)} saved in a typical market.`, 'big', 'sparkle');
    const ssStart = Math.min(S.ssDetail.p1.claimYear, S.ssDetail.p2.claimYear);
    if (ssStart > ry) add(ry, 'Social Security gap begins', `No Social Security until ${ssStart}: ${ssStart - ry} years funded by savings.`, 'gap', 'clock');

    const u1 = S.unlock.p1, u2 = S.unlock.p2;
    if (u1.rule55Year) add(u1.rule55Year, `${n1}’s 401k opens (Rule of 55)`, 'Penalty-free withdrawals from that employer’s 401k.', 'milestone', 'key');
    add(u1.year59, `${n1} reaches 59½`, `All of ${n1}’s retirement accounts are penalty-free.`, 'milestone', 'key');
    if (u2.rule55Year) add(u2.rule55Year, `${n2}’s 401k opens (Rule of 55)`, 'Penalty-free withdrawals from that employer’s 401k.', 'milestone', 'key');
    add(u2.year59, `${n2} reaches 59½`, `All of ${n2}’s retirement accounts are penalty-free.`, 'milestone', 'key');

    // Health coverage changes
    let prev = null;
    for (const r of rows) {
      if (r.year < ry) continue;
      const s = r.health.status;
      if (s !== prev && ['aca', 'aca-full'].includes(s) && prev && !['aca', 'aca-full'].includes(prev)) add(r.year, 'MinnesotaCare lost', `Income ${fmt.money(r.magi)} is over the line; coverage moves to MNsure.`, 'warn', 'medical');
      prev = s;
    }
    if (a.summary.lastMnCareYear) add(a.summary.lastMnCareYear, 'Last MinnesotaCare year', 'Health coverage through MinnesotaCare (or Medicare after 65).', 'event', 'medical');
    add(u1.medicareYear, `${n1} on Medicare`, 'Age 65.', 'milestone', 'medical');
    add(u2.medicareYear, `${n2} on Medicare`, 'Age 65.', 'milestone', 'medical');
    add(S.ssDetail.p1.claimYear, `${n1}’s Social Security`, `${fmt.money(S.ssDetail.p1.annualAtClaim)}/yr at ${P.ss.p1.claimAge} (after ${P.ss.haircutPct}% haircut).`, 'big', 'bank');
    add(S.ssDetail.p2.claimYear, `${n2}’s Social Security`, `${fmt.money(S.ssDetail.p2.annualAtClaim)}/yr at ${P.ss.p2.claimAge} (after ${P.ss.haircutPct}% haircut).`, 'big', 'bank');
    const rmd = rows.find((r) => r.from.rmd > 0);
    if (rmd) add(rmd.year, 'Required withdrawals begin', `About ${fmt.money(rmd.from.rmd)} that year.`, 'event', 'receipt');

    if (S.mortgagePayoffYear) add(S.mortgagePayoffYear + 1, 'Mortgage free', 'Principal & interest drop out of your spending.', 'milestone', 'house');
    if (P.housing.downsize.enabled) add(P.housing.downsize.year, 'Downsize', `Sell, buy a ${fmt.money(P.housing.downsize.newHomeCost)} home, and add the difference to savings.`, 'event', 'house');
    if (P.housing.move.enabled) add(P.housing.move.year, 'Move to another state', `State income tax ${P.housing.move.taxRatePct}%. MinnesotaCare no longer applies.`, 'event', 'house');
    if (P.college.enabled) (P.college.kids || []).forEach((c, i) => { const kid = (P.kids || [])[i]; if (c.enabled && kid) add(c.startYear, `${kid.name} starts college`, `Your share ${fmt.money(c.annualCost * c.coverPct / 100)}/yr for ${c.years} years (today’s $).`, 'event', 'cap'); });
    for (const o of P.spending.oneTime || []) add(o.year, o.label || 'One-time event', `${o.kind === 'expense' ? 'Cost' : 'Money in'}: ${fmt.money(o.amount)}.`, o.kind === 'expense' ? 'event' : 'milestone', o.kind === 'expense' ? 'cart' : 'piggy');
    if (P.death.enabled) add(P.death.year, `${P.people[P.death.person].name} passes away`, `Survivor benefits, single tax brackets, spending at ${P.death.spendingPct}%.`, 'warn', 'heart');
    if (a.summary.shortfallYear) add(a.summary.shortfallYear, 'Money runs short', 'In a typical market, savings run out this year.', 'bad', 'alert');
    add(S.yEnd, 'End of plan', `${P.people[P.household.horizonPerson].name} turns ${P.household.horizonAge}. ${fmt.money(rows[rows.length - 1].balances.total)} left in a typical market.`, 'now', 'flag');
    return ev.filter((e) => e.year >= now && e.year <= S.yEnd).sort((x, y) => x.year - y.year || order(x) - order(y));
  };
  const order = (e) => ({ now: 0, big: 1, gap: 2, milestone: 3, warn: 4, bad: 5, event: 6 }[e.kind] ?? 9);

  /** Horizontal phase bar: working → bridge (no SS) → Social Security. */
  function phaseBar(a) {
    const S = a.schedule;
    const y0 = S.y0, y1 = S.yEnd;
    const span = y1 - y0 + 1;
    const ssStart = Math.min(S.ssDetail.p1.claimYear, S.ssDetail.p2.claimYear);
    const dc = a.rows.filter((r) => r.spending.daycare > 0);
    const dcEnd = dc.length ? dc[dc.length - 1].year + 1 : y0;
    const segs = [
      { from: y0, to: dcEnd, label: 'Daycare', cls: 'p-dc' },
      { from: dcEnd, to: S.retireYear, label: 'Power savings', cls: 'p-work' },
      { from: S.retireYear, to: ssStart, label: 'Bridge · no SS', cls: 'p-gap' },
      { from: ssStart, to: y1 + 1, label: 'Social Security', cls: 'p-ss' },
    ].filter((s) => s.to > s.from);
    return h('div.card',
      h('div.card-title', h('span', 'Life phases'), h('span.grow'), h('span', `${y0}–${y1}`)),
      h('div.phasebar', segs.map((s) => h('div.phase.' + s.cls, { style: { flex: String(s.to - s.from) }, title: `${s.label} ${s.from}–${s.to - 1}` }))),
      h('div.phase-legend', segs.map((s) => h('div.pl', h('span.sw.' + s.cls), h('div', h('div.pl-t', s.label), h('div.pl-y', s.to - 1 > s.from ? `${s.from}–${s.to - 1}` : `${s.from}`))))),
      ssStart > S.retireYear ? h('div.gap-note', UI.icon('clock'), h('span', h('b', `${ssStart - S.retireYear}-year Social Security gap`), ` (${S.retireYear}–${ssStart - 1}). Savings carry everything until benefits start.`)) : null);
  }

  /** The Roth conversion ladder: each year's conversion and when it unlocks. */
  function ladder(a) {
    const rungs = a.rows.filter((r) => r.converted > 500).map((r) => ({ year: r.year, amount: r.converted }));
    if (!rungs.length) return null;
    const now = new Date().getFullYear();
    const max = Math.max(...rungs.map((r) => r.amount));
    const shown = rungs.slice(0, 10);
    const more = rungs.length - shown.length;
    return h('div.card',
      h('div.card-title', h('span', 'Roth conversion ladder'), UI.tipButton('rothLadder'), h('span.grow'), h('span', fmt.money(rungs.reduce((t, r) => t + r.amount, 0)) + ' total')),
      h('div.ladder', shown.map((r) => h('div.rung' + (r.year + 5 <= now ? '.aged' : ''),
        h('span.r-year', String(r.year)),
        h('span.r-bar', h('span', { style: { width: Math.max(4, (r.amount / max) * 100) + '%' } })),
        h('span.r-amt', fmt.money(r.amount)),
        h('span.r-open', '→ ' + (r.year + 5))))),
      more > 0 ? h('div.value-sub', `+ ${more} more years of conversions (${rungs[10].year}–${rungs[rungs.length - 1].year})`) : null,
      h('div.value-sub', 'Each conversion can be spent penalty-free 5 years later (or any time after 59½).'));
  }

  TL.render = function (root, a) {
    if (!root) return;
    if (!a) { UI.mount(root, h('h1.large-title', 'Timeline'), h('div.card', h('p.muted', 'Calculating…'))); return; }
    const P = a.plan;
    const sc = store().scenario();
    const events = TL.events(a);
    const list = h('div.tl');
    let lastYear = null;
    for (const e of events) {
      const showYear = e.year !== lastYear;
      lastYear = e.year;
      list.appendChild(h('div.tl-item.' + e.kind + (showYear ? '' : '.same'),
        h('div.tl-year', showYear ? String(e.year) : ''),
        h('div.tl-dot', UI.icon(e.icon)),
        h('div.tl-body', h('div.tl-title', e.title), h('div.tl-text', e.text), showYear ? h('div.tl-ages', agesAt(P, e.year)) : null)));
    }
    UI.mount(root,
      h('h1.large-title', 'Timeline'),
      h('div', { style: { margin: '-6px 4px 14px' } }, h('span.pill.sky-pill', h('span.dot', { style: { background: `var(--s${sc.color})` } }), sc.name)),
      phaseBar(a),
      ladder(a),
      h('div.card', { style: { paddingLeft: '12px', paddingRight: '14px' } }, list),
      h('p.footer-note', 'Results are educational estimates, not financial advice.'));
  };
})(globalThis.RP = globalThis.RP || {});
