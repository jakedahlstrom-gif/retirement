/*
 * worker.js — runs the math engine in a background thread (a "Web Worker"),
 * so sliders and scrolling stay smooth while 1,000 simulations run.
 *
 * Messages in:  { id, type, plan, opts }
 * Messages out: { id, result } | { id, partial, key, value } | { id, error }
 */
/* global importScripts */
importScripts(
  'engine/util.js', '../data/historical-returns.js', 'engine/defaults.js', 'engine/tax.js',
  'engine/socialsecurity.js', 'engine/health.js', 'engine/schedule.js', 'engine/simulate.js',
  'engine/montecarlo.js', 'engine/api.js', 'engine/scenarios.js', 'engine/slim.js', 'engine/levers.js', 'engine/explore.js'
);

const RP = self.RP;

self.onmessage = function (ev) {
  const { id, type, plan, opts } = ev.data || {};
  try {
    if (type === 'analyze') {
      const a = RP.engine.analyze(plan, opts || {});
      self.postMessage({ id, result: RP.engine.slim(a) });
    } else if (type === 'metrics') {
      // Heavier searches, sent back one at a time so the screen fills in.
      const want = (opts && opts.which) || ['safe', 'earliest', 'green', 'coast'];
      const runs = (opts && opts.runs) || 400;
      const out = {};
      for (const key of want) {
        if (key === 'safe') out.safe = RP.engine.safeSpending(plan, { runs });
        if (key === 'earliest') out.earliest = RP.engine.earliestRetirement(plan, { runs: Math.min(runs, 300) });
        if (key === 'green') out.green = RP.engine.greenLight(plan, { runs });
        if (key === 'coast') out.coast = RP.engine.coastFire(plan, { runs });
        self.postMessage({ id, partial: true, key, value: out[key] });
      }
      self.postMessage({ id, result: out });
    } else if (type === 'byAge') {
      const res = RP.engine.successByAge(plan, opts || {});
      self.postMessage({ id, result: res });
    } else if (type === 'explore') {
      // Deep dives: opts.kind = 'ss' | 'roth' | 'history'
      const fn = { ss: 'ssExplorer', roth: 'rothExplorer', history: 'historyReplay' }[opts && opts.kind];
      if (!fn) throw new Error('Unknown explorer ' + (opts && opts.kind));
      self.postMessage({ id, result: RP.engine[fn](plan, opts) });
    } else if (type === 'levers') {
      // One message per lever, so the list fills in as results arrive.
      const res = RP.engine.levers(plan, opts || {}, (key, value) => self.postMessage({ id, partial: true, key, value }));
      self.postMessage({ id, result: res });
    } else {
      throw new Error('Unknown job ' + type);
    }
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
