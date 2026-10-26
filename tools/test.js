#!/usr/bin/env node
/*
 * tools/test.js — quick checks of the math engine, run in Node (no browser,
 * nothing to install):
 *
 *   node tools/test.js
 *
 * Loads the same engine files the app and its background worker use, then
 * checks results that must always hold. Takes a few seconds.
 */
'use strict';
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
globalThis.RP = {};
for (const f of [
  'js/engine/util.js', 'data/historical-returns.js', 'js/engine/defaults.js', 'js/engine/tax.js',
  'js/engine/socialsecurity.js', 'js/engine/health.js', 'js/engine/schedule.js', 'js/engine/simulate.js',
  'js/engine/montecarlo.js', 'js/engine/api.js', 'js/engine/scenarios.js', 'js/engine/slim.js', 'js/engine/levers.js', 'js/engine/explore.js',
  // UI helpers that don't touch the page: the setup guide's plan builder, the cash-flow groups
  'js/ui/core.js', 'js/ui/setup.js', 'js/ui/flow.js',
]) require(path.join(ROOT, f));
const E = RP.engine;

let failed = 0;
function test(name, fn) {
  const t0 = Date.now();
  try { fn(); console.log(`  ok  ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const RUNS = 200;

console.log('Engine');
test('the sample plan analyzes, one row per year to the horizon', () => {
  const a = E.analyze({}, { runs: RUNS });
  const P = a.plan;
  const years = P.people[P.household.horizonPerson].birthYear + P.household.horizonAge - Number(P.balances.asOf.slice(0, 4)) + 1;
  assert.strictEqual(a.det.rows.length, years);
  assert.ok(a.summary.successRate > 0 && a.summary.successRate <= 1);
});

test('the same seed gives the same success rate', () => {
  const P = E.resolvePlan({ spending: { retirement: 100000 } });
  assert.strictEqual(E.successRate(P, RUNS), E.successRate(P, RUNS));
});

test('another state uses its flat income tax rate', () => {
  const tax = (pct) => E.analyze({ household: { state: 'other', stateTaxPct: pct } }, { mc: false }).det.rows[3].taxes.state;
  assert.strictEqual(tax(0), 0);
  assert.ok(tax(5) > 1000, `expected state tax at 5%, got ${tax(5)}`);
});

console.log('What moves the needle');
const base = E.resolvePlan({ spending: { retirement: 105000 }, retirement: { p1Age: 55 } });
const lv = E.levers(base, { runs: RUNS });
const by = Object.fromEntries(lv.list.map((r) => [r.key, r]));

test('tests the expected changes for a working couple', () => {
  for (const k of ['later', 'earlier', 'spendLess', 'spendMore', 'saveMore', 'partTime', 'guardrailsOn', 'marketsDown', 'crashNow']) assert.ok(by[k], `missing lever ${k}`);
  assert.ok(by.ss67 || by.ss70, 'missing a Social Security lever');
});

test('deltas are measured against the same base and point the right way', () => {
  for (const r of lv.list) assert.ok(Math.abs(r.success - lv.base - r.delta) < 1e-12);
  assert.ok(by.later.delta >= by.earlier.delta, 'retiring later should not hurt more than retiring earlier');
  assert.ok(by.spendLess.delta >= by.spendMore.delta, 'spending less should not hurt more than spending more');
  assert.ok(by.marketsDown.delta < 0, 'worse markets should lower success');
  assert.ok(by.crashNow.delta < 0, 'a crash today should lower success');
  assert.strictEqual(by.crashNow.overrides['balances.cash'], undefined, 'cash is not invested');
});

test('each lever is plain scenario overrides', () => {
  for (const r of lv.list) {
    const Q = E.applyOverrides(base, r.overrides);
    for (const [p, v] of Object.entries(r.overrides)) assert.deepStrictEqual(RP.util.getPath(Q, p), v, `${r.key}: ${p}`);
  }
  assert.strictEqual(by.later.overrides['retirement.p1Age'], 56);
});

test('no retirement-date levers or earliest age once everyone has stopped working', () => {
  const retired = { retirement: { p1Age: 35, together: true } };
  const keys = E.leverList(retired).map((r) => r.key);
  assert.ok(!keys.includes('earlier') && !keys.includes('later'), keys.join(','));
  assert.strictEqual(E.earliestRetirement(retired, { runs: 50 }).retired, true);
});

test('earliest retirement age meets the target and one year sooner does not', () => {
  const e = E.earliestRetirement(base, { runs: RUNS });
  assert.ok(e.age != null && !e.now, JSON.stringify(e));
  const at = (age) => { const Q = RP.util.clone(base); Q.retirement.p1Age = age; return E.successRate(Q, RUNS); };
  assert.ok(at(e.age) >= 0.9, `success at ${e.age} is ${at(e.age)}`);
  assert.ok(at(e.age - 1) < 0.9, `success at ${e.age - 1} is ${at(e.age - 1)}`);
  assert.strictEqual(e.year, base.people.p1.birthYear + e.age + 1);
});

test('earliest retirement age says when the target is out of reach', () => {
  const e = E.earliestRetirement({ spending: { retirement: 400000 } }, { runs: 100 });
  assert.strictEqual(e.age, null);
  assert.strictEqual(e.maxAge, 75);
});

console.log('Scenarios & setup');
test('the "Retire at … at $…K" scenario is named from its actual spending', () => {
  const P = E.resolvePlan({});
  const list = RP.defaultScenarios(P);
  const sc = list.find((s) => s.preset === 'spend75');
  sc.overrides['spending.retirement'] = 82000;
  RP.refreshScenarioNames(P, list);
  assert.strictEqual(sc.name, `Retire at ${P.retirement.p1Age} at $82K`);
});

test('the setup guide builds a complete plan of your own', () => {
  const d = {
    n1: 'Jordan', b1: 1984, m1: 3, n2: '', b2: 1987, m2: 11, state: 'other', stateTax: 5, kids: [{ name: 'Max', birthYear: 2018 }, { name: '', birthYear: null }],
    bal: { p1_401k: 300000, p2_401k: 150000, roth: 60000, hsa: 0, cash: 25000, brokerage: 80000, edu: 0, homeEquity: 250000 },
    sal1: 120000, sal2: 70000, k1: 20000, k2: 10000, match1: 6000, match2: 0, hsa: 0, rothIra: 0,
    spendNow: 80000, spendRet: 85000, age1: 57, together: true, age2: 60,
  };
  const P = RP.ui.setup.buildPlan(d);
  assert.strictEqual(P.meta.isSample, false);
  assert.strictEqual(P.people.p2.name, 'Person 2');
  assert.strictEqual(P.kids.length, 1);
  assert.strictEqual(P.retirement.p2Age, 1984 + 57 - 1987);
  assert.strictEqual(P.household.horizonPerson, 'p2');
  assert.strictEqual(P.college.kids.length, 1);
  const a = E.analyze(P, { runs: RUNS });
  assert.strictEqual(a.summary.retireYear, 1984 + 57 + 1);
  assert.ok(a.det.rows.some((r) => r.taxes.state > 0));
});

console.log('Deep dives');
test('Social Security explorer covers every pair and its best beats or ties yours', () => {
  const ss = E.ssExplorer(base, { runs: 100 });
  assert.strictEqual(ss.cells.length, ss.ages.p1.length * ss.ages.p2.length);
  assert.deepStrictEqual([ss.current.p1, ss.current.p2], [base.ss.p1.claimAge, base.ss.p2.claimAge]);
  assert.ok(ss.best.failYear != null || ss.best.end >= ss.current.end - 1);
  assert.ok(ss.cells.every((c) => c.lifetime > 0));
});

test('someone already collecting keeps their claiming age', () => {
  const ss = E.ssExplorer({ people: { p1: { birthYear: 1955 } }, ss: { p1: { claimAge: 66 } } }, { runs: 50 });
  assert.deepStrictEqual(ss.ages.p1, [66]);
});

test('Roth explorer compares strategies, with yours marked once', () => {
  const ro = E.rothExplorer(base, { runs: 100 });
  assert.strictEqual(ro.strategies.filter((s) => s.current).length, 1);
  const none = ro.strategies.find((s) => s.key === 'none');
  assert.strictEqual(Math.round(none.converted), 0);
  for (const s of ro.strategies) assert.ok(Math.abs(s.afterTaxEnd - (s.end - s.preTaxEnd * E.HEIR_TAX)) < 1e-6);
});

test('history replay uses every complete stretch, and "your returns" averages your assumption', () => {
  const hr = E.historyReplay(base);
  const n = RP.HISTORICAL_RETURNS.length;
  assert.strictEqual(hr.actual.runs.length, n - hr.span + 1);
  assert.strictEqual(hr.matched.runs[0].start, RP.HISTORICAL_RETURNS[0][0]);
  assert.ok(hr.histReturn > hr.planReturn, 'history should beat a 4% assumption for an 80/20 mix');
  assert.ok(hr.matched.successRate <= hr.actual.successRate);
});

test('each year’s cash flow balances: money in equals money out', () => {
  for (const raw of [{}, { jobLoss: { p1: { enabled: true } }, college: { enabled: true }, mortgage: { enabled: true }, spending: { oneTime: [{ year: 2031, amount: 40000, kind: 'windfall' }] } }]) {
    const a = E.slim(E.analyze(raw, { mc: false }));
    for (const r of a.rows) {
      const { ins, outs } = RP.ui.flow.items(r, a.plan);
      const sum = (l) => l.reduce((t, x) => t + x.value, 0);
      assert.ok(Math.abs(sum(ins) - sum(outs)) < 2, `${r.year}: in ${sum(ins)} vs out ${sum(outs)}`);
    }
  }
});

test('possible futures: 100 whole lives from the same runs as the headline number', () => {
  const f = E.futures(base, { count: 100 });
  const a = E.analyze(base);
  assert.strictEqual(f.paths.length, 100);
  assert.strictEqual(f.successRate, a.summary.successRate);
  assert.ok(f.paths.every((p) => p.values.length === f.years.length));
  assert.ok(f.paths.filter((p) => p.failYear != null).every((p) => p.values[p.values.length - 1] === 0), 'futures that run short end at $0');
});

console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
