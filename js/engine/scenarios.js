/*
 * scenarios.js — scenario presets and how a scenario becomes a plan.
 *
 * A scenario = Baseline + a short list of overrides, stored as
 * { 'dotted.path': value }. Change Baseline and every scenario follows,
 * except where it overrides that exact input.
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;

  /** Number of scenario colors (CSS variables --s1 … --s6). */
  RP.SCENARIO_COLORS = 6;

  /** Resolve a scenario into a full plan. */
  E.applyOverrides = function (basePlan, overrides) {
    const p = U.clone(basePlan);
    for (const [path, value] of Object.entries(overrides || {})) U.setPath(p, path, U.clone(value));
    return E.resolvePlan(p);
  };

  /** Preset list. Each `make(P)` returns overrides based on the current Baseline. */
  RP.SCENARIO_PRESETS = [
    { key: 'base', group: 'Main', name: (P) => `Retire at ${P.retirement.p1Age}`, make: () => ({}) },
    { key: 'spend75', group: 'Main', name: (P) => `Retire at ${P.retirement.p1Age} at $75K`, make: () => ({ 'spending.retirement': 75000 }) },
    {
      key: 'jobloss-re', group: 'Job loss', name: (P) => `Job loss ${P.jobLoss.p1.year} + re-employed`,
      make: () => ({ 'jobLoss.p1.enabled': true, 'jobLoss.p1.reemploy.enabled': true }),
    },
    {
      key: 'jobloss-none', group: 'Job loss', name: (P) => `Job loss ${P.jobLoss.p1.year}, no new job`,
      make: () => ({ 'jobLoss.p1.enabled': true, 'jobLoss.p1.reemploy.enabled': false }),
    },
    {
      key: 'retire2032', group: 'Main', name: () => 'Retire 2032',
      make: (P) => ({
        'jobLoss.p1.enabled': true, 'jobLoss.p1.reemploy.enabled': false,
        'retirement.together': false,
        'retirement.p1Age': 2031 - P.people.p1.birthYear,
        'retirement.p2Age': 2031 - P.people.p2.birthYear,
      }),
    },
    { key: 'coast', group: 'Main', name: () => 'Coast FIRE', make: (P) => ({ 'sim.coastYear': Math.min(P.people.p1.birthYear + P.retirement.p1Age, 2033) }) },
    {
      key: 'parttime', group: 'Main', name: () => 'Part-time bridge',
      make: (P) => {
        const age = P.retirement.p1Age - 3;
        const start = P.people.p1.birthYear + age + 1;
        return {
          'retirement.p1Age': age,
          'partTime.p1.enabled': true, 'partTime.p1.amount': 30000, 'partTime.p1.firstYear': start, 'partTime.p1.lastYear': start + 4,
          'partTime.p2.enabled': true, 'partTime.p2.amount': 30000, 'partTime.p2.firstYear': start, 'partTime.p2.lastYear': start + 4,
        };
      },
    },
    {
      key: 'downsize', group: 'Life', name: () => 'Downsize',
      make: (P) => {
        const youngest = Math.max(...(P.kids || []).map((k) => k.birthYear), P.people.p2.birthYear - 18);
        return { 'housing.downsize.enabled': true, 'housing.downsize.year': youngest + 19 };
      },
    },
    {
      key: 'death', group: 'Life', name: (P) => `${P.people.p1.name} passes away`,
      make: (P) => ({ 'death.enabled': true, 'death.person': 'p1', 'death.year': P.people.p1.birthYear + P.retirement.p1Age + 10 }),
    },
    {
      key: 'disability', group: 'Life', name: (P) => `${P.people.p1.name} disabled`,
      make: () => ({ 'disability.enabled': true, 'disability.person': 'p1', 'disability.year': new Date().getFullYear() + 3 }),
    },
    { key: 'stress-crash', group: 'Stress tests', name: () => 'Crash in retirement year', make: () => ({ 'returns.stress.crash.enabled': true }) },
    { key: 'stress-lost', group: 'Stress tests', name: () => 'Lost decade', make: () => ({ 'returns.stress.lostDecade.enabled': true }) },
    { key: 'stress-creep', group: 'Stress tests', name: () => 'Spending creep', make: () => ({ 'spending.creepPct': 1 }) },
    { key: 'stress-ss', group: 'Stress tests', name: () => 'Bigger SS haircut', make: () => ({ 'ss.haircutPct': 40 }) },
    { key: 'stress-tax', group: 'Stress tests', name: () => 'Higher taxes', make: () => ({ 'tax.futureRates.enabled': true }) },
  ];

  /** Build the starting scenario list for a Baseline plan. */
  RP.defaultScenarios = function (basePlan) {
    const P = E.resolvePlan(basePlan);
    return RP.SCENARIO_PRESETS.map((pr, i) => ({
      id: pr.key === 'base' ? 'base' : pr.key,
      preset: pr.key,
      name: pr.name(P),
      color: (i % RP.SCENARIO_COLORS) + 1,
      group: pr.group,
      autoName: true,
      overrides: pr.make(P),
    }));
  };

  /** Refresh names like "Retire at 55" after inputs change (unless renamed). */
  RP.refreshScenarioNames = function (basePlan, scenarios) {
    for (const sc of scenarios) {
      if (!sc.autoName) continue;
      const pr = RP.SCENARIO_PRESETS.find((p) => p.key === sc.preset);
      if (!pr) continue;
      try { sc.name = pr.name(E.applyOverrides(basePlan, sc.overrides)); } catch (e) { /* keep old name */ }
    }
  };
})(globalThis.RP = globalThis.RP || {});
