/*
 * core.js — tiny helpers every screen uses:
 *   h()        build DOM elements:  h('div.card', { onclick }, 'text', child)
 *   ICONS      thin, consistent line icons (inline SVG, no image files)
 *   fmt        money / percent / year formatting
 *   countTo()  numbers that glide from the old value to the new one
 */
(function (RP) {
  'use strict';

  const UI = (RP.ui = RP.ui || {});

  /**
   * h('tag.class1.class2#id', attrs, ...children)
   * attrs: on* = event listeners, style = object or string, html = innerHTML,
   *        anything else becomes an attribute (false/null = skipped).
   */
  UI.h = function h(sel, attrs, ...kids) {
    const m = String(sel).match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, v) => { if (t === '.') el.classList.add(v); else el.id = v; });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (k) => {
      if (k == null || k === false) return;
      if (Array.isArray(k)) k.forEach(add);
      else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    };
    kids.forEach(add);
    return el;
  };

  /** Replace an element's children. */
  UI.mount = function (el, ...kids) { el.replaceChildren(); kids.flat().forEach((k) => k && el.appendChild(k)); return el; };

  // --- Icons: 24×24, 1.6px strokes, round caps -------------------------------
  const P = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    timeline: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="12" r="2"/><circle cx="6" cy="18" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4M16 14a4 4 0 0 1-4 4H8"/>',
    compare: '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M16 7h3v3"/>',
    plan: '<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    check: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6z"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><path d="M16 14.5h2"/>',
    briefcase: '<rect x="3" y="7" width="18" height="12" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M3 12h18"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    piggy: '<path d="M5 11a6 5 0 0 1 11-2.7h2.5l-.7 2.4A5 5 0 0 1 19 13v2h-2l-1 3h-2.5l-.5-1.5h-3l-.5 1.5H7l-.8-2.6A5 5 0 0 1 5 11z"/><circle cx="15" cy="11" r=".6" fill="currentColor"/>',
    cart: '<path d="M4 5h2l2 10h10l2-7H7"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
    house: '<path d="M4 11 12 4l8 7"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>',
    cap: '<path d="m2.5 9 9.5-4 9.5 4-9.5 4z"/><path d="M6.5 11v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11"/><path d="M21.5 9v5"/>',
    bank: '<path d="M3 9.5 12 5l9 4.5"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7"/><path d="M3 20h18"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="m11 11 8-8M16 6l2.5 2.5M14 8l2 2"/>',
    medical: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M20 20H3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    life: '<path d="M3 12h4l2-5 3 10 2-6 1.5 1H21"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5"/><path d="M5 4h14"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    sliders: '<path d="M6 4v16M12 4v16M18 4v16"/><circle cx="6" cy="14" r="2" fill="var(--card)"/><circle cx="12" cy="8" r="2" fill="var(--card)"/><circle cx="18" cy="16" r="2" fill="var(--card)"/>',
    share: '<path d="M12 4v11M8 8l4-4 4 4"/><path d="M6 12v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
    sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  };
  UI.icon = function (name, cls) {
    const span = document.createElement('span');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
    const svg = span.firstChild;
    if (cls) svg.setAttribute('class', cls);
    return svg;
  };

  // --- Formatting --------------------------------------------------------------
  const fmt = (UI.fmt = {});
  fmt.money = function (v, opts) {
    if (v == null || !isFinite(v)) return '—';
    opts = opts || {};
    const neg = v < 0; const a = Math.abs(v);
    let s;
    if (opts.full) s = '$' + Math.round(a).toLocaleString('en-US');
    else if (a >= 1e6) s = '$' + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    else if (a >= 1e4) s = '$' + Math.round(a / 1e3) + 'K';
    else if (a >= 1e3) s = '$' + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    else s = '$' + Math.round(a);
    return (neg ? '−' : '') + s;
  };
  fmt.pct = (v, d) => (v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d == null ? 0 : d) + '%');
  fmt.num = (v, d) => (v == null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }));
  fmt.monthName = (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(m - 1 + 12) % 12];
  fmt.date = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-').map(Number);
    return `${fmt.monthName(m)} ${d || 1}, ${y}`;
  };

  // --- Motion ------------------------------------------------------------------
  UI.reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Animate a number shown in `el` from its last value to `to`. */
  UI.countTo = function (el, to, format, ms) {
    if (!el) return;
    const from = el._val == null ? to : el._val;
    el._val = to;
    if (el._raf) cancelAnimationFrame(el._raf);
    if (UI.reducedMotion() || from === to || !isFinite(from) || !isFinite(to)) { el.textContent = format(to); return; }
    const dur = ms || 700, t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  };

  /** Light haptic tap where supported (Android); silently ignored elsewhere. */
  UI.haptic = function () { try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* ignore */ } };

  /** Debounce helper. */
  UI.debounce = function (fn, ms) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  };
})(globalThis.RP = globalThis.RP || {});
