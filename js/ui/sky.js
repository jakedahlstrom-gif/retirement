/*
 * sky.js — "The Horizon": the full-screen sky the whole app lives under.
 *
 * The time of day follows how close retirement is, using the same countdown
 * the Home screen shows (months until Jan 1 of the retirement year):
 *   30+ years away  → pre-dawn indigo with faint stars
 *   15 years away   → the sun cresting the horizon
 *   0 / retired     → warm golden hour
 *
 * Sky.set(progress) glides there. Calling it again mid-glide (e.g. while a
 * slider is dragged) just retargets the glide, so the sky follows in real
 * time. Purely visual: it only reads results, it never changes them.
 *
 * Scenes (html[data-scene]) repaint the same journey differently: Aurora's
 * northern lights strengthen, Synthwave's neon sun rises over the grid, and
 * Nebula's star rises over a planet's rim.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h;
  const Sky = (UI.sky = {});

  /** Years-to-go that count as "the start of the day" (deep pre-dawn). */
  Sky.SPAN_YEARS = 30;

  // ------------------------------------------------------------ palettes
  // Each keyframe: [progress, { sky gradient (top → horizon), glow around the
  // sun, sea gradient, sun colors, sun lift (-1 below … 0 on the horizon … 1
  // high), star and water-reflection strength }]. The upper sky stays deep
  // at every hour so white text on it is always readable.
  const DARK = [
    [0.00, { top: '#03040b', mid: '#070a1c', low: '#0e1236', hz: '#1a1e4a', glow: '#3a3a8c', glowA: 0.16, seaTop: '#0a0d24', seaBot: '#020309', sun: '#ff9d5c', halo: '#ff8a4c', lift: -1.25, stars: 1, reflect: 0 }],
    [0.25, { top: '#04061a', mid: '#0b1032', low: '#1c2156', hz: '#3a3474', glow: '#6c4aa8', glowA: 0.24, seaTop: '#12163a', seaBot: '#03040c', sun: '#ff9a5a', halo: '#ff8048', lift: -0.62, stars: 0.8, reflect: 0.04 }],
    [0.42, { top: '#060920', mid: '#121747', low: '#33296a', hz: '#a35a72', glow: '#ff7f6a', glowA: 0.32, seaTop: '#241d46', seaBot: '#04050e', sun: '#ffa060', halo: '#ff8a4c', lift: -0.18, stars: 0.42, reflect: 0.22 }],
    [0.50, { top: '#070a24', mid: '#151a4e', low: '#40306e', hz: '#cf7262', glow: '#ff8f66', glowA: 0.40, seaTop: '#2e2248', seaBot: '#04050f', sun: '#ffac66', halo: '#ff9452', lift: 0, stars: 0.26, reflect: 0.42 }],
    [0.68, { top: '#090e2b', mid: '#1b2256', low: '#563a72', hz: '#ef8a5c', glow: '#ffa066', glowA: 0.46, seaTop: '#3a2a4c', seaBot: '#05060f', sun: '#ffbb70', halo: '#ffa058', lift: 0.18, stars: 0.06, reflect: 0.7 }],
    [0.85, { top: '#0b1231', mid: '#212c62', low: '#5e4170', hz: '#ffa25a', glow: '#ffae62', glowA: 0.42, seaTop: '#48324c', seaBot: '#06070f', sun: '#ffc477', halo: '#ffac5c', lift: 0.3, stars: 0, reflect: 0.86 }],
    [1.00, { top: '#0d1534', mid: '#28346c', low: '#6a4568', hz: '#ffb257', glow: '#ffb85e', glowA: 0.44, seaTop: '#573a48', seaBot: '#07070f', sun: '#ffcf80', halo: '#ffb35e', lift: 0.4, stars: 0, reflect: 1 }],
  ];
  // Light mode: a daytime sky. Still deep enough at the top for white text.
  const LIGHT = [
    [0.00, { top: '#1c3970', mid: '#2f5596', low: '#4a68a6', hz: '#d8c4d4', glow: '#ffd9c4', glowA: 0.2, seaTop: '#3d5a8c', seaBot: '#16294f', sun: '#fff1dc', halo: '#ffd2a8', lift: 0.06, stars: 0, reflect: 0.3 }],
    [0.50, { top: '#174789', mid: '#28609f', low: '#3669a8', hz: '#d9e9f5', glow: '#fff3da', glowA: 0.22, seaTop: '#285a8e', seaBot: '#14365f', sun: '#fffaf0', halo: '#ffe6bd', lift: 0.22, stars: 0, reflect: 0.45 }],
    [1.00, { top: '#1f4683', mid: '#335d97', low: '#615b8a', hz: '#ffd49a', glow: '#ffc778', glowA: 0.3, seaTop: '#6a5468', seaBot: '#1f3459', sun: '#ffe7b8', halo: '#ffbf6a', lift: 0.4, stars: 0, reflect: 0.6 }],
  ];
  // Other scenes (Appearance › Scene). Always dark. `fx` is the scene's own
  // effect, growing as retirement nears: aurora strength, neon grid glow,
  // the planet's sunrise rim.
  const AURORA = [
    [0.00, { top: '#01040b', mid: '#030b1c', low: '#06182c', hz: '#0b2a3a', glow: '#1fa98a', glowA: 0.10, seaTop: '#071822', seaBot: '#010409', sun: '#dfeeff', halo: '#9fd8ff', lift: 0.55, stars: 1, reflect: 0.25, fx: 0.25 }],
    [0.50, { top: '#020611', mid: '#051428', low: '#0a2438', hz: '#10374a', glow: '#2be0a8', glowA: 0.16, seaTop: '#0a2230', seaBot: '#02060c', sun: '#e8f4ff', halo: '#a8e6ff', lift: 0.62, stars: 0.9, reflect: 0.4, fx: 0.6 }],
    [1.00, { top: '#030817', mid: '#071a33', low: '#0d2f45', hz: '#16485a', glow: '#5cffc8', glowA: 0.22, seaTop: '#0c2a38', seaBot: '#02070d', sun: '#f2f8ff', halo: '#b8f0ff', lift: 0.7, stars: 0.8, reflect: 0.6, fx: 1 }],
  ];
  const SYNTH = [
    [0.00, { top: '#06021a', mid: '#160636', low: '#3a0f5e', hz: '#7a1b8c', glow: '#ff2bd6', glowA: 0.18, seaTop: '#12042a', seaBot: '#030008', sun: '#ffd319', halo: '#ff2975', lift: -0.7, stars: 0.9, reflect: 0.1, fx: 0.35 }],
    [0.50, { top: '#0a0322', mid: '#220842', low: '#56157a', hz: '#c2268f', glow: '#ff3fbf', glowA: 0.3, seaTop: '#1a0636', seaBot: '#04010b', sun: '#ffd84a', halo: '#ff4f8e', lift: 0, stars: 0.6, reflect: 0.4, fx: 0.7 }],
    [1.00, { top: '#0d0428', mid: '#2c0a4e', low: '#7a1c86', hz: '#ff4fa3', glow: '#ff6ad5', glowA: 0.42, seaTop: '#240842', seaBot: '#05010d', sun: '#ffe066', halo: '#ff6a8a', lift: 0.45, stars: 0.35, reflect: 0.8, fx: 1 }],
  ];
  const NEBULA = [
    [0.00, { top: '#020108', mid: '#070416', low: '#110a2a', hz: '#1c1240', glow: '#5a3bd1', glowA: 0.14, seaTop: '#090614', seaBot: '#020106', sun: '#ffd9a8', halo: '#ff9d6b', lift: -1, stars: 1, reflect: 0, fx: 0.15 }],
    [0.50, { top: '#03020b', mid: '#0a061c', low: '#170d36', hz: '#271a55', glow: '#7a52ff', glowA: 0.2, seaTop: '#0c0819', seaBot: '#020107', sun: '#ffe2b8', halo: '#ffae7a', lift: -0.4, stars: 1, reflect: 0, fx: 0.55 }],
    [1.00, { top: '#04030e', mid: '#0d0822', low: '#1f1142', hz: '#3a2470', glow: '#9a7bff', glowA: 0.26, seaTop: '#100a20', seaBot: '#020108', sun: '#fff0d6', halo: '#ffc28a', lift: 0.1, stars: 1, reflect: 0, fx: 1 }],
  ];
  const COLOR_KEYS = ['top', 'mid', 'low', 'hz', 'glow', 'seaTop', 'seaBot', 'sun', 'halo'];
  const NUM_KEYS = ['glowA', 'lift', 'stars', 'reflect', 'fx'];

  // Colors blend in OKLab so dusk never passes through muddy gray.
  function hexToLab(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363288241 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function labToRgb([L, A, B]) {
    const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
    const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
    const s = Math.pow(L - 0.0894841775 * A - 1.291485548 * B, 3);
    const enc = (c) => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };
    return [enc(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), enc(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), enc(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  const prep = (frames) => frames.map(([p, c]) => {
    const o = { p };
    for (const k of COLOR_KEYS) o[k] = hexToLab(c[k]);
    for (const k of NUM_KEYS) o[k] = c[k] == null ? p : c[k];
    return o;
  });
  const PAL = { dark: prep(DARK), light: prep(LIGHT), aurora: prep(AURORA), synthwave: prep(SYNTH), nebula: prep(NEBULA) };
  /** The scenes, for the Appearance picker. Horizon follows light/dark; the rest are night scenes. */
  Sky.SCENES = [
    { key: 'horizon', label: 'Horizon', sub: 'Dawn to golden hour over the sea' },
    { key: 'aurora', label: 'Aurora', sub: 'Northern lights that grow brighter' },
    { key: 'synthwave', label: 'Synthwave', sub: 'A neon sun rising over the grid' },
    { key: 'nebula', label: 'Nebula', sub: 'Deep space and a planet’s sunrise' },
  ];
  const scene = () => document.documentElement.dataset.scene || 'horizon';

  function sample(frames, p) {
    let i = 1;
    while (i < frames.length - 1 && frames[i].p < p) i++;
    const a = frames[i - 1], b = frames[i];
    const t = Math.min(1, Math.max(0, (p - a.p) / (b.p - a.p || 1)));
    const e = t * t * (3 - 2 * t); // smoothstep between keyframes
    const out = {};
    for (const k of COLOR_KEYS) out[k] = labToRgb(a[k].map((v, j) => v + (b[k][j] - v) * e));
    for (const k of NUM_KEYS) out[k] = a[k] + (b[k] - a[k]) * e;
    return out;
  }

  // ------------------------------------------------------------- the scene
  let el = null, stars = null, cur = null, target = 0.4, raf = 0, last = 0;
  const rgb = (c, a) => (a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
  const isLight = () => {
    const t = document.documentElement.dataset.theme;
    if (t === 'light') return true;
    if (t === 'dark') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  };

  /** Deterministic star field (same sky every launch). */
  function starLayer(seed, count, w, hgt, size, alpha) {
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const pts = [];
    for (let i = 0; i < count; i++) {
      const y = Math.pow(rnd(), 1.5) * hgt; // denser toward the top
      pts.push(`${Math.round(rnd() * w)}px ${Math.round(y)}px 0 0 rgba(255,255,255,${(alpha * (0.45 + rnd() * 0.55)).toFixed(2)})`);
    }
    return h('span.star', { style: { width: size + 'px', height: size + 'px', boxShadow: pts.join(',') } });
  }
  function layoutStars() {
    if (!stars) return;
    const w = Math.max(320, window.innerWidth), hz = Math.max(260, window.innerHeight * 0.5);
    const dense = Math.min(2.2, w / 390);
    UI.mount(stars,
      starLayer(7, Math.round(46 * dense), w, hz, 1, 0.9),
      starLayer(131, Math.round(26 * dense), w, hz, 1.5, 0.85),
      starLayer(977, Math.round(9 * dense), w, hz, 2, 0.95));
  }
  function layoutSun() {
    if (!el) return;
    const w = window.innerWidth;
    el.style.setProperty('--sun-x', Math.round(Math.min(w * 0.84, w / 2 + 230)) + 'px');
  }

  function paint(p) {
    if (!el) return;
    const sc = scene();
    const c = sample(sc !== 'horizon' && PAL[sc] ? PAL[sc] : isLight() ? PAL.light : PAL.dark, p);
    const st = el.style;
    st.setProperty('--sky-top', rgb(c.top));
    st.setProperty('--sky-mid', rgb(c.mid));
    st.setProperty('--sky-low', rgb(c.low));
    st.setProperty('--sky-hz', rgb(c.hz));
    st.setProperty('--sky-glow', rgb(c.glow, c.glowA.toFixed(3)));
    st.setProperty('--sea-top', rgb(c.seaTop));
    st.setProperty('--sea-bot', rgb(c.seaBot));
    st.setProperty('--sun-core', rgb(c.sun));
    st.setProperty('--sun-halo', rgb(c.halo, 0.55));
    st.setProperty('--sun-lift', c.lift.toFixed(4));
    st.setProperty('--stars', c.stars.toFixed(3));
    st.setProperty('--reflect', c.reflect.toFixed(3));
    st.setProperty('--fx', c.fx.toFixed(3));
    Sky._top = rgb(c.top);
  }

  /** Browser chrome (Android status bar, desktop PWA title bar) matches the sky. */
  function settle() {
    const m = document.querySelector('meta[name="theme-color"]:not([media])') || document.querySelector('meta[name="theme-color"]');
    if (m && Sky._top) m.setAttribute('content', Sky._top);
    document.documentElement.style.setProperty('--sky-top-now', Sky._top || '');
  }

  function tick(t) {
    const dt = Math.min(64, t - (last || t));
    last = t;
    const k = 1 - Math.exp(-dt / 420);
    cur += (target - cur) * k;
    if (Math.abs(target - cur) < 0.0007) cur = target;
    paint(cur);
    if (cur !== target) raf = requestAnimationFrame(tick);
    else { raf = 0; last = 0; settle(); }
  }

  /** Glide to a progress between 0 (start of the journey) and 1 (retirement). */
  Sky.set = function (p, opts) {
    target = Math.min(1, Math.max(0, Number(p) || 0));
    Sky.progress = target;
    if (!el) return;
    if (cur == null || (opts && opts.instant) || UI.reducedMotion()) {
      cur = target;
      if (raf) { cancelAnimationFrame(raf); raf = 0; last = 0; }
      paint(cur); settle();
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  };

  /** Months from today to Jan 1 of the retirement year (same as the Home countdown). */
  Sky.monthsUntil = function (retireYear) {
    const now = new Date();
    const target = new Date(retireYear, 0, 1);
    let months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
    if (target.getDate() < now.getDate()) months--;
    return months;
  };
  /** 30+ years to go → 0, 15 → 0.5, retired → 1. */
  Sky.progressFor = (months) => Math.min(1, Math.max(0, 1 - months / (Sky.SPAN_YEARS * 12)));

  /** Build the scene once. It starts in deep pre-dawn and rises to the plan. */
  Sky.mount = function () {
    if (el) return el;
    stars = h('div.sky-stars');
    // Scene layers: each scene's CSS shows only its own.
    const aurora = h('div.sky-aurora', h('span.au.au1'), h('span.au.au2'), h('span.au.au3'));
    const nebula = h('div.sky-nebula', h('span.nb.nb1'), h('span.nb.nb2'), h('span.nb.nb3'));
    el = h('div.sky', { 'aria-hidden': 'true' },
      h('div.sky-air', stars, nebula, aurora, h('div.sky-glow'), h('div.sky-sun')),
      h('div.sky-sea', h('div.sea-drift'), h('div.sea-reflect', h('div.sea-glint')), h('div.sky-grid')),
      h('div.sky-ridge'), h('div.sky-planet'),
      h('div.sky-line'));
    document.body.prepend(el);
    layoutStars(); layoutSun();
    cur = UI.reducedMotion() ? null : 0;
    paint(cur == null ? target : cur);
    window.addEventListener('resize', UI.debounce(() => { layoutStars(); layoutSun(); }, 200));
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', Sky.repaint);
    return el;
  };

  /** Redraw at the current hour (after a light/dark switch). */
  Sky.repaint = function () { paint(cur == null ? target : cur); settle(); };
})(globalThis.RP = globalThis.RP || {});
