/*
 * setup.js — "Set up your plan": five short steps (you two, kids, savings,
 * income, spending & goal) that build a plan from scratch, for anyone without
 * a plan file. Everything else starts from sensible defaults and can be
 * fine-tuned on the Plan tab. Replacing a plan can be undone.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt, U = RP.util;
  const store = () => RP.store;
  const SU = (UI.setup = {});
  const MONTHS = Array.from({ length: 12 }, (_, i) => fmt.monthName(i + 1));

  // ---------------------------------------------------------------- fields
  const labeled = (label, input, flex) => h('label.su-field', { style: flex ? { flex: String(flex) } : null }, h('div.label', label), input);
  const blurActive = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };

  function textField(label, d, key, placeholder) {
    const input = h('input.textfield', { type: 'text', value: d[key], placeholder, autocomplete: 'off' });
    input.addEventListener('input', () => { d[key] = input.value; });
    return labeled(label, input);
  }
  /** Whole numbers (years, ages, percents). */
  function numField(label, d, key, opts) {
    opts = opts || {};
    const input = h('input.textfield', { type: 'text', inputmode: opts.decimal ? 'decimal' : 'numeric', value: d[key] == null ? '' : String(d[key]) });
    input.addEventListener('change', () => {
      const v = Number(String(input.value).replace(/[^0-9.]/g, ''));
      if (input.value.trim() !== '' && isFinite(v)) d[key] = opts.min != null ? Math.max(opts.min, Math.min(opts.max, v)) : v;
      input.value = d[key] == null ? '' : String(d[key]);
    });
    return labeled(label, input, opts.flex);
  }
  /** Dollars: shown as $12,345, edited as a plain number. */
  function moneyField(label, obj, key) {
    const show = () => fmt.money(obj[key] || 0, { full: true });
    const input = h('input.textfield', { type: 'text', inputmode: 'numeric', value: show() });
    input.addEventListener('focus', () => { input.value = obj[key] ? String(Math.round(obj[key])) : ''; setTimeout(() => input.select(), 10); });
    input.addEventListener('blur', () => {
      const raw = String(input.value).replace(/[^0-9.]/g, '');
      obj[key] = raw === '' ? 0 : Math.max(0, Number(raw) || 0);
      input.value = show();
    });
    return labeled(label, input);
  }
  function monthField(label, d, key) {
    const sel = h('select.textfield', { 'aria-label': label }, MONTHS.map((m, i) => h('option', { value: String(i + 1) }, m)));
    sel.value = String(d[key]);
    sel.addEventListener('change', () => { d[key] = Number(sel.value); });
    return labeled(label, sel, 0.8);
  }
  const pair = (...kids) => h('div.su-pair', kids);

  // ---------------------------------------------------------------- the plan
  /** Turn the answers into a full plan. Anything not asked keeps a neutral default. */
  function buildPlan(d) {
    const today = new Date().toISOString().slice(0, 10);
    const y0 = Number(today.slice(0, 4));
    const P = RP.engine.resolvePlan({});
    const name1 = d.n1.trim() || 'Person 1', name2 = d.n2.trim() || 'Person 2';
    P.meta = { planName: `${name1} & ${name2}`, lastUpdated: today, isSample: false };
    P.people.p1 = { name: name1, birthYear: d.b1, birthMonth: d.m1, employer: 'Employer 1' };
    P.people.p2 = { name: name2, birthYear: d.b2, birthMonth: d.m2, employer: 'Employer 2' };
    P.kids = d.kids.filter((k) => k.birthYear).map((k, i) => ({ name: k.name.trim() || `Child ${i + 1}`, birthYear: k.birthYear, birthMonth: 6 }));
    P.household.state = d.state;
    P.household.stateTaxPct = d.state === 'MN' ? 0 : d.stateTax;
    P.household.horizonPerson = d.b1 >= d.b2 ? 'p1' : 'p2'; // until the younger one is 95

    const B = d.bal;
    // Not asked (most people don't know offhand): estimate, and say so at the end.
    Object.assign(P.balances, B, { asOf: today, rothBasis: Math.round(B.roth * 0.7), rothP1SharePct: 50, hsaReceipts: 0, brokerageBasis: Math.round(B.brokerage * 0.8) });

    P.retirement = { p1Age: d.age1, together: d.together, p2Age: d.together ? d.b1 + d.age1 - d.b2 : d.age2 };
    P.income.p1 = { salary: d.sal1, raisePct: 0, newJob: { enabled: false, year: y0 + 3, month: 1, salary: d.sal1 } };
    P.income.p2 = { salary: d.sal2, raisePct: 0, newJob: { enabled: false, year: y0 + 3, month: 1, salary: d.sal2 } };
    const c = (amount) => ({ amount, firstYear: y0, lastYear: null });
    Object.assign(P.contributions, {
      p1_401k: c(d.k1), p1_match: c(d.match1), p2_401k: c(d.k2), p2_match: c(d.match2), hsa: c(d.hsa), rothIra: c(d.rothIra),
      mega: Object.assign({}, P.contributions.mega, { enabled: false, firstYear: y0 }),
      taxable: [], edu: { amount: 0, firstYear: y0, lastYear: null }, leftoverTo: 'brokerage',
    });
    P.hsa.receiptsPerYear = 0;
    Object.assign(P.spending, {
      working: d.spendNow, retirement: d.spendRet, phases: { enabled: false, list: [] },
      daycare: { amount: 0, firstYear: y0, lastYear: y0, lastYearFraction: 1 }, recurring: [], oneTime: [],
    });
    P.college.enabled = false;
    P.college.kids = P.kids.map((k) => ({ enabled: true, startYear: k.birthYear + 18, years: 4, annualCost: 28000, coverPct: 50 }));
    // Social Security: past earnings estimated from today's pay, from age 22.
    for (const [pid, b, sal] of [['p1', d.b1, d.sal1], ['p2', d.b2, d.sal2]]) {
      P.ss[pid] = { claimAge: 67, past: { startYear: b + 22, years: U.clamp(y0 - (b + 22), 0, 45), avgEarnings: Math.round(sal * 0.8) }, record: [] };
    }
    // Dates for options that start switched off, moved near today.
    const retireYear = d.b1 + d.age1 + 1;
    for (const pid of ['p1', 'p2']) {
      Object.assign(P.jobLoss[pid], { enabled: false, year: y0 + 2 });
      Object.assign(P.partTime[pid], { enabled: false, firstYear: retireYear, lastYear: retireYear + 4 });
    }
    Object.assign(P.disability, { enabled: false, year: y0 + 3 });
    Object.assign(P.death, { enabled: false, year: Math.max(y0 + 1, d.b1 + 80) });
    P.housing.downsize.year = Math.max(y0 + 1, retireYear + 5);
    P.housing.move.year = Math.max(y0 + 1, retireYear);
    P.mortgage.enabled = false;
    P.sim.coastYear = null;
    return P;
  }

  // ---------------------------------------------------------------- the steps
  SU.start = function () {
    const y = new Date().getFullYear();
    const own = !store().state.plan.meta.isSample;
    const d = {
      n1: '', b1: y - 40, m1: 1, n2: '', b2: y - 40, m2: 1, state: 'MN', stateTax: 4.5,
      kids: [],
      bal: { p1_401k: 0, p2_401k: 0, roth: 0, hsa: 0, cash: 0, brokerage: 0, edu: 0, homeEquity: 0 },
      sal1: 0, sal2: 0, k1: 0, k2: 0, match1: 0, match2: 0, hsa: 0, rothIra: 0,
      spendNow: 60000, spendRet: 60000, age1: 60, together: true, age2: 60,
    };
    const who = (k) => d[k].trim() || (k === 'n1' ? 'You' : 'Your partner');
    const steps = [
      { title: 'You two', note: own ? 'This starts a new plan in place of your current one (you can undo). Horizon plans for two people.' : 'Horizon plans for two people. Names only appear on your screen.',
        body: () => {
          const stateBox = h('div');
          const drawState = () => UI.mount(stateBox, d.state === 'MN' ? h('p.su-hint', 'Minnesota’s tax rules and health programs (MinnesotaCare, MNsure) are built in.')
            : numField('State income tax rate (%)', d, 'stateTax', { decimal: true, min: 0, max: 15 }));
          drawState();
          return [
            textField('Your name', d, 'n1', 'Alex'),
            pair(numField('Born', d, 'b1', { min: 1930, max: y - 16 }), monthField('Month', d, 'm1')),
            textField('Partner’s name', d, 'n2', 'Sam'),
            pair(numField('Born', d, 'b2', { min: 1930, max: y - 16 }), monthField('Month', d, 'm2')),
            h('div.label.su-label', 'State'),
            UI.segmented({ options: [{ value: 'MN', label: 'Minnesota' }, { value: 'other', label: 'Another state' }], value: d.state, onChange: (v) => { d.state = v; drawState(); } }),
            stateBox,
          ];
        } },
      { title: 'Kids', note: 'Kids living with you count for taxes, health programs and (optionally) college. Skip if none.',
        body: (redraw) => [
          ...d.kids.map((k, i) => h('div.su-kid',
            pair(textField('Name', k, 'name', `Child ${i + 1}`), numField('Born', k, 'birthYear', { min: 1990, max: y + 1, flex: 0.7 })),
            h('button.icon-btn', { 'aria-label': 'Remove', style: { color: 'var(--bad)' }, onclick: () => { blurActive(); d.kids.splice(i, 1); redraw(); } }, UI.icon('trash')))),
          h('button.btn.block', { onclick: () => { blurActive(); d.kids.push({ name: '', birthYear: y - 5 }); redraw(); } }, UI.icon('plus'), 'Add a child'),
        ] },
      { title: 'Savings today', note: 'From your account websites. Round numbers are fine.',
        body: () => [
          moneyField(`${who('n1')}: 401k / 403b / IRA`, d.bal, 'p1_401k'), moneyField(`${who('n2')}: 401k / 403b / IRA`, d.bal, 'p2_401k'),
          moneyField('Roth IRAs (both of you)', d.bal, 'roth'), moneyField('HSA', d.bal, 'hsa'),
          moneyField('Cash (savings, checking)', d.bal, 'cash'), moneyField('Taxable brokerage', d.bal, 'brokerage'),
          moneyField('College savings (529)', d.bal, 'edu'), moneyField('Home equity', d.bal, 'homeEquity'),
        ] },
      { title: 'Income & saving', note: 'Yearly amounts, before taxes. Use $0 for anyone not working.',
        body: () => [
          moneyField(`${who('n1')}: salary`, d, 'sal1'), moneyField(`${who('n2')}: salary`, d, 'sal2'),
          moneyField(`${who('n1')}: 401k contributions`, d, 'k1'), moneyField(`${who('n1')}: employer match`, d, 'match1'),
          moneyField(`${who('n2')}: 401k contributions`, d, 'k2'), moneyField(`${who('n2')}: employer match`, d, 'match2'),
          moneyField('HSA contributions (family)', d, 'hsa'), moneyField('Roth IRA contributions (both)', d, 'rothIra'),
        ] },
      { title: 'Spending & goal', note: 'In today’s dollars, not counting taxes or what you save.',
        body: (redraw) => [
          moneyField('Spending now, per year', d, 'spendNow'),
          moneyField('Spending in retirement, per year', d, 'spendRet'),
          h('p.su-hint', 'Include health insurance and medical costs in retirement spending. Taxes are added for you.'),
          numField(`${who('n1')} retires at age`, d, 'age1', { min: 30, max: 80 }),
          UI.toggleRow({ label: 'Retire together', checked: d.together, onChange: (on) => { blurActive(); d.together = on; redraw(); } }),
          d.together ? null : numField(`${who('n2')} retires at age`, d, 'age2', { min: 30, max: 80 }),
        ] },
    ];

    let step = 0;
    const body = h('div');
    const draw = () => {
      const s = steps[step];
      UI.mount(body,
        h('div.steps', steps.map((x, i) => h('span' + (i === step ? '.on' : i < step ? '.done' : '')))),
        h('p.tip-text.muted', { style: { marginTop: '8px' } }, s.note),
        h('div.su-body', s.body(draw)));
      UI.sheet.open({
        title: `Set up · ${s.title}`, body,
        actions: [
          step > 0 ? { label: 'Back', onClick: () => { blurActive(); step--; draw(); } } : { label: 'Cancel', onClick: () => UI.sheet.close() },
          step < steps.length - 1 ? { label: 'Next', primary: true, onClick: () => { blurActive(); step++; draw(); } }
            : { label: 'Create my plan', primary: true, onClick: () => { blurActive(); finish(); } },
        ],
      });
    };
    const finish = () => {
      store().startPlan(buildPlan(d));
      RP.app.go('home');
      UI.sheet.open({
        title: 'Your plan is ready',
        body: [
          h('p.tip-text', 'Everything stays on this device. A few things were estimated; you can refine them any time on the Plan tab:'),
          h('ul.as-list',
            h('li', 'Social Security uses past earnings estimated from today’s salaries. Paste your record from ssa.gov in Plan › Social Security for a better number.'),
            h('li', 'Roth contributions are set to 70% of your Roth balance, and brokerage cost basis to 80% of its value.'),
            h('li', 'A mortgage, college costs, job changes, part-time work and more are in the Plan tab.')),
          h('p.tip-text.muted', { style: { fontSize: '14px' } }, 'Tip: export a backup from Plan › Export backup once you’re happy with it.'),
        ],
        actions: [{ label: 'Undo', onClick: () => { store().undo(); UI.sheet.close(); } }, { label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
      });
    };
    draw();
  };

  SU.buildPlan = buildPlan; // for the tests
})(globalThis.RP = globalThis.RP || {});
