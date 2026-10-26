/*
 * app.js — starts the app and keeps everything in sync:
 *   - loads your saved plan (or the sample), raises the sky, asks for the PIN
 *   - switches between the six tabs
 *   - whenever an input changes: refreshes the screen right away, then asks
 *     the background worker for new results and animates them in
 *   - import / export of plan files, and the year-by-year spreadsheet
 *   - appearance: light / dark, and the sky scene
 *   - registers the service worker so the app works offline
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h;
  const store = RP.store;
  const App = (RP.app = {});
  const TABS = [
    { key: 'home', label: 'Home', icon: 'home', title: 'Home' },
    { key: 'timeline', label: 'Timeline', icon: 'timeline', title: 'Timeline' },
    { key: 'compare', label: 'Compare', icon: 'compare', title: 'Compare' },
    { key: 'lab', label: 'Lab', icon: 'flask', title: 'Lab' },
    { key: 'plan', label: 'Plan', icon: 'plan', title: 'Plan' },
    { key: 'checklist', label: 'Checklist', icon: 'check', title: 'Checklist' },
  ];
  let tab = 'home';
  const views = {};
  let topbar, titleEl, pill;
  App.last = null; // latest analysis of the active scenario
  App.metrics = {}; // its safe spending, earliest age, green light and Coast FIRE, as they arrive

  // ------------------------------------------------------------------ layout
  function buildShell() {
    const app = document.getElementById('app');
    pill = h('button.scenario-pill', { onclick: () => UI.scenarios.pick('Show which scenario?', (id) => store.setActive(id)) });
    titleEl = h('div.topbar-title', 'Home');
    const undoBtn = h('button.icon-btn', { 'aria-label': 'Undo', onclick: () => { if (store.undo()) UI.toast('Undone'); else UI.toast('Nothing to undo'); } }, UI.icon('undo'));
    topbar = h('header.topbar', pill, titleEl, undoBtn);
    const viewsEl = h('main.views');
    for (const t of TABS) { views[t.key] = h('section.view', { id: 'view-' + t.key, 'aria-label': t.title }); viewsEl.appendChild(views[t.key]); }
    const bar = h('nav.tabbar', { 'aria-label': 'Main' }, h('div.tabbar-inner', TABS.map((t) =>
      h('button.tab', { 'data-tab': t.key, onclick: () => App.go(t.key) }, UI.icon(t.icon), h('span', t.label)))));
    UI.mount(app, topbar, viewsEl, bar);
    window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', window.scrollY > 30), { passive: true });
  }

  function paintPill() {
    const sc = store.scenario();
    UI.mount(pill, h('span.dot', { style: { background: `var(--s${sc.color})` } }), h('span', sc.name), UI.icon('chevronDown', 'chev'));
    pill.querySelector('svg').style.cssText = 'width:14px;height:14px;color:var(--muted)';
  }

  /** Switch tabs. */
  App.go = function (key) {
    tab = key;
    for (const t of TABS) views[t.key].classList.toggle('active', t.key === key);
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === key));
    titleEl.textContent = (TABS.find((t) => t.key === key) || {}).title || '';
    try { sessionStorage.setItem('rp.tab', key); } catch (e) { /* ignore */ }
    renderTab(key);
    window.scrollTo({ top: 0, behavior: UI.reducedMotion() ? 'auto' : 'instant' });
  };
  App.tab = () => tab;

  function renderTab(key) {
    if (key === 'plan') UI.plan.render(views.plan);
    else if (key === 'compare') UI.compare ? UI.compare.render(views.compare) : placeholder(views.compare, 'Compare', 'Charts arrive in the next stage.');
    else if (key === 'timeline') UI.timeline ? UI.timeline.render(views.timeline, App.last) : placeholder(views.timeline, 'Timeline', 'Coming soon.');
    else if (key === 'checklist') UI.checklist ? UI.checklist.render(views.checklist) : placeholder(views.checklist, 'Checklist', 'Coming soon.');
    else if (key === 'lab') UI.lab.render(views.lab);
  }
  function placeholder(el, title, text) { UI.mount(el, h('h1.large-title', title), h('div.card', h('p.muted', text))); }

  // ------------------------------------------------------------- recalculation
  const runAnalysis = UI.debounce(() => {
    const plan = store.activePlan();
    UI.home.setBusy(true);
    RP.engineClient.analyze(plan, {}).then((a) => {
      App.last = a;
      UI.home.update(a);
      UI.home.setBusy(false);
      if (tab === 'timeline' && UI.timeline) UI.timeline.render(views.timeline, a);
      if (UI.compare && UI.compare.onActiveResult) UI.compare.onActiveResult(a);
      if (tab === 'lab') UI.lab.onResult(a);
      runMetrics();
    }).catch((e) => { if (e.message !== 'stale') { console.error(e); UI.home.setBusy(false); } });
  }, 140);

  const runMetrics = UI.debounce(() => {
    const plan = store.activePlan();
    UI.home.clearMetrics();
    App.metrics = {};
    RP.engineClient.metrics(plan, ['safe', 'earliest', 'green', 'coast'], (key, value) => {
      App.metrics[key] = value;
      UI.home.metricsArrived(key);
      UI.home.updateMetrics({ [key]: value });
      if (tab === 'lab') UI.lab.onMetrics(key);
    }).then(() => UI.levers.refresh())
      .catch((e) => { if (e.message !== 'cancelled') console.error(e); });
  }, 500);

  function onStoreChange(what) {
    if (what === 'plan-quiet') return;
    keepStorage();
    paintPill();
    UI.home.syncInputs();
    if (['plan', 'active', 'import', 'scenarios'].includes(what)) {
      RP.engineClient.cancelSlow();
      UI.levers.invalidate();
      runAnalysis();
    }
    if (what === 'compare' || what === 'scenarios' || what === 'plan' || what === 'import') {
      if (UI.compare && UI.compare.invalidate) UI.compare.invalidate();
    }
    if (tab !== 'home') renderTabSoon();
  }
  const renderTabSoon = UI.debounce(() => renderTab(tab), 120);
  App.refreshPlan = () => { if (tab === 'plan') UI.plan.render(views.plan); };

  // ------------------------------------------------------------ import/export
  App.importFile = function () {
    const input = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        const info = store.importData(JSON.parse(text));
        UI.sheet.close();
        UI.toast(`Imported ${info.name || 'plan'}`);
        App.go('home');
      } catch (e) {
        UI.sheet.open({ title: 'Couldn’t import', body: h('p.tip-text', e.message || 'That file couldn’t be read.') });
      }
    });
    document.body.appendChild(input);
    input.click();
  };

  /**
   * Hand a file to the phone's share sheet, or download it where sharing files
   * isn't supported. Resolves 'shared', 'downloaded' or null (cancelled).
   */
  App.saveFile = async function (blob, name, title) {
    try {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return 'shared';
      }
    } catch (e) { if (e && e.name === 'AbortError') return null; }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'downloaded';
  };
  const today = () => new Date().toISOString().slice(0, 10);

  App.exportFile = async function () {
    const data = JSON.stringify(store.exportData(), null, 2);
    const how = await App.saveFile(new Blob([data], { type: 'application/json' }), `retirement-plan-backup-${today()}.json`, 'Retirement plan backup');
    if (!how) return;
    store.markBackedUp();
    if (how === 'downloaded') UI.toast('Backup saved');
    UI.home.refreshAlerts();
    App.refreshPlan();
  };

  /** The year-by-year table (typical market, today's dollars) as a spreadsheet file. */
  App.exportCsv = async function (a, scenarioName) {
    a = a || App.last;
    if (!a) { UI.toast('Still calculating…'); return; }
    const P = a.plan;
    const cols = [
      ['Year', (r) => r.year], [`${P.people.p1.name} age`, (r) => r.ages.p1], [`${P.people.p2.name} age`, (r) => r.ages.p2],
      ['Working', (r) => (r.working ? 'yes' : 'no')],
      ['Paychecks & severance', (r) => r.income.wages], ['Part-time work', (r) => r.income.partTime], ['Social Security', (r) => r.income.ss],
      ['Unemployment', (r) => r.income.ui], ['Disability benefit', (r) => r.income.disability], ['Windfalls & other income', (r) => r.income.windfall],
      ['Everyday spending', (r) => r.spending.core], ['Daycare', (r) => r.spending.daycare], ['Extra health costs', (r) => r.spending.health],
      ['College', (r) => r.spending.college], ['Extras', (r) => r.spending.extras], ['Mortgage change', (r) => r.spending.mortgageAdj],
      ['From cash & brokerage', (r) => r.src.cash], ['From Roth contributions', (r) => r.src.rothBasis], ['From Roth conversions', (r) => r.src.rothConversions],
      ['From Roth growth', (r) => r.src.rothEarnings], ['From 401k / IRA', (r) => r.src.preTax], ['From HSA', (r) => r.src.hsa], ['Penalty withdrawals', (r) => r.src.penalty],
      ['Roth conversions', (r) => r.converted], ['MAGI', (r) => r.magi],
      ['Federal tax', (r) => r.taxes.federal], ['State tax', (r) => r.taxes.state], ['Payroll tax', (r) => r.taxes.fica], ['Penalties', (r) => r.taxes.penalty],
      ['Health coverage', (r) => UI.fmt.coverage(r.health.status)],
      ['Saved to retirement accounts', (r) => r.saving.pre401k + r.saving.match + r.saving.hsa + r.saving.rothIra + r.saving.mega],
      ['Saved to brokerage', (r) => r.saving.taxable + r.saving.leftover],
      ['Pre-tax balance', (r) => r.balances.preTax], ['Roth balance', (r) => r.balances.roth], ['HSA balance', (r) => r.balances.hsa],
      ['Cash & taxable balance', (r) => r.balances.taxable], ['Total savings', (r) => r.balances.total],
      ['Home equity', (r) => r.balances.homeEquity], ['Net worth', (r) => r.balances.netWorth],
    ];
    const cell = (v) => (typeof v === 'number' ? String(Math.round(v)) : /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const lines = [cols.map(([t]) => cell(t)), ...a.rows.map((r) => cols.map(([, f]) => cell(f(r))))].map((l) => l.join(','));
    const slug = String(scenarioName || store.scenario().name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'plan';
    // The byte-order mark tells Excel the file is UTF-8 (names, the ’ in labels).
    const how = await App.saveFile(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' }), `retirement-${slug}-${today()}.csv`, 'Year-by-year projection');
    if (how === 'downloaded') UI.toast('Spreadsheet saved: typical market, today’s dollars');
  };

  // ------------------------------------------------------------- appearance
  /** Auto follows the phone; Light or Dark pins it. Night scenes (Aurora, Synthwave, Nebula) are always dark. */
  function themeAttr() {
    const root = document.documentElement;
    const { theme: t, scene } = store.state.settings;
    const night = scene && scene !== 'horizon' && UI.sky.SCENES.some((s) => s.key === scene);
    if (night) root.dataset.scene = scene; else delete root.dataset.scene;
    if (night) root.dataset.theme = 'dark';
    else if (t === 'light' || t === 'dark') root.dataset.theme = t;
    else delete root.dataset.theme;
  }
  function restyle() {
    themeAttr();
    UI.sky.repaint();
    UI.charts.applyTheme();
    UI.lab.repaint();
  }
  App.setTheme = function (t) { store.updateSettings({ theme: t }); restyle(); };
  App.setScene = function (s) { store.updateSettings({ scene: s }); restyle(); };

  /** Ask the browser not to clear this site's storage when space runs low (once, for a real plan). */
  let persistAsked = false;
  function keepStorage() {
    if (persistAsked || store.state.plan.meta.isSample || !(navigator.storage && navigator.storage.persist)) return;
    persistAsked = true;
    navigator.storage.persist().catch(() => { /* not granted: nothing to do */ });
  }

  // ------------------------------------------------------------------- boot
  App.start = async function () {
    store.load();
    themeAttr();
    UI.sky.mount();
    buildShell();
    UI.home.build(views.home);
    paintPill();
    UI.home.syncInputs();
    store.on(onStoreChange);
    let start = 'home';
    try { start = sessionStorage.getItem('rp.tab') || 'home'; } catch (e) { /* ignore */ }
    App.go(start);
    runAnalysis();
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
    }
    keepStorage();
    await RP.pin.boot();
  };

  document.addEventListener('DOMContentLoaded', () => App.start());
})(globalThis.RP = globalThis.RP || {});
