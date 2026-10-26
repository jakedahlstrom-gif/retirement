/*
 * charts.js — chart styling and the eight Compare charts (built on Chart.js).
 *
 * Style rules (Horizon): smooth lines with a soft glow, gradient fills that
 * fade to transparent, no gridlines, few axis labels, rounded bar tops, a
 * floating glass tooltip, a crosshair on tap, and a small sun at the
 * retirement point. Each scenario keeps its color everywhere. Charts with 2+
 * scenarios always have a legend, so color is never the only clue.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, fmt = UI.fmt;
  const C = (UI.charts = {});

  /** Read a CSS color variable (so charts follow dark/light mode). */
  C.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  C.scenarioColor = (n) => C.css('--s' + n);
  C.alpha = function (color, a) {
    const c = color.trim();
    if (c.startsWith('#')) {
      const v = c.length === 4 ? c.slice(1).split('').map((x) => x + x).join('') : c.slice(1);
      const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    return c.replace(/rgba?\(([^)]+)\)/, (m, inner) => { const p = inner.split(',').slice(0, 3); return `rgba(${p.join(',')},${a})`; });
  };

  /** Shared Chart.js look. Called once and again when the theme changes. */
  C.applyTheme = function () {
    if (!window.Chart) return;
    const D = Chart.defaults;
    D.font.family = C.css('--font') || '-apple-system, system-ui, sans-serif';
    D.font.size = 11;
    D.color = C.css('--muted');
    D.borderColor = C.css('--line');
    D.animation.duration = UI.reducedMotion() ? 0 : 750;
    D.animation.easing = 'easeOutQuart';
    D.maintainAspectRatio = false;
    D.plugins.legend.display = false;
    D.elements.line.borderWidth = 2.25;
    D.elements.line.tension = 0.35;
    D.elements.line.borderCapStyle = 'round';
    D.elements.line.borderJoinStyle = 'round';
    D.elements.point.radius = 0;
    D.elements.point.hoverRadius = 5;
    D.elements.point.hitRadius = 14;
    D.elements.point.hoverBorderWidth = 2;
    D.elements.bar.borderRadius = 4;
    const tt = D.plugins.tooltip;
    tt.backgroundColor = C.alpha(C.css('--card-3'), 0.94);
    tt.titleColor = C.css('--fg');
    tt.bodyColor = C.css('--fg-2');
    tt.borderColor = C.css('--line-strong');
    tt.borderWidth = 1;
    tt.cornerRadius = 14;
    tt.padding = 10;
    tt.boxPadding = 5;
    tt.usePointStyle = true;
    tt.titleFont = { weight: '600', size: 13 };
    tt.bodyFont = { size: 12 };
    tt.caretSize = 0;
    tt.displayColors = true;
  };

  /** Vertical crosshair at the active point + small event markers on the x axis. */
  const overlay = {
    id: 'rpOverlay',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea: a } = chart;
      const opts = chart.options.plugins.rpOverlay || {};
      // Event markers: tiny ticks along the bottom with a dot.
      const labelQueue = [];
      for (const m of opts.markers || []) {
        const x = chart.scales.x.getPixelForValue(m.x);
        if (!isFinite(x) || x < a.left - 1 || x > a.right + 1) continue;
        ctx.save();
        ctx.strokeStyle = m.color || C.css('--faint');
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, a.top + 4); ctx.lineTo(x, a.bottom); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = m.color || C.css('--fg-2');
        ctx.beginPath(); ctx.arc(x, a.bottom, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = C.css('--card'); ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
        if (m.label && opts.showMarkerLabels !== false) labelQueue.push({ x, text: m.label });
      }
      // Marker labels: two rows at most, skip any that would overlap.
      if (labelQueue.length) {
        ctx.save();
        ctx.font = `500 10px ${C.css('--font')}`;
        ctx.fillStyle = C.css('--muted');
        const rowsEnd = [-Infinity, -Infinity];
        const merged = [];
        for (const q of labelQueue.sort((p1, p2) => p1.x - p2.x)) {
          const prev = merged[merged.length - 1];
          if (prev && Math.abs(prev.x - q.x) < 2) prev.text += ' · ' + q.text; else merged.push({ ...q });
        }
        for (const q of merged) {
          const w = ctx.measureText(q.text).width;
          const right = q.x + 4 + w > a.right;
          const x0 = right ? q.x - 4 - w : q.x + 4;
          const row = rowsEnd.findIndex((end) => x0 > end + 6);
          if (row < 0) continue;
          rowsEnd[row] = x0 + w;
          ctx.textAlign = 'left';
          ctx.fillText(q.text, x0, a.top + 10 + row * 12);
        }
        ctx.restore();
      }
      // The sun: a small glowing dot at the retirement point
      if (opts.sun) {
        const x = chart.scales.x.getPixelForValue(opts.sun.x), y = chart.scales.y.getPixelForValue(opts.sun.y);
        if (isFinite(x) && isFinite(y) && y >= a.top - 2 && y <= a.bottom + 2) {
          const amber = C.css('--accent');
          ctx.save();
          const g = ctx.createRadialGradient(x, y, 0, x, y, 16);
          g.addColorStop(0, C.alpha(amber, 0.55)); g.addColorStop(1, C.alpha(amber, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff6e6'; ctx.shadowColor = amber; ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
      // Horizontal reference lines (income limits, targets)
      for (const r of opts.refLines || []) {
        const y = chart.scales.y.getPixelForValue(r.y);
        if (!isFinite(y) || y < a.top || y > a.bottom) continue;
        ctx.save();
        ctx.strokeStyle = r.color || C.css('--faint'); ctx.lineWidth = 1; ctx.setLineDash(r.dash || []);
        ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.css('--muted'); ctx.font = `500 10px ${C.css('--font')}`; ctx.textAlign = 'right';
        ctx.fillText(r.label || '', a.right, y - 4);
        ctx.restore();
      }
      // Crosshair
      const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (act && act.length && opts.crosshair !== false) {
        const x = act[0].element.x;
        ctx.save(); ctx.strokeStyle = C.css('--line-strong'); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke(); ctx.restore();
      }
    },
  };

  /** Direct labels at the right end of each line (scenario names). */
  const endLabels = {
    id: 'rpEndLabels',
    afterDatasetsDraw(chart) {
      const opts = chart.options.plugins.rpEndLabels;
      if (!opts || !opts.enabled) return;
      const { ctx, chartArea: a } = chart;
      const items = [];
      chart.data.datasets.forEach((ds, i) => {
        if (!ds.endLabel || chart.getDatasetMeta(i).hidden) return;
        const pts = chart.getDatasetMeta(i).data;
        let last = null;
        for (let k = pts.length - 1; k >= 0; k--) if (pts[k] && isFinite(pts[k].y) && ds.data[k] != null) { last = pts[k]; break; }
        if (last) items.push({ y: last.y, x: last.x, text: ds.endLabel, color: ds.borderColor });
      });
      // Too crowded? Skip (legend + tooltip carry identity).
      items.sort((p, q) => p.y - q.y);
      for (let k = 1; k < items.length; k++) if (items[k].y - items[k - 1].y < 12) return;
      ctx.save();
      ctx.font = `600 10.5px ${C.css('--font')}`;
      ctx.textAlign = 'right';
      for (const it of items) {
        ctx.fillStyle = it.color;
        ctx.beginPath(); ctx.arc(it.x, it.y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = C.css('--card'); ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = C.css('--fg-2');
        ctx.fillText(it.text, Math.min(it.x - 7, a.right - 7), it.y - 7);
      }
      ctx.restore();
    },
  };

  /** A soft glow under every line (not bands, dashed guides or bars). */
  const glow = {
    id: 'rpGlow',
    beforeDatasetDraw(chart, args) {
      const ds = args.meta && args.meta.dataset ? chart.data.datasets[args.index] : null;
      const type = ds && (ds.type || chart.config.type);
      if (!ds || type !== 'line' || ds.borderDash || !(ds.borderWidth == null || ds.borderWidth >= 1.5) || typeof ds.borderColor !== 'string') return;
      chart.ctx.save();
      chart.ctx.shadowColor = C.alpha(ds.borderColor, 0.55);
      chart.ctx.shadowBlur = 10;
      args.meta._rpGlow = true;
    },
    afterDatasetDraw(chart, args) { if (args.meta._rpGlow) { args.meta._rpGlow = false; chart.ctx.restore(); } },
  };

  if (window.Chart) Chart.register(overlay, endLabels, glow);

  const moneyTick = (v) => fmt.money(v);
  function baseOptions(o) {
    o = o || {};
    return {
      responsive: true,
      interaction: { mode: o.mode || 'index', intersect: false, axis: 'x' },
      layout: { padding: { top: 6, right: 6, left: 0, bottom: 0 } },
      scales: {
        x: {
          type: o.xType || 'linear', grid: { display: false }, border: { color: C.css('--line') },
          ticks: { maxTicksLimit: o.xTicks || 6, maxRotation: 0, includeBounds: o.xType === 'category', callback: o.xFmt || ((v) => (Number.isInteger(v) ? String(v) : '')), color: C.css('--muted') },
          min: o.xMin, max: o.xMax, stacked: !!o.stacked, offset: !!o.offsetX,
        },
        y: {
          beginAtZero: o.beginAtZero !== false, stacked: !!o.stacked,
          grid: { display: false, drawTicks: false }, border: { display: false },
          ticks: { maxTicksLimit: 4, padding: 6, callback: o.yFmt || moneyTick, color: C.css('--muted') },
          min: o.yMin, max: o.yMax,
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => (items.length ? (o.titleFmt ? o.titleFmt(items[0]) : String(items[0].label || items[0].parsed.x)) : ''),
            label: (it) => ` ${it.dataset.label}: ${(o.valFmt || moneyTick)(it.parsed.y)}`,
          },
          filter: (it) => !it.dataset.noTooltip,
          itemSort: (p, q) => q.parsed.y - p.parsed.y,
        },
        rpOverlay: { markers: o.markers || [], refLines: o.refLines || [], sun: o.sun || null },
        rpEndLabels: { enabled: !!o.endLabels },
      },
      onClick: o.onClick,
    };
  }

  function gradient(chart, color, top, bottom) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return C.alpha(color, top);
    const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, C.alpha(color, top));
    g.addColorStop(1, C.alpha(color, bottom));
    return g;
  }

  /** 1.5px surface-colored gap above each non-empty stacked segment. */
  function segBorder(ctx) { const v = ctx.raw && ctx.raw.y; return v > 0 ? { top: 1.5 } : 0; }

  /** Round only the top segment of each stacked bar. */
  function topRadius(ctx) {
    const chart = ctx.chart, i = ctx.dataIndex;
    let top = -1;
    chart.data.datasets.forEach((ds, k) => { if (!chart.getDatasetMeta(k).hidden && (ds.data[i] || 0) > 0) top = k; });
    return ctx.datasetIndex === top ? { topLeft: 4, topRight: 4 } : 0;
  }

  // ------------------------------------------------------------------ builders
  /**
   * Each builder: (input) => Chart.js config.
   * input = { series: [{ sc, a }], focus: { sc, a }, onClick, markers }
   */
  const B = (C.builders = {});

  B.balance = function (inp) {
    const datasets = [];
    const f = inp.focus;
    const years = f.a.schedule.years;
    if (f.a.mc && f.a.mc.bands) {
      const col = C.scenarioColor(f.sc.color);
      datasets.push({ label: '90th percentile', clip: 4, data: f.a.mc.bands.p90.map((v, i) => ({ x: years[i], y: v })), borderWidth: 0, pointRadius: 0, fill: '+1', backgroundColor: (c) => gradient(c.chart, col, 0.16, 0.05), noTooltip: false, order: 10 });
      datasets.push({ label: '10th percentile', data: f.a.mc.bands.p10.map((v, i) => ({ x: years[i], y: v })), borderWidth: 0, pointRadius: 0, fill: false, order: 11 });
    }
    for (const { sc, a } of inp.series) {
      const col = C.scenarioColor(sc.color);
      const med = a.mc && a.mc.bands ? a.mc.bands.p50 : a.rows.map((r) => r.balances.total);
      const solo = inp.series.length === 1;
      datasets.push({ label: sc.name, endLabel: inp.series.length > 1 ? short(sc.name) : null, data: med.map((v, i) => ({ x: a.schedule.years[i], y: v })), borderColor: col, backgroundColor: solo ? (c) => gradient(c.chart, col, 0.24, 0) : col, pointBackgroundColor: col, pointBorderColor: C.css('--card'), fill: solo ? 'origin' : false, order: 1 });
    }
    const fMed = f.a.mc && f.a.mc.bands ? f.a.mc.bands.p50 : f.a.rows.map((r) => r.balances.total);
    const ri = years.indexOf(f.a.schedule.retireYear);
    let maxMed = 0;
    for (const { a } of inp.series) for (const v of (a.mc && a.mc.bands ? a.mc.bands.p50 : a.rows.map((r) => r.balances.total))) maxMed = Math.max(maxMed, v);
    const opts = baseOptions({ markers: inp.markers, onClick: inp.onClick, endLabels: true, xMin: years[0], xMax: years[years.length - 1], yMax: niceCeil(maxMed * 1.6), sun: ri >= 0 ? { x: years[ri], y: fMed[ri] } : null });
    return { type: 'line', data: { datasets }, options: opts };
  };
  function niceCeil(v) {
    if (!(v > 0)) return undefined;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  B.success = function (inp) {
    const labels = inp.series.map(({ sc }) => short(sc.name, inp.series.length > 3 ? 9 : 12));
    const data = inp.series.map(({ a }) => (a.summary.successRate || 0) * 100);
    const colors = inp.series.map(({ sc }) => C.scenarioColor(sc.color));
    const target = inp.series[0] ? inp.series[0].a.plan.sim.successTarget : 90;
    const o = baseOptions({ xType: 'category', mode: 'nearest', yFmt: (v) => v + '%', valFmt: (v) => v.toFixed(0) + '%', yMax: 100, refLines: [{ y: target, label: `${target}% target`, color: C.css('--accent') }], titleFmt: (it) => inp.series[it.dataIndex].sc.name, offsetX: true });
    o.scales.x.ticks.callback = function (v) { return this.getLabelForValue(v); };
    o.scales.x.ticks.autoSkip = false;
    o.plugins.tooltip.callbacks.label = (it) => ` Success: ${it.parsed.y.toFixed(0)}%`;
    return { type: 'bar', data: { labels, datasets: [{ label: 'Success', data, backgroundColor: colors, maxBarThickness: 24, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom' }] }, options: o };
  };

  B.safeSpend = function (inp) {
    const labels = inp.series.map(({ sc }) => short(sc.name, inp.series.length > 3 ? 9 : 12));
    const data = inp.series.map(({ m }) => (m && m.safe ? m.safe.amount : null));
    const colors = inp.series.map(({ sc }) => C.scenarioColor(sc.color));
    const plannedSpend = inp.focus.a.plan.spending.retirement;
    const o = baseOptions({ xType: 'category', mode: 'nearest', refLines: [{ y: plannedSpend, label: `Planned ${fmt.money(plannedSpend)}`, color: C.css('--faint') }], titleFmt: (it) => inp.series[it.dataIndex].sc.name, offsetX: true });
    o.scales.x.ticks.callback = function (v) { return this.getLabelForValue(v); };
    o.scales.x.ticks.autoSkip = false;
    o.plugins.tooltip.callbacks.label = (it) => ` Safe spending: ${fmt.money(it.parsed.y)}/yr`;
    return { type: 'bar', data: { labels, datasets: [{ label: 'Safe spending', data, backgroundColor: colors, maxBarThickness: 24, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom' }] }, options: o };
  };

  /** Income-source categories (stacked). Colors drawn from the validated set. */
  C.sourceCats = () => [
    { key: 'work', label: 'Paychecks', color: C.css('--muted'), get: (r) => r.income.wages + r.income.partTime + r.income.ui + r.income.disability },
    { key: 'ss', label: 'Social Security', color: C.css('--s2'), get: (r) => r.income.ss },
    { key: 'cash', label: 'Cash & brokerage', color: C.css('--s3'), get: (r) => r.src.cash },
    { key: 'roth', label: 'Roth', color: C.css('--s1'), get: (r) => r.src.rothBasis + r.src.rothConversions + r.src.rothEarnings },
    { key: 'pre', label: '401k / IRA', color: C.css('--s4'), get: (r) => r.src.preTax },
    { key: 'hsa', label: 'HSA', color: C.css('--s6'), get: (r) => r.src.hsa },
    { key: 'pen', label: 'Penalty withdrawals', color: C.css('--s5'), get: (r) => r.src.penalty },
  ];

  B.sources = function (inp) {
    const a = inp.focus.a;
    const rows = a.rows.filter((r) => r.year >= a.schedule.retireYear - 2 && r.year <= a.schedule.retireYear + 30);
    const cats = C.sourceCats();
    const datasets = cats.map((c) => ({
      label: c.label, data: rows.map((r) => ({ x: r.year, y: Math.max(0, c.get(r)) })), backgroundColor: c.color, stack: 's',
      borderColor: C.css('--card'), borderWidth: segBorder, borderSkipped: false, borderRadius: topRadius, maxBarThickness: 14,
    })).filter((ds) => ds.data.some((p) => p.y > 1));
    const legend = datasets.map((d) => ({ label: d.label, color: d.backgroundColor }));
    datasets.push({ type: 'line', label: 'MAGI', data: rows.map((r) => ({ x: r.year, y: r.magi })), borderColor: C.css('--fg-2'), borderWidth: 1.5, borderDash: [3, 3], pointRadius: 0, tension: 0.25, stack: 'magi', order: -1 });
    legend.push({ label: 'MAGI (income for health programs)', color: C.css('--fg-2'), dashed: true });
    const o = baseOptions({ stacked: true, markers: inp.markers, onClick: inp.onClick, xMin: rows[0].year - 0.6, xMax: rows[rows.length - 1].year + 0.6 });
    o.plugins.tooltip.itemSort = undefined;
    o.plugins.tooltip.filter = (it) => it.parsed.y > 1;
    return { type: 'bar', data: { datasets }, options: o, legend };
  };

  B.accounts = function (inp) {
    const a = inp.focus.a;
    const cats = [
      { label: 'Pre-tax 401k/IRA', color: C.css('--s4'), get: (r) => r.balances.preTax },
      { label: 'Roth', color: C.css('--s1'), get: (r) => r.balances.roth },
      { label: 'HSA', color: C.css('--s6'), get: (r) => r.balances.hsa },
      { label: 'Cash & taxable', color: C.css('--s3'), get: (r) => r.balances.taxable },
    ];
    const datasets = cats.map((c, k) => ({
      label: c.label, data: a.rows.map((r) => ({ x: r.year, y: Math.max(0, c.get(r)) })), borderColor: c.color, borderWidth: 1.5,
      backgroundColor: (cx) => gradient(cx.chart, c.color, 0.42, 0.12), fill: k === 0 ? 'origin' : '-1', pointBackgroundColor: c.color, pointBorderColor: C.css('--card'),
    }));
    const o = baseOptions({ stacked: true, markers: inp.markers, onClick: inp.onClick, xMin: a.rows[0].year, xMax: a.rows[a.rows.length - 1].year });
    o.plugins.tooltip.itemSort = undefined;
    return { type: 'line', data: { datasets }, options: o, legend: cats.map((c) => ({ label: c.label, color: c.color })) };
  };

  B.magi = function (inp) {
    const f = inp.focus.a;
    const start = Math.min(...inp.series.map((x) => x.a.schedule.retireYear), f.schedule.retireYear) - 2;
    const end = Math.max(f.schedule.unlock.p1.medicareYear, f.schedule.unlock.p2.medicareYear) + 1;
    const pick = (a) => a.rows.filter((r) => r.year >= start && r.year <= end);
    const datasets = [];
    // Income lines (stepped) from the focused scenario's household size.
    const lines = [
      { key: 'mncare', label: 'MinnesotaCare', color: C.css('--accent') },
      { key: 'kidsMA', label: 'Kids’ MA', color: C.css('--warn') },
      { key: 'aca', label: 'ACA 400%', color: C.css('--bad') },
    ];
    for (const l of lines) {
      datasets.push({ label: l.label + ' line', data: pick(f).map((r) => ({ x: r.year, y: r.health.lines ? r.health.lines[l.key] : null })), borderColor: C.alpha(l.color, 0.75), borderWidth: 1, borderDash: [4, 4], stepped: 'middle', tension: 0, pointRadius: 0, endLabel: l.label, fill: false });
    }
    for (const { sc, a } of inp.series) {
      const col = C.scenarioColor(sc.color);
      datasets.push({ label: sc.name, data: pick(a).map((r) => ({ x: r.year, y: r.magi })), borderColor: col, backgroundColor: col, pointBackgroundColor: col, pointBorderColor: C.css('--card'), tension: 0.2 });
    }
    const o = baseOptions({ markers: inp.markers, onClick: inp.onClick, endLabels: true, xMin: start, xMax: end });
    return { type: 'line', data: { datasets }, options: o, legend: [...inp.series.map(({ sc }) => ({ label: sc.name, color: C.scenarioColor(sc.color) })), ...lines.map((l) => ({ label: l.label + ' line', color: l.color, dashed: true }))] };
  };

  B.taxes = function (inp) {
    const a = inp.focus.a;
    const cats = [
      { label: 'Federal', color: C.css('--s2'), get: (r) => Math.max(0, r.taxes.federal) },
      { label: 'Minnesota', color: C.css('--s6'), get: (r) => Math.max(0, r.taxes.state) },
      { label: 'Payroll', color: C.css('--muted'), get: (r) => r.taxes.fica },
      { label: 'Penalties', color: C.css('--s5'), get: (r) => r.taxes.penalty },
    ];
    const rows = a.rows;
    const datasets = cats.map((c) => ({
      label: c.label, data: rows.map((r) => ({ x: r.year, y: c.get(r) })), backgroundColor: c.color, stack: 't',
      borderColor: C.css('--card'), borderWidth: segBorder, borderSkipped: false, borderRadius: topRadius, maxBarThickness: 10,
    })).filter((ds) => ds.data.some((p) => p.y > 1));
    const o = baseOptions({ stacked: true, markers: inp.markers, onClick: inp.onClick, xMin: rows[0].year - 0.6, xMax: rows[rows.length - 1].year + 0.6 });
    o.plugins.tooltip.itemSort = undefined;
    o.plugins.tooltip.filter = (it) => it.parsed.y > 1;
    return { type: 'bar', data: { datasets }, options: o, legend: datasets.map((d) => ({ label: d.label, color: d.backgroundColor })) };
  };

  B.byAge = function (inp) {
    const datasets = inp.series.filter((s) => s.byAge).map(({ sc, byAge }) => {
      const col = C.scenarioColor(sc.color);
      return { label: sc.name, endLabel: inp.series.length > 1 ? short(sc.name) : null, data: byAge.map((p) => ({ x: p.age, y: p.success * 100 })), borderColor: col, backgroundColor: col, pointBackgroundColor: col, pointBorderColor: C.css('--card') };
    });
    const target = inp.focus.a.plan.sim.successTarget;
    const o = baseOptions({ yFmt: (v) => v + '%', valFmt: (v) => v.toFixed(0) + '%', yMax: 100, xMin: 45, xMax: 65, titleFmt: (it) => `Retire at ${it.parsed.x}`, refLines: [{ y: target, label: `${target}%`, color: C.css('--accent') }], endLabels: true });
    o.scales.x.ticks.stepSize = 5;
    return { type: 'line', data: { datasets }, options: o };
  };

  /**
   * Replay history: one bar per start year, the money left at the end. Start
   * years that run short get a coral stub, so they stand out at a glance.
   * input = { runs: [{ start, success, failYear, end }], color }
   */
  B.history = function (inp) {
    const runs = inp.runs;
    const max = Math.max(1, ...runs.map((r) => r.end));
    const stub = max * 0.035;
    const good = C.css('--pos'), bad = C.css('--bad');
    const o = baseOptions({ xType: 'category', mode: 'index', offsetX: true, yMax: niceCeil(max * 1.08), xTicks: 7, valFmt: moneyTick, titleFmt: (it) => `Retire into ${runs[it.dataIndex].start}` });
    o.scales.x.ticks.callback = function (v) { const y = runs[v] && runs[v].start; return y % 20 === 0 ? String(y) : ''; };
    o.scales.x.ticks.autoSkip = false;
    o.scales.x.ticks.maxRotation = 0;
    o.plugins.tooltip.callbacks.label = (it) => { const r = runs[it.dataIndex]; return r.success ? ` ${fmt.money(r.end)} left at the end` : ` Runs short in ${r.failYear}`; };
    o.plugins.rpOverlay.crosshair = false;
    return {
      type: 'bar',
      data: {
        labels: runs.map((r) => String(r.start)),
        datasets: [{ label: 'Left at the end', data: runs.map((r) => (r.success ? r.end : stub)), backgroundColor: runs.map((r) => (r.success ? C.alpha(good, 0.75) : bad)), borderRadius: 2, barPercentage: 0.9, categoryPercentage: 1 }],
      },
      options: o,
    };
  };

  /**
   * Progress: the path your first tracked plan expected (dashed) and where
   * your savings actually were (dots). input = { expected: [{x, y}], actual: [{x, y, label}] }
   */
  B.progress = function (inp) {
    const acc = C.css('--accent'), pos = C.css('--pos');
    const xs = inp.expected.map((p) => p.x).concat(inp.actual.map((p) => p.x));
    const o = baseOptions({ mode: 'nearest', beginAtZero: false, xMin: Math.floor(Math.min(...xs)), xMax: Math.ceil(Math.max(...xs)), xTicks: 5,
      titleFmt: (it) => it.raw.label || `Expected, ${fmt.date(new Date(Date.UTC(Math.floor(it.parsed.x), Math.round((it.parsed.x % 1) * 12), 1)).toISOString().slice(0, 10)).replace(/ 1,/, '')}` });
    o.plugins.tooltip.callbacks.label = (it) => ` ${it.dataset.label}: ${fmt.money(it.parsed.y)}`;
    o.plugins.rpOverlay.crosshair = false;
    return {
      type: 'line',
      data: {
        datasets: [
          { label: 'Plan expected', data: inp.expected, borderColor: C.alpha(acc, 0.85), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.2, order: 2 },
          { label: 'Your savings', data: inp.actual, borderColor: pos, backgroundColor: pos, pointBackgroundColor: pos, pointBorderColor: C.css('--card'), pointBorderWidth: 2, pointRadius: 5.5, pointHoverRadius: 7, borderWidth: 2, tension: 0, order: 1 },
        ],
      },
      options: o,
    };
  };

  function short(name, n) { n = n || 18; return name.length > n ? name.slice(0, n - 1) + '…' : name; }
  C.short = short;
})(globalThis.RP = globalThis.RP || {});
