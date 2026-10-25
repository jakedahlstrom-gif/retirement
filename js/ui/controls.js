/*
 * controls.js — reusable controls:
 *   sheet.open({ title, body, actions })  frosted bottom sheet (swipe down to close)
 *   tipButton(key)                        ⓘ that explains a concept in plain English
 *   toggle({ checked, onChange })         iOS-style switch
 *   segmented({ options, value, onChange })
 *   numberEditor({ value, min, max, step, format, onChange })  slider + field + steppers
 *   toast(text, actionLabel, action)
 *   expand({ title, summary, body })        tap-to-expand card
 */
(function (RP) {
  'use strict';

  const UI = RP.ui;
  const h = UI.h;

  // ---- Bottom sheet -----------------------------------------------------------
  const sheet = (UI.sheet = {});
  let scrim, el, current = null;
  function ensure() {
    if (el) return;
    scrim = h('div.scrim', { onclick: () => sheet.close() });
    el = h('div.sheet', { role: 'dialog', 'aria-modal': 'true' });
    document.body.append(scrim, el);
    // Swipe down on the handle/header to close.
    let startY = null, dy = 0;
    const down = (e) => {
      if (!e.target.closest('.sheet-grab, .sheet-head') || e.target.closest('button')) return;
      startY = (e.touches ? e.touches[0] : e).clientY; dy = 0; el.classList.add('dragging');
    };
    const move = (e) => {
      if (startY == null) return;
      dy = Math.max(0, (e.touches ? e.touches[0] : e).clientY - startY);
      el.style.transform = `translateY(${dy}px)`;
    };
    const up = () => {
      if (startY == null) return;
      el.classList.remove('dragging'); el.style.transform = '';
      if (dy > 90) sheet.close();
      startY = null;
    };
    el.addEventListener('touchstart', down, { passive: true });
    el.addEventListener('touchmove', move, { passive: true });
    el.addEventListener('touchend', up);
    el.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }
  /**
   * opts: { title, body: Node|Node[], actions: [{ label, primary, danger, onClick }], onClose,
   *         overLock (shows above the PIN lock screen) }
   */
  sheet.open = function (opts) {
    ensure();
    if (current && current.onClose) current.onClose();
    current = opts;
    el.classList.toggle('over-lock', !!opts.overLock);
    scrim.classList.toggle('over-lock', !!opts.overLock);
    const body = h('div.sheet-body', opts.body);
    const kids = [
      h('div.sheet-grab', h('span')),
      h('div.sheet-head',
        h('h3', opts.title || ''),
        h('button.icon-btn', { 'aria-label': 'Close', onclick: () => sheet.close() }, UI.icon('close'))),
      body,
    ];
    if (opts.actions && opts.actions.length) {
      kids.push(h('div.sheet-actions', opts.actions.map((a) =>
        h('button.btn' + (a.primary ? '.primary' : '') + (a.danger ? '.danger' : ''), { onclick: () => a.onClick && a.onClick() }, a.label))));
    }
    UI.mount(el, kids);
    requestAnimationFrame(() => { scrim.classList.add('open'); el.classList.add('open'); });
    return body;
  };
  sheet.close = function () {
    if (!el) return;
    scrim.classList.remove('open'); el.classList.remove('open');
    const c = current; current = null;
    if (c && c.onClose) c.onClose();
    if (document.activeElement && el.contains(document.activeElement)) document.activeElement.blur();
  };
  sheet.isOpen = () => !!current;

  // ---- ⓘ tips -----------------------------------------------------------------
  UI.tipButton = function (key, titleOverride) {
    const tip = (RP.TIPS || {})[key];
    if (!tip) return null;
    return h('button.tip', {
      'aria-label': 'Explain ' + (tip.title || key),
      onclick: (e) => {
        e.stopPropagation();
        sheet.open({ title: titleOverride || tip.title, body: [h('p.tip-text', tip.text), tip.more ? h('p.tip-text.muted', tip.more) : null] });
      },
    }, UI.icon('info'));
  };

  // ---- Toggle -----------------------------------------------------------------
  UI.toggle = function ({ checked, onChange, label }) {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label || 'Toggle', checked: !!checked });
    input.addEventListener('change', () => { UI.haptic(); onChange && onChange(input.checked); });
    return h('label.toggle', input, h('span.track'), h('span.knob'));
  };

  // ---- Segmented control ----------------------------------------------------------
  UI.segmented = function ({ options, value, onChange }) {
    const thumb = h('span.seg-thumb');
    const wrap = h('div.seg', { role: 'tablist' }, thumb);
    const btns = options.map((o, i) => {
      const b = h('button', { type: 'button', role: 'tab', onclick: () => { select(i); onChange && onChange(o.value); } }, o.label);
      wrap.appendChild(b);
      return b;
    });
    function select(i) {
      btns.forEach((b, j) => b.classList.toggle('on', j === i));
      const n = options.length;
      thumb.style.width = `calc((100% - 4px) / ${n})`;
      thumb.style.transform = `translateX(${i * 100}%)`;
    }
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    select(idx);
    return wrap;
  };

  // ---- Number editor (big field + slider + −/+ steppers) ----------------------------
  /**
   * { value, min, max, step, sliderMin, sliderMax, format(v), parse(text), onChange(v), onInput(v) }
   * onInput fires while dragging; onChange when the value settles.
   */
  UI.numberEditor = function (o) {
    const step = o.step || 1;
    const sMin = o.sliderMin != null ? o.sliderMin : o.min;
    const sMax = o.sliderMax != null ? o.sliderMax : o.max;
    let v = o.value;
    const fmtv = o.format || ((x) => String(x));
    const clamp = (x) => Math.min(o.max != null ? o.max : Infinity, Math.max(o.min != null ? o.min : -Infinity, x));
    const round = (x) => Math.round(x / step) * step;
    const field = h('input.numfield', { type: 'text', inputmode: o.decimal ? 'decimal' : 'numeric', value: fmtv(v), 'aria-label': o.label || 'Value' });
    const slider = h('input.slider', { type: 'range', min: sMin, max: sMax, step, value: Math.min(sMax, Math.max(sMin, v)), 'aria-label': (o.label || 'Value') + ' slider' });
    const paint = () => {
      const pct = ((Math.min(sMax, Math.max(sMin, v)) - sMin) / (sMax - sMin || 1)) * 100;
      slider.style.setProperty('--fill', pct + '%');
    };
    const set = (x, settle) => {
      v = clamp(round(x));
      field.value = fmtv(v);
      slider.value = Math.min(sMax, Math.max(sMin, v));
      paint();
      if (o.onInput) o.onInput(v);
      if (settle && o.onChange) o.onChange(v);
    };
    slider.addEventListener('input', () => set(Number(slider.value), false));
    slider.addEventListener('change', () => set(Number(slider.value), true));
    field.addEventListener('focus', () => { field.value = String(v); setTimeout(() => field.select(), 10); });
    field.addEventListener('blur', () => {
      const raw = String(field.value).replace(/[^0-9.\-]/g, '');
      const parsed = o.parse ? o.parse(field.value) : Number(raw);
      if (raw !== '' && isFinite(parsed)) set(parsed, true); else field.value = fmtv(v);
    });
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') field.blur(); });
    // Press-and-hold steppers repeat.
    const stepper = (dir, icon) => {
      const b = h('button.stepper', { type: 'button', 'aria-label': dir > 0 ? 'Increase' : 'Decrease' }, UI.icon(icon));
      let timer = null, count = 0;
      const go = () => { set(v + dir * step * (count > 10 ? 5 : 1), false); count++; UI.haptic(); };
      const start = (e) => { e.preventDefault(); count = 0; go(); timer = setInterval(go, 160); };
      const stop = () => { if (timer) { clearInterval(timer); timer = null; if (o.onChange) o.onChange(v); } };
      b.addEventListener('pointerdown', start);
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointerleave', stop);
      b.addEventListener('pointercancel', stop);
      return b;
    };
    paint();
    const wrap = h('div', h('div.numedit', stepper(-1, 'minus'), field, stepper(1, 'plus')), slider,
      o.scale !== false ? h('div.slider-scale', h('span', fmtv(sMin)), h('span', fmtv(sMax))) : null);
    wrap.setValue = (x) => { v = x; field.value = fmtv(v); slider.value = Math.min(sMax, Math.max(sMin, v)); paint(); };
    return wrap;
  };

  // ---- Toast --------------------------------------------------------------------
  let toastEl = null, toastTimer = null;
  UI.toast = function (text, actionLabel, action) {
    if (!toastEl) { toastEl = h('div.toast', { role: 'status' }); document.body.appendChild(toastEl); }
    UI.mount(toastEl, h('span', text), actionLabel ? h('button', { onclick: () => { action && action(); toastEl.classList.remove('show'); } }, actionLabel) : null);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), actionLabel ? 4500 : 2400);
  };

  // ---- Tap-to-expand card ------------------------------------------------------------
  /**
   * { title, summary, body, open, onToggle } → a glass card whose header
   * toggles the body. card.setSummary(x) updates the one-line summary.
   */
  UI.expand = function ({ title, summary, body, open, onToggle }) {
    const sum = h('div.eh-sum', summary || '');
    const card = h('div.card.expand' + (open ? '.open' : ''));
    const head = h('button.expand-head', { type: 'button', 'aria-expanded': String(!!open), onclick: () => {
      const on = !card.classList.contains('open');
      card.classList.toggle('open', on);
      head.setAttribute('aria-expanded', String(on));
      UI.haptic();
      if (onToggle) onToggle(on);
    } }, h('div.eh-text', h('div.eh-title', title), sum), UI.icon('chevron', 'chev'));
    const inner = h('div.expand-inner', body);
    UI.mount(card, head, h('div.expand-body', h('div', inner)));
    card.setSummary = (x) => { if (x instanceof Node) UI.mount(sum, x); else sum.textContent = x == null ? '' : String(x); };
    card.body = inner;
    return card;
  };

  /** A labeled row with a value that opens an editor when tapped. */
  UI.row = function ({ label, value, tip, diff, diffColor, onClick, sub }) {
    return h('button.row' + (sub ? '.sub' : ''), { type: 'button', onclick: onClick },
      h('span.row-label', diff ? h('span.badge-diff', { style: { background: diffColor || 'var(--accent)' }, title: 'Differs from Baseline' }) : null,
        h('span.txt', label), tip ? UI.tipButton(tip) : null),
      h('span.row-value', value),
      UI.icon('chevron', 'chev'));
  };

  /** A labeled row with an inline switch. */
  UI.toggleRow = function ({ label, checked, onChange, tip, diff, diffColor }) {
    return h('div.row',
      h('span.row-label', diff ? h('span.badge-diff', { style: { background: diffColor || 'var(--accent)' } }) : null,
        h('span.txt', label), tip ? UI.tipButton(tip) : null),
      UI.toggle({ checked, onChange, label }));
  };
})(globalThis.RP = globalThis.RP || {});
