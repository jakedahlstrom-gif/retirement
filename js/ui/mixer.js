/*
 * mixer.js — the Mixer: a mixing desk for your plan.
 *
 * Faders for the big choices (and two things you don't control: returns and
 * how wildly markets swing), pads for on/off "what ifs", a needle gauge for
 * the chance of success and a glowing scope that redraws the typical path
 * while you drag. Nothing touches your plan until you Apply it or save the
 * mix as a scenario.
 *
 * The scope's path comes from a quick worker "lane" (typical market only);
 * the gauge waits for a short Monte Carlo on another lane. Both always run
 * the newest mix, so dragging never queues up stale work.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const E = RP.engine, U = RP.util;
  const store = () => RP.store;
  const MX = (UI.mixer = {});
  const C = () => RP.engineClient;

  // key/P: the plan the desk was built for; start: its own settings; mix: yours;
  // ghost/baseOdds: the plan as it is; path/odds: the latest results for the mix.
  let st = null;
  let els = null;

  const PAD_COLORS = { guard: '#5fe0b0', roth: '#a98bff', care: '#ff8a7a', gift: '#ffd166', crash: '#ff5c7a', lost: '#ffa45c' };
  const PAD_NOTES = {
    guard: 'Spend a little less after a bad stretch',
    roth: 'Move pre-tax money to Roth in low-tax years',
    care: `Long-term care costs late in life`,
    gift: `+${fmt.money(E.MIX_GIFT.amount)} in ${E.MIX_GIFT.inYears} years`,
    crash: 'Markets fall 30% the year you retire',
    lost: 'Ten flat years right after you retire',
  };

  // ------------------------------------------------------------ formatting
  function show(key, v) {
    const P = st.P, R = P.returns;
    if (key === 'age' || key === 'ss' || key === 'life') return String(v);
    if (key === 'spend') return fmt.money(P.spending.retirement * v / 100);
    if (key === 'save') return v === 0 ? '±0' : (v > 0 ? '+' : '−') + fmt.money(Math.abs(v));
    if (key === 'ret') return R.allocation.enabled ? (v === 0 ? '±0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1)) : (R.retired + v).toFixed(1) + '%';
    if (key === 'swing') return R.allocation.enabled ? '×' + v.toFixed(1) : Math.round(R.volatility * v) + '%';
    if (key === 'part') return v ? fmt.money(v) : 'Off';
    return String(v);
  }
  const SUB = { age: 'age', spend: 'a year', save: 'a year', ret: 'return', swing: 'volatility', ss: 'at age', part: '5 years', life: 'age' };
  const LONG = {
    age: 'Retirement age', spend: 'Retirement spending', save: 'Extra saving while working', ret: 'Investment returns', swing: 'Market swings',
    ss: 'Social Security claiming age', part: 'Part-time income after retiring', life: 'Plan to age',
  };

  // ------------------------------------------------------------ the desk
  /** Build (or rebuild) the Mixer for the active plan. Keeps your mix if the plan hasn't changed. */
  MX.build = function () {
    const P = store().activePlan();
    const key = JSON.stringify(P);
    if (!st || st.key !== key) {
      const knobs = E.mixerKnobs(P);
      const start = Object.fromEntries(knobs.faders.map((f) => [f.key, f.value]));
      start.pads = Object.fromEntries(knobs.pads.map((p) => [p.key, p.on]));
      st = { key, P: E.resolvePlan(P), knobs, start, mix: clone(start), ghost: null, baseOdds: null, path: null, odds: null, seq: 0 };
    }
    els = {};
    const card = h('section.card.mixer', { 'aria-label': 'The Mixer' });
    els.gaugeNeedle = h('div.mx-needle');
    els.gaugeVal = h('div.mx-big', '—');
    els.gaugeDelta = h('div.mx-delta');
    els.lines = h('div.mx-lines');
    els.scope = h('canvas.mx-scope', { role: 'img', 'aria-label': 'Typical path of your savings with this mix' });
    els.faders = h('div.mx-faders');
    els.pads = h('div.mx-pads');
    els.reset = h('button.btn', { onclick: () => { st.mix = clone(st.start); paintControls(); recalc(); UI.haptic(); } }, 'Reset');
    els.save = h('button.btn', { onclick: saveScenario, title: 'Save this mix as a new scenario' }, 'Save');
    els.apply = h('button.btn.primary', { onclick: apply }, 'Apply');
    UI.mount(card,
      h('div.mx-head', h('div', h('h2.card-title', 'The Mixer'), h('p.muted.mx-sub', 'Slide anything. Your plan stays put until you apply it.'))),
      h('div.mx-screen',
        h('div.mx-top',
          h('div.mx-gauge', { 'aria-hidden': 'true' }, gaugeFace(), els.gaugeNeedle, h('div.mx-hub')),
          h('div.mx-read', h('div.mx-cap', 'Chance of success'), h('div.mx-bigrow', els.gaugeVal), els.gaugeDelta, els.lines)),
        h('div.mx-scope-box', els.scope)),
      els.faders, h('div.mx-padlabel', 'What ifs'), els.pads,
      h('div.mx-actions', els.reset, els.save, els.apply));
    paintControls();
    // First paint: your plan as the ghost line (and the gauge's starting point), then your mix on top.
    const mine = st;
    if (!st.ghost) C().mixPath(st.P).then((g) => { mine.ghost = g; if (!mine.path) { mine.path = g; lines(g); } if (st === mine) scopeTo(mine.path); }).catch(quiet);
    if (!st.baseOdds) C().mixOdds(st.P).then((o) => { mine.baseOdds = o; if (st === mine && !dirty()) showOdds(o); }).catch(quiet);
    else if (!dirty()) showOdds(st.baseOdds);
    if (dirty()) recalc();
    if (st.path) { lines(st.path); requestAnimationFrame(() => scopeTo(st.path)); }
    return card;
  };

  const clone = (m) => JSON.parse(JSON.stringify(m));
  const quiet = (e) => { if (e && e.message !== 'stale' && e.message !== 'cancelled') console.error(e); };
  function dirty() {
    if (!st) return false;
    return Object.keys(E.mixOverrides(st.P, st.mix)).length > 0;
  }

  function paintControls() {
    UI.mount(els.faders, st.knobs.faders.map((f) => fader(f)));
    UI.mount(els.pads, st.knobs.pads.map((p) => pad(p)));
    paintButtons();
  }
  function paintButtons() {
    const d = dirty();
    for (const b of [els.reset, els.save, els.apply]) b.disabled = !d;
  }

  // ------------------------------------------------------------ fader
  function fader(f) {
    const val = h('div.fd-val');
    const fill = h('div.fd-fill'), cap = h('div.fd-cap', h('i'), h('i'), h('i'));
    const notch = h('div.fd-notch', { title: 'Your plan' });
    const track = h('div.fd-track', {
      role: 'slider', tabindex: '0', 'aria-label': LONG[f.key] || f.label,
      'aria-valuemin': String(f.min), 'aria-valuemax': String(f.max),
    }, h('div.fd-slot', fill), h('div.fd-ticks'), notch, cap);
    const el = h('div.fader', { 'data-key': f.key }, val, track, h('div.fd-label', f.label), h('div.fd-sub', SUB[f.key] || ''));
    const frac = (v) => (v - f.min) / (f.max - f.min);
    const set = (v, quietly) => {
      v = Math.round(U.clamp(v, f.min, f.max) / f.step) * f.step;
      v = Number(v.toFixed(4));
      const changed = st.mix[f.key] !== v;
      st.mix[f.key] = v;
      const k = frac(v);
      track.style.setProperty('--k', k.toFixed(4));
      val.textContent = show(f.key, v);
      track.setAttribute('aria-valuenow', String(v));
      track.setAttribute('aria-valuetext', `${show(f.key, v)} ${SUB[f.key] || ''}`.trim());
      el.classList.toggle('moved', Math.abs(v - st.start[f.key]) > 1e-9);
      if (changed && !quietly) { UI.haptic(); recalc(); }
    };
    notch.style.setProperty('--k', frac(st.start[f.key]).toFixed(4));
    set(st.mix[f.key], true);
    // Drag the cap (it keeps its grip, no jump), or tap the track to send it there.
    // The track itself still lets the page scroll, so a swipe past the desk never moves a fader.
    const fromY = (y) => { const r = track.getBoundingClientRect(); const inner = r.height - 34; return f.min + (1 - (y - r.top - 17) / inner) * (f.max - f.min); };
    cap.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      cap.setPointerCapture(e.pointerId);
      track.classList.add('drag');
      track.focus({ preventScroll: true });
      const r = cap.getBoundingClientRect();
      const grip = e.clientY - (r.top + r.height / 2);
      const move = (ev) => set(fromY(ev.clientY - grip));
      const up = () => { track.classList.remove('drag'); cap.removeEventListener('pointermove', move); cap.removeEventListener('pointerup', up); cap.removeEventListener('pointercancel', up); };
      cap.addEventListener('pointermove', move);
      cap.addEventListener('pointerup', up);
      cap.addEventListener('pointercancel', up);
    });
    track.addEventListener('click', (e) => { if (!cap.contains(e.target)) set(fromY(e.clientY)); });
    track.addEventListener('dblclick', () => set(st.start[f.key]));
    track.addEventListener('keydown', (e) => {
      const big = Math.max(f.step, Math.round((f.max - f.min) / 10 / f.step) * f.step);
      const d = { ArrowUp: f.step, ArrowRight: f.step, ArrowDown: -f.step, ArrowLeft: -f.step, PageUp: big, PageDown: -big }[e.key];
      if (d != null) { e.preventDefault(); set(st.mix[f.key] + d); }
      else if (e.key === 'Home') { e.preventDefault(); set(f.min); }
      else if (e.key === 'End') { e.preventDefault(); set(f.max); }
    });
    return el;
  }

  function pad(p) {
    const b = h('button.pad', { 'aria-pressed': String(!!st.mix.pads[p.key]), style: { '--pad': PAD_COLORS[p.key] || 'var(--accent)' } },
      h('span.pad-led'), h('b', p.label), h('small', PAD_NOTES[p.key] || ''));
    b.addEventListener('click', () => {
      st.mix.pads[p.key] = !st.mix.pads[p.key];
      b.setAttribute('aria-pressed', String(st.mix.pads[p.key]));
      b.classList.remove('hit'); void b.offsetWidth; b.classList.add('hit');
      UI.haptic();
      recalc();
    });
    return b;
  }

  // ------------------------------------------------------------ results
  function mixedPlan() { return E.applyOverrides(st.P, E.mixOverrides(st.P, st.mix)); }

  const recalcOdds = UI.debounce(() => {
    const my = st.seq;
    els.gaugeVal.parentNode.classList.add('busy');
    C().mixOdds(mixedPlan()).then((o) => { if (my === st.seq) showOdds(o); }).catch(quiet);
  }, 140);

  function recalc() {
    paintButtons();
    st.seq++;
    const plan = mixedPlan();
    const mine = st;
    C().mixPath(plan).then((p) => { if (st !== mine) return; st.path = p; scopeTo(p); lines(p); }).catch(quiet);
    if (!dirty()) { if (st.baseOdds) showOdds(st.baseOdds); return; }
    recalcOdds();
  }

  function lines(p) {
    const P = st.P;
    const hz = P.household.horizonPerson;
    const birth = P.people[hz].birthYear;
    const name = P.people[hz].name;
    const fail = p.failYear;
    UI.mount(els.lines,
      fail != null
        ? h('div.mx-line.bad', `Typical market: runs short in ${fail}, when ${name} is ${fail - birth}`)
        : h('div.mx-line.ok', `Typical market: lasts until ${name} is ${p.endYear - birth}`),
      h('div.mx-line', `Retire ${p.retireYear} · ${fmt.money(p.spending)}/yr · ${fmt.money(Math.max(0, p.end))} left`));
  }

  function showOdds(o) {
    st.odds = o;
    const s = o.success;
    els.gaugeVal.parentNode.classList.remove('busy');
    UI.countTo(els.gaugeVal, Math.round(s * 100), (v) => Math.round(v) + '%', 500);
    const target = st.P.sim.successTarget / 100;
    els.gaugeVal.className = 'mx-big ' + (s >= target ? 'ok' : s >= 0.75 ? 'meh' : 'bad');
    // Crossing your target from below lights the screen up for a moment.
    const screen = els.gaugeVal.closest('.mx-screen');
    if (screen && st.lastShown != null && st.lastShown < target && s >= target && !UI.reducedMotion()) {
      screen.classList.remove('win'); void screen.offsetWidth; screen.classList.add('win');
      UI.haptic();
    }
    st.lastShown = s;
    const ang = -90 + 180 * Math.pow(U.clamp(s, 0, 1), 2);
    els.gaugeNeedle.style.transform = `rotate(${ang.toFixed(2)}deg)`;
    if (st.baseOdds && dirty()) {
      const d = Math.round((s - st.baseOdds.success) * 100);
      els.gaugeDelta.textContent = d === 0 ? 'same as plan' : (d > 0 ? '▲ ' : '▼ ') + Math.abs(d) + ' pts';
      els.gaugeDelta.className = 'mx-delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '');
    } else { els.gaugeDelta.textContent = 'your plan'; els.gaugeDelta.className = 'mx-delta'; }
    if (!raf && anim) raf = requestAnimationFrame(frame);
  }

  /** The gauge's face: a 180° arc with zones, ticks and labels (SVG). */
  function gaugeFace() {
    const R = 50, cx = 60, cy = 58;
    const pt = (s, r) => { const a = Math.PI + Math.PI * s * s; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    const arc = (s0, s1, cls) => { const [x0, y0] = pt(s0, R), [x1, y1] = pt(s1, R); return `<path class="${cls}" d="M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}"/>`; };
    const target = (st && st.P.sim.successTarget / 100) || 0.9;
    let ticks = '';
    for (let k = 0; k <= 20; k++) { const s = k / 20; const [x0, y0] = pt(s, R - 7), [x1, y1] = pt(s, R - (k % 5 ? 11 : 15)); ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`; }
    let labels = '';
    for (const s of [0.5, 0.75, 0.9]) { const [x, y] = pt(s, R - 22); labels += `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${Math.round(s * 100)}</text>`; }
    const span = h('span');
    span.innerHTML = `<svg viewBox="0 0 120 66" class="mx-face">${arc(0, 0.75, 'z-bad')}${arc(0.75, target, 'z-meh')}${arc(target, 1, 'z-ok')}<g class="ticks">${ticks}</g><g class="lbl">${labels}</g></svg>`;
    return span.firstChild;
  }

  // ------------------------------------------------------------ the scope
  let anim = null, raf = 0;
  /** Glide the scope from what it shows now to path p (and the latest band). */
  function scopeTo(p) {
    if (!p || !els || !els.scope.isConnected) return;
    const next = { years: p.years, values: p.values.slice(), fail: p.failYear, retire: p.retireYear };
    if (!anim || anim.to.years.length !== next.years.length || UI.reducedMotion()) anim = { from: next, to: next, t0: 0 };
    else anim = { from: frameValues(), to: next, t0: performance.now() };
    if (!raf) raf = requestAnimationFrame(frame);
  }
  function frameValues() {
    if (!anim) return null;
    const k = anim.t0 ? Math.min(1, (performance.now() - anim.t0) / 260) : 1;
    const e = 1 - Math.pow(1 - k, 3);
    return Object.assign({}, anim.to, { values: anim.to.values.map((v, i) => anim.from.values[i] + (v - anim.from.values[i]) * e), k });
  }
  let topNow = null;
  function frame() {
    raf = 0;
    if (!els || !els.scope.isConnected || !anim) return;
    const cur = frameValues();
    const cv = els.scope;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
    const acc = css('--accent') || '#ffb65c';
    const odds = st.odds && st.odds.p90 && st.odds.p90.length === cur.values.length ? st.odds : null;
    const ghost = st.ghost && st.ghost.values;
    const n = cur.values.length;
    // Scale: glides too, so the picture never jumps.
    let want = Math.max(...cur.values, ghost ? Math.max(...ghost) : 0, odds ? Math.max(...odds.p50) * 1.2 : 0, 1e5) * 1.08;
    topNow = topNow == null ? want : topNow + (want - topNow) * 0.22;
    const settling = Math.abs(want - topNow) / want > 0.003;
    const L = 6, Rr = 6, T = 14, B = 18;
    const yEnd = Math.max(cur.years[n - 1], ghost ? st.ghost.years[st.ghost.years.length - 1] : 0);
    const y0 = cur.years[0];
    const X = (yr) => L + (yr - y0) / Math.max(1, yEnd - y0) * (W - L - Rr);
    const Y = (v) => T + (1 - Math.min(v, topNow * 1.2) / topNow) * (H - T - B);
    // Grid
    c.strokeStyle = 'rgba(140, 255, 220, 0.07)'; c.lineWidth = 1;
    for (let g = 1; g < 4; g++) { const y = T + g * (H - T - B) / 4; c.beginPath(); c.moveTo(L, y); c.lineTo(W - Rr, y); c.stroke(); }
    for (let yr = Math.ceil(y0 / 10) * 10; yr <= yEnd; yr += 10) { const x = X(yr); c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - B); c.stroke(); }
    // Labels
    c.fillStyle = 'rgba(220, 235, 255, 0.55)'; c.font = `600 10px ${css('--font')}`;
    c.textAlign = 'left'; c.fillText(fmt.money(topNow), L + 2, T - 3);
    const P = st.P, b1 = P.people.p1.birthYear;
    c.fillText(`${P.people.p1.name} ${y0 - b1}`, L + 2, H - 5);
    c.textAlign = 'right'; c.fillText(String(yEnd - b1), W - Rr - 2, H - 5);
    // Band
    if (odds) {
      const bg = c.createLinearGradient(0, T, 0, H - B);
      bg.addColorStop(0, 'rgba(95, 200, 255, 0.06)'); bg.addColorStop(1, 'rgba(95, 200, 255, 0.2)');
      c.fillStyle = bg;
      c.beginPath();
      odds.p90.forEach((v, i) => { const x = X(cur.years[i]), y = Y(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      for (let i = n - 1; i >= 0; i--) c.lineTo(X(cur.years[i]), Y(odds.p10[i]));
      c.closePath(); c.fill();
      c.strokeStyle = 'rgba(120, 210, 255, 0.35)'; c.lineWidth = 1;
      for (const band of [odds.p10, odds.p90]) { c.beginPath(); band.forEach((v, i) => { const x = X(cur.years[i]), y = Y(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); }
      c.fillStyle = 'rgba(120, 210, 255, 0.7)'; c.textAlign = 'right';
      c.fillText('Likely range', W - Rr - 2, T - 3);
    }
    // Ghost: your plan as it is
    if (ghost && dirty()) {
      c.save(); c.setLineDash([3, 4]); c.strokeStyle = 'rgba(255, 255, 255, 0.35)'; c.lineWidth = 1.25;
      c.beginPath(); ghost.forEach((v, i) => { const x = X(st.ghost.years[i]), y = Y(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke(); c.restore();
    }
    // Retirement marker
    const rx = X(cur.retire);
    c.strokeStyle = 'rgba(255, 255, 255, 0.22)'; c.setLineDash([2, 3]);
    c.beginPath(); c.moveTo(rx, T); c.lineTo(rx, H - B); c.stroke(); c.setLineDash([]);
    // The trace: filled glow, then a bright line with a white core
    const grad = c.createLinearGradient(0, T, 0, H - B);
    grad.addColorStop(0, hexA(acc, 0.32)); grad.addColorStop(1, hexA(acc, 0));
    c.beginPath();
    cur.values.forEach((v, i) => { const x = X(cur.years[i]), y = Y(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.lineTo(X(cur.years[n - 1]), Y(0)); c.lineTo(X(cur.years[0]), Y(0)); c.closePath();
    c.fillStyle = grad; c.fill();
    c.save();
    c.lineJoin = c.lineCap = 'round';
    c.shadowColor = acc; c.shadowBlur = 14; c.strokeStyle = acc; c.lineWidth = 2.6;
    c.beginPath(); cur.values.forEach((v, i) => { const x = X(cur.years[i]), y = Y(v); if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
    c.shadowBlur = 0; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 0.9; c.stroke();
    c.restore();
    if (cur.fail != null) {
      const x = X(cur.fail), y = Y(0);
      c.fillStyle = '#ff5c7a'; c.shadowColor = '#ff5c7a'; c.shadowBlur = 12;
      c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); c.shadowBlur = 0;
    }
    if ((cur.k != null && cur.k < 1) || settling) raf = requestAnimationFrame(frame);
  }
  function hexA(color, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(color);
    if (!m) return `rgba(255, 182, 92, ${a})`;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  MX.repaint = () => { if (els && st && st.path) { if (!raf) raf = requestAnimationFrame(frame); } };

  // ------------------------------------------------------------ keep it
  /** A short name from what moved, e.g. "Retire 55 · $90K · crash". */
  function mixName() {
    const bits = [];
    for (const f of st.knobs.faders) {
      if (Math.abs(st.mix[f.key] - st.start[f.key]) < 1e-9) continue;
      const v = st.mix[f.key];
      bits.push({ age: `retire ${v}`, spend: `spend ${show('spend', v)}`, save: `save ${show('save', v)}`, ret: `returns ${show('ret', v)}`, swing: `swings ${show('swing', v)}`, ss: `SS at ${v}`, part: `part-time ${show('part', v)}`, life: `to ${v}` }[f.key]);
    }
    for (const p of st.knobs.pads) if (!!st.mix.pads[p.key] !== p.on) bits.push((st.mix.pads[p.key] ? '' : 'no ') + p.label.toLowerCase());
    const s = 'Mix: ' + bits.join(', ');
    return s.length > 48 ? s.slice(0, 46) + '…' : s;
  }
  function saveScenario() {
    if (!dirty()) return;
    const o = E.mixOverrides(st.P, st.mix);
    const from = store().state.active;
    const sc = store().addScenario(from, mixName(), o);
    UI.toast(`Saved as scenario “${sc.name}”`, 'Show', () => store().setActive(sc.id));
  }
  function apply() {
    if (!dirty()) return;
    const o = E.mixOverrides(st.P, st.mix);
    const name = store().scenario().name;
    store().setMany(o);
    UI.toast(`Applied to ${name}`, 'Undo', () => store().undo());
  }
})(globalThis.RP = globalThis.RP || {});
