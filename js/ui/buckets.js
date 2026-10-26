/*
 * buckets.js — money buckets: your accounts as four glass jars of liquid
 * (pre-tax, Roth, HSA, cash & brokerage), played year by year along the
 * typical-market path. Savings drip in from the top, withdrawals drain out
 * the bottom toward your spending, and Roth conversions arc from the pre-tax
 * jar to the Roth jar. Press play, or scrub to any year.
 *
 * Plain <canvas>; all jars share one scale so their sizes compare honestly.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const BK = (UI.buckets = {});
  const JARS = [
    { key: 'preTax', label: 'Pre-tax', word: 'pre-tax', color: '#7c8cff' },
    { key: 'roth', label: 'Roth', word: 'Roth', color: '#5fe0b0' },
    { key: 'hsa', label: 'HSA', word: 'HSA', color: '#ff8ac2' },
    { key: 'taxable', label: 'Cash & brokerage', short: 'Cash & brok.', word: 'cash & brokerage', color: '#ffd166' },
  ];
  const STEP_MS = 900;

  /** What flowed in and out of each jar in one year. */
  function flows(r) {
    const s = r.saving, src = r.src;
    return {
      in: { preTax: s.pre401k + s.match, roth: s.rothIra + s.mega, hsa: s.hsa, taxable: s.taxable + s.leftover },
      out: { preTax: src.preTax + src.penalty, roth: src.rothBasis + src.rothConversions + src.rothEarnings, hsa: src.hsa, taxable: src.cash },
      conv: r.converted || 0,
    };
  }

  BK.open = function () {
    const a = RP.app.last;
    if (!a) { UI.toast('Still calculating…'); return; }
    const sc = store().scenario();
    const rows = a.rows, P = a.plan;
    const n = rows.length;
    // The jars' shared scale: the biggest any one of them gets.
    let top = 1;
    for (const r of rows) for (const j of JARS) top = Math.max(top, r.balances[j.key]);
    let idx = Math.max(0, rows.findIndex((r) => r.year >= new Date().getFullYear()));
    let shown = JARS.map((j) => rows[idx].balances[j.key]); // animated levels
    let playing = false, lastStep = 0, raf = 0, closed = false, t0 = performance.now();
    let drops = [];

    const canvas = h('canvas.bk-canvas', { role: 'img', 'aria-label': 'Your accounts as jars of money, year by year' });
    const yearEl = h('div.bk-year');
    const caption = h('div.bk-caption');
    const scrub = h('input.slider', { type: 'range', min: '0', max: String(n - 1), step: '1', value: String(idx), 'aria-label': 'Year' });
    const playBtn = h('button.icon-btn.bk-play', { 'aria-label': 'Play' }, UI.icon('play'));
    const pill = h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name);
    UI.sheet.open({
      title: 'Money buckets',
      body: [
        h('div.x-head', pill),
        h('p.x-note', 'Each jar is an account, on the same scale, in today’s dollars along the typical market. Savings drip in, withdrawals drain out, and Roth conversions pour from pre-tax to Roth.'),
        h('div.bk-box', canvas),
        h('div.bk-controls', playBtn, h('div.bk-scrub', yearEl, scrub)),
        caption,
      ],
      onClose: () => { closed = true; cancelAnimationFrame(raf); },
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });

    const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    let G = null;
    function layout() {
      const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const gap = 12, jw = (W - gap * 5) / 4;
      const jt = 34, jb = H - 70;
      G = { W, H, dpr, jw, jt, jb, x: JARS.map((_, k) => gap + k * (jw + gap)), tray: H - 18 };
    }

    function setYear(i, fromPlay) {
      idx = Math.max(0, Math.min(n - 1, i));
      scrub.value = String(idx);
      scrub.style.setProperty('--fill', (idx / Math.max(1, n - 1) * 100).toFixed(1) + '%');
      const r = rows[idx];
      const ages = [P.people.p1.name + ' ' + r.ages.p1, r.alive && r.alive.p2 === false ? null : P.people.p2.name + ' ' + r.ages.p2].filter(Boolean).join(' · ');
      UI.mount(yearEl, h('b', String(r.year)), h('span', ages), h('span.bk-phase' + (r.retired ? '.ret' : ''), r.retired ? 'Retired' : r.working ? 'Working' : 'Between jobs'));
      const f = flows(r);
      const sum = (o) => Object.values(o).reduce((t, v) => t + v, 0);
      const bits = [];
      if (sum(f.in) > 500) bits.push(`Saved ${fmt.money(sum(f.in))}`);
      if (sum(f.out) > 500) {
        const parts = JARS.filter((j) => f.out[j.key] > 500).map((j) => `${fmt.money(f.out[j.key])} ${j.word}`);
        bits.push(`withdrew ${fmt.money(sum(f.out))} (${parts.join(', ')})`);
      }
      if (f.conv > 500) bits.push(`converted ${fmt.money(f.conv)} to Roth`);
      const tax = r.taxes.federal + r.taxes.state;
      if (tax > 500) bits.push(`income tax ${fmt.money(tax)}`);
      const s = bits.join(', ');
      UI.mount(caption, h('p', s ? s.charAt(0).toUpperCase() + s.slice(1) + '.' : 'A quiet year: savings just grow.'),
        h('p.bk-total', `Total at year end: ${fmt.money(r.balances.total)}`));
      if (fromPlay !== 'silent') spawn(f);
    }

    /** Droplets for this year's flows; more money, more drops. */
    function spawn(f) {
      if (UI.reducedMotion() || !G) return;
      const now = performance.now();
      const count = (v) => Math.min(14, Math.round(Math.sqrt(Math.max(0, v) / top) * 26));
      JARS.forEach((j, k) => {
        const cx = G.x[k] + G.jw / 2;
        for (let d = 0; d < count(f.in[j.key]); d++) drops.push({ kind: 'in', k, x: cx + (Math.random() - 0.5) * G.jw * 0.5, born: now + d * 45 + Math.random() * 120, color: j.color });
        for (let d = 0; d < count(f.out[j.key]); d++) drops.push({ kind: 'out', k, x: cx + (Math.random() - 0.5) * G.jw * 0.25, born: now + d * 50 + Math.random() * 120, color: j.color });
      });
      for (let d = 0; d < count(f.conv); d++) drops.push({ kind: 'conv', k: 0, born: now + d * 55, color: JARS[1].color, jit: (Math.random() - 0.5) * 10 });
    }

    function jarPath(c, x, y0, w, y1) {
      const r = Math.min(18, w * 0.28);
      c.beginPath();
      c.moveTo(x + 4, y0);
      c.lineTo(x + 4, y1 - r);
      c.quadraticCurveTo(x + 4, y1, x + 4 + r, y1);
      c.lineTo(x + w - 4 - r, y1);
      c.quadraticCurveTo(x + w - 4, y1, x + w - 4, y1 - r);
      c.lineTo(x + w - 4, y0);
    }

    function frame(t) {
      raf = 0;
      if (closed) return;
      layout();
      const { W, H, dpr, jw, jt, jb } = G;
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const time = (t - t0) / 1000;
      // Play: one year per step.
      if (playing && t - lastStep > STEP_MS) {
        lastStep = t;
        if (idx >= n - 1) { playing = false; paintPlay(); }
        else setYear(idx + 1, true);
      }
      // Ease the liquid toward this year's balances.
      const target = JARS.map((j) => rows[idx].balances[j.key]);
      let moving = false;
      shown = shown.map((v, k) => { const d = target[k] - v; if (Math.abs(d) > top * 0.0005) moving = true; return UI.reducedMotion() ? target[k] : v + d * 0.12; });
      const lvl = (v) => jb - (Math.max(0, v) / top) * (jb - jt - 6);
      const font = css('--font'), fg = css('--fg'), muted = css('--muted');
      // Tray where withdrawals land: your spending.
      c.fillStyle = css('--inset-2'); c.fillRect(8, G.tray, W - 16, 2);
      c.font = `600 10.5px ${font}`; c.fillStyle = muted; c.textAlign = 'left';
      c.fillText('Spending & taxes', 10, G.tray + 13);
      JARS.forEach((j, k) => {
        const x = G.x[k], y = lvl(shown[k]);
        // Liquid with a moving wave on top
        c.save();
        jarPath(c, x, jt, jw, jb); c.closePath(); c.clip();
        const amp = Math.min(4, 1.2 + (moving ? 2.5 : 0));
        const grad = c.createLinearGradient(0, y, 0, jb);
        grad.addColorStop(0, j.color); grad.addColorStop(1, shade(j.color, 0.45));
        c.fillStyle = grad; c.globalAlpha = 0.9;
        c.beginPath(); c.moveTo(x, jb + 2);
        for (let px = 0; px <= jw; px += 3) c.lineTo(x + px, y + Math.sin(px * 0.11 + time * 2.4 + k) * amp + Math.sin(px * 0.05 - time * 1.3 + k * 2) * amp * 0.6);
        c.lineTo(x + jw, jb + 2); c.closePath(); c.fill();
        // A second, lighter wave behind for depth
        c.globalAlpha = 0.35; c.fillStyle = '#ffffff';
        c.beginPath(); c.moveTo(x, y + 6);
        for (let px = 0; px <= jw; px += 3) c.lineTo(x + px, y + 2 + Math.sin(px * 0.09 - time * 2 + k) * amp * 0.7);
        c.lineTo(x + jw, y + 7); c.closePath(); c.fill();
        // Bubbles
        c.globalAlpha = 0.5; c.fillStyle = '#ffffff';
        for (let b = 0; b < 5; b++) {
          const ph = ((time * (0.25 + b * 0.07) + b * 0.37 + k * 0.21) % 1);
          const by = jb - ph * (jb - y);
          if (by > y + 3) { c.beginPath(); c.arc(x + jw * (0.2 + 0.15 * b) + Math.sin(time * 3 + b) * 2, by, 1.2 + (b % 2), 0, 7); c.fill(); }
        }
        c.restore();
        // Glass
        c.save();
        jarPath(c, x, jt, jw, jb);
        c.strokeStyle = 'rgba(255, 255, 255, 0.35)'; c.lineWidth = 1.5; c.stroke();
        c.globalAlpha = 0.18; c.fillStyle = '#ffffff';
        c.fillRect(x + 9, jt + 8, 3, jb - jt - 26); // the glint
        c.restore();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x, jt - 1, jw, 2);
        // Labels
        c.textAlign = 'center';
        c.font = `650 13px ${font}`; c.fillStyle = fg;
        c.fillText(fmt.money(shown[k]), x + jw / 2, jt - 10);
        c.font = `600 11px ${font}`; c.fillStyle = muted;
        c.fillText(jw < 74 && j.short ? j.short : j.label, x + jw / 2, jb + 16);
      });
      // Droplets
      const now = performance.now();
      drops = drops.filter((d) => {
        const age = (now - d.born) / 1000;
        if (age < 0) return true;
        let x, y, alive = true;
        if (d.kind === 'in') { x = d.x; y = 4 + age * age * 420; alive = y < lvl(shown[d.k]); }
        else if (d.kind === 'out') { x = d.x; y = jb + 4 + age * age * 300; alive = y < G.tray; }
        else { // pre-tax → Roth, over the top
          const k = Math.min(1, age / 0.8), xa = G.x[0] + jw / 2, xb = G.x[1] + jw / 2;
          x = xa + (xb - xa) * k; y = lvl(shown[0]) - Math.sin(Math.PI * k) * (jt + 40) + d.jit * k;
          y = Math.min(y, jb); alive = k < 1;
        }
        if (!alive) return false;
        c.fillStyle = d.color; c.shadowColor = d.color; c.shadowBlur = 8;
        c.beginPath(); c.arc(x, y, d.kind === 'conv' ? 2.6 : 2.2, 0, 7); c.fill(); c.shadowBlur = 0;
        return true;
      });
      raf = requestAnimationFrame(frame);
    }
    function shade(hex, k) {
      const v = parseInt(hex.slice(1), 16);
      const f = (x) => Math.round(x * k);
      return `rgb(${f(v >> 16)}, ${f((v >> 8) & 255)}, ${f(v & 255)})`;
    }
    function paintPlay() {
      UI.mount(playBtn, UI.icon(playing ? 'pause' : 'play'));
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
    playBtn.addEventListener('click', () => {
      playing = !playing;
      if (playing && idx >= n - 1) setYear(0);
      lastStep = performance.now();
      paintPlay();
    });
    scrub.addEventListener('input', () => { playing = false; paintPlay(); setYear(Number(scrub.value)); });
    requestAnimationFrame(() => { layout(); setYear(idx, 'silent'); raf = requestAnimationFrame(frame); });
  };
})(globalThis.RP = globalThis.RP || {});
