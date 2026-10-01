/*
 * scenarios.js — choosing and managing scenarios: pick one, add a custom one,
 * duplicate, rename, recolor, delete, or reset a preset to its defaults.
 * Each scenario keeps its color on every chart.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h;
  const store = () => RP.store;
  const Sc = (UI.scenarios = {});

  const dot = (c, size) => h('span.badge-diff', { style: { background: `var(--s${c})`, width: (size || 10) + 'px', height: (size || 10) + 'px' } });

  function grouped() {
    const groups = {};
    for (const s of store().state.scenarios) (groups[s.group || 'Custom'] = groups[s.group || 'Custom'] || []).push(s);
    const order = ['Main', 'Job loss', 'Life', 'Stress tests', 'Custom'];
    return Object.entries(groups).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }

  /** Bottom sheet listing scenarios; calls onPick(id). */
  Sc.pick = function (title, onPick) {
    const active = store().state.active;
    UI.sheet.open({
      title,
      body: grouped().map(([g, list]) => h('div',
        h('div.subhead', { style: { padding: '12px 4px 6px' } }, g),
        h('div.list', list.map((s) => h('button.row', { onclick: () => { onPick(s.id); UI.sheet.close(); } },
          h('span.row-label', dot(s.color), h('span.txt', s.name)),
          h('span.row-value', s.id === active ? '✓' : (Object.keys(s.overrides || {}).length ? `${Object.keys(s.overrides).length} changes` : 'Baseline'))))))),
      actions: [{ label: 'Manage scenarios', onClick: () => Sc.manage() }],
    });
  };

  /** Manage: rename, duplicate, delete, reset, recolor. */
  Sc.manage = function () {
    const body = h('div');
    const draw = () => UI.mount(body,
      h('p.tip-text.muted', { style: { marginTop: 0 } }, 'Every scenario starts from Baseline and changes only what you override. Tap one to edit it.'),
      grouped().map(([g, list]) => h('div',
        h('div.subhead', { style: { padding: '12px 4px 6px' } }, g),
        h('div.list', list.map((s) => h('button.row', { onclick: () => Sc.edit(s.id, draw) },
          h('span.row-label', dot(s.color), h('span.txt', s.name)),
          h('span.row-value', s.id === 'base' ? 'Baseline' : `${Object.keys(s.overrides || {}).length}`), UI.icon('chevron', 'chev')))))),
      h('button.btn.block', { style: { marginTop: '12px' }, onclick: () => { const sc = store().addScenario('base', 'My scenario'); Sc.edit(sc.id, draw); } }, UI.icon('plus'), 'New scenario'));
    draw();
    UI.sheet.open({ title: 'Scenarios', body, actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }] });
  };

  /** One scenario's options. */
  Sc.edit = function (id, back) {
    const s = store().scenario(id);
    const name = h('input.textfield', { value: s.name });
    name.addEventListener('change', () => store().renameScenario(id, name.value || s.name));
    const colors = h('div', { style: { display: 'flex', gap: '12px', margin: '14px 0' } },
      Array.from({ length: RP.SCENARIO_COLORS }, (_, i) => h('button', {
        'aria-label': 'Color ' + (i + 1),
        style: { width: '34px', height: '34px', borderRadius: '17px', background: `var(--s${i + 1})`, outline: s.color === i + 1 ? '2px solid var(--fg)' : 'none', outlineOffset: '3px' },
        onclick: (e) => { store().recolorScenario(id, i + 1); colors.querySelectorAll('button').forEach((b) => { b.style.outline = 'none'; }); e.currentTarget.style.outline = '2px solid var(--fg)'; },
      })));
    const overrides = Object.entries(s.overrides || {});
    const diffList = overrides.length ? h('div.list', overrides.map(([path, v]) => h('div.row.sub',
      h('span.row-label', h('span.txt', fieldLabel(path))),
      h('span.row-value', valueText(path, v))))) : h('p.tip-text.muted', s.id === 'base' ? 'This is Baseline — every other scenario builds on it.' : 'No differences from Baseline yet.');
    UI.sheet.open({
      title: s.id === 'base' ? 'Baseline' : 'Scenario',
      body: [h('div.label', { style: { margin: '0 0 6px 2px' } }, 'Name'), name, colors,
        h('div.subhead', { style: { padding: '6px 2px' } }, 'Differences from Baseline'), diffList,
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '14px' } },
          h('button.btn', { onclick: () => { store().setActive(id); UI.sheet.close(); RP.app.go('plan'); } }, UI.icon('edit'), 'Edit inputs'),
          h('button.btn', { onclick: () => { const c = store().addScenario(id); UI.toast('Duplicated'); Sc.edit(c.id, back); } }, UI.icon('copy'), 'Duplicate'),
          s.id !== 'base' ? h('button.btn', { onclick: () => { store().resetScenario(id); UI.toast('Reset to preset'); Sc.edit(id, back); } }, UI.icon('refresh'), 'Reset') : null,
          s.id !== 'base' ? h('button.btn.danger', { onclick: () => { store().deleteScenario(id); UI.toast('Deleted', 'Undo', () => store().undo()); back ? Sc.manage() : UI.sheet.close(); } }, UI.icon('trash'), 'Delete') : null)],
      actions: [{ label: 'Back', onClick: () => (back ? Sc.manage() : UI.sheet.close()) }, { label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
  };

  function fieldLabel(path) {
    const P = store().state.plan;
    for (const g of RP.PLAN_GROUPS) for (const f of g.fields) {
      if (f.path === path) return typeof f.label === 'function' ? f.label(P) : f.label;
    }
    return path.split('.').slice(-2).join(' ').replace(/([A-Z])/g, ' $1').toLowerCase();
  }
  function valueText(path, v) {
    const P = store().planFor(store().state.active);
    for (const g of RP.PLAN_GROUPS) for (const f of g.fields) if (f.path === path) return UI.plan.display(f, v, P);
    return short(v);
  }
  function short(v) {
    if (typeof v === 'boolean') return v ? 'On' : 'Off';
    if (typeof v === 'number') return Math.abs(v) >= 1000 ? UI.fmt.money(v) : String(v);
    if (Array.isArray(v)) return `${v.length} items`;
    if (v && typeof v === 'object') return 'Changed';
    return String(v);
  }
  Sc.fieldLabel = fieldLabel;
})(globalThis.RP = globalThis.RP || {});
