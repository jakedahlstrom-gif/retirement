/*
 * engine-client.js — talks to the background worker.
 *
 * Workers:
 *   fast   — the main analysis (success %, year-by-year table). Newest request wins.
 *   slow   — heavier searches (safe spending, earliest retirement age, green
 *            light, Coast FIRE). Restarted whenever inputs change, so it never
 *            wastes time on stale numbers.
 *   levers — "what moves the needle" (only while that card is open). Same rule.
 * Compare and the check-in use their own named workers for the same jobs.
 * If workers aren't available (e.g. opening the file directly), the same code
 * runs on the page instead.
 */
(function (RP) {
  'use strict';

  const C = (RP.engineClient = {});
  let seq = 0;
  const workers = {};
  const pending = new Map();

  function makeWorker(name) {
    try {
      const w = new Worker('js/worker.js');
      w.onmessage = (ev) => {
        const { id, result, error, partial, key, value } = ev.data;
        const p = pending.get(id);
        if (!p) return;
        if (partial) { if (p.onPartial) p.onPartial(key, value); return; }
        pending.delete(id);
        if (error) p.reject(new Error(error)); else p.resolve(result);
      };
      w.onerror = (e) => { console.warn('worker error', e.message); };
      workers[name] = w;
      return w;
    } catch (e) {
      workers[name] = null;
      return null;
    }
  }

  function run(name, type, plan, opts, onPartial) {
    const id = ++seq;
    let w = workers[name];
    if (w === undefined) w = makeWorker(name);
    return new Promise((resolve, reject) => {
      if (!w) {
        // Fallback: run on the page (after the screen has had a chance to paint).
        setTimeout(() => {
          try {
            const E = RP.engine;
            if (type === 'analyze') resolve(E.slim(E.analyze(plan, opts)));
            else if (type === 'metrics') {
              const out = {};
              for (const k of opts.which) {
                if (k === 'safe') out.safe = E.safeSpending(plan, { runs: opts.runs });
                if (k === 'earliest') out.earliest = E.earliestRetirement(plan, { runs: Math.min(opts.runs, 300) });
                if (k === 'green') out.green = E.greenLight(plan, { runs: opts.runs });
                if (k === 'coast') out.coast = E.coastFire(plan, { runs: opts.runs });
                if (onPartial) onPartial(k, out[k]);
              }
              resolve(out);
            } else if (type === 'byAge') resolve(E.successByAge(plan, opts));
            else if (type === 'levers') resolve(E.levers(plan, opts, onPartial));
          } catch (e) { reject(e); }
        }, 30);
        return;
      }
      pending.set(id, { resolve, reject, onPartial, name });
      w.postMessage({ id, type, plan: JSON.parse(JSON.stringify(plan)), opts });
    });
  }

  /** Restart a worker, dropping whatever it was doing. */
  function restart(name) {
    const w = workers[name];
    if (w) {
      w.terminate();
      for (const [id, p] of pending) if (p.name === name) { pending.delete(id); p.reject(new Error('cancelled')); }
      delete workers[name];
    }
  }

  // Latest-wins wrapper for the fast analysis.
  const latest = {};
  C.analyze = function (plan, opts, tag) {
    tag = tag || 'main';
    const my = (latest[tag] = (latest[tag] || 0) + 1);
    return run('fast', 'analyze', plan, opts || {}).then((r) => {
      if (my !== latest[tag]) throw new Error('stale');
      return r;
    });
  };

  C.metrics = function (plan, which, onPartial, runs) {
    restart('slow');
    return run('slow', 'metrics', plan, { which, runs: runs || 400 }, onPartial);
  };

  /** Same as metrics(), on a named worker that only restarts itself. */
  C.metricsOn = function (name, plan, which, onPartial, runs) {
    return run(name, 'metrics', plan, { which, runs: runs || 400 }, onPartial);
  };

  C.byAge = function (plan, opts) {
    return run('ages', 'byAge', plan, opts || {});
  };

  /** "What moves the needle": each lever's effect, reported one at a time. Newest request wins. */
  C.levers = function (plan, onPartial, runs) {
    restart('levers');
    return run('levers', 'levers', plan, { runs: runs || 400 }, onPartial);
  };

  C.cancelSlow = () => { restart('slow'); restart('ages'); restart('cmp'); restart('levers'); };
})(globalThis.RP = globalThis.RP || {});
