/*
 * projection.js — the Home hero chart: one glowing median line over a soft
 * best/worst band, a sun dot at retirement, a coral mark where the money runs
 * out, and scrub-to-read any year. Plain <canvas> (no Chart.js). The still
 * picture is cached in a second canvas, so a scrub frame is two drawImage()
 * calls and a hairline. Redraws only on data, motion, scrub, resize or theme
 * change — never a free-running loop.
 *
 *   const p = UI.projection.create(el, { format, onScrub, inset?, retireValue? });
 *   p.update({ years, p50, p10?, p90?, retireYear, retireLabel?, runOutLabel? });
 *   p.destroy();
 */
(function (RP) {
  'use strict';

  const UI = (RP.ui = RP.ui || {});
  const PAD_T = 28, PAD_B = 22, PAD_X = 6;          // plot insets, CSS px (the plot is near full-bleed)
  const INTRO_MS = 900, MORPH_MS = 350, HOLD_MS = 1200, PRESS_MS = 120;
  const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 10];
  let uid = 0;

  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  const reduced = () => (UI.reducedMotion ? UI.reducedMotion() : !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches));

  // Any CSS colour (hex, rgb, hsl, names, color(display-p3 …)) -> [r,g,b]: paint one pixel, read it back.
  const probe = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  function rgb(c) {
    let v = cache.get(c);
    if (!v) {
      probe.clearRect(0, 0, 1, 1); probe.fillStyle = '#000'; probe.fillStyle = c; probe.fillRect(0, 0, 1, 1);
      v = Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3));
      cache.set(c, v);
    }
    return v;
  }
  const rgba = (c, a) => { const v = rgb(c); return `rgba(${v[0]},${v[1]},${v[2]},${+a.toFixed(3)})`; };   // c's hue at alpha a
  const whiten = (c, k) => { const v = rgb(c).map((x) => Math.round(lerp(x, 255, k))); return `rgb(${v})`; };
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

  /** Two [1,2,1] passes over pixel ys: irons out Monte Carlo jitter in the
   *  range band (display only; the median line is drawn exactly). Dense series
   *  only; ends and $0 points (y === base) stay put. */
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
  /** Bezier segments from point a to point b (either direction). */
  function trace(path, xs, ys, m, a, b) {
    for (let s = a < b ? 1 : -1, i = a; i !== b; i += s) {
      const j = i + s, h = (xs[j] - xs[i]) / 3;
      path.bezierCurveTo(xs[i] + h, ys[i] + m[i] * h, xs[j] - h, ys[j] - m[j] * h, xs[j], ys[j]);
    }
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
  const glow = (c, x, y, r, a, col) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, a)); g.addColorStop(0.45, rgba(col, a * 0.35)); g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  };
  const dot = (c, x, y, r, col) => { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); };

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
      yMax, d0: ys[0], d1: ys[n - 1], retire, ri, label: d.retireLabel || '', runOut: d.runOutLabel || '' };
  }
  const resample = (m, U) => {
    const f = (a) => U.map((y) => sample(m.years, a, y));
    return { ...m, years: U, p10: f(m.p10), p50: f(m.p50), p90: f(m.p90) };
  };
  const mix = (a, b, e) => ({ ...b, band: a.band || b.band,
    p10: b.p10.map((v, i) => lerp(a.p10[i], v, e)), p50: b.p50.map((v, i) => lerp(a.p50[i], v, e)), p90: b.p90.map((v, i) => lerp(a.p90[i], v, e)),
    yMax: lerp(a.yMax, b.yMax, e), d0: lerp(a.d0, b.d0, e), d1: lerp(a.d1, b.d1, e),
    retire: isFinite(a.retire) && isFinite(b.retire) ? lerp(a.retire, b.retire, e) : b.retire });
  const same = (a, b) => a.years.length === b.years.length && a.retire === b.retire && a.band === b.band && a.label === b.label && a.runOut === b.runOut &&
    ['years', 'p10', 'p50', 'p90'].every((k) => a[k].every((v, i) => v === b[k][i]));

  // --- Component ---------------------------------------------------------------
  UI.projection = {};
  UI.projection.create = function (box, opts) {
    opts = opts || {};
    const fmt = (v) => (opts.format || (UI.fmt && UI.fmt.money) || ((x) => '$' + Math.round(x)))(v);
    box.classList.add('proj');
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const id = 'proj-desc-' + ++uid;
    // A slider over the years: VoiceOver swipes and arrow keys both move it. The focus cue is drawn in the canvas.
    const cv = UI.h('canvas.proj-canvas', { tabindex: '0', role: 'slider', 'aria-label': 'Savings projection by year', 'aria-describedby': id,
      style: { display: 'block', width: '100%', height: '100%', outline: 'none', touchAction: 'pan-y', userSelect: 'none', webkitUserSelect: 'none', webkitTouchCallout: 'none' } });
    const desc = UI.h('div.proj-desc', { id, hidden: true });
    box.append(cv, desc);
    const ctx = cv.getContext('2d'), layer = document.createElement('canvas'), lc = layer.getContext('2d');

    let tg = null, cur = null, from = null, to = null, anim = null, raf = 0, rev = 1, waiting = false, seen = !window.IntersectionObserver;
    let scrubI = null, holdT = 0, pressT = 0, ptr = null, dirty = true, wasScrub = false, g = null;

    // --- Still layer: band, wash, line, sun, run-out mark, retirement label ---
    function paint(w, h, dpr, scrubbing) {
      const c = lc, cs = getComputedStyle(box), css = (k, d) => cs.getPropertyValue(k).trim() || d;
      const acc = css('--accent', '#ffb65c'), fg = css('--fg', '#f5f5f7'), lite = lum(fg) < 0.5;
      // Light mode: the ink accent draws only the stroke and dots; glows and washes use the bright amber.
      const warm = lite ? whiten(css('--accent-glow', '#f59a3c'), 0) : acc;
      const inset = opts.inset != null ? +opts.inset : parseFloat(css('--proj-inset', '20'));
      const L = PAD_X, R = w - PAD_X, T = PAD_T, B = h - PAD_B;
      g = { acc, fg, warm, lite, B, T, inset: isFinite(inset) ? inset : 20, warn: css('--warn', '#ffa08a'),
        muted: css('--muted', 'rgba(235,235,245,.6)'), font: css('--font', '-apple-system, system-ui, sans-serif') };
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const horizon = () => {   // the $0 baseline, fading out at both ends
        const hz = c.createLinearGradient(0, 0, w, 0);
        hz.addColorStop(0, rgba(fg, 0)); hz.addColorStop(0.5, rgba(fg, lite ? 0.12 : 0.14)); hz.addColorStop(1, rgba(fg, 0));
        c.fillStyle = hz; c.fillRect(0, B, w, 1);
      };
      if (!cur) return horizon();   // empty state: just the horizon
      const span = cur.d1 - cur.d0 || 1, X = (yr) => L + ((yr - cur.d0) / span) * (R - L), Y = (v) => B - (v / cur.yMax) * (B - T);
      const n = cur.years.length, xs = cur.years.map(X), y50 = cur.p50.map(Y), m50 = slopes(xs, y50);
      const revX = rev < 1 ? L + rev * (R - L) : w, reveal = (x) => (rev < 1 ? clamp((revX - x) / 28, 0, 1) : 1);
      Object.assign(g, { X, xs, y50, m50 });

      // Fills run out to the canvas edges (held flat past the ends) so the card shows no seam.
      if (rev > 0) {
        if (cur.band) {   // best/worst band: no stroke; white haze in light mode, fades upward so a clipped top shows no edge
          const y90 = smooth(cur.p90.map(Y), B), y10 = smooth(cur.p10.map(Y), B), band = new Path2D();
          band.moveTo(0, y90[0]); band.lineTo(xs[0], y90[0]); trace(band, xs, y90, slopes(xs, y90), 0, n - 1);
          band.lineTo(w, y90[n - 1]); band.lineTo(w, y10[n - 1]); band.lineTo(xs[n - 1], y10[n - 1]);
          trace(band, xs, y10, slopes(xs, y10), n - 1, 0); band.lineTo(0, y10[0]); band.closePath();
          const tint = lite ? '#fff' : fg, ba = lite ? 0.42 : 0.08, gr = c.createLinearGradient(0, 0, 0, B);
          gr.addColorStop(0, rgba(tint, 0)); gr.addColorStop(T / B, rgba(tint, ba * 0.25)); gr.addColorStop(0.62, rgba(tint, ba * 0.85)); gr.addColorStop(1, rgba(tint, ba));
          c.fillStyle = gr; c.fill(band);
        }
        const area = new Path2D();
        area.moveTo(0, B); area.lineTo(0, y50[0]); area.lineTo(xs[0], y50[0]); trace(area, xs, y50, m50, 0, n - 1);
        area.lineTo(w, y50[n - 1]); area.lineTo(w, B); area.closePath();
        const wash = c.createLinearGradient(0, Math.min(B - 1, ...y50), 0, B);
        wash.addColorStop(0, rgba(warm, lite ? 0.3 : 0.26)); wash.addColorStop(1, rgba(warm, 0));
        c.fillStyle = wash; c.fill(area);
        if (rev < 1) {   // drawing in: feather the fills' leading edge
          const mk = c.createLinearGradient(revX - 28, 0, revX, 0);
          mk.addColorStop(0, '#000'); mk.addColorStop(1, 'rgba(0,0,0,0)');
          c.globalCompositeOperation = 'destination-in'; c.fillStyle = mk; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'source-over';
        }
      }
      horizon();

      // The median: amber with a glow while there is money; a quiet coral dotted run once it reaches $0.
      const z = y50.map((y) => y >= B - 0.3), dead = [], runs = [], line = new Path2D();
      for (let i = 0; i < n; i++) dead[i] = z[i] && i > 0 && (dead[i - 1] || !z[i - 1]);
      for (let i = 0, pen = false; i < n - 1; i++) {
        if (dead[i] && z[i + 1]) { pen = false; continue; }
        if (!pen) { line.moveTo(xs[i], y50[i]); pen = true; }
        trace(line, xs, y50, m50, i, i + 1);
      }
      c.save();
      if (rev < 1) { c.beginPath(); c.rect(0, 0, revX, h); c.clip(); }
      c.shadowColor = rgba(warm, lite ? 0.5 : 0.55); c.shadowBlur = 12 * dpr;
      c.strokeStyle = acc; c.lineWidth = 2.25; c.lineCap = c.lineJoin = 'round'; c.stroke(line);
      c.shadowBlur = 0; c.strokeStyle = rgba(g.warn, 0.6); c.lineWidth = 2; c.setLineDash([0.01, 5]);
      for (let i = 1; i < n; i++) {
        if (!dead[i] || dead[i - 1]) continue;
        let j = i; while (j + 1 < n && dead[j + 1]) j++;
        if (j > i) { c.beginPath(); c.moveTo(xs[i], B); c.lineTo(xs[j], B); c.stroke(); }
        runs.push(i); i = j;
      }
      c.restore();

      // Drawing-in head.
      if (rev < 1 && rev > 0) { const hy = at(xs, y50, m50, revX); glow(c, revX, hy, 10, 0.6 * (1 - rev), warm); dot(c, revX, hy, 2.2, rgba(acc, 1 - rev * rev)); }

      // Where the money runs out: a coral dot on the horizon and a short label.
      if (runs.length) {
        const xd = xs[runs[0]], a = reveal(xd), t = tg.runOut || `Runs out by ${Math.round(cur.years[runs[0]])}`;
        if (a > 0) {
          c.save(); c.globalAlpha = a;
          glow(c, xd, B, 11, lite ? 0.3 : 0.4, g.warn); dot(c, xd, B, 3.25, g.warn);
          c.font = `600 11px ${g.font}`;
          const tw = c.measureText(t).width;
          let tx = xd + 9, x = xd;
          if (tx + tw > w - g.inset) {   // no room to its right: tuck it under the falling line instead
            while (x > g.inset && at(xs, y50, m50, x) > B - 21) x--;
            tx = Math.max(g.inset, x - 4 - tw);
          }
          c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = g.warn; c.fillText(t, tx, B - 7);
          c.restore();
        }
      }

      // Retirement: a sun on the line, its reflection running down to the horizon.
      if (isFinite(cur.retire) && cur.retire >= cur.d0 && cur.retire <= cur.d1) {
        const rx = X(cur.retire), ry = at(xs, y50, m50, rx), a = reveal(rx);
        if (a > 0) {
          c.save(); c.globalAlpha = a;
          const rf = c.createLinearGradient(0, ry + 7, 0, B);
          rf.addColorStop(0, rgba(lite ? acc : warm, lite ? 0.35 : 0.4)); rf.addColorStop(1, rgba(warm, 0.02));
          c.fillStyle = rf; c.fillRect(rx - 0.5, ry + 7, 1, Math.max(0, B - ry - 7));
          glow(c, rx, ry, 30 * a, lite ? 0.22 : 0.16, warm);
          glow(c, rx, ry, 14 * (0.5 + 0.5 * a), lite ? 0.55 : 0.6, warm);
          const r = 4.5 * (0.6 + 0.4 * a), core = c.createRadialGradient(rx - 1.2, ry - 1.2, 0, rx, ry, r);
          core.addColorStop(0, lite ? whiten(warm, 0.45) : '#fff8ea'); core.addColorStop(0.6, warm); core.addColorStop(1, warm);
          dot(c, rx, ry, r, core);
          if (lite) { c.strokeStyle = acc; c.lineWidth = 1; c.beginPath(); c.arc(rx, ry, r, 0, 7); c.stroke(); }
          if (!scrubbing) {
            const cap = tg.label || `Retire ${Math.round(cur.retire)}`;
            const val = (opts.retireValue != null ? opts.retireValue : !tg.label) ? fmt(sample(cur.years, cur.p50, cur.retire)) : '';
            c.font = `${val ? 500 : 600} 11px ${g.font}`;
            const cw = c.measureText(cap).width;
            c.font = `600 13px ${g.font}`;
            const lw = Math.max(cw, val ? c.measureText(val).width : 0), cx = clamp(rx, g.inset + lw / 2, w - g.inset - lw / 2), th = val ? 30 : 14;
            let ty = ry - 16 - th;
            for (let k = 0; k <= 4; k++) ty = Math.min(ty, at(xs, y50, m50, cx + lw * (k / 4 - 0.5)) - 9 - th);   // clear the line under a pushed-in label
            if (ty < 1) ty = Math.min(ry + 15, B - th - 2);   // no room above: flip below
            c.textAlign = 'center'; c.textBaseline = 'top';
            if (val) { c.fillStyle = fg; c.fillText(val, cx, ty + 14); }
            c.font = `${val ? 500 : 600} 11px ${g.font}`; c.fillStyle = g.muted; c.fillText(cap, cx, ty);
          }
          c.restore();
        }
      }
    }

    // --- Per frame: the cached layer (dimmed right of the scrub), year labels, hairline ---
    function draw() {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1, bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = layer.width = bw; cv.height = layer.height = bh; dirty = true; }
      const scrubbing = scrubI != null && !!cur;
      if (dirty || scrubbing !== wasScrub) { paint(w, h, dpr, scrubbing); dirty = false; wasScrub = scrubbing; }
      const sx = scrubbing ? g.X(tg.years[scrubI]) : null, cut = sx == null ? bw : clamp(Math.round(sx * dpr), 0, bw);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, bw, bh);
      if (cut > 0) ctx.drawImage(layer, 0, 0, cut, bh, 0, 0, cut, bh);
      if (cut < bw) { ctx.globalAlpha = 0.4; ctx.drawImage(layer, cut, 0, bw - cut, bh, cut, 0, bw - cut, bh); ctx.globalAlpha = 1; }
      if (!cur) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // First / last year, on the card's text inset.
      ctx.globalAlpha = rev; ctx.font = `500 11px ${g.font}`; ctx.fillStyle = g.muted; ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left'; ctx.fillText(String(Math.round(cur.d0)), g.inset, h - 5);
      ctx.textAlign = 'right'; ctx.fillText(String(Math.round(cur.d1)), w - g.inset, h - 5);
      ctx.globalAlpha = 1;

      if (sx == null) return;
      const sy = at(g.xs, g.y50, g.m50, sx), hx = Math.round(sx * dpr) / dpr, out = isOut(scrubI);
      const hl = ctx.createLinearGradient(0, g.T - 8, 0, g.B);
      hl.addColorStop(0, rgba(g.fg, 0.05)); hl.addColorStop(0.2, rgba(g.fg, 0.35)); hl.addColorStop(1, rgba(g.fg, 0.3));
      ctx.fillStyle = hl; ctx.fillRect(hx - 0.5, g.T - 8, 1, g.B - g.T + 8);
      glow(ctx, sx, sy, 13, g.lite ? 0.5 : 0.6, out ? g.warn : g.warm);
      dot(ctx, sx, sy, 5, out ? g.warn : g.acc);
      dot(ctx, sx, sy, 2.6, g.lite ? '#fff' : g.fg);
    }
    const isOut = (i) => tg.p50[i] <= 0 && tg.p50.slice(0, i).some((v) => v > 0);

    // --- Motion ---
    function frame() {
      raf = 0;
      if (anim) {
        const k = clamp((performance.now() - anim.t0) / anim.dur, 0, 1), e = ease(k);
        if (anim.kind === 'morph') cur = k < 1 ? mix(from, to, e) : tg;
        else rev = k < 1 ? e : 1;
        if (k >= 1) anim = null;
        dirty = true;
      }
      draw();
      if (anim) raf = requestAnimationFrame(frame);
    }
    const request = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const repaint = () => { dirty = true; request(); };
    const intro = () => { waiting = false; rev = 0; anim = { kind: 'intro', t0: performance.now(), dur: INTRO_MS }; repaint(); };

    // The draw-in waits until the card is on screen (above the tab bar), so it is actually seen.
    const io = seen ? null : new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting && e.intersectionRatio >= 0.49)) return;
      seen = true; io.disconnect();
      if (waiting) intro();
    }, { threshold: 0.5, rootMargin: '0px 0px -10% 0px' });
    if (io) io.observe(box);

    // --- Scrub ---
    const info = (i) => ({ year: tg.years[i], index: i, p50: tg.p50[i], p10: tg.has10 ? tg.p10[i] : null, p90: tg.has90 ? tg.p90[i] : null });
    const emit = () => opts.onScrub && opts.onScrub(scrubI == null ? null : info(scrubI));
    function aria() {
      if (!tg) { ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'].forEach((a) => cv.removeAttribute(a)); return; }
      const x = info(scrubI == null ? tg.ri : scrubI);
      cv.setAttribute('aria-valuenow', x.year);
      cv.setAttribute('aria-valuetext', `${x.year}: ${fmt(x.p50)} expected` + (x.p10 != null && x.p90 != null && x.p10 !== x.p90 ? `, likely ${fmt(x.p10)} to ${fmt(x.p90)}` : ''));
    }
    function nearest(yr) {
      let b = 0;
      tg.years.forEach((y, i) => { if (Math.abs(y - yr) < Math.abs(tg.years[b] - yr)) b = i; });
      return b;
    }
    function xToIndex(clientX) {
      const r = cv.getBoundingClientRect(), L = PAD_X, R = r.width - PAD_X;
      return nearest(cur.d0 + clamp((clientX - r.left - L) / (R - L), 0, 1) * (cur.d1 - cur.d0));
    }
    function setScrub(i) {
      clearTimeout(holdT); holdT = 0;
      i = clamp(i, 0, tg.years.length - 1);
      if (i === scrubI) return;
      const was = Math.sign(scrubI - tg.ri);
      if (scrubI != null && was && was !== Math.sign(i - tg.ri) && UI.haptic) UI.haptic();   // tick on reaching retirement
      scrubI = i; emit(); aria(); request();
    }
    function release(ms) {
      clearTimeout(holdT);
      holdT = setTimeout(() => { holdT = 0; if (scrubI == null) return; scrubI = null; emit(); if (tg) aria(); request(); }, ms);
    }

    const on = (t, f) => cv.addEventListener(t, f);
    on('pointerdown', (e) => {
      if (!tg) return;
      if (e.pointerType === 'mouse') { if (e.button === 0) setScrub(xToIndex(e.clientX)); return; }
      clearTimeout(pressT);
      ptr = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, live: false };
      pressT = setTimeout(() => { if (ptr && !ptr.live && tg) { ptr.live = true; setScrub(xToIndex(ptr.x)); } }, PRESS_MS);   // press and hold
    });
    on('pointermove', (e) => {
      if (!tg) return;
      if (e.pointerType === 'mouse') { setScrub(xToIndex(e.clientX)); return; }
      if (!ptr || e.pointerId !== ptr.id) return;
      ptr.x = e.clientX;
      if (!ptr.live) {
        const dx = Math.abs(e.clientX - ptr.x0), dy = Math.abs(e.clientY - ptr.y0);
        if (dy > 10 && dy > dx) { clearTimeout(pressT); ptr = null; return; }   // a vertical swipe: let the page scroll
        if (dx < 6) return;
        clearTimeout(pressT); ptr.live = true;
      }
      setScrub(xToIndex(e.clientX));
    });
    const end = (e) => {
      if (e.pointerType === 'mouse' || !ptr || e.pointerId !== ptr.id) return;
      clearTimeout(pressT);
      if (e.type === 'pointercancel') { if (ptr.live) release(0); }   // the page took the gesture (a scroll): let go at once
      else { if (!ptr.live && tg) setScrub(xToIndex(e.clientX)); release(HOLD_MS); }   // a tap shows that year
      ptr = null;
    };
    on('pointerup', end);
    on('pointercancel', end);
    on('pointerleave', (e) => { if (e.pointerType === 'mouse' && scrubI != null) release(250); });
    on('keydown', (e) => {
      if (!tg || e.altKey || e.metaKey || e.ctrlKey) return;
      const k = e.key, s = e.shiftKey ? 5 : 1;
      if (k === 'Escape') { if (scrubI != null) { e.preventDefault(); release(0); } return; }
      const step = { ArrowRight: s, ArrowUp: s, ArrowLeft: -s, ArrowDown: -s, PageUp: 5, PageDown: -5 }[k];
      const j = k === 'Home' ? 0 : k === 'End' ? tg.years.length - 1 : step ? (scrubI == null ? tg.ri : scrubI) + step : null;
      if (j == null) return;
      e.preventDefault();
      setScrub(j);
    });
    // Keyboard focus shows the cursor at retirement (the focus cue); focus from a tap or click does not.
    on('focus', () => { let kb = false; try { kb = cv.matches(':focus-visible'); } catch (x) { /* old engine */ } if (kb && tg && scrubI == null) setScrub(tg.ri); });
    on('blur', () => { if (scrubI != null && !holdT) release(300); });

    // --- Size & theme ---
    const ro = new ResizeObserver(() => { dirty = true; draw(); });
    ro.observe(box);
    const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
    if (mq) mq.addEventListener('change', repaint);
    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-scene', 'class', 'style'] });

    function summary(m) {
      const last = m.years.length - 1, r = m.ri;
      let s = `Expected ${fmt(m.p50[0])} in ${m.years[0]}`;
      if (isFinite(m.retire)) s += `, ${fmt(m.p50[r])} at retirement in ${m.years[r]}`;
      s += `, ${fmt(m.p50[last])} by ${m.years[last]}.`;
      if (m.band) s += ` Likely range in ${m.years[last]}: ${fmt(m.p10[last])} to ${fmt(m.p90[last])}.`;
      const o = m.p50.findIndex((v, i) => i > 0 && v <= 0 && m.p50[i - 1] > 0);
      return o > 0 ? s + ` Savings reach $0 by ${m.years[o]}.` : s;
    }

    return {
      update(d) {
        const next = model(d, tg);
        if (next && tg && same(tg, next)) return;   // nothing new: leave any running animation alone
        if (!next) {
          tg = cur = null; anim = null; rev = 1; waiting = false;
          if (scrubI != null) { scrubI = null; emit(); }
          desc.textContent = ''; aria(); repaint(); return;
        }
        const prev = cur, prevTg = tg;
        tg = next;
        desc.textContent = summary(tg);
        cv.setAttribute('aria-valuemin', tg.years[0]); cv.setAttribute('aria-valuemax', tg.years[tg.years.length - 1]);
        if (scrubI != null) { scrubI = nearest(prevTg.years[scrubI]); emit(); }
        aria();
        if (!prev || reduced()) {
          cur = tg; anim = null; rev = 1;
          if (!prev && !reduced()) { rev = 0; if (seen) intro(); else waiting = true; }
        } else if (waiting || (anim && anim.kind === 'intro')) {
          cur = tg;                                       // keep drawing in (or waiting to), with the new numbers
        } else {
          const U = Array.from(new Set(prev.years.concat(tg.years))).sort((a, b) => a - b);
          from = resample(prev, U); to = resample(tg, U);
          anim = { kind: 'morph', t0: performance.now(), dur: MORPH_MS };
        }
        repaint();
      },
      destroy() {
        cancelAnimationFrame(raf); clearTimeout(holdT); clearTimeout(pressT);
        ro.disconnect(); mo.disconnect(); if (io) io.disconnect();
        if (mq) mq.removeEventListener('change', repaint);
        cv.remove(); desc.remove();
        box.classList.remove('proj');
        tg = cur = anim = null;
      },
    };
  };
})(globalThis.RP = globalThis.RP || {});
