/*
 * app.js — starts the app and keeps everything in sync:
 *   - loads your saved plan (or the sample), asks for the PIN
 *   - switches between the five tabs
 *   - whenever an input changes: refreshes the screen right away, then asks
 *     the background worker for new results and animates them in
 *   - import / export of plan files
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
    { key: 'plan', label: 'Plan', icon: 'plan', title: 'Plan' },
    { key: 'checklist', label: 'Checklist', icon: 'check', title: 'Checklist' },
  ];
  let tab = 'home';
  const views = {};
  let topbar, titleEl, pill;
  App.last = null; // latest analysis of the active scenario

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
      runMetrics();
    }).catch((e) => { if (e.message !== 'stale') { console.error(e); UI.home.setBusy(false); } });
  }, 140);

  const runMetrics = UI.debounce(() => {
    const plan = store.activePlan();
    UI.home.clearMetrics();
    RP.engineClient.metrics(plan, ['safe', 'green', 'coast'], (key, value) => {
      UI.home.metricsArrived(key);
      UI.home.updateMetrics({ [key]: value });
    }).catch((e) => { if (e.message !== 'cancelled') console.error(e); });
  }, 500);

  function onStoreChange(what) {
    if (what === 'plan-quiet') return;
    paintPill();
    UI.home.syncInputs();
    if (['plan', 'active', 'import', 'scenarios'].includes(what)) {
      RP.engineClient.cancelSlow();
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

  App.exportFile = async function () {
    const data = JSON.stringify(store.exportData(), null, 2);
    const name = `retirement-plan-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([data], { type: 'application/json' });
    try {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Retirement plan backup' });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    UI.toast('Backup saved');
  };

  // ------------------------------------------------------------------- boot
  App.start = async function () {
    store.load();
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
    await RP.pin.boot();
  };

  document.addEventListener('DOMContentLoaded', () => App.start());
})(globalThis.RP = globalThis.RP || {});
