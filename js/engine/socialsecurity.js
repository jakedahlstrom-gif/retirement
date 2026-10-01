/*
 * socialsecurity.js — Social Security benefit math.
 *
 * Steps (same as SSA's):
 *  1. Earnings history: each year's earnings, capped at the taxable maximum,
 *     in today's dollars (wage-indexed).
 *  2. AIME = average of your highest 35 years, per month.
 *  3. PIA (your benefit at full retirement age) = 90% of AIME up to the first
 *     "bend point" + 32% up to the second + 15% above it. 2026 bend points.
 *  4. Adjust for claiming age: smaller if you claim before 67, 8%/yr bigger
 *     for each year you wait past 67 (up to 70).
 *  5. Spousal top-up (up to 50% of the other spouse's PIA) and survivor
 *     benefits (the survivor keeps the larger of the two checks).
 */
(function (RP) {
  'use strict';

  const S = {};

  /**
   * National Average Wage Index (SSA), used to convert past earnings that you
   * paste from your SSA statement (in the dollars of that year) into today's
   * dollars. Years after 2024 are treated as already in today's dollars.
   */
  S.AWI = {
    1990: 21027.98, 1991: 21811.60, 1992: 22935.42, 1993: 23132.67, 1994: 23753.53,
    1995: 24705.66, 1996: 25913.90, 1997: 27426.00, 1998: 28861.44, 1999: 30469.84,
    2000: 32154.82, 2001: 32921.92, 2002: 33252.09, 2003: 34064.95, 2004: 35648.55,
    2005: 36952.94, 2006: 38651.41, 2007: 40405.48, 2008: 41334.97, 2009: 40711.61,
    2010: 41673.83, 2011: 42979.61, 2012: 44321.67, 2013: 44888.16, 2014: 46481.52,
    2015: 48098.63, 2016: 48642.15, 2017: 50321.89, 2018: 52145.80, 2019: 54099.99,
    2020: 55628.60, 2021: 60575.07, 2022: 63795.13, 2023: 66621.80, 2024: 69846.57,
  };

  /** Convert a nominal past-year amount into today's (2024-wage-level) dollars. */
  S.indexEarnings = function (year, amount) {
    const base = S.AWI[2024];
    if (year >= 2025) return amount;
    const awi = S.AWI[year] || S.AWI[1990] * Math.pow(1.04, year - 1990);
    return amount * base / awi;
  };

  /** Full retirement age in months (67 years for anyone born 1960 or later). */
  S.fraMonths = function (birthYear) {
    if (birthYear >= 1960) return 67 * 12;
    if (birthYear <= 1937) return 65 * 12;
    if (birthYear <= 1942) return 65 * 12 + (birthYear - 1937) * 2;
    if (birthYear <= 1954) return 66 * 12;
    return 66 * 12 + (birthYear - 1954) * 2;
  };

  /** Average Indexed Monthly Earnings from an array of yearly earnings (today's $). */
  S.aime = function (yearlyEarnings, wageBase) {
    const capped = yearlyEarnings.map((e) => Math.max(0, Math.min(e, wageBase))).sort((a, b) => b - a);
    let total = 0;
    for (let i = 0; i < 35 && i < capped.length; i++) total += capped[i];
    return Math.floor(total / 420); // SSA rounds AIME down to the dollar
  };

  /** Primary Insurance Amount (monthly benefit at full retirement age). */
  S.pia = function (aime, bendPoints) {
    const [b1, b2] = bendPoints;
    const pia = 0.9 * Math.min(aime, b1) + 0.32 * Math.max(0, Math.min(aime, b2) - b1) + 0.15 * Math.max(0, aime - b2);
    return Math.floor(pia * 10) / 10; // SSA rounds down to the dime
  };

  /** Multiplier on your own PIA for claiming at `claimMonths` of age. */
  S.ownFactor = function (claimMonths, fraMonths) {
    const diff = claimMonths - fraMonths;
    if (diff >= 0) return 1 + Math.min(diff, 70 * 12 - fraMonths) * (2 / 3) / 100; // 8%/yr delayed credits
    const early = -diff;
    return 1 - Math.min(early, 36) * (5 / 9) / 100 - Math.max(0, early - 36) * (5 / 12) / 100;
  };

  /** Multiplier on the spousal benefit (50% of the other's PIA) by claiming age. */
  S.spousalFactor = function (claimMonths, fraMonths) {
    const early = fraMonths - claimMonths;
    if (early <= 0) return 1; // no delayed credits on spousal benefits
    return 1 - Math.min(early, 36) * (25 / 36) / 100 - Math.max(0, early - 36) * (5 / 12) / 100;
  };

  /** Survivor benefit multiplier: 71.5% at age 60 rising to 100% at full retirement age. */
  S.survivorFactor = function (ageMonths, fraMonths) {
    if (ageMonths >= fraMonths) return 1;
    const m60 = 60 * 12;
    const a = Math.max(ageMonths, m60);
    return 0.715 + (0.285 * (a - m60)) / (fraMonths - m60);
  };

  /**
   * Build each person's earnings list (today's dollars) for the AIME.
   *  past:   { startYear, years, avgEarnings }   simple estimate, or
   *  record: [{ year, amount }] pasted from ssa.gov (nominal dollars; indexed here)
   *  future: { [year]: wages } from the simulation (already today's dollars)
   */
  S.earningsList = function (ssPerson, futureWagesByYear, firstSimYear) {
    const byYear = {};
    if (Array.isArray(ssPerson.record) && ssPerson.record.length) {
      for (const r of ssPerson.record) {
        if (r && r.year < firstSimYear && r.amount > 0) byYear[r.year] = S.indexEarnings(r.year, r.amount);
      }
    } else if (ssPerson.past && ssPerson.past.years > 0) {
      for (let i = 0; i < ssPerson.past.years; i++) {
        const yr = ssPerson.past.startYear + i;
        if (yr < firstSimYear) byYear[yr] = ssPerson.past.avgEarnings;
      }
    }
    for (const [yr, w] of Object.entries(futureWagesByYear)) {
      byYear[yr] = (byYear[yr] || 0) + w;
    }
    return Object.values(byYear);
  };

  /**
   * Yearly Social Security income for both spouses across the plan.
   *  ctx = { years:[...], people:{p1,p2}, ss:{p1,p2,haircutPct,haircutYear},
   *          rules:{bendPoints}, wageBase, pia:{p1,p2}, deathYear:{p1,p2} (or null) }
   * Returns { p1:[...], p2:[...] } aligned with ctx.years (annual dollars), and
   * details for display.
   */
  S.yearlyBenefits = function (ctx) {
    const ids = ['p1', 'p2'];
    const info = {};
    for (const id of ids) {
      const person = ctx.people[id];
      const fra = S.fraMonths(person.birthYear);
      const claimAge = U().clamp(ctx.ss[id].claimAge, 62, 70);
      const claimMonth = person.birthYear * 12 + (person.birthMonth - 1) + Math.round(claimAge * 12); // absolute month index
      const deathYear = ctx.deathYear[id];
      info[id] = {
        id, fra, claimAge, claimMonth,
        pia: ctx.pia[id],
        ownMonthly: ctx.pia[id] * S.ownFactor(Math.round(claimAge * 12), fra),
        birthMonthIdx: person.birthYear * 12 + (person.birthMonth - 1),
        deathMonth: deathYear ? deathYear * 12 : Infinity, // dies at the start of that year
      };
    }
    const out = { p1: [], p2: [], details: info };
    const hc = 1 - (ctx.ss.haircutPct || 0) / 100;

    // Monthly check for `me` in absolute month `month`, if survivor benefits
    // (when relevant) start at absolute month `survStart`.
    function monthly(me, sp, month, survStart) {
      if (month >= me.deathMonth) return 0;
      let benefit = 0;
      if (month >= me.claimMonth) {
        benefit = me.ownMonthly;
        // Spousal top-up if the other spouse is alive and has filed.
        if (month < sp.deathMonth && month >= sp.claimMonth) {
          const excess = 0.5 * sp.pia - me.pia;
          if (excess > 0) benefit += excess * S.spousalFactor(Math.round(me.claimAge * 12), me.fra);
        }
      }
      if (month >= sp.deathMonth && month >= survStart) {
        benefit = Math.max(benefit, me.survivorBase * S.survivorFactor(survStart - me.birthMonthIdx, me.fra));
      }
      return benefit;
    }

    // If a spouse dies, pick the better survivor strategy: start survivor
    // benefits as early as allowed (age 60, reduced) or wait until full
    // retirement age (unreduced). Compared on total benefits to age 90.
    for (const id of ids) {
      const me = info[id];
      const sp = info[id === 'p1' ? 'p2' : 'p1'];
      me.survStart = Infinity;
      if (!isFinite(sp.deathMonth) || sp.deathMonth >= me.deathMonth) continue;
      const spAgeAtDeathM = sp.deathMonth - sp.birthMonthIdx;
      if (sp.deathMonth > sp.claimMonth) me.survivorBase = Math.max(sp.ownMonthly, 0.825 * sp.pia);
      else if (spAgeAtDeathM <= sp.fra) me.survivorBase = sp.pia;
      else me.survivorBase = sp.pia * S.ownFactor(Math.min(spAgeAtDeathM, 70 * 12), sp.fra);
      const early = Math.max(me.birthMonthIdx + 60 * 12, sp.deathMonth);
      const atFra = Math.max(me.birthMonthIdx + me.fra, sp.deathMonth);
      const endM = Math.min(me.deathMonth, me.birthMonthIdx + 90 * 12);
      let totEarly = 0, totFra = 0;
      for (let m = sp.deathMonth; m < endM; m++) {
        totEarly += monthly(me, sp, m, early);
        totFra += monthly(me, sp, m, atFra);
      }
      me.survStart = totFra > totEarly ? atFra : early;
    }

    for (const y of ctx.years) {
      for (const id of ids) {
        const me = info[id];
        const sp = info[id === 'p1' ? 'p2' : 'p1'];
        let annual = 0;
        for (let m = 0; m < 12; m++) annual += monthly(me, sp, y * 12 + m, me.survStart);
        const cut = y >= (ctx.ss.haircutYear || 0) ? hc : 1;
        out[id].push(annual * cut);
      }
    }
    return out;
  };

  function U() { return RP.util; }

  RP.ss = S;
})(globalThis.RP = globalThis.RP || {});
