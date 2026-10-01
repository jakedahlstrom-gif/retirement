/*
 * defaults.js — the shape of a plan, with default assumptions.
 *
 * RP.DEFAULT_PLAN holds every setting the engine understands, filled with a
 * FICTIONAL sample household ("Alex & Sam"). Nothing personal lives here, so
 * this file is safe to put online. Your real numbers come from my-plan.json,
 * which you import once in the app; it is merged on top of these defaults
 * (anything missing from your file falls back to the value here).
 *
 * Money is in today's dollars per year unless a name says otherwise.
 * Percentages are written as numbers (5 means 5%).
 */
(function (RP) {
  'use strict';

  RP.DEFAULT_PLAN = {
    schema: 1,
    meta: { planName: 'Sample household', lastUpdated: '2026-08-15', isSample: true },

    people: {
      p1: { name: 'Alex', birthYear: 1986, birthMonth: 7, employer: 'Employer A' },
      p2: { name: 'Sam', birthYear: 1988, birthMonth: 3, employer: 'Employer B' },
    },
    kids: [
      { name: 'Kid 1', birthYear: 2019, birthMonth: 5 },
      { name: 'Kid 2', birthYear: 2022, birthMonth: 10 },
    ],
    household: {
      state: 'MN',
      horizonPerson: 'p2',
      horizonAge: 95,
      kidsInHouseholdThroughAge: 22, // counted for health-program household size & tax dependents
    },

    // Balances on the "as of" date.
    balances: {
      asOf: '2026-08-15',
      p1_401k: 240000,
      p2_401k: 180000,
      roth: 40000,
      rothBasis: 32000, // contributions you can always take back tax- and penalty-free
      rothP1SharePct: 50, // how the Roth total splits between the two of you
      hsa: 15000,
      hsaReceipts: 2000, // saved medical receipts you can reimburse yourself for later
      cash: 15000,
      brokerage: 30000,
      brokerageBasis: 24000, // what you paid for the investments (the rest is gain)
      edu: 8000, // 529 / Trump Account balance
      homeEquity: 220000,
    },

    retirement: { p1Age: 58, together: true, p2Age: 56 },

    income: {
      p1: { salary: 95000, raisePct: 0, newJob: { enabled: false, year: 2030, month: 1, salary: 105000 } },
      p2: { salary: 80000, raisePct: 0, newJob: { enabled: false, year: 2030, month: 1, salary: 90000 } },
    },

    jobLoss: {
      p1: {
        enabled: false, year: 2028, month: 7, severance: 30000,
        ui: { enabled: false, weekly: 948, weeks: 26 },
        reemploy: { enabled: true, afterMonths: 6, salary: 85000 },
      },
      p2: {
        enabled: false, year: 2028, month: 7, severance: 20000,
        ui: { enabled: false, weekly: 800, weeks: 26 },
        reemploy: { enabled: true, afterMonths: 6, salary: 75000 },
      },
      rollOld401kIntoNewPlan: true, // keeps the Rule of 55 working with a new employer
    },

    // Each contribution: yearly amount + first/last year (lastYear null = until that job ends).
    contributions: {
      p1_401k: { amount: 15000, firstYear: 2026, lastYear: null },
      p1_match: { amount: 4750, firstYear: 2026, lastYear: null },
      p2_401k: { amount: 12000, firstYear: 2026, lastYear: null },
      p2_match: { amount: 4000, firstYear: 2026, lastYear: null },
      hsa: { amount: 8750, firstYear: 2026, lastYear: null },
      rothIra: { amount: 15000, firstYear: 2026, lastYear: null },
      mega: { enabled: false, person: 'p1', amount: 12000, firstYear: 2030, lastYear: null },
      taxable: [{ amount: 6000, firstYear: 2026, lastYear: null }],
      edu: { amount: 2000, firstYear: 2026, lastYear: 2036 },
      leftoverTo: 'brokerage', // 'brokerage' | 'cash' | 'spend'
    },

    hsa: { receiptsPerYear: 2000, medicalPerYear: 4000 },

    spending: {
      working: 70000,
      retirement: 75000, // includes medical (~$4K) and health premiums; taxes are extra
      phases: { enabled: false, list: [] }, // [{ fromAge, toAge, amount }] using person 1's age
      daycare: { amount: 0, firstYear: 2026, lastYear: 2026, lastYearFraction: 1 },
      guardrails: { enabled: false, behindPct: 20, cutPct: 10 },
      recurring: [], // [{ id, label, amount, firstYear, lastYear, every }]
      oneTime: [], // [{ id, label, year, amount, kind: 'expense'|'windfall'|'income' }]
      creepPct: 0, // stress test: retirement spending grows this much faster than inflation
    },

    mortgage: {
      enabled: false, balance: 200000, ratePct: 3.0, monthlyPI: 1400, extraMonthly: 0,
      payoffYearOverride: null, includedInSpending: true,
    },

    housing: {
      appreciationPct: 0, // home value growth above inflation
      downsize: { enabled: false, year: 2045, salePrice: null, sellingCostPct: 6, newHomeCost: 300000, annualCostChange: -3000 },
      move: { enabled: false, year: 2040, stateName: 'Another state', taxRatePct: 4.0 },
    },

    college: {
      enabled: false,
      account: '529', // '529' | 'trump'
      costGrowthPct: 1.5,
      trumpEarningsTaxPct: 10, // tax on Trump Account growth when used (kid's low bracket)
      kids: [
        { enabled: true, startYear: 2037, years: 4, annualCost: 28000, coverPct: 50 },
        { enabled: true, startYear: 2040, years: 4, annualCost: 28000, coverPct: 50 },
      ],
    },

    ss: {
      p1: { claimAge: 70, past: { startYear: 2008, years: 18, avgEarnings: 70000 }, record: [] },
      p2: { claimAge: 70, past: { startYear: 2010, years: 16, avgEarnings: 60000 }, record: [] },
      haircutPct: 25,
      haircutYear: 2034,
    },

    partTime: {
      p1: { enabled: false, amount: 20000, firstYear: 2045, lastYear: 2049 },
      p2: { enabled: false, amount: 20000, firstYear: 2045, lastYear: 2049 },
    },

    disability: { enabled: false, person: 'p1', year: 2030, month: 1, benefitPct: 60, taxable: true, untilAge: 65 },
    death: { enabled: false, person: 'p1', year: 2050, spendingPct: 75, lifeInsurance: 0 },

    returns: {
      working: 5.0, // expected real (after-inflation) return while working
      retired: 4.0, // ... once you're retired
      cash: 1.5,
      volatility: 15,
      inflation: 2.5, // only used for things fixed in dollars (mortgage, 72(t), some tax thresholds)
      dividendYield: 1.5, // taxable dividends from the brokerage account each year
      meaning: 'typical', // 'typical' = money compounds at this rate in a typical run; 'average' = average of yearly returns (more conservative)
      source: 'model', // 'model' | 'historical'
      allocation: {
        enabled: false, stocks: 80, bonds: 20, cash: 0,
        stockReturn: 6.5, stockVol: 18, bondReturn: 2.0, bondVol: 7, correlation: 0.1,
        glide: { enabled: false, retiredStocks: 55, yearsBefore: 10 },
      },
      speculative: { enabled: false, pct: 1, return: 8, vol: 60 },
      // Optional per-account tweaks, in percentage points added to the year's return
      // (e.g. +1 for a more aggressive Roth, −0.5 for tax drag in the brokerage).
      accountAdjust: { preTax: 0, roth: 0, hsa: 0, taxable: 0, edu: 0 },
      stress: {
        crash: { enabled: false, pct: -30 }, // a crash in the first year of retirement
        lostDecade: { enabled: false, years: 10, returnPct: 0 },
      },
    },

    conversions: {
      strategy: 'healthCap', // 'healthCap' | 'bracket' | 'fixed' | 'none'
      bracketRate: 12, // fill up to the top of this bracket (when not capped by health rules)
      fixedAmount: 30000,
      buffer: 1000, // stay this far below an income line, to be safe
      fromFirst: 'p2', // convert this person's 401k first
      afterMedicare: 'bracket', // 'bracket' | 'irmaa' | 'none'
    },

    sepp: { enabled: false, person: 'auto', mode: 'auto', amount: 20000, ratePct: 5.0, startYear: null },

    health: {
      fpl: { base: 15960, perPerson: 5680 }, // 2026 HHS poverty guideline (48 states)
      adultMA: 138, mncare: 200, kidsMA: 275, kidsMAUnder2: 283, aca: 400,
      // ACA "applicable percentage" table for 2026: [fromFPL, toFPL, fromRate, toRate]
      applicable: [
        [0, 1.33, 0.021, 0.021], [1.33, 1.5, 0.0314, 0.0419], [1.5, 2.0, 0.0419, 0.066],
        [2.0, 2.5, 0.066, 0.0844], [2.5, 3.0, 0.0844, 0.0996], [3.0, 4.0, 0.0996, 0.0996],
      ],
      acaAdultPremium: 9000, // full-price benchmark plan per adult (50s), per year
      acaKidPremium: 3500,
      acaExtraOOP: 3000, // extra out-of-pocket vs MinnesotaCare, per year
      inflationPct: 1.5, // medical costs grow this much faster than general inflation
      medicareAge: 65,
      ltc: { enabled: false, startAge: 85, years: 3, annualCost: 100000 },
    },

    // 2026 tax law (all editable). Brackets: [upTo, rate]; null = no limit.
    tax: {
      federal: {
        brackets: {
          mfj: [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [null, 0.37]],
          single: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [null, 0.37]],
          hoh: [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [null, 0.37]],
        },
        std: { mfj: 32200, single: 16100, hoh: 24150 },
        addl65: { mfj: 1650, single: 2050, hoh: 2050 },
        ltcg: { mfj: [98900, 613700], single: [49450, 545500], hoh: [66200, 579600] },
        ctc: 2200, ctcRefundable: 1700, odc: 500,
        ctcPhaseout: { mfj: 400000, single: 200000, hoh: 200000 }, // not inflation-adjusted
        niit: { rate: 0.038, mfj: 250000, single: 200000, hoh: 200000 }, // not inflation-adjusted
        ssTaxThresholds: { mfj: [32000, 44000], single: [25000, 34000], hoh: [25000, 34000] }, // not inflation-adjusted
      },
      mn: {
        brackets: {
          mfj: [[48700, 0.0535], [193480, 0.068], [337930, 0.0785], [null, 0.0985]],
          single: [[33310, 0.0535], [109430, 0.068], [203150, 0.0785], [null, 0.0985]],
          hoh: [[41400, 0.0535], [155650, 0.068], [277200, 0.0785], [null, 0.0985]],
        },
        std: { mfj: 30600, single: 15300, hoh: 23000 },
        addl65: { mfj: 1650, single: 2050, hoh: 2050 },
        stdPhaseout: { mfj: 244600, single: 244600, hoh: 244600 },
        dependentExemption: 5300,
        ssSubtraction: { mfj: 110780, single: 86410, hoh: 86410, stepAmount: 4000, stepPct: 0.10 },
        ctc: { perChild: 1750, phaseoutRate: 0.12, phaseoutStart: { mfj: 37910, single: 31950, hoh: 31950 } },
        sub529: { mfj: 3000, single: 1500, hoh: 1500 },
      },
      fica: {
        ssRate: 0.062, medicareRate: 0.0145, wageBase: 184500,
        addlMedicareRate: 0.009, addlMedicareThreshold: { mfj: 250000, single: 200000, hoh: 200000 },
      },
      limits: { k401: 24500, catchup50: 8000, catchup6063: 11250, total415: 72000, ira: 7500, iraCatchup: 1100 },
      rmdAge: 75, // SECURE 2.0: 75 for anyone born 1960 or later
      irmaa: {
        mfj: [218000, 274000, 342000, 410000, 750000],
        single: [109000, 137000, 171000, 205000, 500000],
        partBMonthly: [202.9, 284.1, 405.8, 527.5, 649.2, 689.9],
        partDMonthly: [0, 14.5, 37.5, 60.4, 83.3, 91.0],
      },
      futureRates: { enabled: false, startYear: 2030, increasePct: 20 },
    },

    ssRules: { bendPoints: [1286, 7749] },

    sim: {
      runs: 1000,
      seed: 20260815,
      successTarget: 90, // "safe spending" = most you can spend at this success rate
      greenLightTarget: 95,
      coastTarget: 90,
      coastYear: null, // set by the Coast FIRE scenario: all saving stops this year
    },
  };
})(globalThis.RP = globalThis.RP || {});
