/*
 * explore.js — the deep-dive tools:
 *
 *   RP.engine.ssExplorer(plan)      every Social Security claiming-age pair (62–70 for
 *                                   each of you): money left at the end, lifetime benefits
 *   RP.engine.rothExplorer(plan)    Roth conversion strategies side by side: lifetime
 *                                   taxes, health costs, what's left, chance of success
 *   RP.engine.historyReplay(plan)   your retirement replayed through every stretch of real
 *                                   market history since 1871 (like FIRECalc)
 *
 * The first two compare choices on the typical-market path (fast enough to try
 * dozens), then run the Monte Carlo on the few that matter.
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;

  /** The typical-market path for a plan, with 72(t) sized the same way analyze() does. */
  function typical(P, detail) {
    const S = E.buildSchedule(P);
    const ret = E.deterministicReturns(P, S);
    let det = E.simulate(P, S, ret, { detail: detail || P.sepp.enabled });
    let sepp = null;
    if (P.sepp.enabled) {
      sepp = E.resolveSepp(P, S, det);
      if (sepp && sepp.payment > 0) det = E.simulate(P, S, ret, { detail, sepp });
      else sepp = null;
    }
    return { S, det, ret, sepp };
  }
  E.typicalRun = typical;

  const withValues = (P, o) => {
    const Q = U.clone(P);
    for (const [path, v] of Object.entries(o)) U.setPath(Q, path, v);
    return E.resolvePlan(Q);
  };
  /** Better outcome first: lasts the whole plan, then more left; if both run short, later. */
  const better = (a, b) => (a.failYear == null) !== (b.failYear == null) ? (a.failYear == null ? -1 : 1)
    : a.failYear != null && a.failYear !== b.failYear ? b.failYear - a.failYear : b.end - a.end;

  // ------------------------------------------------------------ Social Security
  /**
   * Claiming ages each person can still choose (already collecting = fixed),
   * then every pair on the typical path. Returns { ages: { p1, p2 }, cells:
   * [{ p1, p2, end, failYear, lifetime }], current, best, success: { current, best } }.
   */
  E.ssExplorer = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const y0 = Number(String(P.balances.asOf).slice(0, 4));
    const choices = (pid) => {
      const b = P.people[pid].birthYear, cur = P.ss[pid].claimAge;
      if (b + cur < y0) return [cur];
      const out = [];
      for (let a = Math.max(62, y0 - b); a <= 70; a++) out.push(a);
      if (!out.includes(cur)) out.push(cur);
      return out.sort((x, y) => x - y);
    };
    const ages = { p1: choices('p1'), p2: choices('p2') };
    const cells = [];
    for (const a1 of ages.p1) {
      for (const a2 of ages.p2) {
        const Q = withValues(P, { 'ss.p1.claimAge': a1, 'ss.p2.claimAge': a2 });
        const { S, det } = typical(Q, false);
        let lifetime = 0;
        for (let i = 0; i < S.n; i++) lifetime += S.ss.p1[i] + S.ss.p2[i];
        cells.push({ p1: a1, p2: a2, end: det.totals[S.n - 1], failYear: det.failYear, lifetime });
      }
    }
    const current = cells.find((c) => c.p1 === P.ss.p1.claimAge && c.p2 === P.ss.p2.claimAge);
    const best = cells.slice().sort(better)[0];
    const runs = opts.runs || 300;
    const rate = (c) => E.successRate(withValues(P, { 'ss.p1.claimAge': c.p1, 'ss.p2.claimAge': c.p2 }), runs);
    const success = { current: rate(current) };
    success.best = best === current ? success.current : rate(best);
    return { ages, cells, current, best, success, runs, horizonAge: P.household.horizonAge, horizonPerson: P.household.horizonPerson };
  };

  // ------------------------------------------------------------ Roth conversions
  /** What a conversion setting actually does, so equivalent settings compare equal. */
  function convSig(C) {
    if (C.strategy === 'none') return 'none';
    const after = C.afterMedicare === 'bracket' ? 'bracket' + C.bracketRate : C.afterMedicare;
    if (C.strategy === 'healthCap') return 'healthCap/' + after;
    if (C.strategy === 'bracket') return 'bracket' + C.bracketRate + '/' + after;
    return 'fixed' + C.fixedAmount;
  }

  /** The strategies worth comparing, as plan overrides (plus yours, if it's none of them). */
  E.rothStrategies = function (P) {
    const hc = { 'conversions.strategy': 'healthCap' };
    const list = [
      { key: 'none', o: { 'conversions.strategy': 'none' } },
      { key: 'until65', o: { ...hc, 'conversions.afterMedicare': 'none' } },
      { key: 'to12', o: { ...hc, 'conversions.afterMedicare': 'bracket', 'conversions.bracketRate': 12 } },
      { key: 'to22', o: { ...hc, 'conversions.afterMedicare': 'bracket', 'conversions.bracketRate': 22 } },
      { key: 'irmaa', o: { ...hc, 'conversions.afterMedicare': 'irmaa' } },
    ];
    const mine = convSig(P.conversions);
    for (const s of list) s.current = convSig(withValues(P, s.o).conversions) === mine;
    if (!list.some((s) => s.current)) list.push({ key: 'yours', o: {}, current: true });
    return list;
  };

  /** Pre-tax money left at the end is counted after this much tax (heirs pay it as they withdraw). */
  E.HEIR_TAX = 0.25;

  /** Each strategy on the typical path, plus its chance of success. */
  E.rothExplorer = function (rawPlan, opts) {
    opts = opts || {};
    const P = E.resolvePlan(rawPlan);
    const runs = opts.runs || 300;
    const out = E.rothStrategies(P).map((s) => {
      const Q = withValues(P, s.o);
      const { det } = typical(Q, true);
      const rows = det.rows;
      const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
      const last = rows[rows.length - 1];
      return {
        key: s.key, overrides: s.o, current: s.current,
        converted: sum((r) => r.converted),
        incomeTax: sum((r) => r.taxes.federal + r.taxes.state),
        health: sum((r) => r.spending.health),
        penalties: sum((r) => r.taxes.penalty),
        end: last.balances.total, preTaxEnd: last.balances.preTax, rothEnd: last.balances.roth,
        afterTaxEnd: last.balances.total - last.balances.preTax * E.HEIR_TAX,
        failYear: det.failYear,
        yearly: rows.map((r) => [r.year, Math.round(r.converted)]),
        success: E.successRate(Q, runs),
      };
    });
    return { strategies: out, runs, endYear: P.people[P.household.horizonPerson].birthYear + P.household.horizonAge };
  };

  // ------------------------------------------------------------ history
  /**
   * Retire into each stretch of real history: savings grow at your expected
   * returns until you retire, then every later year replays history from a
   * different start year (stocks, 10-year Treasuries and cash in your mix).
   * Only full stretches are used, like FIRECalc.
   */
  E.historyReplay = function (rawPlan) {
    const P = E.resolvePlan(rawPlan);
    const R = P.returns;
    const hist = RP.HISTORICAL_RETURNS || [];
    const { S, det, ret, sepp } = typical(P, true);
    const planPath = det.rows.map((r) => r.startTotal); // spending guardrails compare against this
    const startIdx = Math.max(0, S.retireIdx);
    const span = S.n - startIdx;
    const first = hist.length ? hist[0][0] : 0;
    const spec = R.speculative.enabled ? { w: R.speculative.pct / 100, r: Math.exp(E.lnParams(R.speculative.return / 100, R.speculative.vol / 100, R.meaning).m) - 1 } : null;
    const mix = (row, y) => {
      const ws = E.stockWeight(R, y, S.retireYear), wc = R.allocation.cash / 100, wb = Math.max(0, 1 - ws - wc);
      const r = ws * row[1] + wb * row[2] + wc * R.cash / 100;
      return spec ? (1 - spec.w) * r + spec.w * spec.r : r;
    };
    const geo = (rs) => (rs.length ? Math.exp(rs.reduce((t, r) => t + Math.log(1 + r), 0) / rs.length) - 1 : 0);
    // History's long-run return for your mix vs. the return your plan assumes in retirement.
    const histGeo = geo(hist.map((row) => mix(row, S.retireYear)));
    const planGeo = geo(ret.inv.slice(startIdx));
    const scale = (1 + planGeo) / (1 + histGeo);

    const replay = (matched) => {
      const runs = [];
      for (let k = 0; k + span <= hist.length; k++) {
        const inv = ret.inv.slice();
        for (let i = startIdx; i < S.n; i++) {
          const r = mix(hist[k + i - startIdx], S.years[i]);
          inv[i] = matched ? (1 + r) * scale - 1 : r; // matched: same ups and downs, your average
        }
        const res = E.simulate(P, S, { inv, cash: ret.cash }, { planPath, sepp, stopOnFail: true });
        let low = Infinity;
        for (let i = startIdx; i < S.n; i++) low = Math.min(low, res.totals[i]);
        runs.push({ start: first + k, success: res.success, failYear: res.failYear, end: res.totals[S.n - 1], low });
      }
      return { runs, successRate: runs.length ? runs.filter((r) => r.success).length / runs.length : null };
    };
    return {
      actual: replay(false), matched: replay(true), histReturn: histGeo, planReturn: planGeo,
      stocksPct: Math.round(E.stockWeight(R, S.retireYear, S.retireYear) * 100),
      span, retireYear: S.retireYear, endYear: S.yEnd, typicalEnd: det.totals[S.n - 1],
    };
  };
})(globalThis.RP = globalThis.RP || {});
