/*
 * montecarlo.js — market returns, the 1,000-run Monte Carlo, and the
 * headline numbers built on it (success %, safe spending, green-light balance,
 * Coast FIRE date, success by retirement age).
 *
 * Returns are "real" (after inflation). Each year's return is random:
 * lognormal with your chosen average and volatility. Two ways to read "5%":
 *   'average' — the average of yearly returns is 5%. With 15% swings, money
 *               actually compounds at only ~3.9%/yr (more conservative).
 *   'typical' — money compounds at 5%/yr in a typical (median) run.
 *
 * Every scenario uses the exact same random draws (same seed), so differences
 * between scenarios come from your choices, not luck.
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;

  const zCache = new Map();
  /** Random standard-normal draws: runs × years × 3 factors, cached by seed. */
  E.zMatrix = function (runs, n, seed) {
    const key = runs + '|' + n + '|' + seed;
    if (zCache.has(key)) return zCache.get(key);
    const rng = U.rng(seed);
    const z = new Float64Array(runs * n * 3);
    for (let k = 0; k < z.length; k++) z[k] = rng.normal();
    if (zCache.size > 8) zCache.clear();
    zCache.set(key, z);
    return z;
  };

  /** Lognormal parameters for a return with mean/median `mu` and volatility `sigma`. */
  function lnParams(mu, sigma, meaning) {
    const s2 = Math.log(1 + (sigma * sigma) / ((1 + mu) * (1 + mu)));
    const m = meaning === 'typical' ? Math.log(1 + mu) : Math.log(1 + mu) - s2 / 2;
    return { m, s: Math.sqrt(s2) };
  }
  E.lnParams = lnParams;

  /** Stock share of the portfolio in a given year (with optional glide path). */
  function stockWeight(R, y, retireYear) {
    const a = R.allocation;
    if (!a.glide || !a.glide.enabled) return a.stocks / 100;
    const yrs = Math.max(1, a.glide.yearsBefore);
    const t = U.clamp((y - (retireYear - yrs)) / yrs, 0, 1);
    return (a.stocks + (a.glide.retiredStocks - a.stocks) * t) / 100;
  }
  E.stockWeight = stockWeight;

  /** Per-year return settings for a plan. */
  function yearParams(P, S, i) {
    const R = P.returns;
    const y = S.years[i];
    const retired = y >= S.retireYear;
    let mu = (retired ? R.retired : R.working) / 100;
    const ld = R.stress.lostDecade;
    const inLost = ld.enabled && y >= S.retireYear && y < S.retireYear + ld.years;
    if (inLost) mu = ld.returnPct / 100;
    const crash = R.stress.crash.enabled && y === S.retireYear ? R.stress.crash.pct / 100 : null;
    return { mu, sigma: R.volatility / 100, crash, inLost, retired, y };
  }

  /** Expected (typical-path) returns for the deterministic year-by-year table. */
  E.deterministicReturns = function (P, S) {
    const R = P.returns;
    const inv = [], cash = [];
    for (let i = 0; i < S.n; i++) {
      const yp = yearParams(P, S, i);
      let r;
      if (R.source === 'historical') {
        const w = stockWeight(R, yp.y, S.retireYear);
        r = w * HIST_GEO.s + (1 - w - R.allocation.cash / 100) * HIST_GEO.b + (R.allocation.cash / 100) * R.cash / 100;
      } else if (R.allocation.enabled) {
        const a = mixMoments(P, S, i, yp);
        const { m } = lnParams(a.mu, a.sigma, R.meaning);
        r = Math.exp(m) - 1;
      } else {
        const { m } = lnParams(yp.mu, yp.sigma, R.meaning);
        r = Math.exp(m) - 1;
      }
      if (R.speculative.enabled) {
        const sp = lnParams(R.speculative.return / 100, R.speculative.vol / 100, R.meaning);
        const w = R.speculative.pct / 100;
        r = (1 - w) * r + w * (Math.exp(sp.m) - 1);
      }
      if (yp.crash != null) r = yp.crash;
      inv.push(r);
      cash.push(R.cash / 100);
    }
    return { inv, cash };
  };

  /** Mean & volatility of the stock/bond/cash mix (allocation mode). */
  function mixMoments(P, S, i, yp) {
    const a = P.returns.allocation;
    const ws = stockWeight(P.returns, yp.y, S.retireYear);
    const wc = a.cash / 100;
    const wb = Math.max(0, 1 - ws - wc);
    const muS = yp.inLost ? P.returns.stress.lostDecade.returnPct / 100 : a.stockReturn / 100;
    const mu = ws * muS + wb * a.bondReturn / 100 + wc * P.returns.cash / 100;
    const sS = a.stockVol / 100, sB = a.bondVol / 100;
    const sigma = Math.sqrt(ws * ws * sS * sS + wb * wb * sB * sB + 2 * ws * wb * a.correlation * sS * sB);
    return { mu, sigma, ws, wb, wc, muS };
  }

  // Long-run historical averages (geometric), for the deterministic table.
  const HIST_GEO = (function () {
    const rows = RP.HISTORICAL_RETURNS || [];
    if (!rows.length) return { s: 0.065, b: 0.023 };
    let ls = 0, lb = 0;
    for (const r of rows) { ls += Math.log(1 + r[1]); lb += Math.log(1 + r[2]); }
    return { s: Math.exp(ls / rows.length) - 1, b: Math.exp(lb / rows.length) - 1 };
  })();

  /** Random returns for every run and year (flat array: run-major). */
  E.mcReturns = function (P, S, runs, seed) {
    const R = P.returns;
    const n = S.n;
    const z = E.zMatrix(runs, n, seed);
    const inv = new Float64Array(runs * n);
    const cash = new Array(n).fill(R.cash / 100);
    const params = [];
    for (let i = 0; i < n; i++) {
      const yp = yearParams(P, S, i);
      const p = { yp };
      if (R.allocation.enabled && R.source !== 'historical') {
        const mm = mixMoments(P, S, i, yp);
        p.mm = mm;
        p.s = lnParams(mm.muS, R.allocation.stockVol / 100, R.meaning);
        p.b = lnParams(R.allocation.bondReturn / 100, R.allocation.bondVol / 100, R.meaning);
      } else {
        p.main = lnParams(yp.mu, yp.sigma, R.meaning);
      }
      if (R.speculative.enabled) p.spec = lnParams(R.speculative.return / 100, R.speculative.vol / 100, R.meaning);
      params.push(p);
    }
    const hist = RP.HISTORICAL_RETURNS || [];
    const rng = R.source === 'historical' ? U.rng(seed ^ 0x9e3779b9) : null;
    const rho = R.allocation.correlation, rho2 = Math.sqrt(1 - rho * rho);
    const wSpec = R.speculative.enabled ? R.speculative.pct / 100 : 0;

    for (let r = 0; r < runs; r++) {
      let histPos = 0, blockLeft = 0;
      for (let i = 0; i < n; i++) {
        const p = params[i];
        const z1 = z[(r * n + i) * 3], z2 = z[(r * n + i) * 3 + 1], z3 = z[(r * n + i) * 3 + 2];
        let ret;
        if (R.source === 'historical' && hist.length) {
          // Block bootstrap: real history in 10-year chunks, randomly stitched.
          if (blockLeft <= 0) { histPos = Math.floor(rng.next() * hist.length); blockLeft = 10; }
          const row = hist[histPos % hist.length];
          histPos++; blockLeft--;
          const ws = stockWeight(R, p.yp.y, S.retireYear), wc = R.allocation.cash / 100, wb = Math.max(0, 1 - ws - wc);
          ret = ws * row[1] + wb * row[2] + wc * R.cash / 100;
          if (p.yp.inLost) ret = Math.min(ret, R.stress.lostDecade.returnPct / 100 + (ret - HIST_GEO.s) * 0.5);
        } else if (p.mm) {
          const rs = Math.exp(p.s.m + p.s.s * z1) - 1;
          const rb = Math.exp(p.b.m + p.b.s * (rho * z1 + rho2 * z2)) - 1;
          ret = p.mm.ws * rs + p.mm.wb * rb + p.mm.wc * R.cash / 100;
        } else {
          ret = Math.exp(p.main.m + p.main.s * z1) - 1;
        }
        if (wSpec > 0) ret = (1 - wSpec) * ret + wSpec * (Math.exp(p.spec.m + p.spec.s * z3) - 1);
        if (p.yp.crash != null) ret = p.yp.crash;
        inv[r * n + i] = ret;
      }
    }
    return { inv, cash };
  };

  /**
   * Monte Carlo: run the simulation once per random return path.
   * opts: { runs, seed, planPath, sepp, startIdx, state, keepTotals }
   */
  E.monteCarlo = function (P, S, opts) {
    opts = opts || {};
    const runs = opts.runs || P.sim.runs;
    const seed = opts.seed || P.sim.seed;
    const n = S.n;
    const rets = E.mcReturns(P, S, runs, seed);
    const keep = opts.keepTotals !== false;
    const totals = keep ? new Float64Array(runs * n) : null;
    let successes = 0;
    const failYears = {};
    const penalties = [];
    const balRet = [];
    for (let r = 0; r < runs; r++) {
      const res = E.simulate(P, S, { inv: rets.inv.subarray(r * n, (r + 1) * n), cash: rets.cash }, {
        planPath: opts.planPath, sepp: opts.sepp, stopOnFail: true, startIdx: opts.startIdx, state: opts.state,
      });
      if (res.success) successes++;
      else failYears[res.failYear] = (failYears[res.failYear] || 0) + 1;
      penalties.push(res.penaltiesTotal);
      if (res.balanceAtRetirement != null) balRet.push(res.balanceAtRetirement);
      if (keep) for (let i = 0; i < n; i++) totals[r * n + i] = res.totals[i];
    }
    const out = { runs, successRate: successes / runs, failYears };
    if (keep) {
      const p10 = [], p25 = [], p50 = [], p75 = [], p90 = [];
      const col = new Float64Array(runs);
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < runs; r++) col[r] = totals[r * n + i];
        col.sort();
        p10.push(U.percentile(col, 0.1)); p25.push(U.percentile(col, 0.25)); p50.push(U.percentile(col, 0.5));
        p75.push(U.percentile(col, 0.75)); p90.push(U.percentile(col, 0.9));
      }
      out.bands = { p10, p25, p50, p75, p90 };
    }
    penalties.sort((a, b) => a - b);
    balRet.sort((a, b) => a - b);
    out.medianPenalties = U.percentile(penalties, 0.5);
    out.medianBalanceAtRetirement = balRet.length ? U.percentile(balRet, 0.5) : null;
    return out;
  };

  /** Scale every balance in a state by k (used for the green-light search). */
  E.scaleState = function (s, k) {
    const c = E.cloneState(s);
    for (const p of ['p1', 'p2']) {
      c.pre[p].plan *= k; c.pre[p].ira *= k;
      c.roth[p].value *= k; c.roth[p].basis *= k;
      c.roth[p].rungs = c.roth[p].rungs.map(([y, a]) => [y, a * k]);
    }
    c.inherited *= k; c.hsa *= k; c.receipts *= k; c.cash *= k; c.brok *= k; c.brokBasis *= k;
    if (c.sepp) c.sepp.bal *= k;
    return c;
  };
})(globalThis.RP = globalThis.RP || {});
