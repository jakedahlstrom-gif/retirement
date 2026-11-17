/*
 * playbook.js — the Playbook: one year of your plan as a to-do list.
 *
 * While you work: what goes into each account, how that compares with the
 * IRS limits (and the catch-ups your ages unlock), and how much room is left.
 * Once retired: the monthly budget, which accounts to draw from, how much to
 * convert to Roth and the income line to stay under. Plus the dates that fall
 * in that year (Medicare, Social Security, 59½, required withdrawals…) and
 * the tax to expect.
 *
 *   UI.playbook.build(analysis, year)   the lists, as plain data (no page needed)
 *   UI.playbook.card()                  the Home card
 *   UI.playbook.open(year)              the full sheet, with year-by-year arrows
 *
 * It reads the typical-market path, so dollar amounts are estimates in
 * today's dollars. The first year of a plan can be a part-year (it starts at
 * your balance date): amounts are shown as full-year rates and marked.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, fmt = UI.fmt;
  const PB = (UI.playbook = {});
  const money = (v) => fmt.money(Math.round(v / 100) * 100);
  const exact = (v) => fmt.money(v, { full: true });
  /** A tax amount; below zero it's a refundable credit coming back. */
  const owed = (v) => (v < -0.5 ? `a ${exact(-v)} credit` : exact(Math.max(0, v)));

  /** The year to open on: this calendar year, or next year when little of this one is left in the plan. */
  PB.defaultYear = function (a) {
    const now = new Date().getFullYear();
    const first = a.rows[0];
    if (!first) return null; // a plan whose last year has already passed
    let y = Math.max(now, first.year);
    const r = a.rows.find((x) => x.year === y);
    if (r && r.frac < 0.5 && a.rows.some((x) => x.year === y + 1)) y++;
    return Math.min(y, a.rows[a.rows.length - 1].year);
  };

  /**
   * One year's playbook: { year, partial, working, ages, groups: [{ key, title,
   * items: [{ title, value, detail, tone }] }] }. tone: 'ok' (done or on
   * track), 'room' (you could do more), 'watch' (needs care), or none.
   */
  PB.build = function (a, year) {
    const r = a.rows.find((x) => x.year === year);
    if (!r) return null;
    const P = a.plan, S = a.schedule, L = P.tax.limits;
    const f = r.frac || 1, yr = (v) => v / f; // full-year rate
    const pids = ['p1', 'p2'].filter((p) => r.alive[p]);
    const name = (p) => P.people[p].name;
    const ageIn = (p) => year - P.people[p].birthYear; // age reached by Dec 31
    const filing = pids.length === 2 ? 'mfj' : 'single';
    const groups = [];
    const group = (key, title) => { const g = { key, title, items: [] }; groups.push(g); return (title2, value, detail, tone) => g.items.push({ title: title2, value: value == null ? '' : value, detail: detail || '', tone: tone || '' }); };

    // ---------------------------------------------------------------- saving
    const wages = { p1: r.income.wagesP1, p2: r.income.wagesP2 };
    const workers = pids.filter((p) => wages[p] > 0);
    if (workers.length) {
      const add = group('save', 'Save');
      let saved = 0;
      for (const p of workers) {
        const age = ageIn(p);
        const catchUp = age >= 60 && age <= 63 ? L.catchup6063 : age >= 50 ? L.catchup50 : 0;
        const limit = Math.min(L.k401 + catchUp, yr(wages[p]));
        const planned = yr(r.saving.k401[p]);
        const match = yr(r.saving.matchBy[p]);
        const room = limit - planned;
        saved += planned + match;
        const bits = [];
        if (planned > 0) bits.push(`About ${exact(planned / 12)} a month from pay.`);
        if (match > 0) bits.push(`Your employer adds ${exact(match)}.`);
        const catchNote = !catchUp ? '' : age === 50 ? ` (with the ${exact(catchUp)} catch-up, new at 50)`
          : age >= 60 ? ` (with the bigger ${exact(catchUp)} catch-up for ages 60–63)` : ` (with the ${exact(catchUp)} catch-up)`;
        bits.push(room > 250
          ? `The limit at ${age} is ${exact(limit)}${catchNote}, so there’s ${money(room)} of room.`
          : `That’s the limit${catchUp ? ', catch-up included' : ''} ✓`);
        add(`${name(p)}’s 401k`, money(planned), bits.join(' '), room > 250 ? 'room' : 'ok');
      }
      if (r.saving.mega > 0) { saved += yr(r.saving.mega); add('After-tax 401k → Roth', money(yr(r.saving.mega)), 'The “mega backdoor”: after-tax contributions converted to Roth.', 'ok'); }
      const hsa = yr(r.saving.hsa);
      if (hsa > 0) {
        const limit = L.hsaFamily + (pids.some((p) => ageIn(p) >= 55) ? L.hsaCatchup55 : 0);
        saved += hsa;
        add('HSA', money(hsa), hsa >= limit - 100 ? `That’s the family limit ✓` : `The family-coverage limit is ${exact(limit)}, so there’s ${money(limit - hsa)} of room (less with self-only coverage).`, hsa >= limit - 100 ? 'ok' : 'room');
      }
      const ira = yr(r.saving.rothIra);
      const iraLimit = pids.reduce((t, p) => t + L.ira + (ageIn(p) >= 50 ? L.iraCatchup : 0), 0);
      const lines = L.rothIraPhaseout[filing] || L.rothIraPhaseout.single;
      const over = yr(r.magi) > lines[0];
      if (ira > 0 || !over) {
        saved += ira;
        add(pids.length === 2 ? 'Roth IRAs' : 'Roth IRA', money(ira),
          over ? `Your income (about ${money(yr(r.magi))}) is over the ${exact(lines[0])} line where direct Roth IRA contributions phase out. A “backdoor” Roth (contribute to a traditional IRA, then convert) is the usual way around it.`
            : ira >= iraLimit - 100 ? `That’s the limit${pids.length === 2 ? ' for the two of you' : ''} ✓`
              : `The limit${pids.length === 2 ? ' for the two of you' : ''} is ${exact(iraLimit)}, so there’s ${money(iraLimit - ira)} of room.`,
          over ? 'watch' : ira >= iraLimit - 100 ? 'ok' : 'room');
      }
      const brok = yr(r.saving.taxable + r.saving.leftover);
      const toSpend = P.contributions.leftoverTo === 'spend' || (P.sim.coastYear && year >= P.sim.coastYear);
      if (yr(r.saving.taxable) > 100 || (!toSpend && brok > 100)) {
        const v = toSpend ? yr(r.saving.taxable) : brok;
        saved += v;
        add(P.contributions.leftoverTo === 'cash' ? 'Cash savings' : 'Brokerage (bridge fund)', money(v),
          year < S.retireYear ? 'Money you can reach before 59½ with no penalty: it carries the first years of retirement.' : '', 'ok');
      }
      if (r.saving.edu > 0) add('College savings', money(yr(r.saving.edu)), '', 'ok');
      const gross = yr(r.income.wages);
      if (gross > 0 && saved > 0) add('All together', fmt.pct(saved / gross), `${money(saved)} saved from ${money(gross)} of pay, employer money included.`);
    }

    // ---------------------------------------------------------------- spending and withdrawals
    const src = [
      ['cash & brokerage', r.src.cash], ['Roth contributions', r.src.rothBasis], ['aged Roth conversions', r.src.rothConversions],
      ['Roth growth', r.src.rothEarnings], ['401k / IRA', r.src.preTax], ['HSA', r.src.hsa], ['early withdrawals (with a penalty)', r.src.penalty],
    ].filter(([, v]) => yr(v) > 500).sort((x, y) => y[1] - x[1]);
    if (!r.working || src.length) {
      const add = group('spend', r.working ? 'Withdraw' : 'Spend and withdraw');
      if (!r.working) {
        const spend = r.spending.core + r.spending.medicalGrowth + r.spending.mortgageAdj + r.spending.extras + r.spending.health + r.spending.daycare + r.spending.college;
        add('Monthly budget', exact(Math.max(0, yr(spend)) / 12), `${money(Math.max(0, yr(spend)))} for the year, health costs and extras included.${r.spending.guardrailCut ? ' Trimmed this year by your spending guardrails.' : ''}`);
      }
      const inc = [['Social Security', r.income.ss], ['Part-time work', r.income.partTime], ['Windfalls', r.income.windfall]].filter(([, v]) => yr(v) > 500);
      for (const [label, v] of inc) add(label, money(yr(v)), 'Coming in this year.', 'ok');
      src.forEach(([label, v], i) => add(`${i === 0 ? 'Draw from' : 'Then'} ${label}`, money(yr(v)),
        label.startsWith('early') ? 'A 10% penalty applies: a bigger bridge fund or 72(t) payments would avoid it.' : label === 'HSA' ? 'Tax-free for medical costs and saved receipts.' : '',
        label.startsWith('early') ? 'watch' : ''));
      if (r.from.rmd > 0) add('Required withdrawals', money(yr(r.from.rmd)), `The IRS requires at least this much out of pre-tax accounts from ${P.tax.rmdAge}. It’s part of the 401k / IRA amount above.`);
      if (r.from.shortfall > 1) add('Shortfall', money(yr(r.from.shortfall)), 'In a typical market the accounts can’t cover this year.', 'watch');
    }

    // ---------------------------------------------------------------- Roth conversions and income lines
    if (r.converted > 500 || ['mncare', 'aca'].includes(r.capKind)) {
      const add = group('convert', 'Convert and stay under the line');
      const why = { mncare: 'as much as fits under the MinnesotaCare income line', aca: 'as much as fits under the health-subsidy line', bracket: `enough to fill the ${P.conversions.bracketRate}% tax bracket`, irmaa: 'as much as fits under the first Medicare surcharge line' }[r.capKind];
      if (r.converted > 500) add('Convert to Roth', money(yr(r.converted)), `Move this from pre-tax accounts to Roth${why ? `: ${why}` : ''}. You pay tax on it now, at a low rate, and it grows tax-free after that.`, 'ok');
      if (['mncare', 'aca'].includes(r.capKind) && isFinite(r.cap) && r.cap > 0) {
        const cap = yr(r.cap), magi = yr(r.magi);
        const prog = r.capKind === 'mncare' ? 'MinnesotaCare' : 'health-subsidy';
        add(`The ${prog} income line`, exact(cap),
          `Your income for health coverage (MAGI) is planned at ${exact(magi)}. ${magi <= cap + 1 ? `Staying under the line keeps ${r.capKind === 'mncare' ? 'MinnesotaCare' : 'your premium subsidy'}, so watch for surprise income (a big gain, an extra withdrawal).` : `That’s over the line this year, so coverage costs more.`}`,
          magi <= cap + 1 ? 'ok' : 'watch');
      }
    }

    // ---------------------------------------------------------------- dates
    const dates = [];
    if (year === S.retireYear - 1 && S.retireYear > S.y0) dates.push(['Last year of work', '', `Full-time work ends this December. Check that your bridge fund is where the plan expects: about ${money((a.rows.find((x) => x.year === S.retireYear) || r).startTotal)} saved in total.`]);
    if (year === S.retireYear && S.retireYear > S.y0) dates.push(['First year of retirement', '', 'Paychecks stop: this year runs on savings.']);
    for (const p of pids) {
      const age = ageIn(p), n = name(p), mon = fmt.monthName(P.people[p].birthMonth || 1);
      const u = S.unlock[p];
      if (age === 55 && r.saving.hsa > 0) dates.push([`${n} turns 55`, '', `HSA catch-up: ${exact(L.hsaCatchup55)} more a year is allowed.`]);
      if (u.rule55Year === year) dates.push([`${n}’s 401k opens (Rule of 55)`, '', 'Leaving a job at 55 or later lets you draw from that employer’s 401k with no penalty.']);
      if (u.year59 === year) dates.push([`${n} reaches 59½`, '', 'Every retirement account can now be used with no early-withdrawal penalty.']);
      if (u.medicareYear === year) dates.push([`${n} starts Medicare`, mon, `Sign up in the three months before ${n}’s 65th birthday month to avoid a gap or a late penalty.`]);
      const ss = S.ssDetail[p];
      if (ss && ss.claimYear === year) dates.push([`${n} claims Social Security`, money(ss.annualAtClaim) + '/yr', `Apply about three months before you want it to start. The plan uses age ${year - P.people[p].birthYear}.`]);
      if (age === P.tax.rmdAge) dates.push([`${n}’s required withdrawals begin`, '', `From ${P.tax.rmdAge}, the IRS sets a minimum to take out of pre-tax accounts each year.`]);
    }
    for (const k of P.kids || []) {
      const age = year - k.birthYear;
      if (age === 17 && pids.length) dates.push([`${k.name} turns 17`, '', `The ${exact(P.tax.federal.ctc)} child tax credit stops with the year a child turns 17.`]);
      if (age === 18 && P.college.enabled) dates.push([`${k.name} turns 18`, '', 'College costs in your plan are about to start.']);
    }
    if (dates.length) { const add = group('dates', 'This year’s dates'); dates.forEach(([t, v, d]) => add(t, v, d)); }

    // ---------------------------------------------------------------- taxes and coverage
    {
      const add = group('tax', 'Expect');
      const inc = yr(r.taxes.federal + r.taxes.state);
      const stateName = P.household.state === 'MN' && !(P.housing.move.enabled && year >= P.housing.move.year) ? 'Minnesota' : 'state';
      add(inc >= 0 ? 'Income tax' : 'Tax refund', money(Math.abs(inc)),
        `Federal ${owed(yr(r.taxes.federal))}, ${stateName} ${owed(yr(r.taxes.state))}.${r.taxes.fica > 0 ? ` Payroll tax takes another ${money(yr(r.taxes.fica))}.` : ''} Your top federal bracket is ${Math.round(r.marginal * 100)}%.`);
      add('Health coverage', '', fmt.coverage(r.health.status) + (r.health.irmaa > 0 ? `, with a ${money(yr(r.health.irmaa))} Medicare surcharge for high income (IRMAA).` : '.'));
      if (r.taxes.penalty > 0) add('Early-withdrawal penalties', money(yr(r.taxes.penalty)), 'See the withdrawals above.', 'watch');
    }

    return {
      year, partial: f < 0.999, working: r.working, row: r,
      ages: pids.map((p) => `${name(p)} ${r.ages[p]}`).join(' · '),
      groups: groups.filter((g) => g.items.length),
    };
  };

  // ------------------------------------------------------------------ page
  if (typeof document === 'undefined') return; // (the lists above also run in Node, for the checks)
  const h = UI.h;
  const store = () => RP.store;
  let card = null, body = null, last = null;
  const TONE = { ok: 'check', room: 'plus', watch: 'alert' };

  function item(it) {
    return h('div.pb-item' + (it.tone ? '.' + it.tone : ''),
      h('span.pb-ic', it.tone ? UI.icon(TONE[it.tone]) : h('i')),
      h('div.pb-main', h('div.pb-line', h('span.pb-title', it.title), it.value ? h('span.pb-val', it.value) : null), it.detail ? h('p', it.detail) : null));
  }

  function draw() {
    if (!body || !last) return;
    const pb = PB.build(last, PB.defaultYear(last));
    card.hidden = !pb;
    if (!pb) return;
    // The card shows the headline items: what to save, or the budget and where it comes from.
    const pick = [];
    for (const key of ['save', 'spend', 'convert', 'dates']) {
      const g = pb.groups.find((x) => x.key === key);
      if (g) pick.push(...g.items.filter((it) => it.title !== 'All together').slice(0, key === 'save' || key === 'spend' ? 3 : 1));
    }
    const room = pb.groups.flatMap((g) => g.items).filter((it) => it.tone === 'room').length;
    UI.mount(body,
      h('div.pb-head', h('div.value-md', String(pb.year)), h('div.value-sub', pb.ages + (pb.working ? '' : ' · retired'))),
      h('div.pb-short', pick.slice(0, 4).map((it) => h('div.pb-row' + (it.tone ? '.' + it.tone : ''), h('span.pb-ic', it.tone ? UI.icon(TONE[it.tone]) : h('i')), h('span.pb-title', it.title), h('span.pb-val', it.value)))),
      h('button.more-btn', { type: 'button', onclick: () => PB.open(pb.year) }, room ? `Full playbook · ${room} place${room === 1 ? '' : 's'} with room to save more →` : 'See the full playbook →'));
  }

  PB.card = function () {
    body = h('div');
    card = h('div.card.pb-card', h('div.card-title', h('span', 'This year’s playbook'), UI.tipButton('playbook')), body);
    card.hidden = true;
    return card;
  };
  /** New results for the active scenario. */
  PB.update = function (a) { last = a; draw(); };

  /** The full playbook for a year, with arrows to step through the plan. */
  PB.open = function (year) {
    const a = last || RP.app.last;
    if (!a) { UI.toast('Still calculating…'); return; }
    if (year == null) year = PB.defaultYear(a);
    const pb = PB.build(a, year);
    if (!pb) return;
    const sc = store().scenario();
    const first = a.rows[0].year, end = a.rows[a.rows.length - 1].year;
    const step = (d, label) => h('button.btn.small' + (d < 0 ? '.yr-prev' : '.yr-next'), { disabled: year + d < first || year + d > end, onclick: () => PB.open(year + d), 'aria-label': `${label}: ${year + d}` },
      d < 0 ? [UI.icon('chevron', 'flip'), String(year + d)] : [String(year + d), UI.icon('chevron')]);
    UI.sheet.open({
      title: `${year} playbook`,
      body: [
        h('div.yr-nav', step(-1, 'Previous year'), step(1, 'Next year')),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '6px' } },
          h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name),
          h('span.pill', pb.ages),
          h('span.pill' + (pb.working ? '' : '.accent'), pb.working ? 'Working' : 'Retired')),
        pb.partial ? h('p.x-note', `Your plan picks up partway through ${year} (from ${fmt.date(a.plan.balances.asOf)}). Amounts here are full-year rates.`) : null,
        pb.groups.map((g) => [h('div.subhead', { style: { padding: '12px 2px 4px' } }, g.title), h('div.list.pb-list', g.items.map(item))]),
        h('button.more-btn', { type: 'button', style: { marginTop: '14px' }, onclick: () => UI.compare.showYear(a, year, sc) }, `See all the money in and out for ${year} →`),
        h('p.x-note', 'From the typical-market path of your plan, in today’s dollars. Limits are the 2026 IRS limits, which rise with inflation. An estimate to plan around, not tax advice.'),
      ],
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
  };
})(globalThis.RP = globalThis.RP || {});
