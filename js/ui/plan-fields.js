/*
 * plan-fields.js — the list of every input on the Plan tab.
 *
 * Each group becomes a collapsible card. Each field says where it lives in the
 * plan (path), how to show and edit it (type, range), which ⓘ tip explains it,
 * and whether it's an "Advanced" input (hidden until the group's Advanced
 * switch is on). Labels can be functions so they use your names.
 *
 * Field types: money, pct, int, year, age, month, toggle, select, text, date,
 * plus custom list editors (see plan.js).
 */
(function (RP) {
  'use strict';

  const n1 = (P) => P.people.p1.name || 'Person 1';
  const n2 = (P) => P.people.p2.name || 'Person 2';
  const yr = (y0) => ({ min: 2020, max: 2100, sliderMin: y0 || 2026, sliderMax: 2075 });
  const money = (max, step, sliderMax) => ({ type: 'money', min: 0, max: max || 1e8, step: step || 500, sliderMin: 0, sliderMax: sliderMax || max || 200000 });
  const pct = (min, max, step) => ({ type: 'pct', min, max, step: step || 0.5 });
  const person = { type: 'select', options: (P) => [{ value: 'p1', label: n1(P) }, { value: 'p2', label: n2(P) }] };
  const months = { type: 'month' };

  // Repeat a set of fields for one person ('$' in the path becomes p1/p2).
  function personBlock(pid, fields) {
    return fields.map((f) => Object.assign({}, f, {
      path: f.path.replace('$', pid),
      label: typeof f.label === 'function' ? ((P) => f.label(P, pid)) : f.label,
      show: f.show ? ((P) => f.show(P, pid)) : undefined,
      person: pid,
    }));
  }
  const nameOf = (P, pid) => (pid === 'p1' ? n1(P) : n2(P));

  RP.PLAN_GROUPS = [
    {
      key: 'household', title: 'Household', icon: 'users',
      sub: (P) => `${n1(P)} & ${n2(P)} · ${(P.kids || []).length} kid${(P.kids || []).length === 1 ? '' : 's'} · ${P.household.state === 'MN' ? 'MN' : 'Other state'}`,
      reset: [],
      fields: [
        { path: 'people.p1.name', label: 'Person 1 name', type: 'text' },
        { path: 'people.p1.birthYear', label: (P) => `${n1(P)} born`, type: 'year', min: 1930, max: 2010, sliderMin: 1950, sliderMax: 2005 },
        { path: 'people.p1.birthMonth', label: (P) => `${n1(P)} birth month`, ...months, adv: true },
        { path: 'people.p2.name', label: 'Person 2 name', type: 'text' },
        { path: 'people.p2.birthYear', label: (P) => `${n2(P)} born`, type: 'year', min: 1930, max: 2010, sliderMin: 1950, sliderMax: 2005 },
        { path: 'people.p2.birthMonth', label: (P) => `${n2(P)} birth month`, ...months, adv: true },
        { path: 'kids', label: 'Kids', type: 'kids' },
        { path: 'household.state', label: 'State', type: 'select', options: [{ value: 'MN', label: 'Minnesota' }, { value: 'other', label: 'Other' }] },
        { path: 'household.stateTaxPct', label: 'State income tax rate', ...pct(0, 15, 0.1), show: (P) => P.household.state !== 'MN',
          note: 'A flat rate on income above the federal standard deduction. Social Security isn’t taxed. Use 0% for a state with no income tax.' },
        { path: 'household.horizonPerson', label: 'Plan until whose age', ...person, tip: 'horizon', adv: true },
        { path: 'household.horizonAge', label: 'Plan until age', type: 'age', min: 80, max: 110, tip: 'horizon' },
        { path: 'household.kidsInHouseholdThroughAge', label: 'Kids count in household through age', type: 'age', min: 17, max: 26, tip: 'kidsHH', adv: true },
      ],
    },
    {
      key: 'balances', title: 'Balances', icon: 'wallet',
      sub: (P) => `Updated ${RP.ui.fmt.date(P.balances.asOf)}`,
      reset: [],
      fields: [
        { path: 'balances.asOf', label: 'Balances as of', type: 'date', tip: 'lastUpdated' },
        { path: 'balances.p1_401k', label: (P) => `${n1(P)}’s 401k`, ...money(5e7, 1000, 2000000) },
        { path: 'balances.p2_401k', label: (P) => `${n2(P)}’s 401k`, ...money(5e7, 1000, 2000000) },
        { path: 'balances.roth', label: 'Roth IRAs (total)', ...money(5e7, 500, 500000) },
        { path: 'balances.rothBasis', label: 'Roth contributions (basis)', ...money(5e7, 500, 500000), tip: 'rothBasis' },
        { path: 'balances.rothP1SharePct', label: (P) => `Share of Roth that’s ${n1(P)}’s`, ...pct(0, 100, 5), adv: true },
        { path: 'balances.hsa', label: 'HSA', ...money(5e6, 500, 200000) },
        { path: 'balances.hsaReceipts', label: 'Saved HSA receipts', ...money(5e6, 500, 100000), tip: 'hsaReceipts' },
        { path: 'balances.cash', label: 'Cash', ...money(5e7, 500, 200000) },
        { path: 'balances.brokerage', label: 'Taxable brokerage', ...money(5e7, 500, 500000), tip: 'bridge' },
        { path: 'balances.brokerageBasis', label: 'Brokerage cost basis', ...money(5e7, 500, 500000), adv: true, note: 'What you paid for the investments. The rest is gain, which counts as income when sold.' },
        { path: 'balances.edu', label: '529 / Trump Account', ...money(5e6, 500, 200000), tip: 'trump' },
        { path: 'balances.homeEquity', label: 'Home equity', ...money(1e8, 5000, 1500000), note: 'Not spendable unless you model a downsize.' },
      ],
    },
    {
      key: 'retirement', title: 'Retirement dates', icon: 'calendar',
      sub: (P) => `${n1(P)} at ${P.retirement.p1Age}` + (P.retirement.together ? ' · together' : ` · ${n2(P)} at ${P.retirement.p2Age}`),
      reset: ['retirement'],
      fields: [
        { path: 'retirement.p1Age', label: (P) => `${n1(P)} retires at`, type: 'age', min: 40, max: 75, sliderMin: 45, sliderMax: 65, tip: 'retireAge' },
        { path: 'retirement.together', label: 'Retire together', type: 'toggle', tip: 'together' },
        { path: 'retirement.p2Age', label: (P) => `${n2(P)} retires at`, type: 'age', min: 35, max: 75, sliderMin: 40, sliderMax: 65, show: (P) => !P.retirement.together },
      ],
    },
    {
      key: 'income', title: 'Income', icon: 'briefcase',
      sub: (P) => `${RP.ui.fmt.money(P.income.p1.salary)} + ${RP.ui.fmt.money(P.income.p2.salary)}`,
      reset: ['income'],
      fields: [
        ...['p1', 'p2'].flatMap((pid) => personBlock(pid, [
          { path: 'income.$.salary', label: (P, p) => `${nameOf(P, p)}’s salary`, ...money(2e6, 1000, 300000) },
          { path: 'income.$.raisePct', label: (P, p) => `${nameOf(P, p)}’s yearly raise (above inflation)`, ...pct(-5, 10, 0.25), adv: true },
          { path: 'income.$.newJob.enabled', label: (P, p) => `${nameOf(P, p)} changes jobs`, type: 'toggle', adv: true },
          { path: 'income.$.newJob.year', label: 'New job year', type: 'year', ...yr(), adv: true, show: (P, p) => P.income[p].newJob.enabled },
          { path: 'income.$.newJob.month', label: 'New job month', ...months, adv: true, show: (P, p) => P.income[p].newJob.enabled },
          { path: 'income.$.newJob.salary', label: 'New job salary', ...money(2e6, 1000, 300000), adv: true, show: (P, p) => P.income[p].newJob.enabled },
        ])),
      ],
    },
    {
      key: 'jobLoss', title: 'Job loss', icon: 'alert',
      sub: (P) => ['p1', 'p2'].filter((p) => P.jobLoss[p].enabled).map((p) => `${nameOf(P, p)} ${RP.ui.fmt.monthName(P.jobLoss[p].month)} ${P.jobLoss[p].year}`).join(' · ') || 'Off',
      reset: ['jobLoss'],
      fields: [
        ...['p1', 'p2'].flatMap((pid) => personBlock(pid, [
          { path: 'jobLoss.$.enabled', label: (P, p) => `${nameOf(P, p)} loses job`, type: 'toggle', tip: 'jobLoss' },
          { path: 'jobLoss.$.year', label: 'Year', type: 'year', ...yr(), show: (P, p) => P.jobLoss[p].enabled },
          { path: 'jobLoss.$.month', label: 'Month', ...months, show: (P, p) => P.jobLoss[p].enabled },
          { path: 'jobLoss.$.severance', label: 'Severance', ...money(1e6, 500, 150000), show: (P, p) => P.jobLoss[p].enabled },
          { path: 'jobLoss.$.ui.enabled', label: 'Minnesota unemployment', type: 'toggle', show: (P, p) => P.jobLoss[p].enabled },
          { path: 'jobLoss.$.ui.weekly', label: 'Weekly benefit', ...money(2000, 10, 1200), show: (P, p) => P.jobLoss[p].enabled && P.jobLoss[p].ui.enabled },
          { path: 'jobLoss.$.ui.weeks', label: 'Weeks of benefits', type: 'int', min: 0, max: 52, show: (P, p) => P.jobLoss[p].enabled && P.jobLoss[p].ui.enabled },
          { path: 'jobLoss.$.reemploy.enabled', label: 'Finds a new job', type: 'toggle', show: (P, p) => P.jobLoss[p].enabled },
          { path: 'jobLoss.$.reemploy.afterMonths', label: 'After (months)', type: 'int', min: 0, max: 60, show: (P, p) => P.jobLoss[p].enabled && P.jobLoss[p].reemploy.enabled },
          { path: 'jobLoss.$.reemploy.salary', label: 'New salary', ...money(2e6, 1000, 300000), show: (P, p) => P.jobLoss[p].enabled && P.jobLoss[p].reemploy.enabled },
        ])),
        { path: 'jobLoss.rollOld401kIntoNewPlan', label: 'Roll old 401k into new employer’s plan', type: 'toggle', tip: 'rule55', adv: true },
      ],
    },
    {
      key: 'contributions', title: 'Savings', icon: 'piggy',
      sub: (P) => {
        const c = P.contributions;
        const t = c.p1_401k.amount + c.p1_match.amount + c.p2_401k.amount + c.p2_match.amount + c.hsa.amount + c.rothIra.amount;
        return `${RP.ui.fmt.money(t)}/yr into retirement accounts`;
      },
      reset: ['contributions', 'hsa'],
      fields: [
        ...['p1', 'p2'].flatMap((pid) => personBlock(pid, [
          { path: 'contributions.$_401k.amount', label: (P, p) => `${nameOf(P, p)} 401k (pre-tax)`, ...money(40000, 250, 32500) },
          { path: 'contributions.$_match.amount', label: (P, p) => `${nameOf(P, p)} employer match`, ...money(40000, 250, 20000) },
          { path: 'contributions.$_401k.firstYear', label: '401k first year', type: 'year', ...yr(), adv: true },
          { path: 'contributions.$_401k.lastYear', label: '401k last year (blank = until job ends)', type: 'year', ...yr(), nullable: true, adv: true },
          { path: 'contributions.$_match.firstYear', label: 'Match first year', type: 'year', ...yr(), adv: true },
          { path: 'contributions.$_match.lastYear', label: 'Match last year (blank = until job ends)', type: 'year', ...yr(), nullable: true, adv: true },
        ])),
        { path: 'contributions.hsa.amount', label: 'HSA (family)', ...money(20000, 50, 10000) },
        { path: 'contributions.hsa.firstYear', label: 'HSA first year', type: 'year', ...yr(), adv: true },
        { path: 'contributions.hsa.lastYear', label: 'HSA last year (blank = while working)', type: 'year', ...yr(), nullable: true, adv: true },
        { path: 'contributions.rothIra.amount', label: 'Roth IRAs (both)', ...money(30000, 250, 17200) },
        { path: 'contributions.rothIra.firstYear', label: 'Roth IRA first year', type: 'year', ...yr(), adv: true },
        { path: 'contributions.rothIra.lastYear', label: 'Roth IRA last year (blank = while earning)', type: 'year', ...yr(), nullable: true, adv: true },
        { path: 'contributions.mega.enabled', label: 'Mega backdoor Roth', type: 'toggle', tip: 'megaBackdoor' },
        { path: 'contributions.mega.amount', label: 'Mega backdoor per year', ...money(50000, 500, 30000), show: (P) => P.contributions.mega.enabled },
        { path: 'contributions.mega.firstYear', label: 'Mega backdoor starts', type: 'year', ...yr(), show: (P) => P.contributions.mega.enabled },
        { path: 'contributions.mega.lastYear', label: 'Mega backdoor last year (blank = until job ends)', type: 'year', ...yr(), nullable: true, adv: true, show: (P) => P.contributions.mega.enabled },
        { path: 'contributions.mega.person', label: 'Whose 401k', ...person, adv: true, show: (P) => P.contributions.mega.enabled },
        { path: 'contributions.taxable', label: 'Bridge fund (brokerage) savings', type: 'taxableList', tip: 'bridge' },
        { path: 'contributions.edu.amount', label: 'College savings per year', ...money(50000, 250, 20000) },
        { path: 'contributions.edu.firstYear', label: 'College savings first year', type: 'year', ...yr(), adv: true },
        { path: 'contributions.edu.lastYear', label: 'College savings last year', type: 'year', ...yr(), nullable: true, adv: true },
        { path: 'contributions.leftoverTo', label: 'Leftover cash flow goes to', type: 'select', tip: 'leftover', adv: true,
          options: [{ value: 'brokerage', label: 'Brokerage' }, { value: 'cash', label: 'Cash' }, { value: 'spend', label: 'Spend it' }] },
        { path: 'hsa.receiptsPerYear', label: 'New HSA receipts saved per year', ...money(20000, 250, 10000), tip: 'hsaReceipts', adv: true },
      ],
    },
    {
      key: 'spending', title: 'Spending', icon: 'cart',
      sub: (P) => `${RP.ui.fmt.money(P.spending.working)} now · ${RP.ui.fmt.money(P.spending.retirement)} retired`,
      reset: ['spending.working', 'spending.retirement', 'spending.guardrails', 'spending.phases', 'spending.creepPct', 'hsa.medicalPerYear'],
      fields: [
        { path: 'spending.working', label: 'Core spending while working', ...money(500000, 1000, 200000), note: 'Everything except daycare and taxes.' },
        { path: 'spending.retirement', label: 'Retirement spending', ...money(500000, 1000, 150000), sliderMin: 40000, note: 'Includes ~$4K medical and health premiums. Taxes are extra.' },
        { path: 'spending.daycare.amount', label: 'Daycare per year', ...money(200000, 500, 80000), tip: 'daycare' },
        { path: 'spending.daycare.lastYear', label: 'Daycare last year', type: 'year', ...yr(), adv: true },
        { path: 'spending.daycare.lastYearFraction', label: 'Share of the last year', ...pct(0, 100, 5), scale: 100, adv: true },
        { path: 'spending.guardrails.enabled', label: 'Spending guardrails', type: 'toggle', tip: 'guardrails' },
        { path: 'spending.phases', label: 'Spending phases', type: 'phases', tip: 'phases', adv: true },
        { path: 'hsa.medicalPerYear', label: 'Medical costs in budget (from HSA)', ...money(50000, 250, 15000), adv: true },
        { path: 'spending.creepPct', label: 'Spending creep per year', ...pct(-3, 5, 0.25), adv: true, tip: 'stress' },
      ],
    },
    {
      key: 'extras', title: 'Extra expenses', icon: 'receipt',
      sub: (P) => {
        const n = (P.spending.recurring || []).length + (P.spending.oneTime || []).length;
        return n ? `${n} item${n === 1 ? '' : 's'}` : 'Cars, travel, roof, windfalls';
      },
      reset: ['spending.recurring', 'spending.oneTime'],
      fields: [
        { path: 'spending.recurring', label: 'Recurring', type: 'recurring' },
        { path: 'spending.oneTime', label: 'One-time events', type: 'oneTime' },
      ],
    },
    {
      key: 'housing', title: 'Home & mortgage', icon: 'house',
      sub: (P) => [P.mortgage.enabled ? 'Mortgage' : null, P.housing.downsize.enabled ? `Downsize ${P.housing.downsize.year}` : null, P.housing.move.enabled ? `Move ${P.housing.move.year}` : null].filter(Boolean).join(' · ') || 'No mortgage entered',
      reset: ['mortgage', 'housing'],
      fields: [
        { path: 'mortgage.enabled', label: 'Mortgage', type: 'toggle', tip: 'mortgage' },
        { path: 'mortgage.balance', label: 'Balance owed', ...money(5e6, 1000, 800000), show: (P) => P.mortgage.enabled },
        { path: 'mortgage.ratePct', label: 'Interest rate', ...pct(0, 15, 0.125), show: (P) => P.mortgage.enabled },
        { path: 'mortgage.monthlyPI', label: 'Monthly principal & interest', ...money(20000, 25, 6000), show: (P) => P.mortgage.enabled },
        { path: 'mortgage.extraMonthly', label: 'Extra monthly payment', ...money(10000, 25, 3000), show: (P) => P.mortgage.enabled },
        { path: 'mortgage.payoffYearOverride', label: 'Payoff year (blank = calculate)', type: 'year', ...yr(), nullable: true, show: (P) => P.mortgage.enabled, adv: true },
        { path: 'mortgage.includedInSpending', label: 'Payment is inside my spending', type: 'toggle', show: (P) => P.mortgage.enabled, adv: true },
        { path: 'housing.downsize.enabled', label: 'Downsize or move', type: 'toggle', tip: 'downsize' },
        { path: 'housing.downsize.year', label: 'Year', type: 'year', ...yr(), show: (P) => P.housing.downsize.enabled },
        { path: 'housing.downsize.salePrice', label: 'Sale price (blank = today’s value)', ...money(2e7, 5000, 1500000), nullable: true, show: (P) => P.housing.downsize.enabled },
        { path: 'housing.downsize.newHomeCost', label: 'New home cost', ...money(2e7, 5000, 1500000), show: (P) => P.housing.downsize.enabled },
        { path: 'housing.downsize.annualCostChange', label: 'Yearly housing cost change', type: 'money', min: -100000, max: 100000, step: 500, sliderMin: -20000, sliderMax: 20000, show: (P) => P.housing.downsize.enabled },
        { path: 'housing.downsize.sellingCostPct', label: 'Selling costs', ...pct(0, 15, 0.5), show: (P) => P.housing.downsize.enabled, adv: true },
        { path: 'housing.move.enabled', label: 'Move to another state', type: 'toggle' },
        { path: 'housing.move.year', label: 'Move year', type: 'year', ...yr(), show: (P) => P.housing.move.enabled },
        { path: 'housing.move.taxRatePct', label: 'New state income tax rate', ...pct(0, 15, 0.1), show: (P) => P.housing.move.enabled },
        { path: 'housing.appreciationPct', label: 'Home value growth (above inflation)', ...pct(-3, 5, 0.25), adv: true },
      ],
    },
    {
      key: 'college', title: 'Kids & college', icon: 'cap',
      sub: (P) => (P.college.enabled ? `${P.college.account === 'trump' ? 'Trump Account' : '529'} · on` : 'College costs off'),
      reset: ['college'],
      fields: [
        { path: 'college.enabled', label: 'Include college costs', type: 'toggle', tip: 'college' },
        { path: 'college.account', label: 'Savings account', type: 'select', tip: 'trump', options: [{ value: '529', label: '529' }, { value: 'trump', label: 'Trump Account' }] },
        { path: 'college.kids', label: 'Each child', type: 'collegeKids', show: (P) => P.college.enabled },
        { path: 'college.costGrowthPct', label: 'College cost growth (above inflation)', ...pct(-2, 6, 0.25), show: (P) => P.college.enabled, adv: true },
        { path: 'college.trumpEarningsTaxPct', label: 'Tax on Trump Account growth', ...pct(0, 40, 1), adv: true, show: (P) => P.college.account === 'trump' },
      ],
    },
    {
      key: 'ss', title: 'Social Security', icon: 'bank',
      sub: (P) => `Claim at ${P.ss.p1.claimAge} & ${P.ss.p2.claimAge} · ${P.ss.haircutPct}% haircut`,
      reset: ['ss.p1.claimAge', 'ss.p2.claimAge', 'ss.haircutPct', 'ss.haircutYear'],
      fields: [
        { path: 'ss.p1.claimAge', label: (P) => `${n1(P)} claims at`, type: 'age', min: 62, max: 70, tip: 'ssClaim' },
        { path: 'ss.p2.claimAge', label: (P) => `${n2(P)} claims at`, type: 'age', min: 62, max: 70, tip: 'ssClaim' },
        { path: 'ss.haircutPct', label: 'Solvency haircut', ...pct(0, 60, 1), tip: 'ssHaircut' },
        { path: 'ss.haircutYear', label: 'Haircut starts', type: 'year', ...yr(), adv: true },
        ...['p1', 'p2'].flatMap((pid) => personBlock(pid, [
          { path: 'ss.$.past.years', label: (P, p) => `${nameOf(P, p)}: years worked before ${new Date().getFullYear()}`, type: 'int', min: 0, max: 50, adv: true },
          { path: 'ss.$.past.startYear', label: 'First year worked', type: 'year', min: 1960, max: 2030, sliderMin: 1990, sliderMax: 2026, adv: true },
          { path: 'ss.$.past.avgEarnings', label: 'Average earnings then (today’s $)', ...money(500000, 1000, 200000), adv: true },
          { path: 'ss.$.record', label: 'Paste earnings record (ssa.gov)', type: 'ssRecord', adv: true },
        ])),
      ],
    },
    {
      key: 'bridge', title: 'Early access', icon: 'key',
      sub: (P) => ({ healthCap: 'Convert to health cap', bracket: 'Convert to tax bracket', fixed: 'Fixed conversions', none: 'No conversions' }[P.conversions.strategy]) + (P.sepp.enabled ? ' · 72(t)' : ''),
      reset: ['conversions', 'sepp', 'partTime'],
      fields: [
        { path: 'conversions.strategy', label: 'Roth conversions', type: 'select', tip: 'conversions',
          options: [{ value: 'healthCap', label: 'Health cap' }, { value: 'bracket', label: 'Tax bracket' }, { value: 'fixed', label: 'Fixed' }, { value: 'none', label: 'None' }] },
        { path: 'conversions.fixedAmount', label: 'Convert per year', ...money(500000, 1000, 150000), show: (P) => P.conversions.strategy === 'fixed' },
        { path: 'conversions.bracketRate', label: 'Fill up to bracket', type: 'select', options: [{ value: 10, label: '10%' }, { value: 12, label: '12%' }, { value: 22, label: '22%' }, { value: 24, label: '24%' }], adv: true },
        { path: 'conversions.buffer', label: 'Stay below income lines by', ...money(20000, 100, 5000), tip: 'buffer', adv: true },
        { path: 'conversions.fromFirst', label: 'Convert whose 401k first', ...person, adv: true },
        { path: 'conversions.afterMedicare', label: 'After Medicare, convert up to', type: 'select', adv: true,
          options: [{ value: 'bracket', label: 'Bracket' }, { value: 'irmaa', label: 'IRMAA line' }, { value: 'none', label: 'Stop' }] },
        { path: 'sepp.enabled', label: '72(t) payments', type: 'toggle', tip: 'sepp' },
        { path: 'sepp.mode', label: '72(t) amount', type: 'select', show: (P) => P.sepp.enabled, options: [{ value: 'auto', label: 'Auto' }, { value: 'fixed', label: 'Fixed' }] },
        { path: 'sepp.amount', label: '72(t) per year', ...money(200000, 500, 80000), show: (P) => P.sepp.enabled && P.sepp.mode === 'fixed' },
        { path: 'sepp.person', label: 'From whose 401k', type: 'select', show: (P) => P.sepp.enabled, adv: true,
          options: (P) => [{ value: 'auto', label: 'Auto' }, { value: 'p1', label: n1(P) }, { value: 'p2', label: n2(P) }] },
        { path: 'sepp.ratePct', label: '72(t) interest rate', ...pct(1, 8, 0.1), show: (P) => P.sepp.enabled, adv: true },
        ...['p1', 'p2'].flatMap((pid) => personBlock(pid, [
          { path: 'partTime.$.enabled', label: (P, p) => `${nameOf(P, p)} works part-time`, type: 'toggle', tip: 'partTime' },
          { path: 'partTime.$.amount', label: 'Part-time income per year', ...money(300000, 1000, 80000), show: (P, p) => P.partTime[p].enabled },
          { path: 'partTime.$.firstYear', label: 'From', type: 'year', ...yr(), show: (P, p) => P.partTime[p].enabled },
          { path: 'partTime.$.lastYear', label: 'Through', type: 'year', ...yr(), show: (P, p) => P.partTime[p].enabled },
        ])),
      ],
    },
    {
      key: 'health', title: 'Healthcare', icon: 'medical',
      sub: (P) => `MinnesotaCare up to ${P.health.mncare}% · +${P.health.inflationPct}%/yr`,
      reset: ['health'],
      fields: [
        { path: 'health.inflationPct', label: 'Healthcare inflation (above general)', ...pct(-2, 6, 0.25), tip: 'healthInflation' },
        { path: 'health.acaAdultPremium', label: 'Full marketplace premium per adult', ...money(50000, 250, 20000), tip: 'aca' },
        { path: 'health.acaKidPremium', label: 'Full marketplace premium per child', ...money(30000, 250, 10000), adv: true },
        { path: 'health.acaExtraOOP', label: 'Extra out-of-pocket on marketplace', ...money(30000, 250, 12000) },
        { path: 'health.ltc.enabled', label: 'Long-term care late in life', type: 'toggle', tip: 'ltc' },
        { path: 'health.ltc.startAge', label: 'Starting age', type: 'age', min: 60, max: 105, show: (P) => P.health.ltc.enabled },
        { path: 'health.ltc.years', label: 'Years', type: 'int', min: 1, max: 15, show: (P) => P.health.ltc.enabled },
        { path: 'health.ltc.annualCost', label: 'Cost per year', ...money(500000, 1000, 250000), show: (P) => P.health.ltc.enabled },
        { path: 'health.fpl.base', label: 'Poverty guideline, 1 person', ...money(50000, 10, 30000), tip: 'fpl', adv: true },
        { path: 'health.fpl.perPerson', label: 'Each additional person', ...money(20000, 10, 10000), adv: true },
        { path: 'health.mncare', label: 'MinnesotaCare line (% of poverty)', ...pct(100, 400, 1), tip: 'mncare', adv: true },
        { path: 'health.kidsMA', label: 'Kids’ Medical Assistance line', ...pct(100, 400, 1), tip: 'kidsMA', adv: true },
        { path: 'health.aca', label: 'ACA subsidy line', ...pct(200, 600, 1), tip: 'aca', adv: true },
        { path: 'health.medicareAge', label: 'Medicare age', type: 'age', min: 62, max: 70, adv: true },
      ],
    },
    {
      key: 'life', title: 'Life events', icon: 'life',
      sub: (P) => [P.death.enabled ? `${P.people[P.death.person].name} passes ${P.death.year}` : null, P.disability.enabled ? `${P.people[P.disability.person].name} disabled ${P.disability.year}` : null].filter(Boolean).join(' · ') || 'None',
      reset: ['death', 'disability'],
      fields: [
        { path: 'death.enabled', label: 'A spouse passes away', type: 'toggle', tip: 'death' },
        { path: 'death.person', label: 'Who', ...person, show: (P) => P.death.enabled },
        { path: 'death.year', label: 'Year', type: 'year', ...yr(), show: (P) => P.death.enabled },
        { path: 'death.spendingPct', label: 'Survivor spending (% of before)', ...pct(30, 100, 1), show: (P) => P.death.enabled },
        { path: 'death.lifeInsurance', label: 'Life insurance payout', ...money(1e7, 5000, 2000000), show: (P) => P.death.enabled },
        { path: 'disability.enabled', label: 'Disability', type: 'toggle', tip: 'disability' },
        { path: 'disability.person', label: 'Who', ...person, show: (P) => P.disability.enabled },
        { path: 'disability.year', label: 'Year', type: 'year', ...yr(), show: (P) => P.disability.enabled },
        { path: 'disability.month', label: 'Month', ...months, show: (P) => P.disability.enabled, adv: true },
        { path: 'disability.benefitPct', label: 'Insurance benefit (% of salary)', ...pct(0, 100, 5), show: (P) => P.disability.enabled },
        { path: 'disability.untilAge', label: 'Benefit until age', type: 'age', min: 50, max: 70, show: (P) => P.disability.enabled },
        { path: 'disability.taxable', label: 'Benefit is taxable', type: 'toggle', show: (P) => P.disability.enabled, adv: true },
      ],
    },
    {
      key: 'invest', title: 'Investments', icon: 'trend',
      sub: (P) => `${P.returns.working}% working · ${P.returns.retired}% retired · ±${P.returns.volatility}%`,
      reset: ['returns'],
      fields: [
        { path: 'returns.working', label: 'Return while working', ...pct(2, 8, 0.25), tip: 'returns' },
        { path: 'returns.retired', label: 'Return in retirement', ...pct(2, 8, 0.25), tip: 'returns' },
        { path: 'returns.cash', label: 'Return on cash', ...pct(-1, 4, 0.25) },
        { path: 'returns.volatility', label: 'Volatility', ...pct(5, 30, 0.5), tip: 'volatility' },
        { path: 'returns.meaning', label: 'Return means', type: 'select', tip: 'returns', options: [{ value: 'typical', label: 'Typical growth' }, { value: 'average', label: 'Average year' }] },
        { path: 'returns.source', label: 'Market model', type: 'select', tip: 'historical', options: [{ value: 'model', label: 'Random' }, { value: 'historical', label: 'Historical' }] },
        { path: 'returns.inflation', label: 'Inflation', ...pct(0, 8, 0.1), tip: 'inflation', adv: true },
        { path: 'returns.dividendYield', label: 'Brokerage dividend yield', ...pct(0, 6, 0.1), adv: true },
        { path: 'returns.allocation.enabled', label: 'Use a stock/bond mix', type: 'toggle', tip: 'allocation', adv: true },
        { path: 'returns.allocation.stocks', label: 'Stocks', ...pct(0, 100, 5), adv: true },
        { path: 'returns.allocation.bonds', label: 'Bonds', ...pct(0, 100, 5), adv: true },
        { path: 'returns.allocation.cash', label: 'Cash', ...pct(0, 100, 5), adv: true },
        { path: 'returns.allocation.stockReturn', label: 'Stock return', ...pct(0, 12, 0.25), adv: true, show: (P) => P.returns.allocation.enabled },
        { path: 'returns.allocation.stockVol', label: 'Stock volatility', ...pct(5, 35, 0.5), adv: true, show: (P) => P.returns.allocation.enabled },
        { path: 'returns.allocation.bondReturn', label: 'Bond return', ...pct(-2, 6, 0.25), adv: true, show: (P) => P.returns.allocation.enabled },
        { path: 'returns.allocation.bondVol', label: 'Bond volatility', ...pct(1, 20, 0.5), adv: true, show: (P) => P.returns.allocation.enabled },
        { path: 'returns.allocation.glide.enabled', label: 'Glide path toward bonds', type: 'toggle', adv: true },
        { path: 'returns.allocation.glide.retiredStocks', label: 'Stocks at retirement', ...pct(0, 100, 5), adv: true, show: (P) => P.returns.allocation.glide.enabled },
        { path: 'returns.allocation.glide.yearsBefore', label: 'Glide over (years)', type: 'int', min: 1, max: 30, adv: true, show: (P) => P.returns.allocation.glide.enabled },
        { path: 'returns.speculative.enabled', label: 'Speculative sleeve', type: 'toggle', tip: 'speculative', adv: true },
        { path: 'returns.speculative.pct', label: 'Sleeve size', ...pct(0, 20, 0.5), adv: true, show: (P) => P.returns.speculative.enabled },
        { path: 'returns.speculative.vol', label: 'Sleeve volatility', ...pct(10, 150, 5), adv: true, show: (P) => P.returns.speculative.enabled },
        { path: 'returns.accountAdjust.preTax', label: 'Pre-tax accounts: extra return', ...pct(-3, 3, 0.25), adv: true, tip: 'accountAdjust' },
        { path: 'returns.accountAdjust.roth', label: 'Roth: extra return', ...pct(-3, 3, 0.25), adv: true, tip: 'accountAdjust' },
        { path: 'returns.accountAdjust.hsa', label: 'HSA: extra return', ...pct(-3, 3, 0.25), adv: true },
        { path: 'returns.accountAdjust.taxable', label: 'Brokerage: extra return', ...pct(-3, 3, 0.25), adv: true },
        { path: 'returns.accountAdjust.edu', label: '529 / Trump: extra return', ...pct(-3, 3, 0.25), adv: true },
        { path: 'returns.stress.crash.enabled', label: 'Crash in first retirement year', type: 'toggle', tip: 'stress', adv: true },
        { path: 'returns.stress.crash.pct', label: 'Crash size', ...pct(-60, 0, 1), adv: true, show: (P) => P.returns.stress.crash.enabled },
        { path: 'returns.stress.lostDecade.enabled', label: 'Lost decade', type: 'toggle', tip: 'stress', adv: true },
        { path: 'returns.stress.lostDecade.returnPct', label: 'Lost-decade return', ...pct(-5, 4, 0.25), adv: true, show: (P) => P.returns.stress.lostDecade.enabled },
      ],
    },
    {
      key: 'taxes', title: 'Taxes', icon: 'book',
      sub: (P) => (P.tax.futureRates.enabled ? `Rates +${P.tax.futureRates.increasePct}% from ${P.tax.futureRates.startYear}` : '2026 law'),
      reset: ['tax'],
      fields: [
        { path: 'tax.futureRates.enabled', label: 'Higher future tax rates', type: 'toggle', tip: 'futureRates' },
        { path: 'tax.futureRates.startYear', label: 'Starting', type: 'year', ...yr(), show: (P) => P.tax.futureRates.enabled },
        { path: 'tax.futureRates.increasePct', label: 'Rates higher by', ...pct(0, 100, 5), show: (P) => P.tax.futureRates.enabled },
        { path: 'tax.rmdAge', label: 'RMD age', type: 'age', min: 70, max: 80, tip: 'rmd', adv: true },
        { path: 'tax.federal.std.mfj', label: 'Federal standard deduction (joint)', ...money(100000, 50, 60000), adv: true, tip: 'taxes' },
        { path: 'tax.federal.ctc', label: 'Child tax credit per child', ...money(10000, 50, 5000), adv: true },
        { path: 'tax.federal.brackets.mfj', label: 'Federal brackets (joint)', type: 'brackets', adv: true },
        { path: 'tax.federal.brackets.single', label: 'Federal brackets (single)', type: 'brackets', adv: true },
        { path: 'tax.mn.std.mfj', label: 'Minnesota standard deduction (joint)', ...money(100000, 50, 60000), adv: true },
        { path: 'tax.mn.dependentExemption', label: 'Minnesota dependent exemption', ...money(20000, 50, 10000), adv: true },
        { path: 'tax.mn.ctc.perChild', label: 'Minnesota child credit', ...money(10000, 50, 5000), adv: true },
        { path: 'tax.mn.brackets.mfj', label: 'Minnesota brackets (joint)', type: 'brackets', adv: true },
        { path: 'tax.fica.wageBase', label: 'Social Security wage base', ...money(500000, 100, 300000), adv: true },
      ],
    },
    {
      key: 'sim', title: 'Simulation', icon: 'gear',
      sub: (P) => `${P.sim.runs.toLocaleString()} runs · target ${P.sim.successTarget}%`,
      reset: ['sim'],
      fields: [
        { path: 'sim.runs', label: 'Runs per scenario', type: 'int', min: 100, max: 5000, step: 100, sliderMin: 200, sliderMax: 3000, tip: 'runs' },
        { path: 'sim.successTarget', label: 'Safe-spending target', ...pct(50, 99, 1), tip: 'safeSpend' },
        { path: 'sim.greenLightTarget', label: 'Green-light target', ...pct(50, 99, 1), tip: 'greenLight' },
        { path: 'sim.coastTarget', label: 'Coast FIRE target', ...pct(50, 99, 1), tip: 'coast' },
        { path: 'sim.coastYear', label: 'Stop all saving in (Coast test)', type: 'year', ...yr(), nullable: true, adv: true, tip: 'coast' },
        { path: 'sim.seed', label: 'Random seed', type: 'int', min: 1, max: 999999999, step: 1, adv: true },
      ],
    },
  ];
})(globalThis.RP = globalThis.RP || {});
