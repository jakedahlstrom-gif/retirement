/*
 * api.js — the engine's front door. The app (and the tests) call these:
 *
 *   RP.engine.resolvePlan(raw)          fill in any missing settings from defaults
 *   RP.engine.analyze(plan, opts)       year-by-year table + Monte Carlo + summary
 *   RP.engine.safeSpending(plan)        most you can spend at ≥90% success
 *   RP.engine.greenLight(plan)          retirement-day balance for ≥95% success
 *   RP.engine.coastFire(plan)           earliest year saving could stop
 *   RP.engine.successByAge(plan)        success % for retirement ages 45–65
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;

  /** Merge a (possibly partial) plan onto the defaults. */
  E.resolvePlan = function (raw) {
    const P = U.merge(RP.DEFAULT_PLAN, raw || {});
    // Keep numbers sane.
    P.retirement.p1Age = U.clamp(Number(P.retirement.p1Age), 30, 80);
    P.retirement.p2Age = U.clamp(Number(P.retirement.p2Age), 30, 80);
    P.sim.runs = U.clamp(Math.round(P.sim.runs || 1000), 50, 5000);
    return P;
  };

  /** Work out the 72(t) setup (who, when, how much), or null if off/not needed. */
  E.resolveSepp = function (P, S, noSeppDet) {
    if (!P.sepp.enabled) return null;
    let person = P.sepp.person;
    const locked = (p) => S.unlock[p].rule55Year == null && S.unlock[p].separationYear != null &&
      S.unlock[p].separationYear < S.unlock[p].year59;
    if (person !== 'p1' && person !== 'p2') {
      const cands = ['p1', 'p2'].filter(locked);
      if (!cands.length) return { person: null, payment: 0, note: 'Not needed: no 401k is locked in early retirement.' };
      person = cands.sort((a, b) => P.balances[b + '_401k'] - P.balances[a + '_401k'])[0];
    }
    const startYear = P.sepp.startYear || Math.max(S.retireYear, S.unlock[person].separationYear || S.retireYear);
    const endYear = Math.max(startYear + 4, S.unlock[person].year59 - 1);
    let payment = P.sepp.amount;
    if (P.sepp.mode === 'auto') {
      // Size the payments to replace the penalty withdrawals the plan would otherwise need.
      const det = noSeppDet;
      const infl = P.returns.inflation / 100;
      let pen = 0, denom = 0;
      for (const row of det.rows) {
        if (row.year >= startYear && row.year <= endYear) {
          pen += row.from.penaltyWithdrawals;
          denom += Math.pow(1 + infl, -(row.year - startYear));
        }
      }
      payment = denom > 0 ? pen / denom : 0;
      if (payment < 500) return { person, payment: 0, startYear, endYear, note: 'Not needed: this plan has no penalty withdrawals to replace.' };
    }
    return { person, startYear, endYear, payment, ratePct: P.sepp.ratePct };
  };

  /**
   * Full analysis of one plan.
   * opts: { runs, mc (default true), seed }
   */
  E.analyze = function (rawPlan, opts) {
    opts = opts || {};
    const P = rawPlan && rawPlan.__resolved ? rawPlan : E.resolvePlan(rawPlan);
    const S = E.buildSchedule(P);
    const detRet = E.deterministicReturns(P, S);
    let det = E.simulate(P, S, detRet, { detail: true });
    let sepp = null;
    if (P.sepp.enabled) {
      sepp = E.resolveSepp(P, S, det);
      if (sepp && sepp.payment > 0) {
        sepp.withoutPenalties = det.penaltiesTotal;
        det = E.simulate(P, S, detRet, { detail: true, sepp });
      }
    }
    const usableSepp = sepp && sepp.payment > 0 ? sepp : null;
    // The typical path doubles as "the plan" for spending guardrails.
    const planPath = det.rows.map((r) => r.startTotal);
    if (P.spending.guardrails.enabled) det = E.simulate(P, S, detRet, { detail: true, sepp: usableSepp, planPath });
    let mc = null;
    if (opts.mc !== false) {
      mc = E.monteCarlo(P, S, { runs: opts.runs || P.sim.runs, seed: opts.seed, planPath, sepp: usableSepp });
    }
    return { plan: P, schedule: S, det, mc, sepp, planPath, summary: E.summarize(P, S, det, mc) };
  };

  /** Plain numbers for the Home screen and the Compare table. */
  E.summarize = function (P, S, det, mc) {
    const rows = det.rows;
    const at = (y) => rows.find((r) => r.year === y);
    const retireRow = at(S.retireYear);
    const p1At70 = at(P.people.p1.birthYear + 70);
    // MinnesotaCare: the last year it holds continuously from retirement.
    let lastMnCare = null, mnCareLostYear = null, publicYears = 0;
    for (const r of rows) {
      if (r.year < S.retireYear) continue;
      const needsPublic = r.capKind === 'mncare' || r.capKind === 'aca';
      if (!needsPublic) continue;
      publicYears++;
      if (r.health.status === 'mncare' || r.health.status === 'ma') { if (mnCareLostYear == null) lastMnCare = r.year; }
      else if (mnCareLostYear == null) mnCareLostYear = r.year;
    }
    let penalties = 0, penaltyWd = 0, converted = 0, taxes = 0;
    for (const r of rows) {
      penalties += r.taxes.penalty; penaltyWd += r.from.penaltyWithdrawals; converted += r.converted;
      taxes += r.taxes.federal + r.taxes.state;
    }
    const today = rows[0];
    const netWorthToday = E.portfolio(E.initState(P)) + P.balances.edu + P.balances.homeEquity;
    return {
      successRate: mc ? mc.successRate : null,
      retireYear: S.retireYear,
      balanceAtRetirement: retireRow ? retireRow.startTotal : null,
      medianBalanceAtRetirement: mc ? mc.medianBalanceAtRetirement : null,
      balanceAt70: p1At70 ? p1At70.balances.total : null,
      totalPenalties: penalties,
      penaltyWithdrawals: penaltyWd,
      totalConverted: converted,
      lifetimeIncomeTax: taxes,
      lastMnCareYear: lastMnCare,
      mnCareLostYear,
      publicYears,
      netWorthToday,
      portfolioToday: E.portfolio(E.initState(P)),
      firstYear: today ? today.year : null,
      ssAt70: { p1: S.ssDetail.p1.annualAtClaimNoHaircut, p2: S.ssDetail.p2.annualAtClaimNoHaircut },
      ssDetail: S.ssDetail,
      shortfallYear: det.failYear,
      mortgagePayoffYear: S.mortgagePayoffYear,
      unlock: S.unlock,
    };
  };

  /** Quick success rate for a plan (fewer runs, used by searches). */
  E.successRate = function (P, runs, extra) {
    const S = E.buildSchedule(P);
    const det = E.simulate(P, S, E.deterministicReturns(P, S), { detail: true });
    let sepp = null;
    if (P.sepp.enabled) { sepp = E.resolveSepp(P, S, det); if (!sepp || !(sepp.payment > 0)) sepp = null; }
    const planPath = det.rows.map((r) => r.startTotal);
    const mc = E.monteCarlo(P, S, { runs, planPath, sepp, keepTotals: false, ...(extra || {}) });
    return mc.successRate;
  };

  /** Scale retirement spending (base amount and any phases) by k. */
  function withSpendingScale(P, k) {
    const Q = U.clone(P);
    Q.spending.retirement = P.spending.retirement * k;
    if (Q.spending.phases && Q.spending.phases.list) Q.spending.phases.list.forEach((ph) => { ph.amount *= k; });
    return Q;
  }

  /** Most you can spend per year in retirement and still hit the target success. */
  E.safeSpending = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const target = (opts.target || P.sim.successTarget) / 100;
    const runs = opts.runs || Math.min(500, P.sim.runs);
    let lo = 0.3, hi = 2.5;
    if (E.successRate(withSpendingScale(P, hi), runs) >= target) return { amount: P.spending.retirement * hi, capped: true };
    if (E.successRate(withSpendingScale(P, lo), runs) < target) return { amount: P.spending.retirement * lo, floor: true };
    for (let it = 0; it < 9; it++) {
      const mid = (lo + hi) / 2;
      if (E.successRate(withSpendingScale(P, mid), runs) >= target) lo = mid; else hi = mid;
    }
    return { amount: Math.floor((P.spending.retirement * lo) / 500) * 500 };
  };

  /** Retirement-day balance where success reaches the target (default 95%). */
  E.greenLight = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const target = (opts.target || P.sim.greenLightTarget) / 100;
    const runs = opts.runs || Math.min(500, P.sim.runs);
    const S = E.buildSchedule(P);
    const detRet = E.deterministicReturns(P, S);
    // Snapshot the accounts on retirement day along the typical path.
    const state0 = stateAt(P, S, detRet, S.retireIdx);
    const base = E.portfolio(state0);
    if (base <= 0) return { amount: null };
    const succ = (k) => E.monteCarlo(P, S, { runs, startIdx: S.retireIdx, state: E.scaleState(state0, k), keepTotals: false }).successRate;
    let lo = 0.1, hi = 3;
    if (succ(hi) < target) return { amount: base * hi, unreachable: true };
    for (let it = 0; it < 10; it++) {
      const mid = (lo + hi) / 2;
      if (succ(mid) >= target) hi = mid; else lo = mid;
    }
    return { amount: Math.ceil((base * hi) / 10000) * 10000, projected: base };
  };

  /** Account state at the start of year index `idx` along the typical path. */
  function stateAt(P, S, detRet, idx) {
    const s = E.initState(P);
    if (idx <= 0) return s;
    // Run the typical path only up to idx by trimming the schedule length.
    const S2 = Object.assign({}, S, { n: idx });
    const res = E.simulate(P, S2, detRet, {});
    return res.finalState;
  }
  E.stateAt = stateAt;

  /** Earliest year all saving could stop and still reach the target success. */
  E.coastFire = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const target = (opts.target || P.sim.coastTarget) / 100;
    const runs = opts.runs || Math.min(500, P.sim.runs);
    const S = E.buildSchedule(P);
    const first = S.y0 + 1, last = S.retireYear;
    const succ = (y) => { const Q = U.clone(P); Q.sim.coastYear = y; return E.successRate(Q, runs); };
    if (succ(last) < target) return { year: null, reached: false };
    if (succ(first) >= target) return { year: first, reached: true };
    let lo = first, hi = last; // succ(lo) < target <= succ(hi)
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (succ(mid) >= target) hi = mid; else lo = mid;
    }
    return { year: hi, reached: hi <= new Date().getFullYear() };
  };

  /** Success % for each retirement age (person 1), keeping other settings. */
  E.successByAge = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const runs = opts.runs || 300;
    const ages = opts.ages || Array.from({ length: 21 }, (_, k) => 45 + k);
    return ages.map((age) => {
      const Q = U.clone(P);
      const shift = age - P.retirement.p1Age;
      Q.retirement.p1Age = age;
      if (!Q.retirement.together) Q.retirement.p2Age = P.retirement.p2Age + shift;
      return { age, success: E.successRate(Q, runs) };
    });
  };
})(globalThis.RP = globalThis.RP || {});
