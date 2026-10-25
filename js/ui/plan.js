/*
 * plan.js — the Plan tab: collapsible input groups, each with an Advanced
 * switch, and bottom-sheet editors for every input. Edits apply to whichever
 * scenario you're editing (Baseline by default); inputs that differ from
 * Baseline show a small colored dot.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt, U = RP.util;
  const store = () => RP.store;
  const open = new Set(['retirement']);
  const advanced = new Set();
  let root = null;

  const Plan = (UI.plan = {});

  // ---------------------------------------------------------------- formatting
  function labelOf(f, P) { return typeof f.label === 'function' ? f.label(P) : f.label; }
  function optionsOf(f, P) { return typeof f.options === 'function' ? f.options(P) : f.options || []; }
  function display(f, v, P) {
    if (v == null || v === '') return f.nullable ? 'Auto' : '—';
    switch (f.type) {
      case 'money': return fmt.money(v, { full: true });
      case 'pct': return fmt.num(f.scale ? v * f.scale : v, 2).replace(/\.?0+$/, '') + '%';
      case 'month': return fmt.monthName(v);
      case 'date': return fmt.date(v);
      case 'select': { const o = optionsOf(f, P).find((x) => x.value === v); return o ? o.label : String(v); }
      case 'kids': return `${(v || []).length}`;
      case 'taxableList': return (v || []).map((t) => `${fmt.money(t.amount)} ${t.firstYear}${t.lastYear ? '–' + t.lastYear : '+'}`).join(', ') || 'None';
      case 'recurring': case 'oneTime': return `${(v || []).length}`;
      case 'phases': return v && v.enabled ? `${(v.list || []).length} phases` : 'Off';
      case 'collegeKids': return `${(v || []).filter((k) => k.enabled).length} of ${(v || []).length}`;
      case 'ssRecord': return (v || []).length ? `${v.length} years` : 'Not entered';
      case 'brackets': return `${(v || []).length} brackets`;
      default: return String(v);
    }
  }
  Plan.display = display;

  // ---------------------------------------------------------------- render
  Plan.render = function (el) {
    root = el || root;
    if (!root) return;
    const st = store().state;
    const P = store().activePlan();
    const sc = store().scenario();
    const isBase = sc.id === 'base';
    const color = `var(--s${sc.color})`;
    const nOver = Object.keys(sc.overrides || {}).length;

    const head = h('div.card',
      h('div.card-title', h('span', 'Editing'), h('span.grow'),
        store().canUndo() ? h('button.link-btn', { onclick: () => { store().undo(); UI.toast('Undone'); } }, 'Undo') : null),
      h('button.row', { style: { padding: '0', minHeight: '40px' }, onclick: () => UI.scenarios && UI.scenarios.pick('Edit which scenario?', (id) => store().setActive(id)) },
        h('span.row-label', h('span.badge-diff', { style: { background: color, width: '10px', height: '10px' } }), h('span.txt', { style: { fontWeight: 600, fontSize: '19px' } }, sc.name)),
        h('span.row-value', isBase ? 'Baseline' : `${nOver} change${nOver === 1 ? '' : 's'}`), UI.icon('chevron', 'chev')),
      isBase ? h('div.value-sub', 'Changes here flow into every scenario unless that scenario overrides them.')
        : h('div.value-sub', 'Changes here only affect this scenario. Dots mark inputs that differ from Baseline.'));

    const groups = RP.PLAN_GROUPS.map((g) => renderGroup(g, P, sc, color));

    const stt = st.settings;
    const tools = h('div',
      h('div.section-label', 'Tools'),
      h('div.list',
        UI.row({ label: 'Scenarios', value: `${st.scenarios.length}`, onClick: () => UI.scenarios && UI.scenarios.manage() }),
        UI.row({ label: 'Annual check-in', value: st.history.length ? 'Last ' + st.history[st.history.length - 1].date.slice(0, 7) : 'Start', onClick: () => UI.checkin && UI.checkin.start() }),
        UI.row({ label: 'Assumptions', value: 'Plain English', onClick: () => UI.assumptions && UI.assumptions.open() })),
      h('div.section-label', 'Settings'),
      h('div.list',
        UI.row({ label: 'Appearance', value: THEMES.find((t) => t.value === (stt.theme || 'auto')).label, onClick: themeSheet }),
        UI.row({ label: 'PIN lock', value: stt.pinHash ? 'On' : 'Off', onClick: () => RP.pin.settings() })),
      h('div.section-label', 'Data & privacy'),
      h('div.list',
        UI.row({ label: 'Export backup', value: stt.lastBackup ? 'Last ' + fmt.date(stt.lastBackup) : '.json', onClick: () => RP.app.exportFile() }),
        UI.row({ label: 'Import plan file', value: '.json', onClick: () => RP.app.importFile() }),
        UI.row({ label: 'Year-by-year spreadsheet', value: '.csv', onClick: () => RP.app.exportCsv() }),
        UI.row({ label: 'Set up a new plan', value: '', onClick: () => UI.setup.start() }),
        UI.row({ label: 'Reset everything to the sample', value: '', onClick: confirmResetAll })),
      h('p.footer-note', 'Your plan is stored only on this device. Nothing is sent anywhere.'));

    // Search: type a few letters to find any input without opening groups.
    const results = h('div', { hidden: !query.trim() });
    const browse = h('div', { hidden: !!query.trim() }, groups, tools);
    const search = h('input.textfield.plan-search', { type: 'search', placeholder: 'Search inputs, e.g. Roth', value: query, 'aria-label': 'Search inputs', autocomplete: 'off', enterkeyhint: 'search' });
    search.addEventListener('input', () => {
      query = search.value;
      results.hidden = !query.trim(); browse.hidden = !results.hidden;
      paintResults(results, P, sc, color);
    });
    paintResults(results, P, sc, color);

    UI.mount(root, h('h1.large-title', 'Plan'), head, search, results, browse);
  };

  // ---------------------------------------------------------------- search
  let query = '';
  /** Every visible input whose label, group or explanation has all the typed words. */
  function paintResults(el, P, sc, color) {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { UI.mount(el); return; }
    const sections = [];
    for (const g of RP.PLAN_GROUPS) {
      for (const f of g.fields) {
        if (f.show && !f.show(P)) continue;
        const tip = f.tip && RP.TIPS[f.tip];
        const hay = [labelOf(f, P), g.title, tip ? tip.title : '', f.note || '', f.person ? P.people[f.person].name : ''].join(' ').toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
        const title = g.title + (f.person && g.fields.filter((x) => x.person).length > 2 ? ' · ' + P.people[f.person].name : '');
        let sec = sections[sections.length - 1];
        if (!sec || sec.title !== title) sections.push(sec = { title, rows: [] });
        sec.rows.push(fieldRow(f, P, sc, color));
      }
    }
    UI.mount(el, sections.length
      ? h('div.list', sections.map((s) => [h('div.subhead', s.title), s.rows]))
      : h('div.card', h('p.muted', { style: { margin: 0 } }, `No inputs match “${query.trim()}”.`)));
  }

  // ---------------------------------------------------------------- appearance
  const THEMES = [{ value: 'auto', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
  function themeSheet() {
    UI.sheet.open({
      title: 'Appearance',
      body: [
        UI.segmented({ options: THEMES, value: store().state.settings.theme || 'auto', onChange: (t) => { RP.app.setTheme(t); Plan.render(); } }),
        h('p.tip-text.muted', { style: { marginTop: '14px', fontSize: '14px' } }, 'Automatic follows your phone’s light or dark setting. The sky keeps its time of day either way.'),
      ],
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
  }

  function renderGroup(g, P, sc, color) {
    const isOpen = open.has(g.key);
    const adv = advanced.has(g.key);
    const hasAdv = g.fields.some((f) => f.adv);
    const diffCount = sc.id === 'base' ? 0 : g.fields.filter((f) => store().isOverridden(f.path)).length;
    const body = h('div.group-body');
    if (isOpen) {
      let lastPerson = null;
      for (const f of g.fields) {
        if (f.adv && !adv) continue;
        if (f.show && !f.show(P)) continue;
        if (f.person && f.person !== lastPerson && g.fields.filter((x) => x.person).length > 2) {
          body.appendChild(h('div.subhead', P.people[f.person].name));
        }
        lastPerson = f.person || lastPerson;
        body.appendChild(fieldRow(f, P, sc, color));
        if (f.note && !f.adv) body.appendChild(h('div.row-note', f.note));
      }
      const foot = h('div.adv-row',
        hasAdv ? h('span', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, 'Advanced',
          UI.toggle({ checked: adv, label: 'Advanced', onChange: (on) => { if (on) advanced.add(g.key); else advanced.delete(g.key); Plan.render(); } })) : h('span'),
        g.reset && g.reset.length ? h('button.link-btn', { onclick: () => confirmResetSection(g) }, sc.id === 'base' ? 'Reset section' : 'Match Baseline') : null);
      body.appendChild(foot);
    }
    const sub = typeof g.sub === 'function' ? safe(() => g.sub(P)) : '';
    return h('div.list.group' + (isOpen ? '.open' : ''),
      h('button.group-head', { type: 'button', onclick: () => { if (open.has(g.key)) open.delete(g.key); else open.add(g.key); Plan.render(); } },
        h('span.g-ico', UI.icon(g.icon)),
        h('span', { style: { flex: 1, minWidth: 0 } }, h('div.g-title', g.title), h('div.g-sub', sub)),
        diffCount ? h('span.pill', { style: { background: 'transparent', color } }, `${diffCount}`) : null,
        UI.icon('chevron', 'chev')),
      body);
  }
  function safe(fn) { try { return fn(); } catch (e) { return ''; } }

  function fieldRow(f, P, sc, color) {
    const v = U.getPath(P, f.path);
    const diff = sc.id !== 'base' && store().isOverridden(f.path);
    const label = labelOf(f, P);
    if (f.type === 'toggle') {
      return UI.toggleRow({ label, checked: !!v, tip: f.tip, diff, diffColor: color, onChange: (on) => { store().set(f.path, on); } });
    }
    return UI.row({ label, value: display(f, v, P), tip: f.tip, diff, diffColor: color, onClick: () => Plan.edit(f) });
  }

  // ---------------------------------------------------------------- editors
  /** Open the right editor for a field, in a bottom sheet. */
  Plan.edit = function (f) {
    const P = store().activePlan();
    const sc = store().scenario();
    const label = labelOf(f, P);
    const v = U.getPath(P, f.path);
    const tip = f.tip && RP.TIPS[f.tip];
    const note = sc.id === 'base' ? null : h('div', { style: { marginBottom: '12px' } }, h('span.pill', { style: { color: `var(--s${sc.color})` } }, 'Only in ' + sc.name));
    const commit = UI.debounce((val) => store().set(f.path, val), 120);
    let editor;

    if (['money', 'pct', 'int', 'year', 'age'].includes(f.type)) {
      const scale = f.scale || 1;
      const step = f.step || 1;
      const fmtv = f.type === 'money' ? (x) => fmt.money(x, { full: true })
        : f.type === 'pct' ? (x) => fmt.num(x, step < 1 ? 2 : 0).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '%'
          : (x) => String(Math.round(x));
      const start = v == null ? (f.type === 'year' ? new Date().getFullYear() : f.min || 0) : v * scale;
      editor = UI.numberEditor({
        value: start, min: f.min, max: f.max, step, sliderMin: f.sliderMin != null ? f.sliderMin : f.min, sliderMax: f.sliderMax != null ? f.sliderMax : f.max,
        format: fmtv, decimal: f.type === 'pct', label,
        parse: (t) => Number(String(t).replace(/[^0-9.\-]/g, '')),
        onInput: (x) => commit(x / scale), onChange: (x) => commit(x / scale),
      });
      if (f.nullable) {
        editor = h('div', editor, h('button.btn.small', { style: { marginTop: '10px' }, onclick: () => { store().set(f.path, null); UI.sheet.close(); } }, 'Use automatic'));
      }
    } else if (f.type === 'month') {
      editor = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' } },
        Array.from({ length: 12 }, (_, i) => h('button.btn.small' + (v === i + 1 ? '.primary' : ''), {
          onclick: (e) => { store().set(f.path, i + 1); e.currentTarget.parentNode.querySelectorAll('button').forEach((b, j) => b.classList.toggle('primary', j === i)); },
        }, fmt.monthName(i + 1))));
    } else if (f.type === 'select') {
      const opts = optionsOf(f, P);
      editor = opts.length <= 4
        ? UI.segmented({ options: opts, value: v, onChange: (x) => store().set(f.path, x) })
        : h('div.list', opts.map((o) => UI.row({ label: o.label, value: o.value === v ? '✓' : '', onClick: () => { store().set(f.path, o.value); UI.sheet.close(); } })));
    } else if (f.type === 'text') {
      const input = h('input.textfield', { type: 'text', value: v || '', autocomplete: 'off' });
      input.addEventListener('input', () => commit(input.value));
      editor = input;
    } else if (f.type === 'date') {
      const input = h('input.textfield', { type: 'date', value: v || '' });
      input.addEventListener('change', () => store().set(f.path, input.value));
      editor = h('div', input, h('button.btn.small', { style: { marginTop: '10px' }, onclick: () => { const t = new Date().toISOString().slice(0, 10); input.value = t; store().set(f.path, t); } }, 'Today'));
    } else if (Plan.listEditors[f.type]) {
      return Plan.listEditors[f.type](f, P, label, note);
    } else {
      editor = h('p', 'This input can’t be edited here yet.');
    }

    const actions = [
      { label: sc.id === 'base' ? 'Reset' : 'Match Baseline', onClick: () => { store().reset(f.path); UI.sheet.close(); UI.toast('Reset'); } },
      { label: 'Done', primary: true, onClick: () => UI.sheet.close() },
    ];
    UI.sheet.open({
      title: label,
      body: [note, editor, f.note ? h('p.tip-text.muted', { style: { marginTop: '14px' } }, f.note) : null,
        tip ? h('p.tip-text.muted', { style: { marginTop: '14px', fontSize: '14px' } }, tip.text) : null],
      actions,
    });
  };

  // ---------------------------------------------------------------- list editors
  /** A small labeled input used inside list editors. */
  function mini(label, value, onChange, opts) {
    opts = opts || {};
    const input = h('input.textfield', { type: opts.type || 'text', inputmode: opts.inputmode || (opts.type === 'number' ? 'numeric' : undefined), value: value == null ? '' : value, style: { height: '42px', fontSize: '16px' } });
    input.addEventListener('change', () => onChange(opts.type === 'number' ? (input.value === '' ? null : Number(input.value)) : input.value));
    return h('label', { style: { display: 'block', flex: opts.flex || 1, minWidth: 0 } }, h('div.label', { style: { margin: '0 0 4px 2px' } }, label), input);
  }
  function listSheet(title, note, renderItems, onAdd, addLabel, extra) {
    const body = h('div');
    const draw = () => UI.mount(body, note, extra ? extra() : null, renderItems(draw), onAdd ? h('button.btn.block', { style: { marginTop: '6px' }, onclick: () => { onAdd(); draw(); } }, UI.icon('plus'), addLabel || 'Add') : null);
    draw();
    UI.sheet.open({ title, body, actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }] });
  }
  const itemCard = (...kids) => h('div.card', { style: { padding: '14px', marginBottom: '10px' } }, ...kids);
  const rowFlex = (...kids) => h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } }, ...kids);
  const delBtn = (onClick) => h('button.icon-btn', { 'aria-label': 'Delete', onclick: onClick, style: { color: 'var(--bad)' } }, UI.icon('trash'));

  function editList(path, mutate) {
    const P = store().activePlan();
    const list = U.clone(U.getPath(P, path) || []);
    mutate(list);
    store().set(path, list);
  }

  Plan.listEditors = {
    kids(f, P, label, note) {
      listSheet('Kids', note, (redraw) => {
        const kids = store().activePlan().kids || [];
        return kids.map((k, i) => itemCard(
          h('div', { style: { display: 'flex', alignItems: 'center' } }, h('b', { style: { flex: 1 } }, k.name || 'Child ' + (i + 1)), delBtn(() => { editList('kids', (l) => l.splice(i, 1)); redraw(); })),
          rowFlex(
            mini('Name', k.name, (x) => editList('kids', (l) => { l[i].name = x; })),
            mini('Born', k.birthYear, (x) => editList('kids', (l) => { l[i].birthYear = x; }), { type: 'number', flex: 0.7 }),
            mini('Month', k.birthMonth, (x) => editList('kids', (l) => { l[i].birthMonth = x; }), { type: 'number', flex: 0.6 }))));
      }, () => editList('kids', (l) => l.push({ name: 'Child ' + (l.length + 1), birthYear: new Date().getFullYear(), birthMonth: 1 })), 'Add child');
    },
    taxableList(f, P, label, note) {
      listSheet(label, [note, h('p.tip-text.muted', { style: { marginTop: 0 } }, 'Planned yearly savings into your taxable brokerage. Leave “through” blank to keep going until you retire.')], (redraw) => {
        const list = U.getPath(store().activePlan(), f.path) || [];
        return list.map((t, i) => itemCard(
          h('div', { style: { display: 'flex', alignItems: 'center' } }, h('b', { style: { flex: 1 } }, fmt.money(t.amount, { full: true }) + '/yr'), delBtn(() => { editList(f.path, (l) => l.splice(i, 1)); redraw(); })),
          rowFlex(
            mini('Per year', t.amount, (x) => editList(f.path, (l) => { l[i].amount = x || 0; }), { type: 'number' }),
            mini('From', t.firstYear, (x) => editList(f.path, (l) => { l[i].firstYear = x; }), { type: 'number', flex: 0.7 }),
            mini('Through', t.lastYear, (x) => editList(f.path, (l) => { l[i].lastYear = x; }), { type: 'number', flex: 0.7 }))));
      }, () => editList(f.path, (l) => l.push({ amount: 10000, firstYear: new Date().getFullYear() + 1, lastYear: null })), 'Add savings period');
    },
    recurring(f, P, label, note) {
      listSheet('Recurring expenses', [note, h('p.tip-text.muted', { style: { marginTop: 0 } }, 'On top of normal spending. “Every” = how often it repeats (8 = a car every 8 years).')], (redraw) => {
        const list = store().activePlan().spending.recurring || [];
        return list.map((r, i) => itemCard(
          h('div', { style: { display: 'flex', alignItems: 'center' } }, h('b', { style: { flex: 1 } }, r.label || 'Expense'), delBtn(() => { editList(f.path, (l) => l.splice(i, 1)); redraw(); })),
          rowFlex(mini('Label', r.label, (x) => editList(f.path, (l) => { l[i].label = x; })), mini('Amount', r.amount, (x) => editList(f.path, (l) => { l[i].amount = x || 0; }), { type: 'number', flex: 0.8 })),
          rowFlex(
            mini('From', r.firstYear, (x) => editList(f.path, (l) => { l[i].firstYear = x; }), { type: 'number' }),
            mini('Through', r.lastYear, (x) => editList(f.path, (l) => { l[i].lastYear = x; }), { type: 'number' }),
            mini('Every (yrs)', r.every, (x) => editList(f.path, (l) => { l[i].every = Math.max(1, x || 1); }), { type: 'number', flex: 0.8 }))));
      }, () => editList(f.path, (l) => l.push({ id: 'r' + Date.now().toString(36), label: 'Car', amount: 40000, firstYear: new Date().getFullYear() + 5, lastYear: new Date().getFullYear() + 45, every: 8 })), 'Add recurring expense');
    },
    oneTime(f, P, label, note) {
      const kinds = [{ value: 'expense', label: 'Expense' }, { value: 'windfall', label: 'Windfall' }, { value: 'income', label: 'Taxable' }];
      listSheet('One-time events', [note, h('p.tip-text.muted', { style: { marginTop: 0 } }, 'Expense: a big cost (roof, car). Windfall: money in, not taxed (inheritance). Taxable: money in that’s taxed (bonus).')], (redraw) => {
        const list = store().activePlan().spending.oneTime || [];
        return list.map((o, i) => itemCard(
          h('div', { style: { display: 'flex', alignItems: 'center' } }, h('b', { style: { flex: 1 } }, `${o.label || 'Event'} · ${o.year}`), delBtn(() => { editList(f.path, (l) => l.splice(i, 1)); redraw(); })),
          rowFlex(mini('Label', o.label, (x) => editList(f.path, (l) => { l[i].label = x; })), mini('Year', o.year, (x) => editList(f.path, (l) => { l[i].year = x; }), { type: 'number', flex: 0.6 })),
          rowFlex(mini('Amount', o.amount, (x) => editList(f.path, (l) => { l[i].amount = x || 0; }), { type: 'number' })),
          h('div', { style: { marginTop: '10px' } }, UI.segmented({ options: kinds, value: o.kind || 'expense', onChange: (x) => editList(f.path, (l) => { l[i].kind = x; }) }))));
      }, () => editList(f.path, (l) => l.push({ id: 'o' + Date.now().toString(36), label: 'Roof', year: new Date().getFullYear() + 3, amount: 20000, kind: 'expense' })), 'Add event');
    },
    phases(f, P, label, note) {
      const path = 'spending.phases';
      const setPh = (fn) => { const ph = U.clone(store().activePlan().spending.phases); fn(ph); store().set(path, ph); };
      listSheet('Spending phases', [note, h('p.tip-text.muted', { style: { marginTop: 0 } }, `Retirement spending by ${P.people.p1.name}’s age. Ages not covered use your normal retirement spending.`)], (redraw) => {
        const ph = store().activePlan().spending.phases;
        return [
          UI.toggleRow({ label: 'Use spending phases', checked: ph.enabled, onChange: (on) => { setPh((x) => { x.enabled = on; }); redraw(); } }),
          ...(ph.list || []).map((p, i) => itemCard(
            h('div', { style: { display: 'flex', alignItems: 'center' } }, h('b', { style: { flex: 1 } }, `Ages ${p.fromAge}–${p.toAge}`), delBtn(() => { setPh((x) => x.list.splice(i, 1)); redraw(); })),
            rowFlex(
              mini('From age', p.fromAge, (x) => setPh((q) => { q.list[i].fromAge = x; }), { type: 'number' }),
              mini('To age', p.toAge, (x) => setPh((q) => { q.list[i].toAge = x; }), { type: 'number' }),
              mini('Per year', p.amount, (x) => setPh((q) => { q.list[i].amount = x || 0; }), { type: 'number', flex: 1.3 })))),
        ];
      }, () => setPh((x) => { x.list = x.list || []; const last = x.list[x.list.length - 1]; const from = last ? last.toAge + 1 : P.retirement.p1Age; x.list.push({ fromAge: from, toAge: from + 9, amount: P.spending.retirement }); x.enabled = true; }), 'Add phase',
      () => h('button.btn.block', { style: { marginBottom: '12px' }, onclick: () => { Plan.applySmile(); UI.sheet.close(); setTimeout(() => Plan.listEditors.phases(f, store().activePlan(), label, note), 350); } }, UI.icon('sparkle'), 'Fill in a spending smile'));
    },
    collegeKids(f, P, label, note) {
      listSheet('College', note, () => {
        const P2 = store().activePlan();
        const list = P2.college.kids || [];
        return (P2.kids || []).map((kid, i) => {
          const c = list[i] || { enabled: false, startYear: kid.birthYear + 18, years: 4, annualCost: 28000, coverPct: 50 };
          const setK = (fn) => editList('college.kids', (l) => { while (l.length <= i) l.push({ enabled: true, startYear: (P2.kids[l.length] || kid).birthYear + 18, years: 4, annualCost: 28000, coverPct: 50 }); fn(l[i]); });
          return itemCard(
            h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('b', { style: { flex: 1 } }, kid.name), UI.toggle({ checked: c.enabled, onChange: (on) => setK((k) => { k.enabled = on; }) })),
            rowFlex(mini('Starts', c.startYear, (x) => setK((k) => { k.startYear = x; }), { type: 'number' }), mini('Years', c.years, (x) => setK((k) => { k.years = x; }), { type: 'number', flex: 0.6 })),
            rowFlex(mini('Cost per year', c.annualCost, (x) => setK((k) => { k.annualCost = x || 0; }), { type: 'number' }), mini('You cover %', c.coverPct, (x) => setK((k) => { k.coverPct = x || 0; }), { type: 'number', flex: 0.7 })));
        });
      });
    },
    ssRecord(f, P, label, note) {
      const area = h('textarea.textfield', { style: { height: '180px', padding: '12px', fontSize: '15px', fontFamily: 'ui-monospace, Menlo, monospace' }, placeholder: '2006 21500\n2007 28400\n…' });
      const cur = U.getPath(P, f.path) || [];
      area.value = cur.map((r) => `${r.year} ${r.amount}`).join('\n');
      UI.sheet.open({
        title: label,
        body: [note, h('p.tip-text.muted', { style: { marginTop: 0 } }, 'Copy the “Earnings Record” table from your ssa.gov account: one year and amount per line. Amounts are indexed to today automatically. Leave empty to use the simple estimate.'), area],
        actions: [
          { label: 'Clear', onClick: () => { store().set(f.path, []); UI.sheet.close(); } },
          { label: 'Save', primary: true, onClick: () => {
            const rows = [];
            for (const line of area.value.split(/\n/)) {
              const m = line.replace(/[$,]/g, '').match(/(\d{4})\D+(\d+(?:\.\d+)?)/);
              if (m) rows.push({ year: Number(m[1]), amount: Number(m[2]) });
            }
            store().set(f.path, rows); UI.sheet.close(); UI.toast(`Saved ${rows.length} years`);
          } },
        ],
      });
    },
    brackets(f, P, label, note) {
      listSheet(label, [note, h('p.tip-text.muted', { style: { marginTop: 0 } }, 'Each bracket: income up to this amount is taxed at this rate. Leave the last “up to” blank.')], (redraw) => {
        const list = U.getPath(store().activePlan(), f.path) || [];
        return list.map((b, i) => itemCard(rowFlex(
          mini('Up to', b[0], (x) => editList(f.path, (l) => { l[i][0] = x; }), { type: 'number' }),
          mini('Rate %', +(b[1] * 100).toFixed(3), (x) => editList(f.path, (l) => { l[i][1] = (x || 0) / 100; }), { type: 'number', flex: 0.6 }),
          h('div', { style: { alignSelf: 'flex-end' } }, delBtn(() => { editList(f.path, (l) => l.splice(i, 1)); redraw(); })))));
      }, () => editList(f.path, (l) => l.push([null, 0.4])), 'Add bracket');
    },
  };

  /** Spending smile: go-go, slow-go (about 1% less each year), no-go flat. */
  Plan.applySmile = function () {
    const P = store().activePlan();
    const base = P.spending.retirement;
    const a0 = P.retirement.p1Age + 1;
    const list = [{ fromAge: a0, toAge: 64, amount: base }];
    let amt = base;
    for (let a = 65; a <= 79; a += 5) {
      amt = Math.round((amt * Math.pow(0.99, 5)) / 500) * 500;
      list.push({ fromAge: a, toAge: a + 4, amount: amt });
    }
    list.push({ fromAge: 80, toAge: 120, amount: amt });
    store().set('spending.phases', { enabled: true, list: list.filter((x) => x.toAge >= x.fromAge) });
    UI.toast('Spending smile added');
  };

  function confirmResetSection(g) {
    const sc = store().scenario();
    UI.sheet.open({
      title: sc.id === 'base' ? `Reset ${g.title}?` : `Match Baseline for ${g.title}?`,
      body: h('p.tip-text', sc.id === 'base' ? 'Puts these inputs back to their default values. You can undo this.' : 'Removes this scenario’s changes in this section so it uses Baseline’s values.'),
      actions: [{ label: 'Cancel', onClick: () => UI.sheet.close() }, { label: 'Reset', primary: true, onClick: () => { store().resetSection(g.reset); UI.sheet.close(); UI.toast('Reset', 'Undo', () => store().undo()); } }],
    });
  }
  function confirmResetAll() {
    UI.sheet.open({
      title: 'Reset to the sample?',
      body: h('p.tip-text', 'This replaces your plan, scenarios and checklist with the fictional sample household. Export a backup first if you might want it back.'),
      actions: [
        { label: 'Cancel', onClick: () => UI.sheet.close() },
        { label: 'Reset', primary: true, onClick: () => { store().resetAll(); UI.sheet.close(); UI.toast('Reset to sample', 'Undo', () => store().undo()); } },
      ],
    });
  }

  Plan.openGroup = function (key) { open.add(key); };
  /** Jump to an input (used by alerts): open its group, then its editor. */
  Plan.focusField = function (path) {
    const g = RP.PLAN_GROUPS.find((x) => x.fields.some((f) => f.path === path));
    if (!g) return;
    const f = g.fields.find((x) => x.path === path);
    open.add(g.key);
    if (f.adv) advanced.add(g.key);
    query = '';
    RP.app.go('plan');
    Plan.render();
    setTimeout(() => Plan.edit(f), 250);
  };
})(globalThis.RP = globalThis.RP || {});
