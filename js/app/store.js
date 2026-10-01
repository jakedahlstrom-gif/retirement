/*
 * store.js — the app's memory.
 *
 * Holds everything you've entered, saves it in this browser's localStorage
 * (only on this device), and tells the screens when something changed.
 *
 *   state.plan        Baseline plan (every input)
 *   state.scenarios   [{ id, name, color, overrides: { 'path': value } }]
 *   state.active      which scenario the Plan tab is editing
 *   state.compare     which scenarios are overlaid on the Compare tab
 *   state.checklist   your to-do items
 *   state.history     snapshots from annual check-ins
 *   state.settings    PIN (stored only as a salted hash), preferences
 */
(function (RP) {
  'use strict';

  const U = RP.util;
  const E = RP.engine;
  const KEY = 'rp.state.v1';
  const listeners = new Set();
  let undoStack = [];
  let lastPush = 0;

  const DEFAULT_CHECKLIST = [
    { text: 'Update beneficiary designations on every account', done: false },
    { text: 'Review disability insurance', done: false },
    { text: 'Get umbrella insurance', done: false },
    { text: 'Pull official Social Security statements at ssa.gov', done: false },
    { text: 'Decide 529 vs. Trump Accounts', done: false },
  ];

  const S = (RP.store = {});

  function freshState(plan) {
    const P = E.resolvePlan(plan || {});
    return {
      version: 1,
      plan: P,
      scenarios: RP.defaultScenarios(P),
      active: 'base',
      compare: ['base', 'spend75', 'retire2032'],
      checklist: DEFAULT_CHECKLIST.map((c, i) => ({ id: 'c' + i, ...c })),
      history: [],
      settings: { pinHash: null, pinSalt: null, pinAsked: false, theme: 'auto' },
    };
  }

  S.load = function () {
    let st = null;
    try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
    if (!st || !st.plan) st = freshState();
    // Fill in anything new since this was saved.
    st.plan = E.resolvePlan(st.plan);
    const fresh = freshState(st.plan);
    for (const k of Object.keys(fresh)) if (st[k] == null) st[k] = fresh[k];
    st.settings = Object.assign({}, fresh.settings, st.settings);
    if (!st.scenarios.find((s) => s.id === 'base')) st.scenarios.unshift(fresh.scenarios[0]);
    if (!st.scenarios.find((s) => s.id === st.active)) st.active = 'base';
    st.compare = st.compare.filter((id) => st.scenarios.find((s) => s.id === id));
    if (!st.compare.length) st.compare = ['base'];
    S.state = st;
    return st;
  };

  S.save = function () {
    try { localStorage.setItem(KEY, JSON.stringify(S.state)); return true; }
    catch (e) { console.warn('Could not save', e); return false; }
  };

  S.on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  function emit(what) {
    if (S.state && ['plan', 'import', 'scenarios'].includes(what)) RP.refreshScenarioNames(S.state.plan, S.state.scenarios);
    for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } }
  }
  S.emit = emit;

  // ---- Undo -----------------------------------------------------------------
  function snapshot() { return JSON.stringify({ plan: S.state.plan, scenarios: S.state.scenarios, checklist: S.state.checklist }); }
  /** Remember the current state before a change (rapid slider moves coalesce). */
  S.pushUndo = function (force) {
    const now = Date.now();
    if (!force && now - lastPush < 900 && undoStack.length) { lastPush = now; return; }
    undoStack.push(snapshot());
    if (undoStack.length > 50) undoStack.shift();
    lastPush = now;
  };
  S.canUndo = () => undoStack.length > 0;
  S.undo = function () {
    const snap = undoStack.pop();
    if (!snap) return false;
    const o = JSON.parse(snap);
    S.state.plan = o.plan; S.state.scenarios = o.scenarios; S.state.checklist = o.checklist;
    lastPush = 0;
    S.save(); emit('plan');
    return true;
  };

  // ---- Scenarios ------------------------------------------------------------
  S.scenario = (id) => S.state.scenarios.find((s) => s.id === (id || S.state.active)) || S.state.scenarios[0];
  S.planFor = (id) => E.applyOverrides(S.state.plan, S.scenario(id).overrides);
  S.activePlan = () => S.planFor(S.state.active);
  S.isBase = (id) => (id || S.state.active) === 'base';

  /** Read an input from the active scenario's plan. */
  S.get = (path, id) => U.getPath(S.planFor(id), path);

  /** Is this input different from Baseline in the given scenario? */
  S.isOverridden = function (path, id) {
    const sc = S.scenario(id);
    if (sc.id === 'base') return false;
    return Object.keys(sc.overrides || {}).some((k) => k === path || k.startsWith(path + '.') || path.startsWith(k + '.'));
  };

  /** Change an input (on Baseline, or as an override on the active scenario). */
  S.set = function (path, value, opts) {
    opts = opts || {};
    const id = opts.scenario || S.state.active;
    S.pushUndo(opts.forceUndo);
    if (id === 'base') {
      U.setPath(S.state.plan, path, U.clone(value));
      if (path.startsWith('balances.') && path !== 'balances.asOf') S.state.plan.meta.lastUpdated = new Date().toISOString().slice(0, 10);
    } else {
      const sc = S.scenario(id);
      const baseVal = U.getPath(S.state.plan, path);
      if (JSON.stringify(baseVal) === JSON.stringify(value)) delete sc.overrides[path];
      else sc.overrides[path] = U.clone(value);
    }
    S.save();
    emit(opts.silent ? 'plan-quiet' : 'plan');
  };

  /** Undo a scenario's override, or put a Baseline input back to its default. */
  S.reset = function (path, id) {
    id = id || S.state.active;
    S.pushUndo(true);
    if (id === 'base') U.setPath(S.state.plan, path, U.clone(U.getPath(RP.DEFAULT_PLAN, path)));
    else {
      const sc = S.scenario(id);
      for (const k of Object.keys(sc.overrides)) if (k === path || k.startsWith(path + '.')) delete sc.overrides[k];
    }
    S.save(); emit('plan');
  };

  /** Reset a whole section (several top-level paths). */
  S.resetSection = function (paths, id) {
    id = id || S.state.active;
    S.pushUndo(true);
    for (const path of paths) {
      if (id === 'base') {
        const def = U.getPath(RP.DEFAULT_PLAN, path);
        // Keep your personal facts (names, birthdays) when resetting assumptions.
        U.setPath(S.state.plan, path, U.clone(def));
      } else {
        const sc = S.scenario(id);
        for (const k of Object.keys(sc.overrides)) if (k === path || k.startsWith(path + '.')) delete sc.overrides[k];
      }
    }
    S.save(); emit('plan');
  };

  S.setActive = function (id) { S.state.active = id; S.save(); emit('active'); };

  S.addScenario = function (fromId, name) {
    const src = S.scenario(fromId);
    const used = new Set(S.state.scenarios.map((s) => s.color));
    let color = 1;
    for (let c = 1; c <= RP.SCENARIO_COLORS; c++) if (!used.has(c)) { color = c; break; }
    if (used.size >= RP.SCENARIO_COLORS) color = (S.state.scenarios.length % RP.SCENARIO_COLORS) + 1;
    const sc = { id: 'sc' + Date.now().toString(36), preset: null, group: 'Custom', name: name || (src.name + ' copy'), color, autoName: false, overrides: U.clone(src.overrides || {}) };
    S.pushUndo(true);
    S.state.scenarios.push(sc);
    S.save(); emit('scenarios');
    return sc;
  };
  S.renameScenario = function (id, name) { S.pushUndo(true); const sc = S.scenario(id); sc.name = name; sc.autoName = false; S.save(); emit('scenarios'); };
  S.recolorScenario = function (id, color) { S.scenario(id).color = color; S.save(); emit('scenarios'); };
  S.deleteScenario = function (id) {
    if (id === 'base') return;
    S.pushUndo(true);
    S.state.scenarios = S.state.scenarios.filter((s) => s.id !== id);
    S.state.compare = S.state.compare.filter((c) => c !== id);
    if (!S.state.compare.length) S.state.compare = ['base'];
    if (S.state.active === id) S.state.active = 'base';
    S.save(); emit('scenarios');
  };
  S.resetScenario = function (id) {
    const sc = S.scenario(id);
    const pr = RP.SCENARIO_PRESETS.find((p) => p.key === sc.preset);
    S.pushUndo(true);
    sc.overrides = pr ? pr.make(S.state.plan) : {};
    S.save(); emit('plan');
  };
  S.toggleCompare = function (id) {
    const c = S.state.compare;
    if (c.includes(id)) { if (c.length > 1) S.state.compare = c.filter((x) => x !== id); }
    else if (c.length < 4) c.push(id);
    else return false;
    S.save(); emit('compare');
    return true;
  };

  // ---- Import / export --------------------------------------------------------
  /**
   * Accepts: an exported backup, a my-plan.json file ({ plan, checklist }), or a
   * bare plan object. Returns a short description of what was loaded.
   */
  S.importData = function (obj) {
    if (!obj || typeof obj !== 'object') throw new Error('That file isn’t a plan.');
    let plan = null, scenarios = null, checklist = null, history = null, compare = null;
    if (obj.plan && (obj.format === 'retirement-planner' || obj.version)) {
      plan = obj.plan; scenarios = obj.scenarios; checklist = obj.checklist; history = obj.history; compare = obj.compare;
    } else if (obj.people && obj.balances) {
      plan = obj;
    } else {
      throw new Error('That file doesn’t look like a retirement plan.');
    }
    S.pushUndo(true);
    const P = E.resolvePlan(plan);
    P.meta.isSample = false;
    const fresh = freshState(P);
    S.state.plan = P;
    S.state.scenarios = Array.isArray(scenarios) && scenarios.length ? scenarios : fresh.scenarios;
    if (!S.state.scenarios.find((s) => s.id === 'base')) S.state.scenarios.unshift(fresh.scenarios[0]);
    if (Array.isArray(checklist)) S.state.checklist = checklist.map((c, i) => ({ id: c.id || 'c' + i + Date.now().toString(36), text: c.text, done: !!c.done }));
    if (Array.isArray(history)) S.state.history = history;
    S.state.compare = Array.isArray(compare) && compare.length ? compare : fresh.compare;
    S.state.compare = S.state.compare.filter((id) => S.state.scenarios.find((s) => s.id === id));
    S.state.active = 'base';
    S.save(); emit('import');
    return { name: P.meta.planName, scenarios: S.state.scenarios.length };
  };

  S.exportData = function () {
    const st = S.state;
    return {
      format: 'retirement-planner', version: 1, exported: new Date().toISOString(),
      plan: st.plan, scenarios: st.scenarios, compare: st.compare, checklist: st.checklist, history: st.history,
    };
  };

  /** Start over with the sample household (keeps nothing). */
  S.resetAll = function () {
    S.pushUndo(true);
    const settings = S.state.settings;
    S.state = freshState();
    S.state.settings = settings;
    S.save(); emit('import');
  };

  /** Forget everything on this device, including the PIN. */
  S.eraseAll = function () {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
    undoStack = [];
    S.state = freshState();
    emit('import');
  };

  S.updateSettings = function (patch) { Object.assign(S.state.settings, patch); S.save(); };
})(globalThis.RP = globalThis.RP || {});
