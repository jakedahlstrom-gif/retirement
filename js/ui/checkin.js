/*
 * checkin.js — two helpers on the Plan tab:
 *
 *  Annual check-in: walks you through updating balances, salaries and savings,
 *  then shows how the plan changed since last time (and saves a snapshot).
 *
 *  Assumptions: every assumption the plan makes, in plain English, built from
 *  your current inputs.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt, U = RP.util;
  const store = () => RP.store;

  // ---------------------------------------------------------------- check-in
  const CI = (UI.checkin = {});

  function numInput(label, value, onChange) {
    const input = h('input.textfield', { type: 'text', inputmode: 'numeric', value: fmt.money(value, { full: true }) });
    input.addEventListener('focus', () => { input.value = String(Math.round(value)); setTimeout(() => input.select(), 10); });
    input.addEventListener('blur', () => {
      const v = Number(String(input.value).replace(/[^0-9.\-]/g, ''));
      if (isFinite(v) && input.value.trim() !== '') { value = v; onChange(v); }
      input.value = fmt.money(value, { full: true });
    });
    return h('label', { style: { display: 'block', marginBottom: '12px' } }, h('div.label', { style: { margin: '0 0 5px 2px' } }, label), input);
  }

  CI.start = function () {
    const st = store().state;
    if (st.active !== 'base') store().setActive('base');
    const P = U.clone(st.plan);
    const before = RP.app.last ? summaryOf(RP.app.last, UI.home._metrics) : null;
    const draft = {};
    const set = (path, v) => { draft[path] = v; };
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const steps = [
      { title: 'Balances', note: 'Today’s balances from your account websites.', fields: [
        ['balances.p1_401k', `${n1}’s 401k`], ['balances.p2_401k', `${n2}’s 401k`], ['balances.roth', 'Roth IRAs (total)'],
        ['balances.rothBasis', 'Roth contributions (basis)'], ['balances.hsa', 'HSA'], ['balances.hsaReceipts', 'Saved HSA receipts'],
        ['balances.cash', 'Cash'], ['balances.brokerage', 'Brokerage'], ['balances.edu', '529 / Trump Account'], ['balances.homeEquity', 'Home equity'],
      ] },
      { title: 'Income', note: 'Current salaries (before taxes).', fields: [['income.p1.salary', `${n1}’s salary`], ['income.p2.salary', `${n2}’s salary`]] },
      { title: 'Savings', note: 'What you’re contributing this year.', fields: [
        ['contributions.p1_401k.amount', `${n1}’s 401k`], ['contributions.p1_match.amount', `${n1}’s match`],
        ['contributions.p2_401k.amount', `${n2}’s 401k`], ['contributions.p2_match.amount', `${n2}’s match`],
        ['contributions.hsa.amount', 'HSA'], ['contributions.rothIra.amount', 'Roth IRAs'],
        ['spending.working', 'Core spending (per year)'],
      ] },
    ];
    let step = 0;
    const body = h('div');
    const draw = () => {
      const s = steps[step];
      UI.mount(body,
        h('div.steps', steps.map((x, i) => h('span' + (i === step ? '.on' : i < step ? '.done' : '')))),
        h('p.tip-text.muted', { style: { marginTop: '6px' } }, s.note),
        s.fields.map(([path, label]) => numInput(label, draft[path] != null ? draft[path] : U.getPath(P, path), (v) => set(path, v))));
      UI.sheet.open({
        title: `Check-in · ${s.title}`, body,
        actions: [
          step > 0 ? { label: 'Back', onClick: () => { step--; draw(); } } : { label: 'Cancel', onClick: () => UI.sheet.close() },
          step < steps.length - 1 ? { label: 'Next', primary: true, onClick: () => { blurActive(); step++; draw(); } }
            : { label: 'Save & compare', primary: true, onClick: () => { blurActive(); finish(); } },
        ],
      });
    };
    const blurActive = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
    const finish = () => {
      store().pushUndo(true);
      for (const [path, v] of Object.entries(draft)) U.setPath(st.plan, path, v);
      const today = new Date().toISOString().slice(0, 10);
      st.plan.balances.asOf = today;
      st.plan.meta.lastUpdated = today;
      st.plan.meta.isSample = false; // your own balances now
      store().save();
      store().emit('plan');
      UI.sheet.open({ title: 'Check-in saved', body: h('p.tip-text', 'Recalculating your plan…') });
      // Compare with the last check-in (or the plan before this one).
      const prev = st.history.length ? st.history[st.history.length - 1] : (before ? { date: 'before', summary: before } : null);
      RP.engineClient.analyze(store().planFor('base'), {}, 'checkin').then((a) => RP.engineClient.metricsOn('checkin', a.plan, ['safe'], null, 300).then((m) => ({ a, m }))).then(({ a, m }) => {
        const now = summaryOf(a, m);
        st.history.push({ date: today, summary: now });
        store().save();
        const rowFor = (label, key, f) => {
          const was = prev ? prev.summary[key] : null, is = now[key];
          const delta = was != null && is != null ? is - was : null;
          const sign = delta == null || Math.abs(delta) < 1e-9 ? '' : delta > 0 ? '▲ ' : '▼ ';
          return h('div.row.sub', h('span.row-label', h('span.txt', label)),
            h('span.row-value', was != null ? `${f(was)} → ` : ''), h('span.row-value.strong', f(is)),
            delta != null && Math.abs(delta) > 1e-9 ? h('span.pill' + (delta > 0 ? '.accent' : '.warn'), { style: { marginLeft: '6px' } }, sign + f(Math.abs(delta))) : null);
        };
        UI.sheet.open({
          title: 'How your plan changed',
          body: [
            h('p.tip-text.muted', { style: { marginTop: 0 } }, prev ? (prev.date === 'before' ? 'Compared with your plan before this check-in.' : `Compared with your check-in on ${fmt.date(prev.date)}.`) : 'Your first check-in. Next year you’ll see the changes here.'),
            h('div.list',
              rowFor('Chance of success', 'success', (v) => fmt.pct(v)),
              rowFor('Net worth', 'netWorth', (v) => fmt.money(v)),
              rowFor('Savings at retirement', 'balRet', (v) => fmt.money(v)),
              rowFor('Safe spending', 'safe', (v) => fmt.money(v))),
          ],
          actions: [{ label: 'Done', primary: true, onClick: () => { UI.sheet.close(); RP.app.go('home'); } }],
        });
      }).catch((e) => { if (e.message !== 'stale') UI.sheet.close(); });
    };
    draw();
  };

  function summaryOf(a, m) {
    return { success: a.summary.successRate, netWorth: a.summary.netWorthToday, balRet: a.summary.balanceAtRetirement, safe: m && m.safe ? m.safe.amount : null };
  }

  // ---------------------------------------------------------------- assumptions
  const AS = (UI.assumptions = {});
  AS.items = function (P, a) {
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const R = P.returns;
    const S = a && a.schedule;
    const fpl4 = RP.health.fpl(4, P.health);
    const sec = [];
    const add = (title, lines) => sec.push({ title, lines: lines.filter(Boolean) });
    add('Money', [
      'All amounts are in today’s dollars, so $80K in 2050 buys what $80K buys today.',
      `Inflation (${R.inflation}%) only matters for things fixed in dollars: mortgage payments, 72(t) payments, and the few tax lines the law doesn’t adjust (Social Security taxation, the 0.9% Medicare tax and NIIT thresholds).`,
      `Balances are as of ${fmt.date(P.balances.asOf)}. The first year covers only the rest of ${String(P.balances.asOf).slice(0, 4)}.`,
      'Money moves mid-year on average: half a year of growth before withdrawals and contributions, half after.',
    ]);
    add('Investments', [
      R.source === 'historical' ? 'Returns replay real US history (1871–2022 stocks and 10-year Treasuries) in randomly stitched 10-year chunks.'
        : `Returns are random each year: ${R.working}% while working and ${R.retired}% once retired (after inflation), with ±${R.volatility}% volatility.`,
      R.meaning === 'typical' ? 'Those returns are the growth rate of a typical run (how investment firms usually quote returns). Switch to “Average year” for a more conservative reading.'
        : 'Those returns are the average of yearly returns; with ups and downs, money compounds at somewhat less.',
      `Cash earns ${R.cash}% after inflation. Brokerage pays ${R.dividendYield}% in taxable dividends each year.`,
      R.allocation.enabled ? `Stock/bond mix: ${R.allocation.stocks}/${R.allocation.bonds}${R.allocation.glide.enabled ? `, gliding to ${R.allocation.glide.retiredStocks}% stocks at retirement` : ''}.` : null,
      `${P.sim.runs.toLocaleString()} simulated market histories per scenario, using the same random draws for every scenario so comparisons are fair.`,
      `Success means every year’s spending, taxes and penalties are paid through ${P.people[P.household.horizonPerson].name}’s age ${P.household.horizonAge}. Home equity isn’t counted unless you downsize.`,
    ]);
    add('Work & saving', [
      `${n1} works through ${S ? S.unlock.p1.retireYear : '—'} and ${n2} through ${S ? S.unlock.p2.retireYear : '—'} (end of each year), unless a job loss, disability or death says otherwise.`,
      `401k deferrals are pre-tax and stop when each job ends. At a new job they scale with salary, up to the IRS limit ($${P.tax.limits.k401.toLocaleString()} plus catch-ups).`,
      'The HSA is funded while at least one of you works. Medical bills are paid out of pocket while working, and the receipts are saved for later tax-free reimbursement.',
      'Roth IRA contributions need earned income (paychecks, severance or part-time work).',
      P.contributions.mega.enabled ? 'Mega backdoor Roth money is treated as Roth contributions you can withdraw any time after leaving that job (once rolled into a Roth IRA).' : null,
      `Planned brokerage savings come out of what’s left after spending and taxes; anything beyond that goes to ${P.contributions.leftoverTo === 'spend' ? 'extra spending' : P.contributions.leftoverTo}.`,
      P.sim.coastYear ? `Coast test: all saving stops in ${P.sim.coastYear}, and leftover cash flow is spent.` : null,
    ]);
    add('Spending', [
      `Core spending: ${fmt.money(P.spending.working)}/yr while working, ${fmt.money(P.spending.retirement)}/yr once retired (includes ~${fmt.money(P.hsa.medicalPerYear)} of medical costs and health premiums). Taxes are extra.`,
      `Medical costs grow ${P.health.inflationPct}% a year faster than inflation.`,
      P.spending.daycare.amount > 0 ? `Daycare ${fmt.money(P.spending.daycare.amount)}/yr through ${P.spending.daycare.lastYear} (${Math.round(P.spending.daycare.lastYearFraction * 100)}% of the last year), and $0 in any month a parent is home.` : null,
      P.spending.guardrails.enabled ? `Guardrails: spending drops ${P.spending.guardrails.cutPct}% in any retirement year savings are more than ${P.spending.guardrails.behindPct}% behind the typical path.` : 'Spending stays fixed in bad markets (no guardrails).',
      P.mortgage.enabled ? 'The mortgage payment is inside your spending; principal & interest drop out when it’s paid off.' : null,
      P.spending.phases.enabled ? 'Spending phases replace retirement spending at the ages you set.' : null,
    ]);
    add('Withdrawals', [
      'When spending is more than income, money comes from: cash → brokerage → Roth contributions → Rule-of-55 / 59½ money (kept under the income cap) → Roth conversions 5+ years old → HSA receipts.',
      'Last resorts, in order: locked 401k money with the 10% penalty (still under the cap, so the Roth ladder keeps aging), young Roth conversions (10% penalty), going over the MinnesotaCare line, then over the ACA line, then Roth earnings and HSA money for non-medical use.',
      'Brokerage sales count only their gain as income. Cash, Roth basis, aged conversions and HSA medical withdrawals add no income.',
      `Rule of 55 applies if you leave that employer in or after the year you turn 55${P.jobLoss.rollOld401kIntoNewPlan ? '; an old 401k is assumed rolled into a new employer’s plan so it’s covered too' : ''}.`,
      'Roth conversions are withdrawn oldest first, and each is penalty-free 5 years after Jan 1 of its year (or any time after 59½).',
      P.sepp.enabled ? `72(t): a fixed payment at ${P.sepp.ratePct}% (amortization method), kept for 5 years or until 59½, whichever is later; fixed in dollars, so it shrinks after inflation.` : null,
      `Required minimum distributions start at ${P.tax.rmdAge} (born 1960 or later).`,
      'A surviving spouse inherits everything; the late spouse’s pre-tax money is penalty-free for the survivor.',
    ]);
    add('Roth conversions', [
      ({ healthCap: `Each early-retirement year converts up to the MinnesotaCare line (200% of poverty) minus a ${fmt.money(P.conversions.buffer)} buffer.`, bracket: `Each year converts up to the top of the ${P.conversions.bracketRate}% bracket.`, fixed: `A fixed ${fmt.money(P.conversions.fixedAmount)} is converted each retired year.`, none: 'No Roth conversions.' })[P.conversions.strategy],
      `${P.people[P.conversions.fromFirst].name}’s 401k is converted first. Conversions happen only after that person has left the job.`,
      `After Medicare: ${({ bracket: `fill to the top of the ${P.conversions.bracketRate}% bracket`, irmaa: 'stay under the first IRMAA line', none: 'no conversions' })[P.conversions.afterMedicare]}.`,
    ]);
    add('Health coverage', [
      'While either of you works, the family is on employer coverage (premiums inside spending).',
      `Before 65 with no employer plan: Medical Assistance to ${P.health.adultMA}%, MinnesotaCare to ${P.health.mncare}% (${fmt.money((P.health.mncare / 100) * fpl4)} for 4 in 2026), and MNsure premium tax credits to ${P.health.aca}%. Kids under 19 have Medical Assistance to ${P.health.kidsMA}%.`,
      `Household size for these lines counts kids through age ${P.household.kidsInHouseholdThroughAge} (college students you claim). The poverty guideline is $${P.health.fpl.base.toLocaleString()} for one plus $${P.health.fpl.perPerson.toLocaleString()} per person, kept constant in today’s dollars.`,
      `On MNsure you pay the ACA share of income for a benchmark plan (full price above ${P.health.aca}%: ${fmt.money(P.health.acaAdultPremium)}/adult, ${fmt.money(P.health.acaKidPremium)}/child), plus ${fmt.money(P.health.acaExtraOOP)}/yr more out of pocket than MinnesotaCare.`,
      'MAGI includes all Social Security. Medicare starts at 65 with premiums in spending; IRMAA surcharges are added when income is high (using the same year’s income).',
      P.health.ltc.enabled ? `Long-term care: ${fmt.money(P.health.ltc.annualCost)}/yr for ${P.health.ltc.years} years from age ${P.health.ltc.startAge}, per person.` : null,
    ]);
    add('Social Security', [
      'Benefits come from each person’s top 35 years of earnings (capped at the wage base, in today’s dollars) with 2026 bend points, so they update when retirement dates change.',
      `Claiming at ${P.ss.p1.claimAge} (${n1}) and ${P.ss.p2.claimAge} (${n2}). Full retirement age is 67; each year of delay to 70 adds 8%.`,
      `Benefits are cut ${P.ss.haircutPct}% from ${P.ss.haircutYear} to test the trust-fund shortfall.`,
      'Spousal top-ups (up to half the other’s full benefit) and survivor benefits (the larger check) are applied automatically.',
      'Real wage growth is ignored, which slightly understates future benefits (conservative).',
    ]);
    add('Taxes', [
      `2026 federal brackets and standard deduction (${fmt.money(P.tax.federal.std.mfj)} joint), the ${fmt.money(P.tax.federal.ctc)} child tax credit for kids under 17, long-term gains at 0/15/20%, and payroll taxes.`,
      P.household.state === 'MN'
        ? `Minnesota: 2026 brackets, ${fmt.money(P.tax.mn.std.mfj)} standard deduction, ${fmt.money(P.tax.mn.dependentExemption)} per dependent, the child credit, and the Social Security subtraction.`
        : `State income tax: a flat ${P.household.stateTaxPct || 0}% on income above the federal standard deduction (Social Security not taxed). Minnesota’s health programs don’t apply.`,
      'Brackets are assumed to keep pace with inflation (flat in today’s dollars).',
      P.tax.futureRates.enabled ? `All rates ${P.tax.futureRates.increasePct}% higher from ${P.tax.futureRates.startYear}.` : null,
      'A spouse’s death switches to joint brackets for that year (and 2 more with dependent kids), then head of household or single.',
      P.housing.move.enabled ? `After moving, state tax is a flat ${P.housing.move.taxRatePct}% and MinnesotaCare no longer applies.` : null,
    ]);
    add('Not modeled', [
      'The Social Security earnings test (claiming early while working), state tax on HSA growth outside Minnesota, college financial aid, estate taxes, long-term capital-loss harvesting, and bracket changes from chained-CPI indexing.',
      'Results are educational estimates, not financial advice.',
    ]);
    return sec;
  };

  AS.open = function () {
    const P = store().activePlan();
    const sec = AS.items(P, RP.app.last);
    UI.sheet.open({
      title: 'Assumptions',
      body: sec.map((s) => h('div', h('div.subhead', { style: { padding: '14px 2px 6px' } }, s.title),
        h('div.card', { style: { padding: '12px 16px' } }, h('ul.as-list', s.lines.map((l) => h('li', l)))))),
    });
  };
})(globalThis.RP = globalThis.RP || {});
