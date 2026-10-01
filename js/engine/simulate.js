/*
 * simulate.js — the year-by-year money engine.
 *
 * Each year:
 *   1. Accounts grow for half a year (money moves "mid-year" on average).
 *   2. Paychecks, Social Security, part-time work, etc. come in; 401k/HSA/
 *      Roth contributions go out to their accounts.
 *   3. If spending + taxes is more than income, money is pulled from accounts
 *      in your draw order (cash → brokerage → Roth contributions → Rule-of-55 /
 *      59½ money within the income cap → aged Roth conversions → HSA receipts →
 *      penalty withdrawals as a last resort).
 *   4. Roth conversions fill whatever room is left under the year's income cap
 *      (the MinnesotaCare line in early retirement).
 *   5. Taxes are recalculated and steps 3–4 repeat until everything balances
 *      (withdrawing money to pay tax creates a little more tax).
 *   6. Accounts grow for the second half of the year.
 *
 * Accounts tracked:
 *   pre[p].plan  — 401k at the current/last employer (Rule of 55 applies here)
 *   pre[p].ira   — rollover IRA (no Rule of 55)
 *   inherited    — a late spouse's pre-tax money (penalty-free for the survivor)
 *   roth[p]      — value, contribution basis, and conversion "rungs" [year, amount]
 *   hsa + receipts, cash, brokerage (+ cost basis), edu (529/Trump), sepp (72(t) IRA)
 */
