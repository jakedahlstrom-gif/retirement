/*
 * lab.js — the math behind the Lab tab:
 *
 *   RP.engine.mixerKnobs(plan)            the Mixer's faders and pads, starting where your plan is
 *   RP.engine.mixOverrides(plan, mix)     a mix as plain scenario overrides (only what moved)
 *   RP.engine.mixPath(plan)               the typical-market path, quick enough to redraw while you drag
 *   RP.engine.mixOdds(plan, runs)         chance of success, with the 10th / 50th / 90th percentile paths
 *   RP.engine.decisionCells(plan)         the decision map's grid: retirement age × spending
 *   RP.engine.decisionMap(plan, opts, on) success for some or all of those cells
 *   RP.engine.rollLife(plan, k)           Monte Carlo life number k, year by year, with its markets
 *   RP.engine.ridgeline(plan)             how spread out savings are at a few ages, across every run
 *   RP.engine.planScore(analysis, safe)   the plan's report card: six parts, a score and a grade
 *
 * Everything reuses the plan's own random market years (same seed), so a
 * difference between two settings comes from the setting, not from luck.
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;

  const yearOf = (P) => Number(String(P.balances.asOf).slice(0, 4));
  /** The years-of-work ahead check used for retirement-date controls. */
  const stillWorking = (P) => { const ry = E.retireYears(P); return Math.max(ry.p1, ry.p2) >= yearOf(P); };
  /** People who haven't started Social Security yet. */
  const ssOpen = (P) => ['p1', 'p2'].filter((pid) => P.people[pid].birthYear + P.ss[pid].claimAge > yearOf(P));
  const withOverrides = (P, o) => {
    const Q = U.clone(P);
    for (const [path, v] of Object.entries(o)) U.setPath(Q, path, U.clone(v));
    return E.resolvePlan(Q);
  };

  // ------------------------------------------------------------ the Mixer
  /**
   * Faders: { key, label, min, max, step, value } (value = where the plan is now).
   * Pads: { key, label, on }. Only the controls that make sense for this plan.
   */
  E.mixerKnobs = function (rawPlan) {
    const P = E.resolvePlan(rawPlan);
    const y0 = yearOf(P);
    const R = P.returns;
    const faders = [], pads = [];
    const fader = (key, label, min, max, step, value) => faders.push({ key, label, min, max, step, value: U.clamp(value, min, max) });

    if (stillWorking(P)) {
      const cur = P.retirement.p1Age;
      fader('age', 'Retire at', Math.min(cur, Math.max(40, y0 - 1 - P.people.p1.birthYear)), Math.max(cur, 75), 1, cur);
    }
    fader('spend', 'Spending', 50, 150, 5, 100);
    if (stillWorking(P) && P.contributions.leftoverTo !== 'spend') fader('save', 'Saving', -20000, 20000, 1000, 0);
    if (R.source !== 'historical') {
      fader('ret', 'Returns', -3, 3, 0.5, 0);
      fader('swing', 'Swings', 0.4, 2, 0.1, 1);
    }
    const open = ssOpen(P);
    if (open.length) {
      const lo = Math.max(62, ...open.map((pid) => Math.min(70, y0 - P.people[pid].birthYear)));
      fader('ss', 'Claim SS', lo, 70, 1, P.ss[open[0]].claimAge);
    }
    const pt = P.partTime.p1;
    if (!(P.death.enabled && P.death.person === 'p1')) fader('part', 'Part-time', 0, 60000, 2500, pt.enabled ? pt.amount : 0);
    fader('life', 'Plan to age', 85, 105, 1, P.household.horizonAge);

    pads.push({ key: 'guard', label: 'Guardrails', on: !!P.spending.guardrails.enabled });
    pads.push({ key: 'roth', label: 'Roth conversions', on: P.conversions.strategy !== 'none' });
    pads.push({ key: 'care', label: 'Long-term care', on: !!P.health.ltc.enabled });
    pads.push({ key: 'gift', label: 'Inheritance', on: false });
    pads.push({ key: 'crash', label: 'Crash at retirement', on: !!R.stress.crash.enabled });
    pads.push({ key: 'lost', label: 'Lost decade', on: !!R.stress.lostDecade.enabled });
    return { faders, pads, y0 };
  };

  /** The inheritance pad: this much arrives this many years from now. */
  E.MIX_GIFT = { amount: 250000, inYears: 10 };

  /**
   * A mix ({ faderKey: value, …, pads: { padKey: bool } }) as scenario
   * overrides. Controls left where the plan has them add nothing.
   */
  E.mixOverrides = function (rawPlan, mix) {
    const P = E.resolvePlan(rawPlan);
    const knobs = E.mixerKnobs(P);
    const start = Object.fromEntries(knobs.faders.map((f) => [f.key, f.value]));
    const startPad = Object.fromEntries(knobs.pads.map((p) => [p.key, p.on]));
    const moved = (k) => k in start && mix[k] != null && Math.abs(mix[k] - start[k]) > 1e-9;
    const padMoved = (k) => k in startPad && mix.pads && mix.pads[k] != null && !!mix.pads[k] !== startPad[k];
    const o = {};
    const R = P.returns, A = R.allocation, y0 = knobs.y0;

    if (moved('age')) {
      const d = mix.age - P.retirement.p1Age;
      o['retirement.p1Age'] = mix.age;
      if (!P.retirement.together) o['retirement.p2Age'] = U.clamp(P.retirement.p2Age + d, 30, 80);
    }
    if (moved('spend')) {
      const k = mix.spend / 100;
      o['spending.retirement'] = Math.round(P.spending.retirement * k);
      const ph = P.spending.phases;
      if (ph && ph.enabled && (ph.list || []).length) o['spending.phases'] = Object.assign({}, ph, { list: ph.list.map((p) => Object.assign({}, p, { amount: Math.round(p.amount * k) })) });
    }
    if (moved('save')) o['spending.working'] = Math.max(0, P.spending.working - mix.save);
    if (moved('ret')) {
      if (A.enabled) { o['returns.allocation.stockReturn'] = A.stockReturn + mix.ret; o['returns.allocation.bondReturn'] = A.bondReturn + mix.ret; }
      else { o['returns.working'] = R.working + mix.ret; o['returns.retired'] = R.retired + mix.ret; }
    }
    if (moved('swing')) {
      const k = mix.swing;
      if (A.enabled) { o['returns.allocation.stockVol'] = Math.round(A.stockVol * k * 10) / 10; o['returns.allocation.bondVol'] = Math.round(A.bondVol * k * 10) / 10; }
      else o['returns.volatility'] = Math.round(R.volatility * k * 10) / 10;
    }
    if (moved('ss')) for (const pid of ssOpen(P)) o[`ss.${pid}.claimAge`] = mix.ss;
    if (moved('part')) {
      if (mix.part > 0) {
        const pt = P.partTime.p1;
        const ret = E.retireYears(withOverrides(P, o)).p1 + 1;
        const first = pt.enabled ? pt.firstYear : Math.max(ret, y0 + 1);
        o['partTime.p1.enabled'] = true;
        o['partTime.p1.amount'] = mix.part;
        o['partTime.p1.firstYear'] = first;
        o['partTime.p1.lastYear'] = pt.enabled ? pt.lastYear : first + 4;
      } else o['partTime.p1.enabled'] = false;
    }
    if (moved('life')) o['household.horizonAge'] = mix.life;

    if (padMoved('guard')) o['spending.guardrails.enabled'] = !!mix.pads.guard;
    if (padMoved('roth')) o['conversions.strategy'] = mix.pads.roth ? 'healthCap' : 'none';
    if (padMoved('care')) o['health.ltc.enabled'] = !!mix.pads.care;
    if (padMoved('gift') && mix.pads.gift) o['spending.oneTime'] = (P.spending.oneTime || []).concat([{ year: y0 + E.MIX_GIFT.inYears, amount: E.MIX_GIFT.amount, kind: 'windfall', label: 'Inheritance' }]);
    if (padMoved('crash')) o['returns.stress.crash.enabled'] = !!mix.pads.crash;
    if (padMoved('lost')) o['returns.stress.lostDecade.enabled'] = !!mix.pads.lost;
    return o;
  };

  /** Typical-market savings on Jan 1 of each year (today through the year after the plan ends). */
  E.mixPath = function (rawPlan) {
    const P = E.resolvePlan(rawPlan);
    const { S, det } = E.typicalRun(P, false);
    const start = E.portfolio(E.initState(P));
    const values = [Math.round(start)];
    for (let i = 0; i < S.n; i++) values.push(Math.round(det.totals[i]));
    return {
      years: S.years.concat([S.yEnd + 1]), values, failYear: det.failYear,
      retireYear: S.retireYear, endYear: S.yEnd, end: det.totals[S.n - 1],
      ageAt: { p1: P.people.p1.birthYear, p2: P.people.p2.birthYear }, horizon: P.household.horizonPerson,
      spending: P.spending.retirement,
    };
  };

  /** Chance of success plus the 10th / 50th / 90th percentile of savings (Jan 1, like mixPath). */
  E.mixOdds = function (rawPlan, runs) {
    const P = E.resolvePlan(rawPlan);
    const S = E.buildSchedule(P);
    const det = E.simulate(P, S, E.deterministicReturns(P, S), { detail: true });
    let sepp = null;
    if (P.sepp.enabled) { sepp = E.resolveSepp(P, S, det); if (!sepp || !(sepp.payment > 0)) sepp = null; }
    const mc = E.monteCarlo(P, S, { runs: runs || 300, planPath: det.rows.map((r) => r.startTotal), sepp });
    const start = Math.round(E.portfolio(E.initState(P)));
    const band = (b) => [start].concat(b.map(Math.round));
    return { success: mc.successRate, runs: mc.runs, p10: band(mc.bands.p10), p50: band(mc.bands.p50), p90: band(mc.bands.p90) };
  };

  // ------------------------------------------------------------ decision map
  /**
   * Retirement age (person 1, rows) × retirement spending (columns, % of
   * today's plan). Cells come back ordered from yours outward, so the map
   * fills in around where you are.
   */
  E.decisionCells = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const y0 = yearOf(P);
    const cur = P.retirement.p1Age;
    const working = stillWorking(P);
    const nowAge = Math.max(30, y0 - 1 - P.people.p1.birthYear);
    // Nine ages that take in yours and (if known) the earliest that works.
    let ages = [cur];
    if (working) {
      const ROWS = 9;
      let lo = Math.max(nowAge, Math.min(cur - 4, (opts.earliest || cur) - 2));
      if (cur > lo + ROWS - 1) lo = cur - ROWS + 1;
      let hi = Math.min(80, lo + ROWS - 1);
      lo = Math.max(nowAge, Math.min(lo, hi - ROWS + 1));
      ages = [];
      for (let a = lo; a <= hi; a++) ages.push(a);
    }
    // Seven spending levels from 60% of your plan up past safe spending (if known).
    const room = opts.safeRatio ? Math.round(opts.safeRatio * 10) * 10 + 30 : 140;
    const hiPct = U.clamp(room, 140, 240);
    const step = Math.max(10, Math.round((hiPct - 60) / 6 / 10) * 10);
    const pcts = Array.from({ length: 7 }, (_, j) => 60 + j * step);
    if (!pcts.includes(100)) { pcts.push(100); pcts.sort((a, b) => a - b); }
    const ci = ages.indexOf(cur), cj = pcts.indexOf(100);
    const cells = [];
    ages.forEach((age, i) => pcts.forEach((pct, j) => cells.push({ i, j, age, pct, amount: Math.round(P.spending.retirement * pct / 100) })));
    cells.sort((a, b) => (Math.hypot(a.i - ci, a.j - cj) - Math.hypot(b.i - ci, b.j - cj)) || (a.i - b.i) || (a.j - b.j));
    return { ages, pcts, cells, current: { age: cur, pct: 100 }, spending: P.spending.retirement, target: P.sim.successTarget, working };
  };

  /** The overrides that put a plan in one decision-map cell. */
  E.decisionOverrides = function (rawPlan, cell) {
    const P = E.resolvePlan(rawPlan);
    const o = {};
    const knobs = { age: cell.age, spend: cell.pct };
    if (cell.age === P.retirement.p1Age) delete knobs.age;
    Object.assign(o, E.mixOverrides(P, knobs));
    return o;
  };

  /** Success for each cell (opts.cells, or every cell); onCell(cell) as each finishes. */
  E.decisionMap = function (rawPlan, opts, onCell) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const runs = opts.runs || 120;
    const cells = opts.cells || E.decisionCells(P).cells;
    return cells.map((c) => {
      const out = Object.assign({}, c, { success: E.successRate(withOverrides(P, E.decisionOverrides(P, c)), runs) });
      if (onCell) onCell(out);
      return out;
    });
  };

  // ------------------------------------------------------------ roll a life
  const endsMemo = { key: null, ends: null };
  /**
   * Life number k (0-based) of the Monte Carlo: the very same draws the
   * headline number uses. Each year: ages, the market's return, savings, what
   * came in and went out. Plus how its ending ranks against every other life.
   */
  E.rollLife = function (rawPlan, k) {
    const P = E.resolvePlan(rawPlan);
    const runs = P.sim.runs;
    k = U.clamp(Math.floor(Number(k) || 0), 0, runs - 1);
    const { S, det, sepp } = E.typicalRun(P, true);
    const planPath = det.rows.map((r) => r.startTotal);
    const rets = E.mcReturns(P, S, runs, P.sim.seed);
    const n = S.n;
    const life = E.simulate(P, S, { inv: rets.inv.subarray(k * n, (k + 1) * n), cash: rets.cash }, { detail: true, planPath, sepp, stopOnFail: false });
    // Rank: how many lives end with less (memoized per plan, since rolling again is common).
    const key = JSON.stringify(P);
    if (endsMemo.key !== key) {
      const ends = new Float64Array(runs);
      for (let r = 0; r < runs; r++) {
        const res = E.simulate(P, S, { inv: rets.inv.subarray(r * n, (r + 1) * n), cash: rets.cash }, { planPath, sepp, stopOnFail: true });
        ends[r] = res.success ? res.totals[n - 1] : -1e9 + (res.failYear || 0); // running short earlier ranks lower
      }
      endsMemo.key = key; endsMemo.ends = ends;
    }
    const ends = endsMemo.ends, mine = ends[k];
    let below = 0;
    for (let r = 0; r < runs; r++) if (ends[r] < mine) below++;
    const rows = life.rows.map((r) => ({
      year: r.year, ages: r.ages, ret: r.returnPct / 100, start: Math.round(r.startTotal), end: Math.round(r.balances.total),
      retired: r.retired, income: Math.round(r.income.wages + r.income.partTime + r.income.ss + r.income.ui + r.income.disability + r.income.windfall),
      spent: Math.round(r.spending.core + r.spending.daycare + r.spending.health + r.spending.college + r.spending.extras + r.spending.mortgageAdj + r.spending.medicalGrowth),
      cut: !!r.spending.guardrailCut, short: r.from.shortfall > 0,
    }));
    const geo = (list) => (list.length ? Math.exp(list.reduce((t, x) => t + Math.log(1 + x), 0) / list.length) - 1 : 0);
    const retRows = rows.filter((r) => r.retired);
    return {
      k, runs, rows, failYear: life.failYear, success: life.success, end: rows.length ? rows[rows.length - 1].end : 0,
      rank: below / Math.max(1, runs - 1), retireYear: S.retireYear,
      avgReturn: geo(rows.map((r) => r.ret)), avgRetired: geo(retRows.map((r) => r.ret)),
      planReturn: geo(det.rows.map((r) => r.returnPct / 100)),
      horizon: P.household.horizonPerson, names: { p1: P.people.p1.name, p2: P.people.p2.name },
    };
  };

  // ------------------------------------------------------------ ridgeline
  /**
   * The spread of savings across every run at a few ages (every 5 years from
   * retirement), as smooth curves over a log scale. Lives that have run
   * short are counted separately (they'd be at $0, off a log scale).
   */
  E.ridgeline = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const { S, det, sepp } = E.typicalRun(P, true);
    const runs = Math.min(opts.runs || 600, P.sim.runs);
    const mc = E.monteCarlo(P, S, { runs, planPath: det.rows.map((r) => r.startTotal), sepp, keepTotals: true, rawTotals: true });
    if (!mc.totals) throw new Error('ridgeline needs raw totals');
    const n = S.n, T = mc.totals;
    const first = Math.max(0, S.retireIdx);
    const idx = [];
    for (let i = first; i < n; i += 5) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    // Log-dollar range from every kept value.
    let hi = 0;
    for (let k = 0; k < T.length; k++) if (T[k] > hi) hi = T[k];
    const lo = 4; // $10K: the left edge (log10 dollars)
    const top = Math.max(lo + 1, Math.log10(Math.max(hi, 1e5)) + 0.05);
    const BINS = 72, bw = 0.09;
    const xs = Array.from({ length: BINS }, (_, b) => lo + (b + 0.5) * (top - lo) / BINS);
    const col = new Float64Array(runs);
    const ridges = idx.map((i) => {
      const dens = new Array(BINS).fill(0);
      let zero = 0;
      for (let r = 0; r < runs; r++) {
        const v = (col[r] = T[r * n + i]);
        if (v < 1000) { zero++; continue; }
        const lv = Math.log10(v);
        for (let b = 0; b < BINS; b++) { const d = (xs[b] - lv) / bw; if (d > -3.5 && d < 3.5) dens[b] += Math.exp(-0.5 * d * d); }
      }
      const total = dens.reduce((x, y) => x + y, 0) || 1;
      col.sort();
      return {
        year: S.years[i], age: S.age.p1[i], density: dens.map((d) => d / total), zero: zero / runs,
        p10: U.percentile(col, 0.1), p50: U.percentile(col, 0.5), p90: U.percentile(col, 0.9),
      };
    });
    return { xs, lo, top, ridges, runs, retireYear: S.retireYear, typical: idx.map((i) => det.totals[i]), names: { p1: P.people.p1.name } };
  };

  // ------------------------------------------------------------ plan score
  const lerp01 = (v, bad, good) => U.clamp((v - bad) / (good - bad), 0, 1);
  /**
   * The plan's report card from a (slim) analysis and, if known, safe spending.
   * Six parts, each { key, label, points, max, value, note }; parts that can't
   * be judged (no retirement ahead, no safe-spending yet) drop out and the
   * rest scale up to 100.
   */
  E.planScore = function (a, safe) {
    const P = a.plan, rows = a.rows, ry = a.summary.retireYear;
    const retRows = rows.filter((r) => r.year >= ry);
    const at = rows.find((r) => r.year === ry) || rows[0];
    const startBal = at ? at.startTotal : 0;
    const parts = [];
    const part = (key, label, max, frac, value, note) => parts.push({ key, label, max, frac, points: max * frac, value, note });

    const s = a.summary.successRate;
    if (s != null) part('success', 'Chance of success', 40, lerp01(s, 0.5, 0.95), s, 'Full marks at 95% or better.');
    if (safe && safe.amount && P.spending.retirement > 0) {
      const ratio = safe.amount / P.spending.retirement;
      part('cushion', 'Spending cushion', 15, lerp01(ratio, 0.8, 1.2), ratio, 'Safe spending vs. your plan. Full marks at 20% headroom.');
    }
    const early = retRows.slice(0, 5);
    if (early.length && startBal > 0) {
      const wd = early.reduce((t, r) => t + Object.values(r.src).reduce((x, y) => x + y, 0), 0) / early.length;
      const rate = wd / startBal;
      part('rate', 'Withdrawal rate', 15, 1 - lerp01(rate, 0.035, 0.06), rate, 'Average of your first five retired years. Full marks at 3.5% or less.');
    }
    if (retRows.length) {
      const tax = retRows.reduce((t, r) => t + r.taxes.federal + r.taxes.state, 0) + rows.reduce((t, r) => t + r.taxes.penalty, 0);
      const agi = retRows.reduce((t, r) => t + Math.max(0, r.agi), 0);
      const rate = agi > 0 ? tax / agi : 0;
      part('tax', 'Taxes in retirement', 10, 1 - lerp01(rate, 0.08, 0.22), rate, 'Income tax (and any early-withdrawal penalties) as a share of your taxable income once retired. Full marks at 8% or less.');
    }
    if (at && P.spending.retirement > 0) {
      const yrs = at.balances.taxable / P.spending.retirement;
      part('flex', 'Flexible money', 10, lerp01(yrs, 0, 2), yrs, 'Cash and brokerage at retirement, in years of spending. Full marks at two years: no tax or penalty to reach it.');
    }
    if (at) {
      const b = at.balances, t = b.preTax + b.roth + b.hsa + b.taxable;
      if (t > 0) {
        const sh = [b.preTax / t, (b.roth + b.hsa) / t, b.taxable / t];
        const hhi = sh.reduce((x, y) => x + y * y, 0);
        part('mix', 'Tax diversification', 10, lerp01(1 - hhi, 0, 0.55), sh, 'Pre-tax, Roth and taxable money at retirement. More even = more ways to control taxes.');
      }
    }
    const max = parts.reduce((t, p) => t + p.max, 0) || 1;
    const score = Math.round(parts.reduce((t, p) => t + p.points, 0) / max * 100);
    const grade = score >= 97 ? 'A+' : score >= 93 ? 'A' : score >= 90 ? 'A−' : score >= 87 ? 'B+' : score >= 83 ? 'B' : score >= 80 ? 'B−'
      : score >= 77 ? 'C+' : score >= 73 ? 'C' : score >= 70 ? 'C−' : score >= 60 ? 'D' : 'F';
    return { score, grade, parts };
  };
})(globalThis.RP = globalThis.RP || {});
