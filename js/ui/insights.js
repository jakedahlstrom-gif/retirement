/*
 * insights.js — turns an analysis into plain-English alerts, milestones and a
 * short plan summary. Alerts point at the input that would fix them, so a tap
 * can jump straight there. The same alerts also become markers on the charts.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, fmt = UI.fmt;
  const I = (UI.insights = {});

  function yearsText(ys) {
    if (!ys.length) return '';
    const runs = [];
    let s = ys[0], p = ys[0];
    for (let i = 1; i <= ys.length; i++) {
      if (ys[i] === p + 1) { p = ys[i]; continue; }
      runs.push(s === p ? `${s}` : `${s}–${p}`);
      s = p = ys[i];
    }
    return runs.slice(0, 3).join(', ') + (runs.length > 3 ? '…' : '');
  }

  /**
   * a = slim analysis; metrics = { safe, green, coast } (optional)
   * Returns [{ level, title, text, fix, path, years }]
   */
  I.alerts = function (a, metrics) {
    if (!a) return [];
    const P = a.plan, rows = a.rows, S = a.schedule, sum = a.summary;
    const out = [];
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const retired = rows.filter((r) => r.year >= S.retireYear);

    // Success
    if (sum.successRate != null && sum.successRate < 0.8) {
      out.push({ level: 'bad', title: `Success is ${fmt.pct(sum.successRate)}`, text: 'Fewer than 8 in 10 market scenarios fund the whole plan.', fix: 'Try retiring a year or two later, or spending a little less.', path: 'retirement.p1Age', years: [] });
    }
    // Typical path runs short
    if (a.summary.shortfallYear) {
      out.push({ level: 'bad', title: `Money runs short in ${a.summary.shortfallYear}`, text: 'Even with typical markets, savings run out before the end of the plan.', fix: 'Lower retirement spending.', path: 'spending.retirement', years: [a.summary.shortfallYear] });
    }
    // Health program lines
    const lostMn = retired.filter((r) => r.capKind === 'mncare' && !['mncare', 'ma'].includes(r.health.status)).map((r) => r.year);
    if (lostMn.length) {
      const cost = retired.filter((r) => lostMn.includes(r.year)).reduce((t, r) => t + r.health.extraCost, 0);
      out.push({ level: 'warn', title: `Over the MinnesotaCare line in ${yearsText(lostMn)}`, text: `Income tops 200% of the poverty line, so coverage moves to MNsure (about ${fmt.money(cost)} more in total).`, fix: 'Lower spending in those years, or turn on 72(t) payments.', path: 'spending.retirement', years: lostMn });
    }
    const overAca = rows.filter((r) => r.health.status === 'aca-full').map((r) => r.year);
    if (overAca.length) {
      out.push({ level: 'bad', title: `Over the ACA 400% line in ${yearsText(overAca)}`, text: 'Above this line there’s no premium help, so health insurance is full price.', fix: 'Spread withdrawals out or lower spending.', path: 'spending.retirement', years: overAca });
    }
    const kidsLost = retired.filter((r) => r.capKind && r.health.kidsStatus === 'plan').map((r) => r.year);
    if (kidsLost.length) {
      out.push({ level: 'warn', title: `Kids lose Medical Assistance in ${yearsText(kidsLost)}`, text: 'Income is above 275% of the poverty line, so the kids need marketplace coverage.', fix: 'Keep income lower in those years.', path: 'conversions.strategy', years: kidsLost });
    }
    // Penalties
    const penYears = rows.filter((r) => r.taxes.penalty > 1).map((r) => r.year);
    if (penYears.length) {
      out.push({ level: 'warn', title: `${fmt.money(sum.totalPenalties)} in early-withdrawal penalties`, text: `Penalty withdrawals are needed in ${yearsText(penYears)}.`, fix: P.sepp.enabled ? 'Try a bigger bridge fund or later retirement.' : 'Turn on 72(t) payments to avoid most of them.', path: P.sepp.enabled ? 'contributions.taxable' : 'sepp.enabled', years: penYears });
    }
    // Rule of 55 lost
    for (const pid of ['p1', 'p2']) {
      const u = S.unlock[pid];
      const age = (pid === 'p1' ? P.people.p1 : P.people.p2);
      const plannedRetireAge = pid === 'p1' ? P.retirement.p1Age : (P.retirement.together ? P.people.p1.birthYear + P.retirement.p1Age - age.birthYear : P.retirement.p2Age);
      if (plannedRetireAge >= 55 && u.rule55Year == null && u.separationYear && u.separationYear < u.year59) {
        out.push({ level: 'warn', title: `Rule of 55 is off for ${pid === 'p1' ? n1 : n2}`, text: `Leaving work in ${u.separationYearForAge} (age ${u.separationYearForAge - age.birthYear}) means the 401k stays locked until ${u.year59} unless converted.`, fix: 'Being re-employed and leaving that job at 55+ restores it.', path: `jobLoss.${pid}.reemploy.enabled`, years: [u.separationYearForAge] });
      }
    }
    // RMDs & IRMAA
    const irmaa = rows.filter((r) => r.health.irmaa > 0).map((r) => r.year);
    if (irmaa.length) {
      out.push({ level: 'info', title: `IRMAA surcharges in ${yearsText(irmaa)}`, text: 'High income at Medicare age adds extra Medicare premiums.', fix: 'More Roth conversions before 65 can lower future RMDs.', path: 'conversions.afterMedicare', years: irmaa });
    }
    const rmdRows = rows.filter((r) => r.from.rmd > 0);
    if (rmdRows.length) {
      const first = rmdRows[0];
      out.push({ level: 'info', title: `Required withdrawals start in ${first.year}`, text: `About ${fmt.money(first.from.rmd)} that year, taxed as income.`, fix: 'Roth conversions in your 60s shrink these.', path: 'conversions.afterMedicare', years: [first.year] });
    }
    // Planned savings the paycheck can't cover
    const tight = rows.filter((r) => { const want = plannedTaxable(P, r.year, r); return r.working && r.year > S.y0 && want - r.saving.taxable > Math.max(2500, 0.1 * want); }).map((r) => r.year);
    if (tight.length) {
      out.push({ level: 'info', title: `Bridge savings fall short in ${yearsText(tight)}`, text: 'After spending and taxes, there isn’t enough left for the planned brokerage savings.', fix: 'Adjust the bridge-fund plan or spending.', path: 'contributions.taxable', years: tight });
    }
    // Stale balances
    const asOf = new Date(P.balances.asOf + 'T00:00:00');
    const months = (Date.now() - asOf.getTime()) / (30.44 * 864e5);
    if (months > 6) {
      out.push({ level: 'info', title: 'Balances are over 6 months old', text: `Last updated ${fmt.date(P.balances.asOf)}.`, fix: 'Run the annual check-in.', path: 'balances.asOf', years: [], action: 'checkin' });
    }
    if (metrics && metrics.coast && metrics.coast.year == null) {
      out.push({ level: 'info', title: 'No Coast FIRE date yet', text: 'Stopping saving in any year before retiring keeps success under target.', fix: 'Keep saving; it’s working.', path: 'sim.coastTarget', years: [] });
    }
    const order = { bad: 0, warn: 1, info: 2 };
    return out.sort((x, y) => order[x.level] - order[y.level]);
  };

  function plannedTaxable(P, y, row) {
    let t = 0;
    for (const s of P.contributions.taxable || []) {
      if (y >= s.firstYear && (s.lastYear == null || y <= s.lastYear)) t += s.amount;
    }
    if (P.sim.coastYear && y >= P.sim.coastYear) return 0;
    return row.working ? t * 0.98 : 0;
  }

  /** Milestones with their year and whether they've been reached. */
  I.milestones = function (a, metrics) {
    if (!a) return [];
    const P = a.plan, S = a.schedule, rows = a.rows;
    const now = new Date().getFullYear();
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const list = [];
    const dc = P.spending.daycare;
    if (dc && dc.amount > 0) {
      const last = rows.filter((r) => r.spending.daycare > 0).pop();
      const y = last ? last.year + (dc.lastYearFraction < 1 && last.year === dc.lastYear ? 0 : 1) : dc.firstYear;
      list.push({ key: 'daycare', emoji: '🎒', title: 'Daycare-free', year: y });
    }
    if (metrics && metrics.coast && metrics.coast.year) list.push({ key: 'coast', emoji: '🏝️', title: 'Coast FIRE', year: metrics.coast.year });
    const p1Age = S.retireYear - 1 - P.people.p1.birthYear;
    list.push({ key: 'retired', emoji: '🎉', title: `Retired at ${p1Age}`, year: S.retireYear });
    const u1 = S.unlock.p1, u2 = S.unlock.p2;
    list.push({ key: 'p1unlock', emoji: '🔓', title: `${n1}’s 401k unlocked`, year: u1.rule55Year != null ? Math.min(u1.rule55Year, u1.year59) : u1.year59 });
    list.push({ key: 'p2unlock', emoji: '🔓', title: `${n2}’s 401k unlocked`, year: u2.rule55Year != null ? Math.min(u2.rule55Year, u2.year59) : u2.year59 });
    if (S.mortgagePayoffYear) list.push({ key: 'mortgage', emoji: '🏡', title: 'Mortgage free', year: S.mortgagePayoffYear + 1 });
    list.push({ key: 'medicare', emoji: '🩺', title: `${n1} on Medicare`, year: u1.medicareYear });
    list.push({ key: 'ss1', emoji: '💌', title: `${n1}’s Social Security`, year: S.ssDetail.p1.claimYear });
    list.push({ key: 'ss2', emoji: '💌', title: `${n2}’s Social Security`, year: S.ssDetail.p2.claimYear });
    if (metrics && metrics.green && metrics.green.amount) {
      const hit = rows.find((r) => r.balances.total >= metrics.green.amount);
      if (hit) list.push({ key: 'green', emoji: '🟢', title: 'Green light', year: hit.year });
    }
    for (const m of list) {
      m.earned = m.year <= now;
      if (m.earned && (m.key === 'coast' || m.key === 'green')) m.title += ' reached';
    }
    return list.sort((x, y) => x.year - y.year);
  };

  /** A few plain-English sentences describing the plan. */
  I.summary = function (a, metrics) {
    if (!a) return '';
    const P = a.plan, S = a.schedule, rows = a.rows, sum = a.summary;
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const ry = S.retireYear;
    const a1 = ry - 1 - P.people.p1.birthYear, a2 = ry - 1 - P.people.p2.birthYear;
    const parts = [];
    const lossP1 = P.jobLoss.p1.enabled && !P.jobLoss.p1.reemploy.enabled;
    if (lossP1) parts.push(`${n1} stops working in ${P.jobLoss.p1.year} and ${n2} works through ${ry - 1}.`);
    else if (P.retirement.together) parts.push(`You both retire at the end of ${ry - 1} (${n1} ${a1}, ${n2} ${a2}).`);
    else parts.push(`Full-time work ends after ${ry - 1}.`);
    if (sum.balanceAtRetirement) parts.push(`Savings reach about <b>${fmt.money(sum.balanceAtRetirement)}</b> by then in a typical market.`);
    if (sum.successRate != null) parts.push(`The plan works in <b>${fmt.pct(sum.successRate)}</b> of ${a.mc.runs.toLocaleString()} market scenarios.`);
    const bridge = rows.filter((r) => r.year >= ry && r.year < Math.max(S.unlock.p1.year59, S.unlock.p2.year59));
    if (bridge.length) {
      const src = { cash: 0, rothBasis: 0, preTaxPenaltyFree: 0, rothConversions: 0, penalty: 0 };
      let conv = 0;
      for (const r of bridge) {
        src.cash += r.from.cash; src.rothBasis += r.from.rothBasis; src.preTaxPenaltyFree += r.from.preTaxPenaltyFree;
        src.rothConversions += r.from.rothConversions; src.penalty += r.from.penaltyWithdrawals; conv += r.converted;
      }
      const names = { cash: 'cash and brokerage', rothBasis: 'Roth contributions', preTaxPenaltyFree: S.unlock.p1.rule55Year ? `${n1}’s 401k (Rule of 55)` : '401k money after 59½', rothConversions: 'aged Roth conversions', penalty: 'some penalty withdrawals' };
      const top = Object.entries(src).filter(([, v]) => v > 1000).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k]) => names[k]);
      if (top.length) parts.push(`Until 59½, spending comes mostly from ${top.join(', ').replace(/, ([^,]*)$/, ' and $1')}.`);
      const avgConv = conv / bridge.length;
      if (avgConv > 1000) parts.push(`Roth conversions of about <b>${fmt.money(avgConv)}/yr</b> keep income under the health-program line${sum.lastMnCareYear ? `, with MinnesotaCare through ${sum.lastMnCareYear}` : ''}.`);
    }
    if (a.sepp && a.sepp.payment > 0 && a.sepp.withoutPenalties != null) {
      parts.push(`72(t) payments of about <b>${fmt.money(a.sepp.payment)}/yr</b> from ${P.people[a.sepp.person].name}’s 401k (${a.sepp.startYear}–${a.sepp.endYear}) cut penalties from ${fmt.money(a.sepp.withoutPenalties)} to <b>${fmt.money(sum.totalPenalties)}</b>.`);
    } else if (a.sepp && a.sepp.note) parts.push(`72(t): ${a.sepp.note}`);
    parts.push(`Social Security starts in ${S.ssDetail.p1.claimYear} and ${S.ssDetail.p2.claimYear}.`);
    if (metrics && metrics.safe && metrics.safe.amount) parts.push(`You could spend up to <b>${fmt.money(metrics.safe.amount)}/yr</b> and stay at ${P.sim.successTarget}% success.`);
    return parts.join(' ');
  };
})(globalThis.RP = globalThis.RP || {});
