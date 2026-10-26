/*
 * ridge.js — the range of outcomes: a ridgeline ("joyplot") of how much you
 * might have at each age from retirement on, across hundreds of market
 * histories. Each ridge is a smooth histogram on a log scale ($10K, $100K,
 * $1M…), so a tall narrow ridge means "fairly sure", a wide flat one means
 * "anyone's guess". Lives that have run out are counted on the left in red.
 *
 * Two looks: Color, and Pulsar (white lines on black, after the famous album
 * cover drawn from a pulsar's radio signal).
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const RG = (UI.ridge = {});
  let look = 'color';

  RG.open = function () {
    const sc = store().scenario();
    const P = RP.engine.resolvePlan(store().activePlan());
    let res = null, raf = 0, closed = false, t0 = 0, pick = null;
    const canvas = h('canvas.rg-canvas', { role: 'img', 'aria-label': 'How spread out your savings could be at each age' });
    const box = h('div.rg-box' + (look === 'pulsar' ? '.pulsar' : ''), h('div.x-wait', h('span.busy-dot'), 'Running the numbers…'));
    const detail = h('div.rg-detail');
    const seg = UI.segmented({
      options: [{ value: 'color', label: 'Color' }, { value: 'pulsar', label: 'Pulsar' }], value: look,
      onChange: (v) => { look = v; box.classList.toggle('pulsar', v === 'pulsar'); t0 = performance.now() - 2000; redraw(); },
    });
    const pill = h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name);
    UI.sheet.open({
      title: 'Range of outcomes',
      body: [
        h('div.x-head', pill),
        h('p.x-note', `Each ridge shows where your savings could be at that age (${P.people.p1.name}’s), across the market histories your plan is tested on. Tall and narrow: fairly sure. Wide and flat: anyone’s guess. The dashed line is the middle outcome. Tap a ridge.`),
        seg, box, detail,
      ],
      onClose: () => { closed = true; cancelAnimationFrame(raf); },
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
    const redraw = () => { if (!raf && res) raf = requestAnimationFrame(draw); };

    let G = null;
    function draw(t) {
      raf = 0;
      if (closed || !res) return;
      const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W) return;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
      const pulsar = look === 'pulsar';
      const rs = res.ridges, m = rs.length;
      const L = 50, R = 12, B = 30;
      const peakPx = Math.min(90, (H - B) / (m + 2) * 2.6);
      const T = peakPx + 12; // room for the first ridge's peak
      const step = (H - T - B) / Math.max(1, m - 1);
      const peak = Math.max(...rs.map((r) => Math.max(...r.density) * (1 - r.zero))) || 1;
      const X = (lv) => L + (lv - res.lo) / (res.top - res.lo) * (W - L - R);
      const base = (i) => T + i * step;
      G = { base, step, T, m };
      const now = t || performance.now();
      let animating = false;
      const font = css('--font');
      // Dollar grid
      c.font = `600 10.5px ${font}`; c.textAlign = 'center';
      for (let e = Math.ceil(res.lo); e <= Math.floor(res.top); e++) {
        const x = X(e);
        c.strokeStyle = pulsar ? 'rgba(255,255,255,0.08)' : css('--line'); c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, 4); c.lineTo(x, H - B + 4); c.stroke();
        c.fillStyle = pulsar ? 'rgba(255,255,255,0.5)' : css('--muted');
        c.fillText(fmt.money(Math.pow(10, e)), x, H - 10);
      }
      // Ridges, back (top) to front (bottom); each fill hides the ones behind it.
      rs.forEach((r, i) => {
        const k = UI.reducedMotion() ? 1 : Math.min(1, Math.max(0, (now - t0 - i * 110) / 700));
        const e = 1 - Math.pow(1 - k, 3);
        if (k < 1) animating = true;
        const y0 = base(i);
        const scale = (1 - r.zero) / peak * peakPx * e;
        const pts = r.density.map((d, b) => [X(res.xs[b]), y0 - d * scale]);
        const hue = 265 - (i / Math.max(1, m - 1)) * 230; // violet → amber
        c.beginPath();
        c.moveTo(L, y0);
        pts.forEach(([x, y]) => c.lineTo(x, y));
        c.lineTo(W - R, y0);
        if (pulsar) {
          c.fillStyle = '#000'; c.fill();
          c.strokeStyle = pick === i ? '#ffd166' : '#fff'; c.lineWidth = pick === i ? 2 : 1.4; c.stroke();
        } else {
          const g = c.createLinearGradient(0, y0 - peakPx, 0, y0);
          g.addColorStop(0, `hsla(${hue}, 95%, 70%, 0.95)`); g.addColorStop(1, `hsla(${hue}, 85%, 45%, 0.75)`);
          c.fillStyle = g; c.fill();
          c.strokeStyle = pick === i ? '#fff' : 'rgba(255,255,255,0.75)'; c.lineWidth = pick === i ? 2.2 : 1.1; c.stroke();
        }
        // Median: a line up to the curve (later ridges cover it, like the rest)
        if (r.p50 > 0) {
          const lv = Math.log10(Math.max(r.p50, Math.pow(10, res.lo)));
          const b = Math.max(0, Math.min(res.xs.length - 1, Math.round((lv - res.lo) / (res.top - res.lo) * res.xs.length - 0.5)));
          const x = X(lv);
          c.strokeStyle = pulsar ? 'rgba(255, 209, 102, 0.9)' : 'rgba(255, 255, 255, 0.7)'; c.lineWidth = 1.2;
          c.setLineDash([2, 2]); c.beginPath(); c.moveTo(x, y0); c.lineTo(x, pts[b][1] + 2); c.stroke(); c.setLineDash([]);
        }
        // Age label, and lives that have run out
        c.textAlign = 'right'; c.font = `650 11.5px ${font}`;
        c.fillStyle = pulsar ? '#fff' : css('--fg');
        c.fillText(String(r.age), L - 22, y0 + 1);
        if (r.zero >= 0.005) {
          c.fillStyle = css('--bad');
          const zh = Math.min(peakPx * 0.6, 6 + r.zero * peakPx * 2) * e;
          c.fillRect(L - 14, y0 - zh, 5, zh);
          c.font = `600 9.5px ${font}`; c.textAlign = 'right';
          if (r.zero >= 0.01) c.fillText(Math.round(r.zero * 100) + '%', L - 2, y0 - zh - 3);
        }
      });
      c.textAlign = 'left'; c.font = `600 10.5px ${font}`; c.fillStyle = pulsar ? 'rgba(255,255,255,0.6)' : css('--muted');
      c.fillText('Age', 6, 12);
      if (animating) raf = requestAnimationFrame(draw);
    }

    function paintPick() {
      if (pick == null) { UI.mount(detail); return; }
      const r = res.ridges[pick];
      UI.mount(detail, h('div.rg-pick',
        h('div.rg-pick-title', `${P.people.p1.name} at ${r.age} (${r.year})`),
        h('div.x-stats',
          h('div.x-stat', h('div.label', '1 in 10 below'), h('div.x-val', fmt.money(r.p10))),
          h('div.x-stat', h('div.label', 'Half above'), h('div.x-val', fmt.money(r.p50))),
          h('div.x-stat', h('div.label', '1 in 10 above'), h('div.x-val', fmt.money(r.p90)))),
        h('p.x-note', r.zero >= 0.005 ? `${fmt.pct(r.zero, r.zero < 0.1 ? 1 : 0)} of lives have run out of money by this age.` : 'No lives have run out of money by this age.')));
    }
    canvas.addEventListener('click', (e) => {
      if (!G) return;
      const y = e.clientY - canvas.getBoundingClientRect().top;
      let best = 0, bd = Infinity;
      for (let i = 0; i < G.m; i++) { const d = Math.abs(G.base(i) - 8 - y); if (d < bd) { bd = d; best = i; } }
      pick = best; UI.haptic(); paintPick(); redraw();
    });

    RP.engineClient.lab('ridge', P).then((r) => {
      if (closed) return;
      res = r;
      UI.mount(box, canvas);
      box.style.height = Math.max(300, 90 + r.ridges.length * 34) + 'px';
      pick = Math.min(r.ridges.length - 1, Math.floor(r.ridges.length / 2));
      paintPick();
      t0 = performance.now();
      redraw();
    }).catch((e) => { if (e.message !== 'stale' && !closed) { console.error(e); UI.mount(box, h('p.tip-text', 'Couldn’t draw the range.')); } });
  };
})(globalThis.RP = globalThis.RP || {});
