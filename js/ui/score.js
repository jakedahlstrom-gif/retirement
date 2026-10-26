/*
 * score.js — the plan's report card: six concentric rings (like activity
 * rings), one per part of a sturdy plan, a score out of 100 and a letter
 * grade. The math is RP.engine.planScore (js/engine/lab.js).
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const SC = (UI.score = {});
  const COLORS = { success: '#5fe0b0', cushion: '#6fc8ff', rate: '#a98bff', tax: '#ff8ac2', flex: '#ffd166', mix: '#ff9a62' };
  const SHORT = { success: 'Success', cushion: 'Cushion', rate: 'Draw rate', tax: 'Taxes', flex: 'Flexible $', mix: 'Tax mix' };

  /** Value of one part, in words. */
  function said(p) {
    if (p.key === 'success') return fmt.pct(p.value);
    if (p.key === 'cushion') return (p.value >= 1 ? '+' : '−') + Math.round(Math.abs(p.value - 1) * 100) + '%';
    if (p.key === 'rate' || p.key === 'tax') return fmt.pct(p.value, 1);
    if (p.key === 'flex') return p.value >= 10 ? '10+ yrs' : p.value.toFixed(1) + ' yrs';
    if (p.key === 'mix') return p.value.map((x) => Math.round(x * 100)).join(' / ');
    return '';
  }
  /** What would raise a part's score. */
  function tip(p) {
    return {
      success: 'Retiring a little later or spending a little less moves this most. Try it in the Mixer.',
      cushion: 'Safe spending is close to (or under) what you plan to spend. A small cut or a year more of work adds headroom.',
      rate: 'A lower early withdrawal rate leaves room for a bad first few years. Part-time income or a bigger nest egg both help.',
      tax: 'Roth conversions in low-income years and spreading withdrawals across accounts can lower this.',
      flex: 'Money in cash and brokerage can be spent without tax surprises or penalties, which helps before 59½ and in down markets.',
      mix: 'Saving some money in Roth or a brokerage account (not only pre-tax) gives you more ways to manage taxes later.',
    }[p.key];
  }

  function rings(res, size) {
    const W = size || 132, c = W / 2, big = W > 150, sw = W * (big ? 0.04 : 0.05), gap = W * (big ? 0.016 : 0.02);
    let svg = `<svg viewBox="0 0 ${W} ${W}" class="sc-rings" aria-hidden="true">`;
    res.parts.forEach((p, i) => {
      const r = c - sw / 2 - 2 - i * (sw + gap);
      const len = 2 * Math.PI * r;
      const col = COLORS[p.key];
      svg += `<circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${col}" stroke-opacity="0.16" stroke-width="${sw.toFixed(2)}"/>`;
      svg += `<circle class="sc-arc" cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${col}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round"
        stroke-dasharray="${len.toFixed(2)}" stroke-dashoffset="${len.toFixed(2)}" data-to="${(len * (1 - Math.max(0.004, p.frac))).toFixed(2)}"
        transform="rotate(-90 ${c} ${c})" style="filter: drop-shadow(0 0 3px ${col}); transition-delay: ${i * 70}ms"/>`;
    });
    svg += '</svg>';
    const span = h('span');
    span.innerHTML = svg;
    const el = span.firstChild;
    // Sweep the arcs in once they're on screen.
    requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.sc-arc').forEach((a) => a.setAttribute('stroke-dashoffset', a.dataset.to))));
    return el;
  }

  /** The Lab's report card for the active scenario's latest results. */
  SC.card = function (a, safe) {
    if (!a) return h('div.card.sc-card', h('div.x-wait', h('span.busy-dot'), 'Grading your plan…'));
    const res = RP.engine.planScore(a, safe);
    const legend = h('div.sc-legend', res.parts.map((p) => h('div.sc-li',
      h('i', { style: { background: COLORS[p.key] } }), h('span', SHORT[p.key]), h('b', `${Math.round(p.points)}/${p.max}`))));
    const card = h('button.card.sc-card', { onclick: () => SC.open(a, safe), 'aria-label': `Plan score ${res.score} out of 100, grade ${res.grade}. Show details.` },
      h('div.sc-ringbox', rings(res)),
      h('div.sc-side', h('div.card-title', 'Plan score'), h('div.sc-gradeline', h('span.sc-grade', res.grade), h('span.sc-num', `${res.score} / 100`)), legend));
    return card;
  };

  SC.open = function (a, safe) {
    const res = RP.engine.planScore(a, safe);
    UI.sheet.open({
      title: 'Plan score',
      body: [
        h('div.sc-hero', h('div.sc-ringbox.big', rings(res, 190), h('div.sc-center', h('div.sc-grade', res.grade))), h('div.sc-hero-num', `${res.score} out of 100`)),
        h('p.x-note', 'Six things that make a retirement plan sturdy, weighted by how much they matter. It’s a rough guide for comparing scenarios, not a verdict.'),
        h('div.list', res.parts.map((p) => h('div.sc-row',
          h('div.sc-row-head', h('i', { style: { background: COLORS[p.key], boxShadow: `0 0 8px ${COLORS[p.key]}` } }), h('b', p.label), h('span.sc-val', said(p)), h('span.sc-pts', `${Math.round(p.points)}/${p.max}`)),
          h('div.sc-bar', h('span', { style: { width: (p.frac * 100).toFixed(1) + '%', background: COLORS[p.key] } })),
          h('p', p.frac > 0.97 ? p.note : p.note + ' ' + tip(p))))),
      ],
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
  };
})(globalThis.RP = globalThis.RP || {});
