/*
 * projection.js — the Home hero chart: one glowing median line over a soft
 * best/worst band, a sun dot at retirement, and scrub-to-read any year.
 * Plain <canvas> (no Chart.js). Redraws only on data, motion, scrub, resize
 * or theme change — never a free-running loop.
 *
 *   const p = UI.projection.create(el, { format, onScrub });
 *   p.update({ years, p50, p10?, p90?, retireYear, retireLabel? });
 *   p.destroy();
 */
(function (RP) {
  'use strict';

  const UI = (RP.ui = RP.ui || {});
  const PAD_T = 28, PAD_B = 22, PAD_X = 6;          // plot insets, CSS px
  const INTRO_MS = 900, MORPH_MS = 350, HOLD_MS = 1200;
  const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10];

  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const reduced = () => (UI.reducedMotion ? UI.reducedMotion() : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));

  // Any CSS colour -> [r,g,b,a], parsed by the canvas itself (hex, rgb, hsl, names).
  const probe = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  function rgb(c) {
    if (cache.has(c)) return cache.get(c);
    probe.fillStyle = '#000'; probe.fillStyle = c;
    const s = String(probe.fillStyle);
    let v = [0, 0, 0, 1];
    if (s[0] === '#') v = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)).concat(1);
    else { const p = s.match(/[\d.]+/g); if (p && p.length >= 3) v = [+p[0], +p[1], +p[2], p[3] == null ? 1 : +p[3]]; }
    cache.set(c, v);
    return v;
  }
  const rgba = (c, a) => { const v = rgb(c); return `rgba(${v[0]},${v[1]},${v[2]},${+(v[3] * a).toFixed(3)})`; };
  const lum = (c) => { const v = rgb(c); return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255; };

  /** Ceiling a little above v, on a 1–1.2–1.5–2… ladder. */
  function nice(v) {
    if (!(v > 0)) return 1;
    const e = Math.pow(10, Math.floor(Math.log10(v)));
    return e * NICE.find((s) => s * e >= v * 0.9999);
  }

  /** Linear sample of series vs at year y (held flat past either end). */
  function sample(ys, vs, y) {
    const n = ys.length;
    if (y <= ys[0]) return vs[0];
    if (y >= ys[n - 1]) return vs[n - 1];
    let i = 1; while (ys[i] < y) i++;
    return lerp(vs[i - 1], vs[i], (y - ys[i - 1]) / (ys[i] - ys[i - 1]));
  }

  /** Two [1,2,1] passes over pixel ys: irons out Monte Carlo jitter, display only.
   *  Dense series only; ends and $0 points (y === base) stay put. */
  function smooth(a, base) {
    if (a.length < 24) return a;
    for (let p = 0; p < 2; p++) a = a.map((v, i) => (i && i < a.length - 1 && v !== base ? (a[i - 1] + 2 * v + a[i + 1]) / 4 : v));
    return a;
  }

  // --- Monotone cubic (Steffen): smooth, never overshoots, so never dips below $0.
  function slopes(xs, ys) {
    const n = xs.length, m = new Float64Array(n), d = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) { const h = xs[i + 1] - xs[i]; d[i] = h ? (ys[i + 1] - ys[i]) / h : 0; }
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) {
      const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], a = d[i - 1], b = d[i];
      const p = (a * h1 + b * h0) / (h0 + h1 || 1);
      m[i] = (Math.sign(a) + Math.sign(b)) * Math.min(Math.abs(a), Math.abs(b), 0.5 * Math.abs(p)) || 0;
    }
    return m;
  }
  function trace(path, xs, ys, m, rev) {
    const seg = (i, j) => { const h = (xs[j] - xs[i]) / 3; path.bezierCurveTo(xs[i] + h, ys[i] + m[i] * h, xs[j] - h, ys[j] - m[j] * h, xs[j], ys[j]); };
    const n = xs.length;
    if (rev) for (let i = n - 1; i > 0; i--) seg(i, i - 1);
    else for (let i = 0; i < n - 1; i++) seg(i, i + 1);
  }
  function at(xs, ys, m, x) {
    const n = xs.length;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const h = xs[hi] - xs[lo], t = (x - xs[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (3 * t2 - 2 * t3) * ys[hi] + (t3 - t2) * h * m[hi];
  }

  // --- Data model --------------------------------------------------------------
  function model(d, prev) {
    const ys = ((d && d.years) || []).map(Number), n = ys.length;
    if (n < 2) return null;
    const num = (a) => (a && a.length === n ? Array.from(a, (x) => Math.max(0, +x || 0)) : null);
    const p50 = num(d.p50) || new Array(n).fill(0), p10 = num(d.p10), p90 = num(d.p90);
    const top = Math.max(...p50) || Math.max(0, ...(p90 || [])) / 2;
    // Keep the current ceiling while the median peak sits at 58–90% of it, so the
    // line visibly rises and falls as sliders move instead of rescaling every tick.
    let yMax = prev && prev.yMax;
    if (!(yMax && top >= yMax * 0.58 && top <= yMax * 0.9)) yMax = nice(top * 1.2);
    const retire = d.retireYear == null ? NaN : +d.retireYear;
    let ri = 0;
    ys.forEach((y, i) => { if (Math.abs(y - retire) < Math.abs(ys[ri] - retire)) ri = i; });
    return { years: ys, p50, p10: p10 || p50, p90: p90 || p50, has10: !!p10, has90: !!p90, band: !!(p10 || p90),
      yMax, d0: ys[0], d1: ys[n - 1], retire, ri, label: (d && d.retireLabel) || '' };
  }
  const resample = (m, U) => {
    const f = (a) => U.map((y) => sample(m.years, a, y));
    return { ...m, years: U, p10: f(m.p10), p50: f(m.p50), p90: f(m.p90) };
  };
  const mix = (a, b, e) => ({ ...b, band: a.band || b.band,
    p10: b.p10.map((v, i) => lerp(a.p10[i], v, e)), p50: b.p50.map((v, i) => lerp(a.p50[i], v, e)), p90: b.p90.map((v, i) => lerp(a.p90[i], v, e)),
    yMax: lerp(a.yMax, b.yMax, e), d0: lerp(a.d0, b.d0, e), d1: lerp(a.d1, b.d1, e),
    retire: isFinite(a.retire) && isFinite(b.retire) ? lerp(a.retire, b.retire, e) : b.retire });
  const same = (a, b) => a.years.length === b.years.length && a.retire === b.retire && a.band === b.band && a.label === b.label &&
    ['years', 'p10', 'p50', 'p90'].every((k) => a[k].every((v, i) => v === b[k][i]));

  // --- Component ---------------------------------------------------------------
  UI.projection = {};
  UI.projection.create = function (box, opts) {
    opts = opts || {};
    const fmt = (v) => (opts.format || (UI.fmt && UI.fmt.money) || ((x) => '$' + Math.round(x)))(v);
    box.classList.add('proj');
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const h = UI.h, abs = { position: 'absolute', top: '0', left: '0', pointerEvents: 'none', whiteSpace: 'nowrap' };
    const cv = h('canvas.proj-canvas', { tabindex: '0', role: 'img', 'aria-label': 'Savings projection',
      style: { display: 'block', width: '100%', height: '100%', touchAction: 'pan-y', userSelect: 'none', webkitUserSelect: 'none', webkitTouchCallout: 'none' } });
    const ry = h('span.proj-readout-y'), rv = h('span.proj-readout-v');
    const readout = h('div.proj-readout', { 'aria-hidden': 'true', style: { ...abs, opacity: '0' } }, ry, rv);
    const live = h('div.proj-sr', { 'aria-live': 'polite', style: { ...abs, width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' } });
    box.append(cv, readout, live);
    const ctx = cv.getContext('2d');

    let tg = null, cur = null, from = null, to = null, anim = null, raf = 0, rev = 1;
    let scrubI = null, holdT = 0, ptr = null;

    // --- Paint ---
    function draw() {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1, bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      readout.style.opacity = scrubI != null && cur ? '1' : '0';
      if (!cur) return;
      const cs = getComputedStyle(box), css = (k, d) => cs.getPropertyValue(k).trim() || d;
      const acc = css('--accent', '#ffb65c'), fg = css('--fg', '#f5f5f7'), muted = css('--muted', 'rgba(235,235,245,.6)');
      const font = css('--font', '-apple-system, system-ui, sans-serif'), lite = lum(fg) < 0.5;
      const L = PAD_X, R = w - PAD_X, T = PAD_T, B = h - PAD_B, span = cur.d1 - cur.d0 || 1;
      const X = (yr) => L + ((yr - cur.d0) / span) * (R - L);
      const Y = (v) => B - (v / cur.yMax) * (B - T);
      const n = cur.years.length, xs = cur.years.map(X), y50 = smooth(cur.p50.map(Y), B), m50 = slopes(xs, y50);
      const revX = rev < 1 ? L + rev * (R - L) : w;
      const clip = (x0, x1, y1) => { ctx.beginPath(); ctx.rect(x0, 0, Math.max(0, x1 - x0), y1); ctx.clip(); };

      // Horizon: the $0 baseline, fading out at both ends.
      const hz = ctx.createLinearGradient(0, 0, w, 0);
      hz.addColorStop(0, rgba(fg, 0)); hz.addColorStop(0.5, rgba(fg, lite ? 0.12 : 0.14)); hz.addColorStop(1, rgba(fg, 0));
      ctx.fillStyle = hz; ctx.fillRect(0, B, w, 1);

      // Best/worst band (p10–p90): no stroke; fades upward so the clipped top never shows an edge.
      if (cur.band) {
        const y90 = smooth(cur.p90.map(Y), B), y10 = smooth(cur.p10.map(Y), B), band = new Path2D();
        band.moveTo(xs[0], y90[0]); trace(band, xs, y90, slopes(xs, y90));
        band.lineTo(xs[n - 1], y10[n - 1]); trace(band, xs, y10, slopes(xs, y10), true); band.closePath();
        const ba = lite ? 0.07 : 0.08, g = ctx.createLinearGradient(0, 0, 0, B);
        g.addColorStop(0, rgba(fg, 0)); g.addColorStop(T / B, rgba(fg, ba * 0.25)); g.addColorStop(0.62, rgba(fg, ba * 0.85)); g.addColorStop(1, rgba(fg, ba));
        ctx.save(); clip(0, revX, B); ctx.fillStyle = g; ctx.fill(band); ctx.restore();
      }

      // Median: gradient wash + one glowing line. Right of the scrub point is dimmed.
      const line = new Path2D();
      line.moveTo(xs[0], y50[0]); trace(line, xs, y50, m50);
      const area = new Path2D(line);
      area.lineTo(xs[n - 1], B); area.lineTo(xs[0], B); area.closePath();
      const wash = ctx.createLinearGradient(0, Math.min(B - 1, ...y50), 0, B);
      wash.addColorStop(0, rgba(acc, lite ? 0.2 : 0.26)); wash.addColorStop(1, rgba(acc, 0));
      const paint = (x0, x1, a) => {
        if (x1 <= x0) return;
        ctx.save(); clip(x0, x1, h); ctx.globalAlpha = a;
        ctx.fillStyle = wash; ctx.fill(area);
        ctx.shadowColor = rgba(acc, lite ? 0.35 : 0.55); ctx.shadowBlur = 12 * dpr;
        ctx.strokeStyle = acc; ctx.lineWidth = 2.25; ctx.lineCap = ctx.lineJoin = 'round'; ctx.stroke(line);
        ctx.restore();
      };
      const sx = scrubI != null ? X(tg.years[scrubI]) : null;
      if (sx == null) paint(0, revX, 1);
      else { paint(0, Math.min(sx, revX), 1); paint(sx, revX, 0.4); }

      const glow = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(acc, a)); g.addColorStop(0.45, rgba(acc, a * 0.35)); g.addColorStop(1, rgba(acc, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      };
      const dot = (x, y, r, c) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };

      // Drawing-in head.
      if (rev < 1) { const hy = at(xs, y50, m50, revX); glow(revX, hy, 10, 0.6 * (1 - rev)); dot(revX, hy, 2.2, rgba(acc, 1 - rev * rev)); }

      // Retirement: a sun on the line, its reflection running down to the horizon.
      ctx.font = `500 11px ${font}`;
      if (isFinite(cur.retire) && cur.retire >= cur.d0 && cur.retire <= cur.d1) {
        const rx = X(cur.retire), ryy = at(xs, y50, m50, rx), a = rev < 1 ? clamp((revX - rx) / 28, 0, 1) : 1;
        if (a > 0) {
          ctx.save(); ctx.globalAlpha = a;
          const rf = ctx.createLinearGradient(0, ryy + 7, 0, B);
          rf.addColorStop(0, rgba(acc, lite ? 0.45 : 0.4)); rf.addColorStop(1, rgba(acc, 0.02));
          ctx.fillStyle = rf; ctx.fillRect(rx - 0.5, ryy + 7, 1, Math.max(0, B - ryy - 7));
          glow(rx, ryy, 30 * a, lite ? 0.1 : 0.16);
          glow(rx, ryy, 14 * (0.5 + 0.5 * a), lite ? 0.45 : 0.6);
          const core = ctx.createRadialGradient(rx - 1.2, ryy - 1.2, 0, rx, ryy, 4.5);
          core.addColorStop(0, lite ? acc : '#fff8ea'); core.addColorStop(0.6, acc); core.addColorStop(1, acc);
          dot(rx, ryy, 4.5 * (0.6 + 0.4 * a), core);
          if (scrubI == null) {
            const cap = tg.label || `Retire ${Math.round(cur.retire)}`, val = fmt(sample(cur.years, cur.p50, cur.retire));
            const cw = ctx.measureText(cap).width;
            ctx.font = `600 13px ${font}`;
            const lw = Math.max(cw, ctx.measureText(val).width), cx = clamp(rx, L + lw / 2, R - lw / 2);
            let ty = ryy - 16 - 30;
            if (ty < 1) ty = Math.min(ryy + 15, B - 32);   // no room above: flip below
            ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillStyle = fg; ctx.fillText(val, cx, ty + 14);
            ctx.font = `500 11px ${font}`; ctx.fillStyle = muted; ctx.fillText(cap, cx, ty);
          }
          ctx.restore();
        }
      }

      // First / last year.
      ctx.save();
      ctx.globalAlpha = rev; ctx.fillStyle = muted; ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left'; ctx.fillText(String(Math.round(cur.d0)), L, h - 5);
      ctx.textAlign = 'right'; ctx.fillText(String(Math.round(cur.d1)), R, h - 5);
      ctx.restore();

      // Scrub: hairline, a bright dot, and the DOM readout above it.
      if (sx != null) {
        const sy = at(xs, y50, m50, sx), hx = Math.round(sx * dpr) / dpr;
        const hl = ctx.createLinearGradient(0, T - 8, 0, B);
        hl.addColorStop(0, rgba(fg, 0.05)); hl.addColorStop(0.2, rgba(fg, 0.35)); hl.addColorStop(1, rgba(fg, 0.3));
        ctx.fillStyle = hl; ctx.fillRect(hx - 0.5, T - 8, 1, B - T + 8);
        glow(sx, sy, 13, lite ? 0.45 : 0.6);
        dot(sx, sy, 5, acc);
        dot(sx, sy, 2.6, lite ? '#fff' : fg);
        ry.textContent = String(tg.years[scrubI]); rv.textContent = fmt(tg.p50[scrubI]);
        const rw = readout.offsetWidth;
        readout.style.transform = `translate3d(${clamp(sx - rw / 2, 0, w - rw).toFixed(1)}px,0,0)`;
      }
    }

    // --- Motion ---
    function frame() {
      raf = 0;
      if (anim) {
        const k = clamp((performance.now() - anim.t0) / anim.dur, 0, 1), e = ease(k);
        if (anim.kind === 'morph') cur = k < 1 ? mix(from, to, e) : tg;
        else rev = k < 1 ? e : 1;
        if (k >= 1) anim = null;
      }
      draw();
      if (anim) raf = requestAnimationFrame(frame);
    }
    const request = () => { if (!raf) raf = requestAnimationFrame(frame); };

    // --- Scrub ---
    const info = (i) => ({ year: tg.years[i], index: i, p50: tg.p50[i], p10: tg.has10 ? tg.p10[i] : null, p90: tg.has90 ? tg.p90[i] : null });
    const emit = () => opts.onScrub && opts.onScrub(scrubI == null ? null : info(scrubI));
    function nearest(yr) {
      let b = 0;
      tg.years.forEach((y, i) => { if (Math.abs(y - yr) < Math.abs(tg.years[b] - yr)) b = i; });
      return b;
    }
    function xToIndex(e) {
      const r = cv.getBoundingClientRect(), L = PAD_X, R = r.width - PAD_X;
      return nearest(cur.d0 + clamp((e.clientX - r.left - L) / (R - L), 0, 1) * (cur.d1 - cur.d0));
    }
    function setScrub(i, say) {
      clearTimeout(holdT); holdT = 0;
      i = clamp(i, 0, tg.years.length - 1);
      if (i !== scrubI) {
        const was = Math.sign(scrubI - tg.ri);
        if (scrubI != null && was && was !== Math.sign(i - tg.ri) && UI.haptic) UI.haptic();   // tick on reaching retirement
        scrubI = i; emit();
      }
      if (say) {
        const x = info(i);
        live.textContent = `${x.year}: ${fmt(x.p50)} expected` + (tg.band ? `, range ${fmt(tg.p10[i])} to ${fmt(tg.p90[i])}` : '');
      }
      request();
    }
    function release(ms) {
      clearTimeout(holdT);
      holdT = setTimeout(() => { holdT = 0; if (scrubI == null) return; scrubI = null; emit(); request(); }, ms);
    }

    const on = (t, f) => cv.addEventListener(t, f);
    on('pointerdown', (e) => {
      if (!tg) return;
      if (e.pointerType === 'mouse') { if (e.button === 0) setScrub(xToIndex(e)); return; }
      ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, live: false };
    });
    on('pointermove', (e) => {
      if (!tg) return;
      if (e.pointerType === 'mouse') { setScrub(xToIndex(e)); return; }
      if (!ptr || e.pointerId !== ptr.id) return;
      if (!ptr.live) {
        const dx = Math.abs(e.clientX - ptr.x0), dy = Math.abs(e.clientY - ptr.y0);
        if (dy > 10 && dy > dx) { ptr = null; return; }   // a vertical swipe: let the page scroll
        if (dx < 6) return;
        ptr.live = true;
      }
      setScrub(xToIndex(e));
    });
    const end = (e) => {
      if (e.pointerType === 'mouse' || !ptr || e.pointerId !== ptr.id) return;
      if (e.type === 'pointerup' && !ptr.live && tg) setScrub(xToIndex(e));   // a tap shows that year
      if (ptr.live || e.type === 'pointerup') release(HOLD_MS);
      ptr = null;
    };
    on('pointerup', end);
    on('pointercancel', end);
    on('pointerleave', (e) => { if (e.pointerType === 'mouse' && scrubI != null) release(250); });
    on('keydown', (e) => {
      if (!tg) return;
      const k = e.key, step = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
      if (k === 'Escape' && scrubI != null) { e.preventDefault(); release(0); return; }
      const j = k === 'Home' ? 0 : k === 'End' ? tg.years.length - 1
        : k === 'ArrowLeft' || k === 'ArrowRight' ? (scrubI == null ? tg.ri : scrubI + step) : null;   // first press lands on retirement
      if (j == null) return;
      e.preventDefault();
      setScrub(j, true);
    });
    on('blur', () => { if (scrubI != null && !holdT) release(HOLD_MS); });

    // --- Size & theme ---
    const ro = new ResizeObserver(() => draw());
    ro.observe(box);
    const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) mq.addEventListener('change', request);
    const mo = new MutationObserver(request);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

    function summary(m) {
      const last = m.years.length - 1, r = m.ri;
      let s = `Savings projection. Expected ${fmt(m.p50[0])} in ${m.years[0]}`;
      if (isFinite(m.retire)) s += `, ${fmt(m.p50[r])} at retirement in ${m.years[r]}`;
      s += `, ${fmt(m.p50[last])} by ${m.years[last]}.`;
      if (m.band) s += ` Likely range in ${m.years[last]}: ${fmt(m.p10[last])} to ${fmt(m.p90[last])}.`;
      return s + ' Use left and right arrow keys to read each year.';
    }

    return {
      update(d) {
        const next = model(d, tg);
        if (!next) { tg = cur = null; anim = null; rev = 1; if (scrubI != null) { scrubI = null; emit(); } cv.setAttribute('aria-label', 'Savings projection'); request(); return; }
        const prev = cur, prevTg = tg;
        tg = next;
        cv.setAttribute('aria-label', summary(tg));
        if (scrubI != null) { scrubI = nearest(prevTg.years[scrubI]); emit(); }
        if (!prev || reduced()) {
          cur = tg; anim = null; rev = 1;
          if (!prev && !reduced()) { rev = 0; anim = { kind: 'intro', t0: performance.now(), dur: INTRO_MS }; }
        } else if (anim && anim.kind === 'intro') {
          cur = tg;                                       // keep drawing in, with the new numbers
        } else if (same(prev, tg)) {
          cur = tg; anim = null;
        } else {
          const U = Array.from(new Set(prev.years.concat(tg.years))).sort((a, b) => a - b);
          from = resample(prev, U); to = resample(tg, U);
          anim = { kind: 'morph', t0: performance.now(), dur: MORPH_MS };
        }
        request();
      },
      destroy() {
        cancelAnimationFrame(raf); clearTimeout(holdT);
        ro.disconnect(); mo.disconnect();
        if (mq) mq.removeEventListener('change', request);
        cv.remove(); readout.remove(); live.remove();
        box.classList.remove('proj');
        tg = cur = anim = null;
      },
    };
  };
})(globalThis.RP = globalThis.RP || {});
