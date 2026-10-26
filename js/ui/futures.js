/*
 * futures.js — "100 possible futures": a hundred of the market histories your
 * plan is tested on, drawn one after another like light trails across the
 * sky. Mint lines last the whole plan; coral ones run short. Your typical
 * path glows amber on top. It turns "93% chance of success" into something
 * you can see.
 *
 * Plain <canvas>. Finished trails are kept in a second canvas, so each frame
 * only redraws the few lines still streaking in.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const FU = (UI.futures = {});
  const PAD = { l: 8, r: 8, t: 26, b: 22 };
  const SWEEP_MS = 520, SPREAD_MS = 1900;
  let token = 0, raf = 0;

  /** Deterministic shuffle, so the trails arrive in the same order every time. */
  function order(n) {
    const idx = Array.from({ length: n }, (_, i) => i);
    let s = 7;
    for (let i = n - 1; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    return idx;
  }
  const niceTop = (v) => { const e = Math.pow(10, Math.floor(Math.log10(v || 1))); return e * [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * e >= v); };
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  function draw(canvas, res) {
    const my = ++token;
    cancelAnimationFrame(raf);
    const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    const col = { ok: css('--pos'), bad: css('--bad'), acc: css('--accent'), muted: css('--muted'), line: css('--line-strong'), font: css('--font') };
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext('2d');
    const layer = document.createElement('canvas');
    layer.width = canvas.width; layer.height = canvas.height;
    const lc = layer.getContext('2d');
    for (const c of [ctx, lc]) c.setTransform(dpr, 0, 0, dpr, 0, 0);

    const ys = res.years, n = ys.length;
    const peaks = res.paths.map((p) => Math.max(...p.values)).sort((a, b) => a - b);
    const top = niceTop(Math.max(pct(peaks, 0.85), Math.max(...res.typical)) * 1.1);
    const X = (i) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
    const Y = (v) => PAD.t + (1 - Math.min(v, top * 1.05) / top) * (H - PAD.t - PAD.b);
    const ri = Math.max(0, ys.indexOf(res.retireYear));

    // The still frame: horizon, retirement marker, year labels
    const frame = (c) => {
      c.clearRect(0, 0, W, H);
      c.fillStyle = col.line; c.fillRect(PAD.l, Y(0), W - PAD.l - PAD.r, 1);
      c.fillRect(X(ri), PAD.t - 6, 1, Y(0) - PAD.t + 6);
      c.font = `500 11px ${col.font}`; c.fillStyle = col.muted; c.textBaseline = 'alphabetic';
      c.textAlign = 'left'; c.fillText(String(ys[0]), PAD.l, H - 5);
      c.textAlign = 'right'; c.fillText(String(ys[n - 1]), W - PAD.r, H - 5);
      c.textAlign = 'center'; c.fillText(`Retire ${res.retireYear}`, Math.min(Math.max(X(ri), 40), W - 40), PAD.t - 10);
      c.textAlign = 'left'; c.fillText(fmt.money(top), PAD.l, 12);
    };
    // One trail, drawn up to fraction k of its length
    const trail = (c, p, k, head) => {
      const last = Math.max(1, Math.floor(k * (n - 1)));
      const fail = p.failYear != null;
      c.save();
      c.beginPath(); c.rect(PAD.l, PAD.t, W, Y(0) + 1 - PAD.t); c.clip(); // the best futures run off the top
      c.strokeStyle = fail ? col.bad : col.ok;
      c.globalAlpha = fail ? 0.55 : 0.24;
      c.lineWidth = fail ? 1.3 : 1;
      c.lineJoin = c.lineCap = 'round';
      c.beginPath();
      for (let i = 0; i <= last; i++) { const x = X(i), y = Y(p.values[i]); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke();
      c.restore();
      if (head) { // the bright head of a trail still streaking in
        const x = X(last), y = Y(p.values[last]);
        const g = c.createRadialGradient(x, y, 0, x, y, 7);
        g.addColorStop(0, fail ? col.bad : '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill();
      }
      if (k >= 1 && fail) { // where this future runs short
        const fi = Math.max(0, ys.indexOf(p.failYear));
        c.fillStyle = col.bad; c.beginPath(); c.arc(X(fi), Y(0), 2.2, 0, 7); c.fill();
      }
    };
    const typical = (c) => {
      c.save();
      c.strokeStyle = col.acc; c.lineWidth = 2.25; c.shadowColor = col.acc; c.shadowBlur = 10;
      c.beginPath();
      res.typical.forEach((v, i) => { const x = X(i), y = Y(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke(); c.restore();
    };

    frame(lc);
    const seq = order(res.paths.length);
    const reduced = UI.reducedMotion();
    if (reduced) {
      for (const i of seq) trail(lc, res.paths[i], 1, false);
      ctx.clearRect(0, 0, W, H); ctx.drawImage(layer, 0, 0, W, H); typical(ctx);
      return;
    }
    const t0 = performance.now();
    const doneSet = new Set();
    const tick = (t) => {
      if (my !== token) return;
      const el = t - t0;
      ctx.clearRect(0, 0, W, H);
      const live = [];
      seq.forEach((pi, k) => {
        if (doneSet.has(pi)) return;
        const start = (k / seq.length) * SPREAD_MS;
        const f = (el - start) / SWEEP_MS;
        if (f >= 1) { trail(lc, res.paths[pi], 1, false); doneSet.add(pi); }
        else if (f > 0) live.push([pi, 1 - Math.pow(1 - f, 2)]);
      });
      ctx.drawImage(layer, 0, 0, W, H);
      for (const [pi, f] of live) trail(ctx, res.paths[pi], f, true);
      if (doneSet.size < seq.length) raf = requestAnimationFrame(tick);
      else typical(ctx);
    };
    raf = requestAnimationFrame(tick);
  }

  FU.open = function (scId) {
    const sc = store().scenario(scId);
    const P = store().planFor(sc.id);
    const pill = h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name);
    const body = h('div.x-body', h('div.x-head', pill), h('div.x-wait', h('span.busy-dot'), 'Imagining 100 futures…'));
    let closed = false, replay = null;
    UI.sheet.open({
      title: 'Possible futures', body,
      onClose: () => { closed = true; token++; cancelAnimationFrame(raf); },
      actions: [{ label: 'Replay', onClick: () => replay && replay() }, { label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
    RP.engineClient.explore('futures', P).then((res) => {
      if (closed) return; // closed or replaced while calculating
      const ends = res.paths.map((p) => (p.failYear != null ? 0 : p.values[p.values.length - 1])).sort((a, b) => a - b);
      const lasting = res.paths.filter((p) => p.failYear == null).length;
      const canvas = h('canvas.fu-canvas', { role: 'img', 'aria-label': `${res.paths.length} possible futures for your savings; ${lasting} last the whole plan` });
      const who = RP.engine.resolvePlan(P);
      const age = who.household.horizonAge, name = who.people[who.household.horizonPerson].name;
      UI.mount(body,
        h('div.x-head', pill),
        h('p.x-note', `Each line is one possible life of your savings: ${res.paths.length} of the ${res.runs.toLocaleString()} market histories your plan is tested on, in today’s dollars.`),
        h('div.fu-box', canvas),
        h('div.ss-legend',
          h('span.lg', h('i.x-sw', { style: { background: 'var(--pos)' } }), 'Lasts'),
          h('span.lg', h('i.x-sw', { style: { background: 'var(--bad)' } }), 'Runs short'),
          h('span.lg', h('i.pg-dash', { style: { borderTopStyle: 'solid', borderTopWidth: '2px' } }), 'Typical market')),
        h('div.x-stats', { style: { marginTop: '16px' } },
          h('div.x-stat', h('div.label', 'Last to the end'), h('div.x-val' + (lasting >= 90 ? '.pos' : lasting < 75 ? '.neg' : ''), `${lasting} of ${res.paths.length}`)),
          h('div.x-stat', h('div.label', 'Worst 10% leave'), h('div.x-val', fmt.money(pct(ends, 0.1)))),
          h('div.x-stat', h('div.label', 'Best 10% leave'), h('div.x-val', fmt.money(pct(ends, 0.9))))),
        h('p.x-note', `Across all ${res.runs.toLocaleString()} histories, ${fmt.pct(res.successRate)} last until ${name} is ${age}. The spread is why the plan is tested on many futures instead of one average: what matters most is the order of good and bad years early in retirement.`));
      replay = () => draw(canvas, res);
      requestAnimationFrame(replay);
    }).catch((e) => { if (e.message !== 'cancelled') { console.error(e); UI.mount(body, h('p.tip-text', 'Couldn’t draw the futures.')); } });
  };
})(globalThis.RP = globalThis.RP || {});
