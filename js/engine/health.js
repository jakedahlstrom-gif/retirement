/*
 * health.js — health coverage rules for early retirement (before Medicare).
 *
 * Income lines are percentages of the federal poverty guideline (FPL), which
 * depends on household size:
 *   adults  ≤138% → Medical Assistance        (no extra cost)
 *   adults  ≤200% → MinnesotaCare             (low cost, already in your budget)
 *   kids    ≤275% → Medical Assistance for kids (≤283% under age 2)
 *   adults  ≤400% → MNsure marketplace with premium tax credits (extra cost)
 *   above 400%    → full-price marketplace premiums (extra cost — the "cliff")
 * Medicare starts at 65; its premiums are assumed to be in your budget, plus
 * IRMAA surcharges when income is high.
 *
 * "MAGI" for these programs = AGI + all Social Security (taxable or not).
 */
(function (RP) {
  'use strict';

  const H = {};

  /** Poverty guideline for a household of `size`. */
  H.fpl = function (size, params) {
    return params.fpl.base + params.fpl.perPerson * Math.max(0, size - 1);
  };

  /** Share of income you must pay toward the benchmark plan (ACA table). */
  H.applicablePct = function (fplRatio, table) {
    for (const [lo, hi, rLo, rHi] of table) {
      if (fplRatio < hi) {
        if (fplRatio <= lo) return rLo;
        return rLo + ((rHi - rLo) * (fplRatio - lo)) / (hi - lo);
      }
    }
    return table[table.length - 1][3];
  };

  /**
   * Coverage + extra cost for one year.
   *  x = { magi, householdSize, adultsUnder65, kidsUnder2, kidsUnder19, olderKidsInHH,
   *        publicMonths (months with no employer coverage), state, hasMinnesotaCare, growth }
   * Returns { status, kidsStatus, extraCost, fplRatio, lines:{...} }
   */
  H.coverage = function (x, params) {
    const fpl = H.fpl(x.householdSize, params);
    const ratio = x.magi / fpl;
    const lines = {
      adultMA: (params.adultMA / 100) * fpl,
      mncare: (params.mncare / 100) * fpl,
      kidsMA: (params.kidsMA / 100) * fpl,
      aca: (params.aca / 100) * fpl,
    };
    const res = { status: 'employer', kidsStatus: 'employer', extraCost: 0, fplRatio: ratio, fpl, lines };
    const share = Math.max(0, Math.min(12, x.publicMonths)) / 12;
    if (share <= 0) return res;

    const mnCareAvailable = x.hasMinnesotaCare !== false;
    // Adults (and kids 19+ still in the household) under 65.
    let adultStatus;
    if (x.adultsUnder65 + x.olderKidsInHH <= 0) adultStatus = 'medicare';
    else if (ratio <= params.adultMA / 100) adultStatus = 'ma';
    else if (mnCareAvailable && ratio <= params.mncare / 100) adultStatus = 'mncare';
    else if (ratio <= params.aca / 100) adultStatus = 'aca';
    else adultStatus = 'aca-full';

    // Kids under 19.
    const kidsLimit = params.kidsMA / 100;
    const babyLimit = params.kidsMAUnder2 / 100;
    let kidsOnMA = 0, kidsNeedPlan = 0;
    for (let i = 0; i < x.kidsUnder19; i++) {
      const limit = i < x.kidsUnder2 ? babyLimit : kidsLimit;
      if (ratio <= limit) kidsOnMA++; else kidsNeedPlan++;
    }
    res.kidsStatus = x.kidsUnder19 === 0 ? 'none' : kidsNeedPlan === 0 ? 'ma' : 'plan';

    // Extra cost beyond what's already in the budget.
    const g = x.growth || 1;
    let extra = 0;
    const adultsOnPlan = adultStatus === 'aca' || adultStatus === 'aca-full' ? x.adultsUnder65 + x.olderKidsInHH : 0;
    const coveredByPlan = adultsOnPlan + (adultsOnPlan > 0 || kidsNeedPlan > 0 ? kidsNeedPlan : 0);
    if (coveredByPlan > 0) {
      const fullPremium = (adultsOnPlan * params.acaAdultPremium + kidsNeedPlan * params.acaKidPremium) * g;
      let premium = fullPremium;
      if (ratio <= params.aca / 100) {
        premium = Math.min(fullPremium, H.applicablePct(ratio, params.applicable) * x.magi);
      }
      extra = premium + params.acaExtraOOP * g;
    }
    res.status = adultStatus;
    res.extraCost = extra * share;
    return res;
  };

  /** Medicare IRMAA surcharge (annual, per household) for people 65+. */
  H.irmaa = function (magi, filing, count65, params) {
    if (count65 <= 0) return { tier: 0, cost: 0 };
    const th = params.irmaa[filing === 'mfj' ? 'mfj' : 'single'];
    let tier = 0;
    for (let i = 0; i < th.length; i++) if (magi > th[i]) tier = i + 1;
    if (tier === 0) return { tier: 0, cost: 0 };
    const b = params.irmaa.partBMonthly, d = params.irmaa.partDMonthly;
    const perPerson = (b[tier] - b[0] + d[tier]) * 12;
    return { tier, cost: perPerson * count65 };
  };

  RP.health = H;
})(globalThis.RP = globalThis.RP || {});