(function (RP) {
  'use strict';

  const E = RP.engine;
  const T = RP.tax;
  const H = RP.health;
  const PIDS = ['p1', 'p2'];

  /** Starting account state from the plan's balances. */
  E.initState = function (plan) {
    const B = plan.balances;
    const s1 = (B.rothP1SharePct == null ? 50 : B.rothP1SharePct) / 100;
    return {
      pre: { p1: { plan: B.p1_401k, ira: 0 }, p2: { plan: B.p2_401k, ira: 0 } },
      inherited: 0,
      roth: {
        p1: { value: B.roth * s1, basis: B.rothBasis * s1, rungs: [] },
        p2: { value: B.roth * (1 - s1), basis: B.rothBasis * (1 - s1), rungs: [] },
      },
      hsa: B.hsa, receipts: B.hsaReceipts,
      cash: B.cash, brok: B.brokerage, brokBasis: Math.min(B.brokerageBasis, B.brokerage),
      edu: B.edu, eduBasis: B.edu,
      sepp: null,
      oldPlanMoved: { p1: false, p2: false },
    };
  };

  E.cloneState = function (s) {
    return {
      pre: { p1: { ...s.pre.p1 }, p2: { ...s.pre.p2 } },
      inherited: s.inherited,
      roth: {
        p1: { value: s.roth.p1.value, basis: s.roth.p1.basis, rungs: s.roth.p1.rungs.map((r) => r.slice()) },
        p2: { value: s.roth.p2.value, basis: s.roth.p2.basis, rungs: s.roth.p2.rungs.map((r) => r.slice()) },
      },
      hsa: s.hsa, receipts: s.receipts, cash: s.cash, brok: s.brok, brokBasis: s.brokBasis,
      edu: s.edu, eduBasis: s.eduBasis, sepp: s.sepp ? { ...s.sepp } : null,
      oldPlanMoved: { ...s.oldPlanMoved },
    };
  };

  /** Spendable portfolio (excludes 529/Trump and home equity). */
  E.portfolio = function (s) {
    return s.pre.p1.plan + s.pre.p1.ira + s.pre.p2.plan + s.pre.p2.ira + s.inherited + (s.sepp ? s.sepp.bal : 0) +
      s.roth.p1.value + s.roth.p2.value + s.hsa + s.cash + s.brok;
  };

  E.buckets = function (s) {
    return {
      preTax: s.pre.p1.plan + s.pre.p1.ira + s.pre.p2.plan + s.pre.p2.ira + s.inherited + (s.sepp ? s.sepp.bal : 0),
      roth: s.roth.p1.value + s.roth.p2.value,
      hsa: s.hsa,
      taxable: s.cash + s.brok,
      edu: s.edu,
    };
  };

  /** Tax bill for a year. `inc` holds this year's (partial-year) amounts. */
  E.yearTaxes = function (P, S, i, inc) {
    const f = S.frac[i], k = 1 / f;
    const filing = S.filing[i];
    const ssTot = (inc.ss.p1 + inc.ss.p2) * k;
    const earned = (inc.wages.p1 + inc.wages.p2 + inc.partTime.p1 + inc.partTime.p2 + inc.sev.p1 + inc.sev.p2) * k;
    const pref = (inc.divs + inc.gains) * k;
    const agiExSS = earned - (inc.def401k.p1 + inc.def401k.p2 + inc.hsaPayroll) * k +
      (inc.ui + inc.disab + inc.other + inc.interest + inc.ordWd) * k + pref;
    const ssTaxable = T.taxableSocialSecurity(ssTot, agiExSS, filing, P.tax, S.deflator[i]);
    const agi = agiExSS + ssTaxable;
    const fed = T.federalTax({
      ordinary: agi - pref, preferential: pref, filing, count65: S.count65[i],
      kidsUnder17: S.kidsUnder17[i], otherDependents: S.otherDependents[i], earnedIncome: earned,
      nii: (inc.interest + inc.divs + inc.gains) * k, magi: agi, rateMult: S.rateMult[i], deflator: S.deflator[i],
    }, P.tax);
    let state;
    if (S.state[i] === 'MN') {
      state = T.minnesotaTax({
        agi, ssTaxable, filing, count65: S.count65[i], dependents: S.dependents[i],
        kidsUnder18: S.kidsUnder18[i], contrib529: inc.edu529 * k, rateMult: S.rateMult[i],
      }, P.tax).tax;
    } else {
      state = T.flatStateTax(agi, ssTaxable, filing, S.stateRate[i], P.tax);
    }
    const hp = S.hsaPayrollPid[i];
    const w = PIDS.map((p) => (inc.wages[p] + inc.partTime[p] + inc.sev[p] - (p === hp ? inc.hsaPayroll : 0)) * k);
    const fica = T.fica(w, filing, P.tax, S.deflator[i]);
    return {
      federal: fed.tax * f, state: state * f, fica: fica * f,
      penalty: 0.1 * inc.pen10 + 0.2 * inc.pen20,
      agi: agi * f, magi: (agi + ssTot - ssTaxable) * f, ssTaxable: ssTaxable * f,
      taxableIncome: fed.taxableIncome * f, marginal: fed.marginal,
    };
  };

  /** Amounts available from each source right now, in draw-order terms. */
  function availability(s, S, i) {
    const y = S.years[i];
    const v = { cash: Math.max(0, s.cash), brok: Math.max(0, s.brok), roth: {}, pre: {} };
    v.gainFrac = s.brok > 0 ? Math.max(0, 1 - s.brokBasis / s.brok) : 0;
    for (const p of PIDS) {
      const r = s.roth[p];
      const val = Math.max(0, r.value);
      const age59 = y >= S.unlock[p].year59;
      const basis = Math.min(Math.max(0, r.basis), val);
      let rem = val - basis, aged = 0, unaged = 0, blocked = false;
      for (const [ry, amt] of r.rungs) {
        const a = Math.min(amt, rem);
        rem -= a;
        if (!blocked && (age59 || y - ry >= 5)) aged += a;
        else { blocked = true; unaged += a; }
      }
      v.roth[p] = { basis, aged, unaged, earn: Math.max(0, rem), age59 };
      const u = S.unlock[p];
      v.pre[p] = {
        plan: Math.max(0, s.pre[p].plan), ira: Math.max(0, s.pre[p].ira),
        freePlan: age59 || (u.rule55Year != null && y >= u.rule55Year),
        freeIra: age59,
      };
    }
    v.inherited = Math.max(0, s.inherited);
    v.hsa = Math.max(0, s.hsa);
    v.receipts = Math.min(Math.max(0, s.receipts), v.hsa);
    v.hsaPenalty = !(S.alive.p1[i] && S.age.p1[i] >= 65) && !(S.alive.p2[i] && S.age.p2[i] >= 65);
    return v;
  }

  /**
   * Decide where `need` dollars come from. Pure function: doesn't touch the
   * account state. `room` = how much more income fits under the year's cap.
   */
  function planDraw(need, v, room, room2) {
    const d = {
      cash: 0, brok: 0, gain: 0, rothBasis: { p1: 0, p2: 0 }, rothAged: { p1: 0, p2: 0 },
      rothEarnFree: { p1: 0, p2: 0 }, receipts: 0, rothUnaged: { p1: 0, p2: 0 },
      pre: { p1: { plan: 0, ira: 0 }, p2: { plan: 0, ira: 0 } }, inherited: 0,
      preFreeInCap: 0, preFreeOverCap: 0, prePenalty: 0, rothEarnPen: { p1: 0, p2: 0 }, hsaNon: 0,
      ordinary: 0, pen10: 0, pen20: 0, capUsed: 0, short: 0,
    };
    let rem = Math.max(0, need);
    // room  = income left under the main cap (e.g. the MinnesotaCare line)
    // room2 = income left under the backup cap (the ACA 400% line), if any
    const take = (avail) => { const a = Math.min(rem, Math.max(0, avail)); rem -= a; return a; };
    const addIncome = (a) => { room -= a; room2 -= a; d.capUsed += a; d.ordinary += a; };
    const pre = { p1: { ...v.pre.p1 }, p2: { ...v.pre.p2 } };
    let inh = v.inherited;

    const free = [], locked = [];
    if (inh > 0) free.push(['inh']);
    for (const p of PIDS) {
      (pre[p].freeIra ? free : locked).push([p, 'ira']);
      (pre[p].freePlan ? free : locked).push([p, 'plan']);
    }
    const avail = (b) => (b[0] === 'inh' ? inh : pre[b[0]][b[1]]);
    const debit = (b, a) => { if (b[0] === 'inh') { inh -= a; d.inherited += a; } else { pre[b[0]][b[1]] -= a; d.pre[b[0]][b[1]] += a; } };
    // Pull pre-tax money from `list`, never letting income pass `limit()`.
    const drawPre = (list, limit, penalty, tag) => {
      for (const b of list) {
        if (rem <= 0) break;
        const a = Math.min(rem, avail(b), Math.max(0, limit()));
        if (a <= 0) continue;
        rem -= a; debit(b, a); addIncome(a);
        if (penalty) { d.prePenalty += a; d.pen10 += a; }
        else if (tag === 'in') d.preFreeInCap += a; else d.preFreeOverCap += a;
      }
    };
    const underCap = () => room, underCap2 = () => room2, noLimit = () => Infinity;

    // --- No penalty, income kept under the cap ---
    // 1. Cash, 2. brokerage (only the gain part counts as income)
    d.cash = take(v.cash);
    d.brok = take(v.brok);
    d.gain = d.brok * v.gainFrac;
    room -= d.gain; room2 -= d.gain; d.capUsed += d.gain;
    // 3. Roth contributions (basis)
    for (const p of PIDS) d.rothBasis[p] = take(v.roth[p].basis);
    // 4. Rule-of-55 / 59½ / inherited pre-tax money, up to the cap
    drawPre(free, underCap, false, 'in');
    // 5. Roth conversions that are 5+ years old (and anything once 59½)
    for (const p of PIDS) d.rothAged[p] = take(v.roth[p].aged);
    for (const p of PIDS) if (v.roth[p].age59) d.rothEarnFree[p] = take(v.roth[p].earn);
    // 6. HSA receipts (reimburse yourself for old medical bills, tax-free)
    d.receipts = take(v.receipts);

    // --- Last resorts: penalties ---
    // 7. Locked 401k money with the 10% penalty, still under the cap. This lets
    //    the Roth ladder keep aging (young conversions stay untouched).
    drawPre(locked, underCap, true);
    // 8. Young Roth conversions: 10% penalty, but no tax and no added income
    for (const p of PIDS) { d.rothUnaged[p] = take(v.roth[p].unaged); d.pen10 += d.rothUnaged[p]; }
    // 9. Over the main cap but under the backup cap (keeps marketplace subsidies)
    drawPre(free, underCap2, false, 'over');
    drawPre(locked, underCap2, true);
    // 10. Beyond every cap
    drawPre(free, noLimit, false, 'over');
    drawPre(locked, noLimit, true);
    // 11. Roth earnings before 59½ (taxed + 10%)
    for (const p of PIDS) {
      if (v.roth[p].age59) continue;
      const a = take(v.roth[p].earn);
      d.rothEarnPen[p] = a; addIncome(a); d.pen10 += a;
    }
    // 12. HSA for non-medical spending (taxed; +20% before 65)
    d.hsaNon = take(v.hsa - d.receipts);
    addIncome(d.hsaNon);
    if (v.hsaPenalty) d.pen20 += d.hsaNon;
    d.short = rem;
    d.roomLeft = room;
    d.preLeft = pre;
    return d;
  }

  // Exposed for the tests.
  E._planDraw = planDraw;
  E._availability = availability;

  /** Apply a planned draw to the account state. */
  function applyDraw(s, d) {
    s.cash -= d.cash;
    if (d.brok > 0) {
      const basisShare = s.brok > 0 ? Math.min(1, s.brokBasis / s.brok) : 1;
      s.brokBasis = Math.max(0, s.brokBasis - d.brok * basisShare);
      s.brok -= d.brok;
    }
    for (const p of PIDS) {
      const r = s.roth[p];
      const basisTake = d.rothBasis[p];
      r.basis -= basisTake;
      let rungTake = d.rothAged[p] + d.rothUnaged[p];
      while (rungTake > 1e-9 && r.rungs.length) {
        const a = Math.min(r.rungs[0][1], rungTake);
        r.rungs[0][1] -= a; rungTake -= a;
        if (r.rungs[0][1] <= 1e-6) r.rungs.shift();
      }
      r.value -= basisTake + d.rothAged[p] + d.rothUnaged[p] + d.rothEarnFree[p] + d.rothEarnPen[p];
      s.pre[p].plan -= d.pre[p].plan;
      s.pre[p].ira -= d.pre[p].ira;
    }
    s.inherited -= d.inherited;
    s.receipts -= d.receipts;
    s.hsa -= d.receipts + d.hsaNon;
  }

  /** Move pre-tax money into a Roth (conversion), oldest-rule: fromFirst person first. */
  function conversionPlan(P, S, i, d, s) {
    const order = P.conversions.fromFirst === 'p1' ? ['p1', 'p2'] : ['p2', 'p1'];
    const avail = [];
    for (const p of order) {
      if (!S.alive[p][i] || S.personMonths[p][i] > 0) continue; // must have left that job
      avail.push([p, 'ira', Math.max(0, d.preLeft[p].ira)]);
      avail.push([p, 'plan', Math.max(0, d.preLeft[p].plan)]);
    }
    void s;
    return avail;
  }

  /** 72(t) annuity factor: balance needed per $1 of yearly payment. */
  E.seppFactor = function (ratePct, age) {
    const r = ratePct / 100;
    const n = E.SINGLE_LIFE[Math.max(40, Math.min(60, age))] || 30;
    return (1 - Math.pow(1 + r, -n)) / r;
  };

  /**
   * Run the simulation.
   *  returns: { inv: array of yearly real returns for invested money, cash: array }
   *  opts: { detail, planPath (for guardrails), startIdx, state, stopOnFail, sepp }
   * Returns { success, failYear, totals, rows, penaltiesTotal, balanceAtRetirement, ... }
   */
  E.simulate = function (P, S, returns, opts) {
    opts = opts || {};
    const detail = !!opts.detail;
    const startIdx = opts.startIdx || 0;
    const s = opts.state ? E.cloneState(opts.state) : E.initState(P);
    const n = S.n;
    const totals = new Array(n).fill(0);
    const rows = detail ? [] : null;
    const infl = P.returns.inflation / 100;
    const nomCash = (r) => (1 + r) * (1 + infl) - 1;
    const sepp = opts.sepp || null;
    let failed = false, failYear = null, penaltiesTotal = 0, penaltyWdTotal = 0;
    let lastMnCareYear = null, balanceAtRetirement = null, guardCuts = 0;
    const out = { success: true };

    for (let i = startIdx; i < n; i++) {
      const y = S.years[i];
      const f = S.frac[i];
      const rInv = returns.inv[i], rCash = returns.cash[i];
      const hInv = Math.sqrt(Math.pow(1 + rInv, f)), hCash = Math.sqrt(Math.pow(1 + rCash, f));
      // Half-year growth factor for each account type (same unless adjusted).
      const adj = P.returns.accountAdjust || {};
      const hOf = (k) => (adj[k] ? Math.sqrt(Math.pow(Math.max(0.01, 1 + rInv + adj[k] / 100), f)) : hInv);
      const hx = { pre: hOf('preTax'), roth: hOf('roth'), hsa: hOf('hsa'), tax: hOf('taxable'), edu: hOf('edu'), cash: hCash };
      const startTotal = E.portfolio(s);
      if (i === S.retireIdx) balanceAtRetirement = startTotal;

      // Death: the survivor inherits everything (pre-tax becomes penalty-free).
      if (i === S.deathIdx && S.deathPid) {
        const dp = S.deathPid, sp = S.survivorPid;
        s.inherited += s.pre[dp].plan + s.pre[dp].ira + (s.sepp && s.sepp.person === dp ? s.sepp.bal : 0);
        s.pre[dp].plan = 0; s.pre[dp].ira = 0;
        if (s.sepp && s.sepp.person === dp) s.sepp = null;
        const r = s.roth[dp], rs = s.roth[sp];
        rs.value += r.value; rs.basis += r.basis; rs.rungs = rs.rungs.concat(r.rungs).sort((a, b) => a[0] - b[0]);
        s.roth[dp] = { value: 0, basis: 0, rungs: [] };
      }
      // Changing employers without rolling the old 401k in: it becomes an IRA (no Rule of 55).
      if (!P.jobLoss.rollOld401kIntoNewPlan) {
        for (const p of PIDS) {
          if (!s.oldPlanMoved[p] && S.unlock[p].changeYear === y) { s.pre[p].ira += s.pre[p].plan; s.pre[p].plan = 0; s.oldPlanMoved[p] = true; }
        }
      }
      // 72(t): carve out the IRA that pays the fixed yearly amount.
      if (sepp && y === sepp.startYear && !s.sepp && S.alive[sepp.person][i]) {
        const p = sepp.person;
        const want = sepp.payment * E.seppFactor(sepp.ratePct, S.age[p][i]);
        let fromIra = Math.min(want, s.pre[p].ira);
        let fromPlan = Math.min(want - fromIra, s.pre[p].plan);
        s.pre[p].ira -= fromIra; s.pre[p].plan -= fromPlan;
        const bal = fromIra + fromPlan;
        s.sepp = { person: p, bal, payment: sepp.payment * Math.min(1, bal / Math.max(1, want)), startYear: y, endYear: sepp.endYear };
      }

      // RMDs are based on last year-end balances.
      const rmdNeed = { p1: 0, p2: 0 };
      for (const p of PIDS) {
        const age = S.age[p][i];
        if (S.alive[p][i] && age >= P.tax.rmdAge) {
          const factor = E.ULT[Math.min(110, age)] || 3.5;
          const bal = s.pre[p].plan + s.pre[p].ira + (S.survivorPid === p ? s.inherited : 0);
          rmdNeed[p] = (bal / factor) * f;
        }
      }

      // --- Grow to mid-year ---
      growAll(s, hx);

      // --- Fixed flows ---
      const wages = { p1: S.wages.p1[i], p2: S.wages.p2[i] };
      const partTime = { p1: S.partTime.p1[i], p2: S.partTime.p2[i] };
      const sev = { p1: S.severance.p1[i], p2: S.severance.p2[i] };
      const def401k = { p1: S.def401k.p1[i], p2: S.def401k.p2[i] };
      const mega = S.mega.p1[i] + S.mega.p2[i];
      const hsaPayroll = S.hsaContrib[i];
      const ss = { p1: S.ss.p1[i], p2: S.ss.p2[i] };
      const disab = S.disability[i];
      const divs = s.brok * (P.returns.dividendYield / 100) * f;
      const interest = Math.max(0, s.cash * nomCash(P.returns.cash / 100) * f);

      // Contributions straight from paychecks
      for (const p of PIDS) s.pre[p].plan += def401k[p] + S.match[p][i];
      s.hsa += hsaPayroll;
      s.receipts += S.receiptsAdd[i];
      for (const p of PIDS) { s.roth[p].value += S.mega[p][i]; s.roth[p].basis += S.mega[p][i]; }
      s.brokBasis += divs; // dividends are reinvested

      // RMDs (pre-tax → cash flow)
      let rmd = 0;
      for (const p of PIDS) {
        let need = Math.min(rmdNeed[p], s.pre[p].plan + s.pre[p].ira + (S.survivorPid === p ? s.inherited : 0));
        rmd += need;
        let a = Math.min(need, s.pre[p].ira); s.pre[p].ira -= a; need -= a;
        a = Math.min(need, s.pre[p].plan); s.pre[p].plan -= a; need -= a;
        if (S.survivorPid === p) { a = Math.min(need, s.inherited); s.inherited -= a; need -= a; }
      }
      // 72(t) payment (fixed dollars, so it shrinks with inflation)
      let seppPay = 0;
      if (s.sepp) {
        if (y <= s.sepp.endYear) {
          seppPay = Math.min(s.sepp.bal, (s.sepp.payment / Math.pow(1 + infl, y - s.sepp.startYear)) * f);
          s.sepp.bal -= seppPay;
        } else {
          s.pre[s.sepp.person].ira += s.sepp.bal; // done: the rest goes back to a normal IRA
          s.sepp = null;
        }
      }

      // HSA pays the medical part of the budget once retired
      const hsaMed = Math.min(Math.max(0, s.hsa), S.hsaMedical[i]);
      s.hsa -= hsaMed;

      // College: from the 529/Trump account first
      let collegeLeft = S.college[i];
      let eduTax = 0;
      if (collegeLeft > 0 && s.edu > 0) {
        const a = Math.min(collegeLeft, s.edu);
        if (P.college.account === 'trump') {
          const earnShare = s.edu > 0 ? Math.max(0, 1 - s.eduBasis / s.edu) : 0;
          eduTax = a * earnShare * (P.college.trumpEarningsTaxPct / 100);
        }
        s.eduBasis = Math.max(0, s.eduBasis - a * (s.eduBasis / s.edu));
        s.edu -= a; collegeLeft -= a;
      }
      s.edu += S.eduContrib[i]; s.eduBasis += S.eduContrib[i];

      // Guardrails: spend 10% less in years the portfolio is >20% behind plan
      let guardMult = 1;
      const gr = P.spending.guardrails;
      if (gr && gr.enabled && opts.planPath && y >= S.retireYear && startTotal < (1 - gr.behindPct / 100) * opts.planPath[i]) {
        guardMult = 1 - gr.cutPct / 100;
        guardCuts++;
      }

      const core = (S.coreWorking[i] + S.coreRetired[i] * guardMult) * S.survivorMult[i];
      const fixedNeed = core + S.medicalGrowth[i] + S.daycare[i] + S.mortgageAdj[i] + S.recurring[i] +
        S.oneTimeExpense[i] + collegeLeft + eduTax + S.ltc[i] + S.housingCostChange[i] +
        Math.max(0, -S.downsizeNet[i]) + S.rothIra[i] + S.eduContrib[i] - hsaMed;
      const fixedCash = wages.p1 + wages.p2 + partTime.p1 + partTime.p2 + sev.p1 + sev.p2 + S.ui[i] + disab +
        S.otherIncome[i] + S.windfall[i] + ss.p1 + ss.p2 + rmd + seppPay + Math.max(0, S.downsizeNet[i]) -
        def401k.p1 - def401k.p2 - hsaPayroll - mega;

      // --- Solve: withdrawals ↔ taxes ↔ health costs, until they agree ---
      const v = availability(s, S, i);
      const kind = S.capKind[i];
      const strategy = P.conversions.strategy;
      let tax = 0, health = 0, irmaa = 0;
      let d = null, conv = null, tx = null, convTotal = 0, cov = null;
      const baseInc = {
        wages, partTime, sev, def401k, hsaPayroll, ui: S.ui[i], disab: P.disability.taxable ? disab : 0,
        other: S.otherIncome[i], interest, divs, ss, edu529: P.college.account === '529' ? S.eduContrib[i] : 0,
      };
      // Income already counted toward the cap before any withdrawals
      const fixedOrd = rmd + seppPay;
      // How much room under the cap is left after fixed income?
      const pre0 = E.yearTaxes(P, S, i, { ...baseInc, gains: 0, ordWd: fixedOrd, pen10: 0, pen20: 0 });
      const measure0 = kind === 'mncare' || kind === 'aca' ? pre0.magi : pre0.agi;
      const room0 = S.cap[i] - measure0;
      const room2 = S.cap2[i] - measure0;
      for (let iter = 0; iter < 30; iter++) {
        const need = fixedNeed + tax + health + irmaa - fixedCash;
        d = planDraw(need, v, room0, room2);
        // Roth conversions fill the remaining room
        convTotal = 0; conv = [];
        if (d.short <= 0.5 && strategy !== 'none') {
          let want = 0;
          if (strategy === 'fixed') want = S.workMonths[i] === 0 ? P.conversions.fixedAmount * f : 0;
          else if (isFinite(S.cap[i]) && kind !== 'none') want = Math.max(0, d.roomLeft);
          if (want > 0) {
            for (const [p, bk, amt] of conversionPlan(P, S, i, d, s)) {
              const a = Math.min(want, amt);
              if (a > 0) { conv.push([p, bk, a]); want -= a; convTotal += a; }
              if (want <= 0) break;
            }
          }
        }
        tx = E.yearTaxes(P, S, i, {
          ...baseInc, gains: d.gain, ordWd: fixedOrd + d.ordinary + convTotal, pen10: d.pen10, pen20: d.pen20,
        });
        cov = H.coverage({
          magi: tx.magi / f, householdSize: S.hhSize[i], adultsUnder65: S.adultsUnder65[i],
          kidsUnder2: S.kidsUnder2[i], kidsUnder19: S.kidsUnder19[i], olderKidsInHH: S.olderKidsInHH[i],
          publicMonths: S.publicMonths[i], hasMinnesotaCare: S.hasMinnesotaCare[i], growth: S.healthGrowth[i],
        }, P.health);
        const newHealth = cov.extraCost;
        const newIrmaa = H.irmaa(tx.agi / f, S.filing[i], S.count65[i], P.tax).cost * f;
        const newTax = tx.federal + tx.state + tx.fica + tx.penalty;
        const delta = Math.abs(newTax - tax) + Math.abs(newHealth - health) + Math.abs(newIrmaa - irmaa);
        // After many rounds, only let the estimate rise (guarantees it settles).
        if (iter > 15) { tax = Math.max(tax, newTax); health = Math.max(health, newHealth); irmaa = Math.max(irmaa, newIrmaa); }
        else { tax = newTax; health = newHealth; irmaa = newIrmaa; }
        if (delta < 0.5) break;
      }

      // --- Commit ---
      applyDraw(s, d);
      for (const [p, bk, a] of conv) {
        s.pre[p][bk] -= a;
        s.roth[p].value += a;
        s.roth[p].rungs.push([y, a]);
      }
      // Roth IRA contributions (from cash flow, split evenly)
      for (const p of PIDS) {
        const share = S.alive[p][i] ? (S.alive.p1[i] && S.alive.p2[i] ? 0.5 : 1) : 0;
        s.roth[p].value += S.rothIra[i] * share;
        s.roth[p].basis += S.rothIra[i] * share;
      }
      // Surplus: planned bridge-fund savings first, then leftovers
      const need = fixedNeed + tax + health + irmaa - fixedCash;
      let toTaxable = 0, leftover = 0;
      if (need < 0) {
        const surplus = -need;
        toTaxable = Math.min(S.taxableTarget[i], surplus);
        leftover = surplus - toTaxable;
        s.brok += toTaxable; s.brokBasis += toTaxable;
        const lt = S.leftoverTo[i];
        if (lt === 'cash') s.cash += leftover;
        else if (lt === 'brokerage') { s.brok += leftover; s.brokBasis += leftover; }
      }

      // --- Grow the second half of the year ---
      growAll(s, hx);

      const endTotal = E.portfolio(s);
      totals[i] = endTotal;
      penaltiesTotal += tx.penalty;
      penaltyWdTotal += d.prePenalty + d.rothUnaged.p1 + d.rothUnaged.p2 + d.rothEarnPen.p1 + d.rothEarnPen.p2 + d.hsaNon;
      if (cov.status === 'mncare' || cov.status === 'ma') lastMnCareYear = y;
      if (d.short > 1 && !failed) { failed = true; failYear = y; }

      if (detail) {
        rows.push(makeRow(P, S, i, {
          s, d, conv, convTotal, tx, cov, health, irmaa, rmd, seppPay, hsaMed, core, guardMult, toTaxable,
          leftover, need, fixedNeed, fixedCash, divs, interest, collegeLeft, startTotal, endTotal, rInv,
        }));
      }
      if (failed && opts.stopOnFail) {
        for (let j = i + 1; j < n; j++) totals[j] = 0;
        break;
      }
    }
    out.success = !failed;
    out.failYear = failYear;
    out.totals = totals;
    out.rows = rows;
    out.penaltiesTotal = penaltiesTotal;
    out.penaltyWithdrawals = penaltyWdTotal;
    out.lastMnCareYear = lastMnCareYear;
    out.balanceAtRetirement = balanceAtRetirement;
    out.guardCuts = guardCuts;
    out.finalState = s;
    return out;
  };

  function growAll(s, g) {
    s.pre.p1.plan *= g.pre; s.pre.p1.ira *= g.pre; s.pre.p2.plan *= g.pre; s.pre.p2.ira *= g.pre;
    s.inherited *= g.pre;
    if (s.sepp) s.sepp.bal *= g.pre;
    s.roth.p1.value *= g.roth; s.roth.p2.value *= g.roth;
    s.hsa *= g.hsa; s.brok *= g.tax; s.edu *= g.edu;
    s.cash *= g.cash;
  }

  /** One row of the year-by-year table ("where each dollar comes from"). */
  function makeRow(P, S, i, x) {
    const d = x.d;
    const sum2 = (o) => o.p1 + o.p2;
    const b = E.buckets(x.s);
    return {
      year: S.years[i],
      ages: { p1: S.age.p1[i], p2: S.age.p2[i] },
      alive: { p1: S.alive.p1[i], p2: S.alive.p2[i] },
      working: S.workMonths[i] > 0,
      retired: S.years[i] >= S.retireYear,
      income: {
        wages: S.wages.p1[i] + S.wages.p2[i] + S.severance.p1[i] + S.severance.p2[i],
        partTime: S.partTime.p1[i] + S.partTime.p2[i],
        ss: S.ss.p1[i] + S.ss.p2[i], ssP1: S.ss.p1[i], ssP2: S.ss.p2[i],
        ui: S.ui[i], disability: S.disability[i], windfall: S.windfall[i] + S.otherIncome[i] + Math.max(0, S.downsizeNet[i]),
      },
      spending: {
        core: x.core, daycare: S.daycare[i], health: x.health + x.irmaa, college: x.collegeLeft,
        mortgageAdj: S.mortgageAdj[i], extras: S.recurring[i] + S.oneTimeExpense[i] + S.ltc[i] + S.housingCostChange[i] + Math.max(0, -S.downsizeNet[i]),
        medicalGrowth: S.medicalGrowth[i], hsaMedical: x.hsaMed, guardrailCut: x.guardMult < 1,
      },
      saving: {
        pre401k: S.def401k.p1[i] + S.def401k.p2[i], match: S.match.p1[i] + S.match.p2[i],
        hsa: S.hsaContrib[i], rothIra: S.rothIra[i], mega: S.mega.p1[i] + S.mega.p2[i],
        taxable: x.toTaxable, leftover: x.leftover, edu: S.eduContrib[i],
      },
      from: {
        cash: d.cash + d.brok,
        gains: d.gain,
        rothBasis: sum2(d.rothBasis),
        rothConversions: sum2(d.rothAged) + sum2(d.rothUnaged),
        rothEarnings: sum2(d.rothEarnFree) + sum2(d.rothEarnPen),
        preTax: d.preFreeInCap + d.preFreeOverCap + d.prePenalty + x.rmd + x.seppPay,
        preTaxPenaltyFree: d.preFreeInCap + d.preFreeOverCap,
        rmd: x.rmd, sepp: x.seppPay,
        hsa: d.receipts + d.hsaNon + x.hsaMed, hsaReceipts: d.receipts,
        penaltyWithdrawals: d.prePenalty + sum2(d.rothUnaged) + sum2(d.rothEarnPen) + d.hsaNon,
        shortfall: d.short,
      },
      // Non-overlapping sources (these add up to everything withdrawn this year)
      src: {
        cash: d.cash + d.brok,
        rothBasis: sum2(d.rothBasis),
        rothConversions: sum2(d.rothAged),
        rothEarnings: sum2(d.rothEarnFree),
        preTax: d.preFreeInCap + d.preFreeOverCap + x.rmd + x.seppPay,
        hsa: d.receipts + x.hsaMed,
        penalty: d.prePenalty + sum2(d.rothUnaged) + sum2(d.rothEarnPen) + d.hsaNon,
      },
      converted: x.convTotal,
      conversions: x.conv.map(([p, bk, a]) => ({ person: p, from: bk, amount: a })),
      taxes: { federal: x.tx.federal, state: x.tx.state, fica: x.tx.fica, penalty: x.tx.penalty },
      magi: x.tx.magi, agi: x.tx.agi, marginal: x.tx.marginal,
      cap: S.cap[i], capKind: S.capKind[i],
      health: { status: x.cov.status, kidsStatus: x.cov.kidsStatus, fplRatio: x.cov.fplRatio, lines: x.cov.lines, extraCost: x.health, irmaa: x.irmaa },
      balances: { ...b, total: x.endTotal, homeEquity: S.homeEquity[i], netWorth: x.endTotal + b.edu + S.homeEquity[i] },
      rungs: { p1: x.s.roth.p1.rungs.map((r) => r.slice()), p2: x.s.roth.p2.rungs.map((r) => r.slice()) },
      startTotal: x.startTotal,
      returnPct: x.rInv * 100,
    };
  }
})(globalThis.RP = globalThis.RP || {});
