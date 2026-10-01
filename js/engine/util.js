/*
 * util.js — small shared helpers used by every other engine file.
 *
 * Every engine file attaches itself to one shared namespace object, RP
 * ("Retirement Planner"). In the browser that lives on `globalThis.RP`; in
 * Node (for the tests) it is the same `globalThis.RP`. No build step needed.
 */
(function (RP) {
  'use strict';

  const U = {};

  U.clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  U.sum = (arr) => arr.reduce((a, b) => a + b, 0);
  U.isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /** Deep copy of plain JSON-like data. */
  U.clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

  /**
   * Deep merge: values in `over` win; nested objects merge; arrays are replaced
   * wholesale (so a scenario can swap a whole list like one-time events).
   */
  U.merge = function merge(base, over) {
    if (over === undefined) return U.clone(base);
    if (!U.isObj(base) || !U.isObj(over)) return U.clone(over);
    const out = U.clone(base);
    for (const k of Object.keys(over)) {
      out[k] = U.isObj(out[k]) && U.isObj(over[k]) ? merge(out[k], over[k]) : U.clone(over[k]);
    }
    return out;
  };

  /** Read a value by dotted path, e.g. getPath(plan, 'income.p1.salary'). */
  U.getPath = function (obj, path) {
    let cur = obj;
    for (const part of String(path).split('.')) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  };

  /** Write a value by dotted path, creating objects along the way. */
  U.setPath = function (obj, path, value) {
    const parts = String(path).split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
    return obj;
  };

  /** Flatten an object into { 'a.b.c': value } pairs (arrays kept as values). */
  U.flatten = function flatten(obj, prefix, out) {
    out = out || {};
    for (const k of Object.keys(obj || {})) {
      const key = prefix ? prefix + '.' + k : k;
      if (U.isObj(obj[k])) flatten(obj[k], key, out);
      else out[key] = obj[k];
    }
    return out;
  };

  /**
   * Seeded random numbers (mulberry32). The same seed always gives the same
   * sequence, so Monte Carlo results don't jitter when you move a slider and
   * every scenario faces the exact same "luck".
   */
  U.rng = function (seed) {
    let a = seed >>> 0;
    let spare = null;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    /** Standard normal (mean 0, sd 1) via Box–Muller. */
    const normal = function () {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = next();
      v = next();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
    return { next, normal };
  };

  /** Value at percentile p (0..1) of an already-sorted numeric array. */
  U.percentile = function (sorted, p) {
    if (!sorted.length) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  /** Fraction of a calendar year remaining after a YYYY-MM-DD date. */
  U.yearFractionRemaining = function (isoDate) {
    const [y, m, d] = String(isoDate).split('-').map(Number);
    const start = Date.UTC(y, (m || 1) - 1, d || 1);
    const end = Date.UTC(y + 1, 0, 1);
    const len = Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1);
    return U.clamp((end - start) / len, 0, 1);
  };

  RP.util = U;
})(globalThis.RP = globalThis.RP || {});
