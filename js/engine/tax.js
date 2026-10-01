/*
 * tax.js — federal income tax, Minnesota income tax, payroll (FICA) tax, and
 * the rules for how much Social Security is taxable.
 *
 * Everything is in today's dollars. Brackets that the law adjusts for inflation
 * stay fixed in today's dollars. A few thresholds are NOT adjusted for inflation
 * by law (Social Security taxation, NIIT, the extra 0.9% Medicare tax, the
 * child-credit phase-out); those shrink each year in today's dollars, so the
 * caller passes a `deflator` = (1 + inflation)^(years since 2026).
 *
 * Bracket format: [[upTo, rate], ...]; the last `upTo` is null (= no limit).
 */
(function (RP) {
  'use strict';

  const T = {};

  /** Tax owed on `income` using progressive `brackets`, rates scaled by `mult`. */
  T.bracketTax = function (income, brackets, mult) {
    mult = mult || 1;
    let tax = 0, lower = 0;
    for (const [upTo, rate] of brackets) {
      const top = upTo == null ? Infinity : upTo;
      if (income <= lower) break;
      tax += (Math.min(income, top) - lower) * rate * mult;
      lower = top;
    }
    return Math.max(0, tax);
  };

  /** The marginal rate that applies to the next dollar of `income`. */
  T.marginalRate = function (income, brackets, mult) {
    mult = mult || 1;
    for (const [upTo, rate] of brackets) {
      if (upTo == null || income < upTo) return rate * mult;
    }
    return brackets[brackets.length - 1][1] * mult;
  };

  /** Top of the bracket with the given rate (e.g. 0.12 -> 100,800 for joint filers). */
  T.bracketTop = function (brackets, rate) {
    for (const [upTo, r] of brackets) if (Math.abs(r - rate) < 1e-9) return upTo == null ? Infinity : upTo;
    return Infinity;
  };

  /**
   * How much Social Security is taxable (IRS Pub 915 worksheet).
   * otherIncome = AGI before Social Security (+ tax-exempt interest).
   */
  T.taxableSocialSecurity = function (ssBenefits, otherIncome, filing, params, deflator) {
    if (ssBenefits <= 0) return 0;
    const th = params.federal.ssTaxThresholds[filing] || params.federal.ssTaxThresholds.single;
    const b1 = th[0] / deflator, b2 = th[1] / deflator;
    const provisional = otherIncome + 0.5 * ssBenefits;
    if (provisional <= b1) return 0;
    if (provisional <= b2) return Math.min(0.5 * ssBenefits, 0.5 * (provisional - b1));
    return Math.min(0.85 * ssBenefits, 0.85 * (provisional - b2) + Math.min(0.5 * ssBenefits, 0.5 * (b2 - b1)));
  };

  /**
   * Federal income tax.
   * x = { ordinary, preferential (qualified dividends + long-term gains), filing,
   *       count65, kidsUnder17, otherDependents, earnedIncome, nii, magi,
   *       rateMult, deflator }
   * Returns { tax, beforeCredits, credits, refundableCredit, taxableIncome, marginal }.
   */
  T.federalTax = function (x, params) {
    const F = params.federal;
    const filing = x.filing;
    const mult = x.rateMult || 1;
    const deflator = x.deflator || 1;
    const std = F.std[filing] + (F.addl65[filing] || 0) * (x.count65 || 0);
    const ordinary = Math.max(0, x.ordinary);
    const pref = Math.max(0, x.preferential || 0);
    // The standard deduction is used against ordinary income first.
    const taxableOrd = Math.max(0, ordinary - std);
    const leftoverDeduction = Math.max(0, std - ordinary);
    const taxablePref = Math.max(0, pref - leftoverDeduction);
    const taxableIncome = taxableOrd + taxablePref;

    let tax = T.bracketTax(taxableOrd, F.brackets[filing], mult);

    // Long-term gains and qualified dividends stack on top of ordinary income.
    const [t0, t15] = F.ltcg[filing];
    const in0 = Math.max(0, Math.min(taxableIncome, t0) - taxableOrd);
    const in15 = Math.max(0, Math.min(taxableIncome, t15) - Math.max(taxableOrd, t0));
    const in20 = Math.max(0, taxableIncome - Math.max(taxableOrd, t15));
    tax += (in15 * 0.15 + in20 * 0.20) * mult;
    void in0;

    // Net investment income tax (threshold is not inflation-adjusted).
    if (x.nii > 0 && x.magi > 0) {
      const over = x.magi - F.niit[filing] / deflator;
      if (over > 0) tax += F.niit.rate * Math.min(x.nii, over);
    }

    const beforeCredits = tax;

    // Child tax credit ($2,200 per child under 17) + $500 for other dependents.
    let credit = (x.kidsUnder17 || 0) * F.ctc + (x.otherDependents || 0) * F.odc;
    const phaseStart = F.ctcPhaseout[filing] / deflator;
    if (x.magi > phaseStart) credit = Math.max(0, credit - Math.ceil((x.magi - phaseStart) / 1000) * 50);
    const nonRefundable = Math.min(credit, tax);
    tax -= nonRefundable;
    // Part of the child credit is refundable, but only with earned income.
    const unused = credit - nonRefundable;
    const refundableCap = Math.min((x.kidsUnder17 || 0) * F.ctcRefundable, 0.15 * Math.max(0, (x.earnedIncome || 0) - 2500));
    const refundable = Math.max(0, Math.min(unused, refundableCap));
    tax -= refundable;

    return {
      tax,
      beforeCredits,
      credits: nonRefundable + refundable,
      refundableCredit: refundable,
      taxableIncome,
      marginal: T.marginalRate(taxableOrd, F.brackets[filing], mult),
    };
  };

  /**
   * Minnesota income tax.
   * x = { agi, ssTaxable, filing, count65, dependents, kidsUnder18, contrib529, rateMult }
   */
  T.minnesotaTax = function (x, params) {
    const M = params.mn;
    const filing = x.filing;
    const agi = Math.max(0, x.agi);
    // Social Security subtraction: full below the threshold, then 10% less per $4,000 over.
    let ssSub = 0;
    if (x.ssTaxable > 0) {
      const th = M.ssSubtraction[filing];
      const steps = agi <= th ? 0 : Math.ceil((agi - th) / M.ssSubtraction.stepAmount);
      ssSub = x.ssTaxable * Math.max(0, 1 - steps * M.ssSubtraction.stepPct);
    }
    const sub529 = Math.min(x.contrib529 || 0, M.sub529[filing] || 0);
    // Standard deduction (reduced for high incomes).
    let std = M.std[filing] + (M.addl65[filing] || 0) * (x.count65 || 0);
    if (agi > M.stdPhaseout[filing]) std -= Math.min(0.03 * (agi - M.stdPhaseout[filing]), 0.8 * std);
    const exemptions = M.dependentExemption * (x.dependents || 0);
    const taxable = Math.max(0, agi - ssSub - sub529 - std - exemptions);
    let tax = T.bracketTax(taxable, M.brackets[filing], x.rateMult || 1);
    // Minnesota Child Tax Credit ($1,750 per child under 18), refundable, phases out 12%.
    let ctc = (x.kidsUnder18 || 0) * M.ctc.perChild;
    if (ctc > 0) ctc = Math.max(0, ctc - M.ctc.phaseoutRate * Math.max(0, agi - M.ctc.phaseoutStart[filing]));
    tax -= ctc;
    return { tax, taxable, ssSubtraction: ssSub, ctc };
  };

  /** A flat-rate state tax (used if you model moving out of Minnesota). */
  T.flatStateTax = function (agi, ssTaxable, filing, ratePct, params) {
    const std = params.federal.std[filing];
    return Math.max(0, (agi - ssTaxable - std) * ratePct / 100);
  };

  /**
   * Payroll tax for one household. wages = array of W-2 wages per person (after
   * HSA payroll deductions, which skip FICA; 401k deferrals do NOT skip FICA).
   */
  T.fica = function (wages, filing, params, deflator) {
    const P = params.fica;
    let tax = 0, total = 0;
    for (const w of wages) {
      if (w <= 0) continue;
      tax += Math.min(w, P.wageBase) * P.ssRate + w * P.medicareRate;
      total += w;
    }
    const addlTh = P.addlMedicareThreshold[filing] / deflator;
    if (total > addlTh) tax += (total - addlTh) * P.addlMedicareRate;
    return tax;
  };

  RP.tax = T;
})(globalThis.RP = globalThis.RP || {});
