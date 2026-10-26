/*
 * flow.js — one year's money as a flow diagram: where it came from on the
 * left, one stream through the middle, where it went on the right (a Sankey
 * chart, like ProjectionLab's cash flow view). Plain SVG.
 *
 *   UI.flow.items(row, plan)    { ins: [...], outs: [...] }, each { key, label, value, color }
 *   UI.flow.diagram(row, plan)  the SVG element
 *
 * Money in always equals money out for a year (income + withdrawals =
 * spending + taxes + saving), so the two sides line up.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, fmt = UI.fmt;
  const F = (UI.flow = {});
  const NS = 'http://www.w3.org/2000/svg';

  /** The year's sources and uses, largest first, without the empty ones. */
  F.items = function (r, P) {
    const keep = (list) => list.filter((x) => x.value > 1).sort((a, b) => b.value - a.value);
    const spendLeftover = P.contributions.leftoverTo === 'spend' || (P.sim.coastYear && r.year >= P.sim.coastYear);
    const ins = keep([
      { key: 'work', label: 'Paychecks', value: r.income.wages + r.income.partTime + r.income.ui + r.income.disability, color: 'var(--muted)' },
      { key: 'ss', label: 'Social Security', value: r.income.ss, color: 'var(--s2)' },
      { key: 'windfall', label: 'Windfalls', value: r.income.windfall, color: 'var(--accent)' },
      { key: 'cash', label: 'Cash & brokerage', value: r.src.cash, color: 'var(--s3)' },
      { key: 'roth', label: 'Roth', value: r.src.rothBasis + r.src.rothConversions + r.src.rothEarnings, color: 'var(--s1)' },
      { key: 'pre', label: '401k / IRA', value: r.src.preTax, color: 'var(--s4)' },
      { key: 'hsa', label: 'HSA', value: r.src.hsa, color: 'var(--s6)' },
      { key: 'pen', label: 'Penalty withdrawals', value: r.src.penalty, color: 'var(--s5)' },
      { key: 'short', label: 'Shortfall', value: r.from.shortfall, color: 'var(--bad)' },
    ]);
    const outs = keep([
      // A paid-off mortgage shows as a negative adjustment: it comes off everyday spending.
      { key: 'spend', label: 'Everyday spending', value: r.spending.core + r.spending.medicalGrowth + r.spending.mortgageAdj + (spendLeftover ? r.saving.leftover : 0), color: 'var(--accent)' },
      { key: 'extras', label: 'Extras', value: r.spending.extras, color: 'var(--s3)' },
      { key: 'health', label: 'Health premiums', value: r.spending.health, color: 'var(--warn)' },
      { key: 'daycare', label: 'Daycare', value: r.spending.daycare, color: 'var(--s4)' },
      { key: 'college', label: 'College', value: r.spending.college, color: 'var(--s6)' },
      { key: 'tax', label: 'Taxes', value: r.taxes.federal + r.taxes.state + r.taxes.fica, color: 'var(--s5)' },
      { key: 'pen', label: 'Penalties', value: r.taxes.penalty, color: 'var(--bad)' },
      { key: 'saveRet', label: 'Saved for retirement', value: r.saving.pre401k + r.saving.hsa + r.saving.rothIra + r.saving.mega, color: 'var(--pos)' },
      { key: 'saveTax', label: P.contributions.leftoverTo === 'cash' ? 'Saved to cash' : 'Saved to brokerage', value: r.saving.taxable + (spendLeftover ? 0 : r.saving.leftover), color: 'var(--s1)' },
      { key: 'saveEdu', label: 'College savings', value: r.saving.edu, color: 'var(--s6)' },
    ]);
    return { ins, outs };
  };

  function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  /** The diagram, drawn in a 340-wide box that scales to its container. */
  F.diagram = function (r, P) {
    const { ins, outs } = F.items(r, P);
    const W = 340, H = 236, BAR = 7, GAP = 7, HUB = 8;
    const sumIn = ins.reduce((t, x) => t + x.value, 0), sumOut = outs.reduce((t, x) => t + x.value, 0);
    const k = Math.min((H - GAP * Math.max(0, ins.length - 1)) / Math.max(1, sumIn), (H - GAP * Math.max(0, outs.length - 1)) / Math.max(1, sumOut));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'flow', role: 'img', 'aria-label': `Money in: ${ins.map((x) => `${x.label} ${fmt.money(x.value)}`).join(', ')}. Money out: ${outs.map((x) => `${x.label} ${fmt.money(x.value)}`).join(', ')}.` });
    const hubX = W / 2 - HUB / 2, hubTop = (H - Math.max(sumIn, sumOut) * k) / 2;
    const ribbon = (x1, a1, b1, x2, a2, b2, color) => {
      const m = (x1 + x2) / 2;
      svg.appendChild(el('path', { d: `M${x1} ${a1}C${m} ${a1} ${m} ${a2} ${x2} ${a2}L${x2} ${b2}C${m} ${b2} ${m} ${b1} ${x1} ${b1}Z`, style: `fill:${color}`, class: 'flow-ribbon' }));
    };
    const label = (x, y, anchor, item) => {
      const t = el('text', { x, y, 'text-anchor': anchor, class: 'flow-label' });
      t.appendChild(el('tspan', { class: 'flow-name' }, item.label + ' '));
      t.appendChild(el('tspan', { class: 'flow-value' }, fmt.money(item.value)));
      svg.appendChild(t);
    };
    // Left: sources into the hub
    let y = (H - (sumIn * k + GAP * (ins.length - 1))) / 2, hy = hubTop;
    const nodes = [];
    for (const it of ins) {
      const hgt = Math.max(1.5, it.value * k);
      ribbon(BAR, y, y + hgt, hubX, hy, hy + it.value * k, it.color);
      nodes.push([0, y, hgt, it.color]);
      if (hgt >= 11) label(BAR + 5, y + hgt / 2 + 3.5, 'start', it);
      y += hgt + GAP; hy += it.value * k;
    }
    // Right: the hub out to uses
    y = (H - (sumOut * k + GAP * (outs.length - 1))) / 2; hy = hubTop;
    for (const it of outs) {
      const hgt = Math.max(1.5, it.value * k);
      ribbon(hubX + HUB, hy, hy + it.value * k, W - BAR, y, y + hgt, it.color);
      nodes.push([W - BAR, y, hgt, it.color]);
      if (hgt >= 11) label(W - BAR - 5, y + hgt / 2 + 3.5, 'end', it);
      y += hgt + GAP; hy += it.value * k;
    }
    // Bars on top of the ribbons
    for (const [x, ny, hgt, color] of nodes) svg.appendChild(el('rect', { x, y: ny, width: BAR, height: hgt, rx: 2, style: `fill:${color}` }));
    svg.appendChild(el('rect', { x: hubX, y: hubTop, width: HUB, height: Math.max(sumIn, sumOut) * k, rx: 3, class: 'flow-hub' }));
    // Labels go last so they sit above everything
    for (const t of svg.querySelectorAll('text')) svg.appendChild(t);
    return svg;
  };
})(globalThis.RP = globalThis.RP || {});
