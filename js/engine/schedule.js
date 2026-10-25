/*
 * schedule.js — everything about each year that does NOT depend on market
 * returns: ages, paychecks, job loss & re-employment, contributions, daycare,
 * spending targets, mortgage, college, Social Security, tax filing status,
 * health-program income lines, and when accounts unlock.
 *
 * It's computed once per scenario, then reused by all 1,000 Monte Carlo runs
 * (that's a big part of why the simulation is fast enough for a phone).
 *
 * Money amounts stored per year already cover only the simulated part of the
 * first year (e.g. Aug 15 → Dec 31 of 2026), so the simulation can add them up
 * directly. `frac[i]` says what share of year i is simulated.
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = (RP.engine = RP.engine || {});

  /** IRS Uniform Lifetime Table (2022+) for required minimum distributions. */
  E.ULT = {
    72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2,
    81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9,
    90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3,
    99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
    108: 3.9, 109: 3.7, 110: 3.5,
  };
  /** IRS Single Life Expectancy Table (2022+), used for 72(t) payments. */
  E.SINGLE_LIFE = {
    40: 45.7, 41: 44.8, 42: 43.8, 43: 42.9, 44: 41.9, 45: 41.0, 46: 40.0, 47: 39.0, 48: 38.1,
    49: 37.1, 50: 36.2, 51: 35.3, 52: 34.3, 53: 33.4, 54: 32.5, 55: 31.6, 56: 30.6, 57: 29.8,
    58: 28.9, 59: 28.0, 60: 27.1,
  };

  E.PIDS = ['p1', 'p2'];

  /** Calendar year in which a person reaches 59½. */
  E.year59half = (person) => Math.floor((person.birthYear * 12 + (person.birthMonth - 1) + 714) / 12);

  /** The calendar year each person retires (works through Dec 31 of it). */
  E.retireYears = function (plan) {
    const p1y = plan.people.p1.birthYear + plan.retirement.p1Age;
    const p2y = plan.retirement.together ? p1y : plan.people.p2.birthYear + plan.retirement.p2Age;
    return { p1: p1y, p2: p2y };
  };

  /**
   * Month-by-month employment model for one person. Months are absolute
   * indexes: year * 12 + (month - 1).
   */
  E.employment = function (plan, pid, y0) {
    const person = plan.people[pid];
    const inc = plan.income[pid];
    const jl = plan.jobLoss[pid];
    const retireYear = E.retireYears(plan)[pid];
    const deathMonth = plan.death.enabled && plan.death.person === pid ? plan.death.year * 12 : Infinity;
    const disabMonth = plan.disability.enabled && plan.disability.person === pid
      ? plan.disability.year * 12 + plan.disability.month - 1 : Infinity;
    const endMonth = Math.min((retireYear + 1) * 12, deathMonth, disabMonth);
    const lossMonth = jl.enabled ? jl.year * 12 + jl.month - 1 : Infinity;
    const reMonth = jl.enabled && jl.reemploy.enabled ? lossMonth + Math.max(0, jl.reemploy.afterMonths) : Infinity;
    const newJobMonth = inc.newJob && inc.newJob.enabled ? inc.newJob.year * 12 + inc.newJob.month - 1 : Infinity;
    const growth = (m) => Math.pow(1 + (inc.raisePct || 0) / 100, Math.floor(m / 12) - y0);

    const employed = (m) => m < endMonth && !(m >= lossMonth && m < reMonth);
    const baseSalary = (m) => inc.salary * growth(m);
    const salary = function (m) {
      let s = inc.salary, t = -Infinity;
      if (newJobMonth <= m) { s = inc.newJob.salary; t = newJobMonth; }
      if (reMonth <= m && reMonth > t) s = jl.reemploy.salary;
      return s * growth(m);
    };
    // Final separation from employment (the month you stop for good).
    let finalSep = endMonth;
    if (lossMonth < endMonth && !(jl.reemploy.enabled && reMonth < endMonth)) finalSep = lossMonth;
    // Did the person change employers (job loss + re-employment, or a new job)?
    let changeMonth = Infinity;
    if (newJobMonth < finalSep) changeMonth = newJobMonth;
    if (reMonth < finalSep) changeMonth = Math.min(changeMonth, lossMonth);

    return { pid, person, retireYear, deathMonth, disabMonth, endMonth, lossMonth, reMonth, newJobMonth,
      finalSep, changeMonth, employed, salary, baseSalary };
  };

  /** Mortgage amortization (nominal dollars, month by month). */
  E.amortize = function (m, startMonth) {
    const out = { payments: {}, balances: {}, payoffMonth: Infinity };
    if (!m || !m.enabled || !(m.balance > 0)) return out;
    const r = (m.ratePct || 0) / 100 / 12;
    let bal = m.balance;
    const pay = m.monthlyPI + (m.extraMonthly || 0);
    const overrideEnd = m.payoffYearOverride ? (m.payoffYearOverride + 1) * 12 : Infinity;
    const dust = Math.max(1, pay * 0.01); // a few dollars left from cent rounding = paid off
    for (let k = 0; k < 600 && bal > dust; k++) {
      const month = startMonth + k;
      out.balances[month] = bal;
      if (month >= overrideEnd) { out.payoffMonth = month; bal = 0; break; }
      const interest = bal * r;
      let p = Math.min(pay, bal + interest);
      if (pay <= interest && k > 0) { p = pay; } // payment too small: never pays off
      const principalPaid = p - interest;
      const piPart = Math.min(m.monthlyPI, p);
      out.payments[month] = { pi: piPart, extra: p - piPart };
      bal = Math.max(0, bal - principalPaid);
      if (bal <= dust) out.payoffMonth = month + 1;
    }
    return out;
  };

  /**
   * Build the full year-by-year schedule for a (fully merged) plan.
   */
  E.buildSchedule = function (plan) {
    const P = plan;
    const ids = E.PIDS;
    const y0 = Number(String(P.balances.asOf).slice(0, 4));
    // First simulated month: the "as of" month if the date is on/before the
    // 15th, otherwise the next month. The first year covers whole months.
    const [, asM, asD] = String(P.balances.asOf).split('-').map(Number);
    const asOfMonth = y0 * 12 + (asM - 1) + ((asD || 1) > 15 ? 1 : 0);
    const frac0 = ((y0 + 1) * 12 - asOfMonth) / 12;
    const hp = P.people[P.household.horizonPerson] || P.people.p2;
    const yEnd = hp.birthYear + P.household.horizonAge;
    const years = [];
    for (let y = y0; y <= yEnd; y++) years.push(y);
    const n = years.length;
    const infl = (P.returns.inflation || 0) / 100;
    const hInfl = (P.health.inflationPct || 0) / 100;
    const lim = P.tax.limits;
    const C = P.contributions;
    const coastYear = P.sim.coastYear || null;

    const emp = { p1: E.employment(P, 'p1', y0), p2: E.employment(P, 'p2', y0) };
    const deathPid = P.death.enabled ? P.death.person : null;
    const deathYear = P.death.enabled ? P.death.year : null;
    const survivorPid = deathPid ? (deathPid === 'p1' ? 'p2' : 'p1') : null;
    const mort = E.amortize(P.mortgage, asOfMonth);
    const downsize = P.housing.downsize;
    const downsizeMonth = downsize.enabled ? downsize.year * 12 : Infinity;

    const arr = () => new Array(n).fill(0);
    const S = {
      y0, yEnd, n, years, frac: arr(), asOfMonth,
      age: { p1: arr(), p2: arr() }, alive: { p1: arr(), p2: arr() },
      workMonths: arr(), personMonths: { p1: arr(), p2: arr() },
      wages: { p1: arr(), p2: arr() }, partTime: { p1: arr(), p2: arr() },
      severance: { p1: arr(), p2: arr() }, ui: arr(), disability: arr(),
      ss: { p1: arr(), p2: arr() },
      def401k: { p1: arr(), p2: arr() }, match: { p1: arr(), p2: arr() }, mega: { p1: arr(), p2: arr() },
      hsaContrib: arr(), hsaPayrollPid: new Array(n).fill('p1'), receiptsAdd: arr(), hsaMedical: arr(),
      rothIra: arr(), taxableTarget: arr(), eduContrib: arr(),
      leftoverTo: new Array(n).fill(C.leftoverTo || 'brokerage'),
      coreWorking: arr(), coreRetired: arr(), survivorMult: new Array(n).fill(1),
      medicalGrowth: arr(), daycare: arr(), mortgageAdj: arr(), mortgagePaid: arr(),
      recurring: arr(), oneTimeExpense: arr(), windfall: arr(), otherIncome: arr(),
      college: arr(), ltc: arr(), downsizeNet: arr(), housingCostChange: arr(), homeEquity: arr(),
      filing: new Array(n).fill('mfj'), count65: arr(), adultsUnder65: arr(),
      kidsUnder2: arr(), kidsUnder17: arr(), kidsUnder18: arr(), kidsUnder19: arr(),
      dependents: arr(), olderKidsInHH: arr(), otherDependents: arr(), hhSize: arr(),
      publicMonths: arr(), deflator: arr(), rateMult: new Array(n).fill(1),
      state: new Array(n).fill(P.household.state || 'MN'), stateRate: arr(), hasMinnesotaCare: new Array(n).fill(true),
      healthGrowth: arr(), events: [],
      unlock: { p1: {}, p2: {} },
    };

    // ---- People: unlock years -------------------------------------------
    for (const pid of ids) {
      const e = emp[pid];
      const person = P.people[pid];
      const sepYearForAge = Math.floor((e.finalSep - 1) / 12);
      const r55 = isFinite(e.finalSep) && sepYearForAge - person.birthYear >= 55 && e.finalSep < e.deathMonth;
      S.unlock[pid] = {
        year59: E.year59half(person),
        rule55Year: r55 ? Math.floor(e.finalSep / 12) : null,
        separationYear: isFinite(e.finalSep) ? Math.floor(e.finalSep / 12) : null,
        separationYearForAge: sepYearForAge,
        changeYear: isFinite(e.changeMonth) ? Math.floor(e.changeMonth / 12) : null,
        medicareYear: person.birthYear + P.health.medicareAge,
        rmdYear: person.birthYear + P.tax.rmdAge,
        retireYear: e.retireYear,
      };
    }

    // ---- Year loop -----------------------------------------------------------
    let lastFullTimeYear = y0 - 1;
    const futureWages = { p1: {}, p2: {} };

    for (let i = 0; i < n; i++) {
      const y = years[i];
      const f = i === 0 ? frac0 : 1;
      S.frac[i] = f;
      const firstMonth = i === 0 ? asOfMonth : y * 12;
      const simMonths = [];
      for (let m = firstMonth; m < (y + 1) * 12; m++) simMonths.push(m);
      S.deflator[i] = Math.pow(1 + infl, y - 2026);
      S.healthGrowth[i] = Math.pow(1 + hInfl, y - y0);
      if (P.tax.futureRates.enabled && y >= P.tax.futureRates.startYear) S.rateMult[i] = 1 + P.tax.futureRates.increasePct / 100;

      // Ages & who is alive
      let adults = 0;
      for (const pid of ids) {
        S.age[pid][i] = y - P.people[pid].birthYear;
        S.alive[pid][i] = !(deathPid === pid && y >= deathYear) ? 1 : 0;
        adults += S.alive[pid][i];
        if (S.alive[pid][i] && S.age[pid][i] >= P.health.medicareAge) S.count65[i]++;
        else if (S.alive[pid][i]) S.adultsUnder65[i]++;
      }
      // Kids
      for (const k of P.kids || []) {
        const a = y - k.birthYear;
        if (a < 0) continue;
        if (a < 2) S.kidsUnder2[i]++;
        if (a < 17) S.kidsUnder17[i]++;
        if (a < 18) S.kidsUnder18[i]++;
        if (a < 19) S.kidsUnder19[i]++;
        if (a <= P.household.kidsInHouseholdThroughAge) {
          S.dependents[i]++;
          if (a >= 17) S.otherDependents[i]++;
          if (a >= 19) S.olderKidsInHH[i]++;
        }
      }
      S.hhSize[i] = adults + S.dependents[i];

      // Filing status
      if (deathPid && y >= deathYear) {
        if (y === deathYear) S.filing[i] = 'mfj';
        else if (y <= deathYear + 2 && S.dependents[i] > 0) S.filing[i] = 'mfj'; // qualifying surviving spouse
        else S.filing[i] = S.dependents[i] > 0 ? 'hoh' : 'single';
        S.survivorMult[i] = P.death.spendingPct / 100;
      }

      // State
      if (P.housing.move.enabled && y >= P.housing.move.year) {
        S.state[i] = 'other';
        S.stateRate[i] = P.housing.move.taxRatePct;
        S.hasMinnesotaCare[i] = false;
      } else if ((P.household.state || 'MN') !== 'MN') {
        S.state[i] = 'other';
        S.stateRate[i] = P.household.stateTaxPct || 0;
        S.hasMinnesotaCare[i] = false;
      }

      // ---- Paychecks, month by month -----------------------------------------
      let workMonths = 0, parentHomeMonthsInDaycare = 0, daycareMonths = 0;
      const dc = P.spending.daycare;
      const months = { p1: 0, p2: 0 };
      const contrib = { def: { p1: 0, p2: 0 }, match: { p1: 0, p2: 0 }, mega: { p1: 0, p2: 0 } };
      for (const m of simMonths) {
        let anyEmployed = false, parentHome = false;
        for (const pid of ids) {
          const e = emp[pid];
          if (!S.alive[pid][i]) continue;
          if (e.employed(m)) {
            anyEmployed = true;
            months[pid]++;
            const sal = e.salary(m) / 12;
            S.wages[pid][i] += sal;
            const ratio = e.salary(m) / Math.max(1, e.baseSalary(m));
            const inWin = (c) => c && y >= c.firstYear && (c.lastYear == null || y <= c.lastYear) && !(coastYear && y >= coastYear);
            const cd = C[pid + '_401k'], cm = C[pid + '_match'];
            if (inWin(cd)) contrib.def[pid] += (cd.amount / 12) * ratio;
            if (inWin(cm)) contrib.match[pid] += (cm.amount / 12) * ratio;
            if (C.mega && C.mega.enabled && C.mega.person === pid && inWin(C.mega)) contrib.mega[pid] += C.mega.amount / 12;
          } else if (m < e.deathMonth && m < e.disabMonth) {
            parentHome = true;
          }
          // Unemployment insurance
          const jl = P.jobLoss[pid];
          if (jl.enabled && jl.ui.enabled && m >= e.lossMonth && m < e.reMonth) {
            const uiMonths = (jl.ui.weeks * 7) / 30.4375;
            if (m - e.lossMonth < uiMonths) S.ui[i] += (jl.ui.weekly * 52) / 12 * Math.min(1, uiMonths - (m - e.lossMonth));
          }
          // Disability benefit
          if (m >= e.disabMonth && m < e.deathMonth) {
            const untilM = (P.people[pid].birthYear + P.disability.untilAge) * 12 + P.people[pid].birthMonth - 1;
            if (m < untilM) S.disability[i] += (P.disability.benefitPct / 100) * e.salary(e.disabMonth - 1) / 12;
          }
          if (jl.enabled && m === e.lossMonth && e.lossMonth < e.endMonth) S.severance[pid][i] += jl.severance;
        }
        if (anyEmployed) workMonths++;
        // Daycare (month by month; drops to $0 while a parent is home)
        const inDc = dc && dc.amount > 0 && y >= dc.firstYear && y <= dc.lastYear &&
          (y < dc.lastYear || (m - y * 12) < 12 * (dc.lastYearFraction == null ? 1 : dc.lastYearFraction));
        if (inDc) {
          daycareMonths++;
          if (parentHome) parentHomeMonthsInDaycare++;
          else S.daycare[i] += dc.amount / 12;
        }
      }
      void daycareMonths; void parentHomeMonthsInDaycare;
      S.workMonths[i] = workMonths;
      S.personMonths.p1[i] = months.p1;
      S.personMonths.p2[i] = months.p2;
      if (workMonths > 0) lastFullTimeYear = y;

      // 401k limits (with catch-up), capped at wages
      for (const pid of ids) {
        const age = S.age[pid][i];
        const cap = (lim.k401 + (age >= 60 && age <= 63 ? lim.catchup6063 : age >= 50 ? lim.catchup50 : 0)) * f;
        const def = Math.min(contrib.def[pid], cap, S.wages[pid][i]);
        S.def401k[pid][i] = Math.max(0, def);
        S.match[pid][i] = contrib.match[pid];
        S.mega[pid][i] = Math.max(0, Math.min(contrib.mega[pid], lim.total415 * f - S.def401k[pid][i] - S.match[pid][i]));
      }

      // Part-time work in retirement (counts as earned income)
      for (const pid of ids) {
        const pt = P.partTime[pid];
        if (pt && pt.enabled && S.alive[pid][i] && y >= pt.firstYear && y <= pt.lastYear) S.partTime[pid][i] = pt.amount * f;
        futureWages[pid][y] = (S.wages[pid][i] + S.partTime[pid][i] + S.severance[pid][i]) / f; // full-year earnings for the SS record
      }

      // HSA: while at least one of you works (family HDHP through work)
      const inWin = (c) => c && y >= c.firstYear && (c.lastYear == null || y <= c.lastYear) && !(coastYear && y >= coastYear);
      const maxMonths = Math.max(months.p1, months.p2);
      if (inWin(C.hsa)) S.hsaContrib[i] = C.hsa.amount * (maxMonths / 12);
      S.hsaPayrollPid[i] = S.wages.p1[i] >= S.wages.p2[i] ? 'p1' : 'p2';
      if (workMonths > 0) S.receiptsAdd[i] = (P.hsa.receiptsPerYear || 0) * f;
      // Earned income (needed for Roth IRA contributions)
      const earned = S.wages.p1[i] + S.wages.p2[i] + S.partTime.p1[i] + S.partTime.p2[i] + S.severance.p1[i] + S.severance.p2[i];
      if (inWin(C.rothIra) && (C.rothIra.lastYear != null || workMonths > 0)) {
        S.rothIra[i] = Math.min(C.rothIra.amount * f, earned);
      }
      // Planned taxable (bridge fund) savings, while working
      for (const t of C.taxable || []) {
        if (y >= t.firstYear && (t.lastYear == null ? workMonths > 0 : y <= t.lastYear) && !(coastYear && y >= coastYear)) {
          S.taxableTarget[i] += t.amount * (t.lastYear == null ? workMonths / 12 : f);
        }
      }
      if (inWin(C.edu)) S.eduContrib[i] = C.edu.amount * f;
      if (coastYear && y >= coastYear) S.leftoverTo[i] = 'spend';

      // ---- Spending -----------------------------------------------------------
      S.coreWorking[i] = P.spending.working * (workMonths / 12);
      S.coreRetired[i] = retiredSpendingFor(P, y, S.age.p1[i]) * (simMonths.length - workMonths) / 12;
      S.medicalGrowth[i] = (P.hsa.medicalPerYear || 0) * (S.healthGrowth[i] - 1) * f;
      if (workMonths === 0) S.hsaMedical[i] = (P.hsa.medicalPerYear || 0) * S.healthGrowth[i] * f;
      else S.hsaMedical[i] = (P.hsa.medicalPerYear || 0) * S.healthGrowth[i] * ((simMonths.length - workMonths) / 12);
      S.publicMonths[i] = simMonths.length - workMonths;

      // Mortgage: the payment is fixed in dollars, so it shrinks in today's dollars.
      if (P.mortgage.enabled) {
        for (const m of simMonths) {
          const pay = m < downsizeMonth ? mort.payments[m] : null;
          const deflate = Math.pow(1 + infl, (m - asOfMonth + 0.5) / 12);
          const actual = pay ? (pay.pi + pay.extra) / deflate : 0;
          S.mortgagePaid[i] += actual;
          if (P.mortgage.includedInSpending !== false) S.mortgageAdj[i] += actual - P.mortgage.monthlyPI;
          else S.mortgageAdj[i] += actual;
        }
      }

      // Recurring & one-time items
      for (const r of P.spending.recurring || []) {
        const every = Math.max(1, r.every || 1);
        if (y >= r.firstYear && y <= (r.lastYear == null ? yEnd : r.lastYear) && (y - r.firstYear) % every === 0) {
          S.recurring[i] += r.amount * (every === 1 ? f : 1);
        }
      }
      for (const o of P.spending.oneTime || []) {
        if (o.year !== y) continue;
        if (o.kind === 'windfall') S.windfall[i] += o.amount;
        else if (o.kind === 'income') S.otherIncome[i] += o.amount;
        else S.oneTimeExpense[i] += o.amount;
      }
      if (deathPid && y === deathYear && P.death.lifeInsurance > 0) S.windfall[i] += P.death.lifeInsurance;

      // College (your share), grows faster than inflation
      if (P.college.enabled) {
        const g = Math.pow(1 + (P.college.costGrowthPct || 0) / 100, y - y0);
        for (const kid of P.college.kids || []) {
          if (kid.enabled && y >= kid.startYear && y < kid.startYear + kid.years) {
            S.college[i] += kid.annualCost * (kid.coverPct / 100) * g;
          }
        }
      }

      // Long-term care late in life
      const ltc = P.health.ltc;
      if (ltc && ltc.enabled) {
        for (const pid of ids) {
          const a = S.age[pid][i];
          if (S.alive[pid][i] && a >= ltc.startAge && a < ltc.startAge + ltc.years) S.ltc[i] += ltc.annualCost * S.healthGrowth[i];
        }
      }

      // Housing: home equity & optional downsize
      const appr = Math.pow(1 + (P.housing.appreciationPct || 0) / 100, y - y0);
      const mortBalNominal = (month) => (mort.balances[month] != null ? mort.balances[month] : (month >= mort.payoffMonth ? 0 : (P.mortgage.enabled ? P.mortgage.balance : 0)));
      const mortBalReal = (month) => mortBalNominal(month) / Math.pow(1 + infl, (month - asOfMonth) / 12);
      const homeValue0 = P.balances.homeEquity + (P.mortgage.enabled ? P.mortgage.balance : 0);
      if (downsize.enabled && y > downsize.year) {
        S.homeEquity[i] = downsize.newHomeCost * Math.pow(1 + (P.housing.appreciationPct || 0) / 100, y - downsize.year);
        S.housingCostChange[i] = downsize.annualCostChange * f;
      } else {
        S.homeEquity[i] = homeValue0 * appr - mortBalReal((y + 1) * 12 - 1);
      }
      if (downsize.enabled && y === downsize.year) {
        const sale = (downsize.salePrice != null ? downsize.salePrice : homeValue0) * appr;
        S.downsizeNet[i] = sale * (1 - downsize.sellingCostPct / 100) - mortBalReal(y * 12) - downsize.newHomeCost;
        S.homeEquity[i] = downsize.newHomeCost;
        S.events.push({ year: y, type: 'downsize', label: 'Downsize home' });
      }
    }

    // ---- Social Security (needs the full earnings picture) ------------------
    const wageBase = P.tax.fica.wageBase;
    const pia = {};
    S.ssDetail = {};
    for (const pid of ids) {
      const list = RP.ss.earningsList(P.ss[pid], futureWages[pid], y0);
      const aime = RP.ss.aime(list, wageBase);
      pia[pid] = RP.ss.pia(aime, P.ssRules.bendPoints);
      S.ssDetail[pid] = { aime, pia: pia[pid], yearsWorked: list.filter((e) => e > 0).length };
    }
    const benefits = RP.ss.yearlyBenefits({
      years, people: P.people, ss: P.ss, pia,
      deathYear: { p1: deathPid === 'p1' ? deathYear : null, p2: deathPid === 'p2' ? deathYear : null },
    });
    for (let i = 0; i < n; i++) {
      S.ss.p1[i] = benefits.p1[i] * S.frac[i];
      S.ss.p2[i] = benefits.p2[i] * S.frac[i];
    }
    for (const pid of ids) {
      const d = benefits.details[pid];
      S.ssDetail[pid].claimYear = P.people[pid].birthYear + Math.floor(d.claimAge);
      S.ssDetail[pid].annualAtClaimNoHaircut = d.ownMonthly * 12;
      S.ssDetail[pid].annualAtClaim = d.ownMonthly * 12 * (1 - (P.ss.haircutPct || 0) / 100);
    }

    // ---- Household retirement year -----------------------------------------
    S.lastFullTimeYear = lastFullTimeYear;
    S.retireYear = lastFullTimeYear + 1; // first year nobody works full time
    S.retireIdx = Math.max(0, S.retireYear - y0);
    // Spending creep (stress test) once retired
    if (P.spending.creepPct) {
      for (let i = 0; i < n; i++) {
        if (years[i] >= S.retireYear) S.coreRetired[i] *= Math.pow(1 + P.spending.creepPct / 100, years[i] - S.retireYear);
      }
    }

    // ---- Income caps used for Roth conversions & withdrawals ----------------
    S.cap = arr();
    S.cap2 = arr(); // backup cap: the ACA 400% line if MinnesotaCare is lost
    S.capKind = new Array(n).fill('none');
    S.healthCap = arr();
    for (let i = 0; i < n; i++) {
      const fpl = RP.health.fpl(S.hhSize[i], P.health);
      const needsPublic = S.publicMonths[i] > 0 && (S.adultsUnder65[i] + S.olderKidsInHH[i] > 0);
      let cap = Infinity, kind = 'none';
      if (needsPublic) {
        if (S.hasMinnesotaCare[i]) { cap = (P.health.mncare / 100) * fpl - P.conversions.buffer; kind = 'mncare'; }
        else { cap = (P.health.aca / 100) * fpl - P.conversions.buffer; kind = 'aca'; }
      }
      S.healthCap[i] = cap;
      // Tax-bracket cap (top of the chosen bracket, plus the standard deduction)
      const filing = S.filing[i];
      const F = P.tax.federal;
      const bracketCap = RP.tax.bracketTop(F.brackets[filing], P.conversions.bracketRate / 100) +
        F.std[filing] + F.addl65[filing] * S.count65[i];
      if (!needsPublic) {
        if (S.count65[i] > 0 && S.adultsUnder65[i] === 0) {
          const am = P.conversions.afterMedicare;
          if (am === 'irmaa') { cap = P.tax.irmaa[filing === 'mfj' ? 'mfj' : 'single'][0] - P.conversions.buffer; kind = 'irmaa'; }
          else if (am === 'bracket') { cap = bracketCap; kind = 'bracket'; }
        } else { cap = bracketCap; kind = 'bracket'; }
      } else if (P.conversions.strategy === 'bracket') {
        cap = Math.min(cap, bracketCap);
      }
      S.cap[i] = cap * S.frac[i];
      S.cap2[i] = (kind === 'mncare' ? (P.health.aca / 100) * fpl - P.conversions.buffer : Infinity) * S.frac[i];
      S.capKind[i] = kind;
    }

    S.emp = emp;
    S.deathPid = deathPid;
    S.deathIdx = deathPid ? deathYear - y0 : -1;
    S.survivorPid = survivorPid;
    S.mortgagePayoffYear = isFinite(mort.payoffMonth) ? Math.floor((mort.payoffMonth - 1) / 12) : null;
    return S;
  };

  /** Retirement spending for a year: base amount, or a spending phase by age. */
  function retiredSpendingFor(P, y, ageP1) {
    const ph = P.spending.phases;
    if (ph && ph.enabled && Array.isArray(ph.list)) {
      for (const p of ph.list) {
        if (ageP1 >= p.fromAge && ageP1 <= p.toAge) return p.amount;
      }
    }
    return P.spending.retirement;
  }
  E.retiredSpendingFor = retiredSpendingFor;
})(globalThis.RP = globalThis.RP || {});
