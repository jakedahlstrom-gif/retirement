/*
 * decision.js — the decision map: retirement age (down) × retirement
 * spending (across), each square colored by the chance the money lasts.
 *
 * The squares are tested in the background, spread over a few workers, and
 * fill in from your own spot outward. Colors blend smoothly between squares
 * (the browser scales a tiny image up), and a bright line traces your success
 * target, so the "safe zone" reads at a glance. Tap a square to see it, then
 * use it or save it as a scenario.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const E = RP.engine;
  const store = () => RP.store;
  const DM = (UI.decision = {});
  const RUNS = 120;

  // Success → color: coral below 50%, through amber, to mint at your target and teal at 100%.
  function colorFor(s, target) {
    const stops = [[0, [150, 30, 70]], [0.5, [222, 54, 94]], [0.75, [255, 181, 71]], [target, [95, 224, 176]], [1, [47, 211, 199]]];
    let i = 1;
    while (i < stops.length - 1 && stops[i][0] < s) i++;
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    const t = Math.min(1, Math.max(0, (s - a) / ((b - a) || 1)));
    return ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
  }

  DM.open = function () {
    const sc = store().scenario();
    const P = E.resolvePlan(store().activePlan());
    const m = RP.app.metrics || {};
    const grid = E.decisionCells(P, {
      earliest: m.earliest && m.earliest.age, safeRatio: m.safe && m.safe.amount && P.spending.retirement ? m.safe.amount / P.spending.retirement : null,
    });
    const R = grid.ages.length, Cn = grid.pcts.length, target = grid.target / 100;
    const vals = Array.from({ length: R }, () => new Array(Cn).fill(null));
    const born = Array.from({ length: R }, () => new Array(Cn).fill(0));
    let sel = { i: grid.ages.indexOf(grid.current.age), j: grid.pcts.indexOf(100) };
    let done = 0, closed = false, raf = 0;

    const canvas = h('canvas.dm-canvas', { role: 'img', 'aria-label': 'Decision map: chance of success for each retirement age and spending level' });
    const box = h('div.dm-box', canvas);
    const status = h('div.dm-status', h('span.busy-dot'), `Testing ${R * Cn} combinations…`);
    const detail = h('div.dm-detail');
    const facts = h('div.dm-facts');
    const pill = h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name);
    UI.sheet.open({
      title: 'Decision map',
      body: [
        h('div.x-head', pill),
        h('p.x-note', `Down: when ${P.people.p1.name} retires. Across: what you spend each year once retired. Each square is the chance your money lasts, from ${RUNS} market histories. The bright line is your ${grid.target}% target.`),
        box, status, detail, facts,
        h('div.dm-legend', h('span', '50%'), h('i'), h('span', '100%')),
      ],
      onClose: () => { closed = true; cancelAnimationFrame(raf); RP.engineClient.cancelMap(); },
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });

    // ---------------------------------------------------------------- drawing
    const tiny = document.createElement('canvas');
    tiny.width = Cn; tiny.height = R;
    const LAB = { l: 34, t: 22, r: 4, b: 4 };
    let geo = null;
    function draw() {
      raf = 0;
      if (closed) return;
      const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W) return;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const gw = W - LAB.l - LAB.r, gh = H - LAB.t - LAB.b, cw = gw / Cn, ch = gh / R;
      geo = { gw, gh, cw, ch };
      const now = performance.now();
      let fading = false;
      // The tiny image: one pixel per square, faded in as results arrive.
      const tc = tiny.getContext('2d');
      const img = tc.createImageData(Cn, R);
      for (let i = 0; i < R; i++) for (let j = 0; j < Cn; j++) {
        const v = vals[i][j], o = (i * Cn + j) * 4;
        if (v == null) { img.data[o + 3] = 0; continue; }
        const a = Math.min(1, (now - born[i][j]) / 450);
        if (a < 1) fading = true;
        const [r, g, b] = colorFor(v, target);
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = Math.round(255 * a);
      }
      tc.putImageData(img, 0, 0);
      // Empty squares shimmer as a dark base.
      c.save();
      roundRect(c, LAB.l, LAB.t, gw, gh, 14); c.clip();
      c.fillStyle = 'rgba(10, 14, 34, 0.9)'; c.fillRect(LAB.l, LAB.t, gw, gh);
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      // Scale so pixel centers land on square centers (smooth inside, clamped at the edges).
      c.drawImage(tiny, LAB.l, LAB.t, gw, gh);
      // Square edges and numbers
      c.strokeStyle = 'rgba(0, 0, 0, 0.18)'; c.lineWidth = 1;
      for (let j = 1; j < Cn; j++) { c.beginPath(); c.moveTo(LAB.l + j * cw, LAB.t); c.lineTo(LAB.l + j * cw, LAB.t + gh); c.stroke(); }
      for (let i = 1; i < R; i++) { c.beginPath(); c.moveTo(LAB.l, LAB.t + i * ch); c.lineTo(LAB.l + gw, LAB.t + i * ch); c.stroke(); }
      c.font = `650 ${Math.min(13, cw * 0.28).toFixed(1)}px ${getComputedStyle(document.documentElement).getPropertyValue('--font')}`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      for (let i = 0; i < R; i++) for (let j = 0; j < Cn; j++) {
        const v = vals[i][j];
        if (v == null) continue;
        c.globalAlpha = Math.min(1, (now - born[i][j]) / 450);
        c.fillStyle = 'rgba(0, 0, 0, 0.35)';
        c.fillText(Math.round(v * 100), LAB.l + (j + 0.5) * cw, LAB.t + (i + 0.5) * ch + 1);
        c.fillStyle = '#ffffff';
        c.fillText(Math.round(v * 100), LAB.l + (j + 0.5) * cw, LAB.t + (i + 0.5) * ch);
      }
      c.globalAlpha = 1;
      contour(c);
      c.restore();
      // Your plan: a dashed ring; the selected square: a solid one.
      const ci = grid.ages.indexOf(grid.current.age), cj = grid.pcts.indexOf(100);
      if (ci >= 0 && cj >= 0) {
        c.save(); c.setLineDash([3, 3]); c.strokeStyle = '#fff'; c.lineWidth = 1.5;
        roundRect(c, LAB.l + cj * cw + 3, LAB.t + ci * ch + 3, cw - 6, ch - 6, 7); c.stroke(); c.restore();
      }
      if (sel && sel.i >= 0 && sel.j >= 0 && !(sel.i === ci && sel.j === cj)) {
        c.save(); c.strokeStyle = '#fff'; c.lineWidth = 2.5; c.shadowColor = 'rgba(255,255,255,0.8)'; c.shadowBlur = 10;
        roundRect(c, LAB.l + sel.j * cw + 2, LAB.t + sel.i * ch + 2, cw - 4, ch - 4, 8); c.stroke(); c.restore();
      }
      // Axis labels
      const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
      c.fillStyle = css('--muted'); c.font = `600 11px ${css('--font')}`;
      c.textAlign = 'right';
      grid.ages.forEach((a, i) => { c.fillStyle = i === ci ? css('--fg') : css('--muted'); c.fillText(String(a), LAB.l - 7, LAB.t + (i + 0.5) * ch); });
      c.textAlign = 'center';
      grid.pcts.forEach((p, j) => { c.fillStyle = j === cj ? css('--fg') : css('--muted'); c.fillText(fmt.money(P.spending.retirement * p / 100), LAB.l + (j + 0.5) * cw, LAB.t - 10); });
      if (fading) raf = requestAnimationFrame(draw);
    }

    /** Marching squares on the square centers: the line where success crosses the target. */
    function contour(c) {
      const { cw, ch } = geo;
      const X = (j) => LAB.l + (j + 0.5) * cw, Y = (i) => LAB.t + (i + 0.5) * ch;
      const segs = [];
      for (let i = 0; i < R - 1; i++) for (let j = 0; j < Cn - 1; j++) {
        const q = [vals[i][j], vals[i][j + 1], vals[i + 1][j + 1], vals[i + 1][j]];
        if (q.some((v) => v == null)) continue;
        const pts = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]];
        const cross = [];
        for (let e = 0; e < 4; e++) {
          const a = q[e], b = q[(e + 1) % 4];
          if ((a >= target) !== (b >= target)) {
            const t = (target - a) / (b - a);
            const [ia, ja] = pts[e], [ib, jb] = pts[(e + 1) % 4];
            cross.push([X(ja + (jb - ja) * t), Y(ia + (ib - ia) * t)]);
          }
        }
        if (cross.length === 2) segs.push(cross);
        else if (cross.length === 4) { segs.push([cross[0], cross[1]]); segs.push([cross[2], cross[3]]); }
      }
      if (!segs.length) return;
      c.save();
      c.lineCap = 'round';
      c.strokeStyle = 'rgba(255, 255, 255, 0.95)'; c.lineWidth = 2.2; c.shadowColor = '#ffffff'; c.shadowBlur = 8;
      c.beginPath();
      for (const [[x0, y0], [x1, y1]] of segs) { c.moveTo(x0, y0); c.lineTo(x1, y1); }
      c.stroke();
      c.restore();
    }
    function roundRect(c, x, y, w, hh, r) {
      c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r);
      c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
    }
    const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

    // ---------------------------------------------------------------- reading
    function paintDetail() {
      if (!sel || sel.i < 0 || sel.j < 0) { UI.mount(detail); return; }
      const age = grid.ages[sel.i], pct = grid.pcts[sel.j], v = vals[sel.i][sel.j];
      const amount = Math.round(P.spending.retirement * pct / 100);
      const isPlan = age === grid.current.age && pct === 100;
      const o = E.decisionOverrides(P, { age, pct });
      UI.mount(detail,
        h('div.dm-pick',
          h('div', h('div.dm-pick-title', `Retire at ${age}, spend ${fmt.money(amount)} a year`),
            h('div.dm-pick-sub', isPlan ? 'Your plan as it is' : `${P.people.p1.name} ${age} is ${P.people.p1.birthYear + age + 1}`)),
          h('div.dm-pick-val' + (v == null ? '' : v >= target ? '.ok' : v >= 0.75 ? '.meh' : '.bad'), v == null ? '…' : fmt.pct(v))),
        isPlan ? null : h('div.dm-actions',
          h('button.btn', { onclick: () => { const s2 = store().addScenario(store().state.active, `Retire ${age}, ${fmt.money(amount)}/yr`, o); UI.toast(`Saved as scenario “${s2.name}”`, 'Show', () => store().setActive(s2.id)); } }, 'Save as scenario'),
          h('button.btn.primary', { onclick: () => { const nm = store().scenario().name; store().setMany(o); UI.sheet.close(); UI.toast(`Applied to ${nm}`, 'Undo', () => store().undo()); } }, 'Use this')));
    }
    function paintFacts() {
      const ci = grid.ages.indexOf(grid.current.age), cj = grid.pcts.indexOf(100);
      const bits = [];
      if (cj >= 0 && grid.working) {
        const col = grid.ages.map((a, i) => [a, vals[i][cj]]);
        if (col.every(([, v]) => v != null)) {
          const ok = col.find(([, v]) => v >= target);
          bits.push(h('div.dm-fact', h('b', ok ? String(ok[0]) : `over ${grid.ages[grid.ages.length - 1]}`), h('span', `earliest age on this map that meets ${grid.target}% at your spending`)));
        }
      }
      if (ci >= 0) {
        const row = vals[ci];
        if (row.every((v) => v != null)) {
          let best = null;
          row.forEach((v, j) => { if (v >= target) best = j; });
          bits.push(h('div.dm-fact', h('b', best == null ? 'under ' + fmt.money(P.spending.retirement * grid.pcts[0] / 100) : (best === Cn - 1 ? fmt.money(P.spending.retirement * grid.pcts[best] / 100) + '+' : fmt.money(P.spending.retirement * grid.pcts[best] / 100))),
            h('span', `most you can spend on this map retiring at ${grid.current.age}`)));
        }
      }
      UI.mount(facts, bits);
    }

    canvas.addEventListener('click', (e) => {
      if (!geo) return;
      const r = canvas.getBoundingClientRect();
      const j = Math.floor((e.clientX - r.left - LAB.l) / geo.cw), i = Math.floor((e.clientY - r.top - LAB.t) / geo.ch);
      if (i < 0 || j < 0 || i >= R || j >= Cn) return;
      sel = { i, j };
      UI.haptic();
      paintDetail(); redraw();
    });
    // Keyboard: arrows move the selection.
    canvas.tabIndex = 0;
    canvas.addEventListener('keydown', (e) => {
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (!d) return;
      e.preventDefault();
      sel = { i: Math.min(R - 1, Math.max(0, sel.i + d[0])), j: Math.min(Cn - 1, Math.max(0, sel.j + d[1])) };
      paintDetail(); redraw();
    });

    box.style.aspectRatio = `${Cn * 1.18 + 0.8} / ${R + 0.6}`;
    requestAnimationFrame(redraw);
    paintDetail();

    const t0 = performance.now();
    RP.engineClient.decisionMap(P, grid.cells, (cell) => {
      if (closed) return;
      vals[cell.i][cell.j] = cell.success;
      born[cell.i][cell.j] = UI.reducedMotion() ? 0 : performance.now();
      done++;
      status.lastChild.textContent = `Testing ${R * Cn} combinations… ${done}`;
      if (sel && sel.i === cell.i && sel.j === cell.j) paintDetail();
      redraw();
    }, RUNS).then(() => {
      if (closed) return;
      status.textContent = `${R * Cn} combinations, ${RUNS} market histories each, in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
      status.classList.add('done');
      paintFacts(); paintDetail();
    }).catch((e) => { if (e.message !== 'cancelled' && !closed) { console.error(e); status.textContent = 'Couldn’t finish the map.'; } });
  };
})(globalThis.RP = globalThis.RP || {});
