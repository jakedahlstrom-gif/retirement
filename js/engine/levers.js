/*
 * levers.js — "what moves the needle": how much common choices (and one
 * market risk) change your chance of success, and the earliest retirement
 * age that still meets your success target.
 *
 * Every test reuses the plan's own random market years (same seed, same run
 * count), so a difference of a few points comes from the change, not luck.
 *
 *   RP.engine.leverList(plan)              changes worth testing, each as scenario overrides
 *   RP.engine.testLever(plan, lever, runs) success rate with one change applied
 *   RP.engine.levers(plan, opts, onEach)   the base rate plus every lever, with deltas
 *   RP.engine.earliestRetirement(plan)     youngest retirement age (person 1) at the target
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;

  /** Spending steps of $5K, or $2.5K for smaller budgets. */
  const stepFor = (amount) => (amount >= 40000 ? 5000 : 2500);

  /** Retirement spending moved by `delta` dollars; spending phases scale along. */
  function spendingOverrides(P, delta) {
    const s = P.spending.retirement;
    const o = { 'spending.retirement': Math.max(0, s + delta) };
    const ph = P.spending.phases;
    if (ph && ph.enabled && (ph.list || []).length) {
      const k = s > 0 ? Math.max(0, s + delta) / s : 1;
      o['spending.phases'] = Object.assign({}, ph, { list: ph.list.map((p) => Object.assign({}, p, { amount: Math.round(p.amount * k) })) });
    }
    return o;
  }

  /**
   * The levers that apply to this plan. Each: { key, kind: 'choice'|'risk',
   * overrides: { 'dotted.path': value }, info: numbers for the labels }.
   */
  E.leverList = function (rawPlan) {
    const P = E.resolvePlan(rawPlan);
    const S = E.buildSchedule(P);
    const R = P.retirement;
    const ry = E.retireYears(P);
    const list = [];
    const add = (key, kind, overrides, info) => list.push({ key, kind, overrides, info: info || {} });
    const shiftAges = (d) => {
      const o = { 'retirement.p1Age': R.p1Age + d };
      if (!R.together) o['retirement.p2Age'] = R.p2Age + d;
      return o;
    };

    // When you retire (only while someone still has work ahead)
    const working = Math.max(ry.p1, ry.p2) >= S.y0;
    if (working && R.p1Age < 75) add('later', 'choice', shiftAges(1), { age: R.p1Age + 1 });
    if (working && R.p1Age > 30) add('earlier', 'choice', shiftAges(-1), { age: R.p1Age - 1 });

    // How much you spend, in retirement and now
    const step = stepFor(P.spending.retirement);
    add('spendLess', 'choice', spendingOverrides(P, -step), { step, amount: Math.max(0, P.spending.retirement - step) });
    add('spendMore', 'choice', spendingOverrides(P, step), { step, amount: P.spending.retirement + step });
    const wStep = stepFor(P.spending.working);
    if (S.retireYear > S.y0 && P.contributions.leftoverTo !== 'spend' && P.spending.working > wStep) {
      add('saveMore', 'choice', { 'spending.working': P.spending.working - wStep }, { step: wStep });
    }

    // A part-time bridge in the first years of retirement
    if (!P.partTime.p1.enabled && !P.partTime.p2.enabled && !(P.death.enabled && P.death.person === 'p1' && P.death.year <= S.retireYear)) {
      const first = Math.max(S.retireYear, S.y0 + 1), amount = 20000;
      add('partTime', 'choice', {
        'partTime.p1.enabled': true, 'partTime.p1.amount': amount, 'partTime.p1.firstYear': first, 'partTime.p1.lastYear': first + 4,
      }, { amount, first, last: first + 4 });
    }

    // Social Security timing, for whoever hasn't started yet
    const claimLever = (age) => {
      const o = {};
      for (const pid of ['p1', 'p2']) {
        const cur = P.ss[pid].claimAge;
        if (cur !== age && P.people[pid].birthYear + Math.min(cur, age) > S.y0) o[`ss.${pid}.claimAge`] = age;
      }
      return o;
    };
    const ssAge = Math.min(P.ss.p1.claimAge, P.ss.p2.claimAge) < 70 ? 70 : 67;
    const ssO = claimLever(ssAge);
    if (Object.keys(ssO).length) add('ss' + ssAge, 'choice', ssO, { age: ssAge, people: Object.keys(ssO).map((k) => k.split('.')[1]) });

    // Spending guardrails
    const g = P.spending.guardrails;
    add(g.enabled ? 'guardrailsOff' : 'guardrailsOn', 'choice', { 'spending.guardrails.enabled': !g.enabled }, { cutPct: g.cutPct, behindPct: g.behindPct });

    // A risk you don't control: everything invested falls 30% overnight (cash stays put)
    const B = P.balances, keep = 0.7;
    const invested = B.p1_401k + B.p2_401k + B.roth + B.hsa + B.brokerage;
    if (invested > 0) {
      add('crashNow', 'risk', {
        'balances.p1_401k': Math.round(B.p1_401k * keep), 'balances.p2_401k': Math.round(B.p2_401k * keep),
        'balances.roth': Math.round(B.roth * keep), 'balances.hsa': Math.round(B.hsa * keep), 'balances.brokerage': Math.round(B.brokerage * keep),
      }, { pct: 30, loss: invested * (1 - keep) });
    }

    // Another: every year's return 1 point lower
    if (P.returns.source !== 'historical') {
      const A = P.returns.allocation;
      const o = A.enabled
        ? { 'returns.allocation.stockReturn': A.stockReturn - 1, 'returns.allocation.bondReturn': A.bondReturn - 1 }
        : { 'returns.working': P.returns.working - 1, 'returns.retired': P.returns.retired - 1 };
      add('marketsDown', 'risk', o, { pts: 1 });
    }
    return list;
  };

  /** Success rate with one lever's overrides applied. */
  E.testLever = function (P, lever, runs) {
    const Q = U.clone(P);
    for (const [path, v] of Object.entries(lever.overrides)) U.setPath(Q, path, U.clone(v));
    return E.successRate(E.resolvePlan(Q), runs);
  };

  /**
   * Base success rate and each lever's effect. onEach(key, value) is called
   * with 'base' first, then once per lever as results come in.
   */
  E.levers = function (rawPlan, opts, onEach) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const runs = opts.runs || 400;
    const base = E.successRate(P, runs);
    if (onEach) onEach('base', base);
    const list = E.leverList(P).map((lv) => {
      const success = E.testLever(P, lv, runs);
      const r = Object.assign({}, lv, { success, delta: success - base });
      if (onEach) onEach(lv.key, r);
      return r;
    });
    return { base, runs, list };
  };

  /**
   * Youngest retirement age for person 1 where success still meets the target
   * (the safe-spending target by default). Person 2 moves by the same number
   * of years unless you retire together. Returns
   *   { age, year, success, target, now }   now = stopping work today already works
   *   { age: null, target, maxAge }         not reachable by maxAge
   *   { age: null, target, retired: true }  you've both stopped working already
   */
  E.earliestRetirement = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const target = (opts.target || P.sim.successTarget) / 100;
    const runs = opts.runs || 300;
    const y0 = Number(String(P.balances.asOf).slice(0, 4));
    const ry = E.retireYears(P);
    if (Math.max(ry.p1, ry.p2) < y0) return { age: null, target: target * 100, retired: true };
    const cur = P.retirement.p1Age;
    const nowAge = Math.min(cur, Math.max(30, y0 - 1 - P.people.p1.birthYear)); // works no more from today
    const maxAge = Math.max(cur, 75);
    const memo = new Map();
    const succ = (age) => {
      if (!memo.has(age)) {
        const Q = U.clone(P);
        Q.retirement.p1Age = age;
        if (!Q.retirement.together) Q.retirement.p2Age = U.clamp(P.retirement.p2Age + (age - cur), 30, 80);
        memo.set(age, E.successRate(Q, runs));
      }
      return memo.get(age);
    };
    const found = (age, now) => ({ age, year: P.people.p1.birthYear + age + 1, success: memo.get(age), target: target * 100, now: !!now });
    // Success rises with retirement age, so bisect between a failing and a passing age.
    let lo, hi;
    if (succ(cur) >= target) {
      if (nowAge >= cur) return found(cur, true);
      if (succ(nowAge) >= target) return found(nowAge, true);
      lo = nowAge; hi = cur;
    } else {
      if (succ(maxAge) < target) return { age: null, target: target * 100, maxAge };
      lo = cur; hi = maxAge;
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (succ(mid) >= target) hi = mid; else lo = mid;
    }
    return found(hi, false);
  };
})(globalThis.RP = globalThis.RP || {});
