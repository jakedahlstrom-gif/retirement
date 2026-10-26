/*
 * levers.js — the Home card "What moves the needle": one row per common change
 * (retire a year later, spend $5K less, claim Social Security at 70…) with how
 * far it moves your chance of success, biggest first. Tap a row to apply the
 * change or try it as a new scenario.
 *
 * The tests run in the background only while the card is open, after the
 * other numbers have settled.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const LV = (UI.levers = {});
  let card = null, body = null;
  let done = null;     // finished result: { key, P, base, runs, list }
  let pending = null;  // plan JSON being tested right now

  /** Words for one lever: row label and detail, scenario name, explanation. */
  function describe(lv, P) {
    const i = lv.info, n1 = P.people.p1.name;
    const who = (pids) => (pids.length === 2 ? 'Both of you' : P.people[pids[0]].name);
    switch (lv.key) {
      case 'later': return { label: 'Retire a year later', sub: `${n1} at ${i.age}`, name: `Retire at ${i.age}`,
        about: 'One more year of paychecks and saving, and one less year for your savings to cover.' };
      case 'earlier': return { label: 'Retire a year earlier', sub: `${n1} at ${i.age}`, name: `Retire at ${i.age}`,
        about: 'One less year of saving, and one more year for your savings to cover.' };
      case 'spendLess': return { label: `Spend ${fmt.money(i.step)} less in retirement`, sub: `${fmt.money(i.amount)} a year`, name: `Spend ${fmt.money(i.amount)}`,
        about: 'Your retirement budget, every year of retirement. Any spending phases scale along with it.' };
      case 'spendMore': return { label: `Spend ${fmt.money(i.step)} more in retirement`, sub: `${fmt.money(i.amount)} a year`, name: `Spend ${fmt.money(i.amount)}`,
        about: 'Your retirement budget, every year of retirement. Any spending phases scale along with it.' };
      case 'saveMore': return { label: `Spend ${fmt.money(i.step)} less while working`, sub: 'and invest the difference', name: `Save ${fmt.money(i.step)} more`,
        about: `Trim today’s spending by ${fmt.money(i.step)} a year until you retire. The extra cash flow goes into your brokerage account.` };
      case 'partTime': return { label: 'Work part-time after retiring', sub: `${n1}, ${fmt.money(i.amount)}/yr for 5 years`, name: `Part-time ${fmt.money(i.amount)}`,
        about: `${n1} earns ${fmt.money(i.amount)} a year from ${i.first} through ${i.last}, the first five years of retirement. It counts as income for taxes and health programs, and keeps Roth IRA contributions possible.` };
      case 'ss70': return { label: 'Claim Social Security at 70', sub: who(i.people), name: 'Claim SS at 70',
        about: 'Each year you wait past 67 adds 8% to your checks, for life. Savings cover the longer wait before they start.' };
      case 'ss67': return { label: 'Claim Social Security at 67', sub: who(i.people), name: 'Claim SS at 67',
        about: 'Checks start three years sooner, but they’re about 19% smaller for life than waiting until 70.' };
      case 'guardrailsOn': return { label: 'Trim spending in bad years', sub: `${i.cutPct}% cut when ${i.behindPct}% behind`, name: 'Spending guardrails',
        about: `Spending guardrails: in any retirement year your savings are more than ${i.behindPct}% behind the typical path, spend ${i.cutPct}% less. Small, temporary cuts like this protect against a bad run of markets.` };
      case 'guardrailsOff': return { label: 'Never trim spending', sub: 'Turn guardrails off', name: 'No guardrails',
        about: 'Spend the same amount every year, whatever markets do.' };
      case 'crashNow': return { label: `Markets fall ${i.pct}% tomorrow`, sub: `${fmt.money(i.loss)} gone overnight`, name: `Crash today (−${i.pct}%)`,
        about: `Everything you have invested drops ${i.pct}% overnight (cash stays put), then the plan carries on with ordinary markets. A gut check for scary headlines: how much would a crash right now really change your odds?` };
      case 'marketsDown': return { label: 'Markets earn 1% less', sub: 'A risk, not a choice', name: 'Markets −1%',
        about: 'Every year’s return one percentage point lower. You can’t control this one, but it shows how much the plan leans on markets.' };
      default: return { label: lv.key, sub: '', name: lv.key, about: '' };
    }
  }

  const pts = (d) => Math.round(d * 100);
  function ptsText(d) {
    const p = pts(d);
    if (p === 0) return '±0';
    return (p > 0 ? '+' : '−') + Math.abs(p) + (Math.abs(p) === 1 ? ' pt' : ' pts');
  }

  /** One row: label, a bar growing left (worse) or right (better) from the middle, and the change. */
  function row(lv, r, maxAbs, P, tappable) {
    const d = describe(lv, P);
    const p = r ? pts(r.delta) : 0;
    const w = r ? Math.min(1, Math.abs(r.delta) / maxAbs) * 50 : 0;
    const fill = h('span.lv-fill' + (p < 0 ? '.neg' : ''), { style: { width: w + '%', [p < 0 ? 'right' : 'left']: '50%' } });
    return h('button.lv-row', { type: 'button', disabled: !(r && tappable), 'aria-label': r ? `${d.label}: ${ptsText(r.delta)} chance of success` : d.label, onclick: () => open(r, P) },
      h('span.lv-text', h('span.lv-label', d.label), h('span.lv-sub', d.sub)),
      h('span.lv-bar', { 'aria-hidden': 'true' }, fill),
      h('span.lv-val' + (p > 0 ? '.pos' : p < 0 ? '.neg' : ''), r ? ptsText(r.delta) : '…'));
  }

  function paint(state, final) {
    if (!body) return;
    const P = state.P;
    const results = final ? state.list : state.levers.map((lv) => state.results[lv.key] || null);
    const known = results.filter(Boolean);
    const maxAbs = Math.max(0.05, ...known.map((r) => Math.abs(r.delta)));
    const order = final ? state.list.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)) : state.levers;
    const intro = state.base == null
      ? `Testing ${state.levers.length} changes against the same market histories…`
      : `Your chance of success is ${fmt.pct(state.base)} in this test. Each row changes one thing.`;
    UI.mount(body,
      h('p.lv-intro', h('span', intro), UI.tipButton('levers')),
      h('div.lv-list', order.map((lv) => row(lv, final ? lv : state.results[lv.key], maxAbs, P, final))),
      final ? h('p.lv-foot', 'Tap a change to apply it or try it as a scenario.') : null);
    body.classList.remove('stale');
    if (final) card.setSummary(summaryText(state));
  }

  function summaryText(state) {
    const best = state.list.filter((r) => r.kind === 'choice' && pts(r.delta) > 0).sort((a, b) => b.delta - a.delta)[0];
    if (state.base >= 0.995 && (!best || pts(best.delta) < 1)) return 'Near 100% already: no single change moves it much.';
    if (!best) return 'None of the common changes would raise your odds.';
    return `Best move: ${describe(best, state.P).label} (${ptsText(best.delta)})`;
  }

  /** Results still match the plan on screen? (Levers hold exact values, e.g. "retire at 56".) */
  const current = () => done && done.key === JSON.stringify(store().activePlan());

  /** Detail sheet: before → after, what the change means, apply or try it. */
  function open(r, P) {
    const d = describe(r, P);
    const sc = store().scenario();
    const p = pts(r.delta);
    const after = h('div.value-lg' + (p > 0 ? '.value-pos' : p < 0 ? '.value-neg' : ''), fmt.pct(r.success));
    UI.sheet.open({
      title: d.label,
      body: [
        h('div.lv-compare', h('div', h('div.label', 'Now'), h('div.value-lg', fmt.pct(done.base))),
          UI.icon('chevron', 'lv-arrow'), h('div', h('div.label', 'With this change'), after)),
        h('p.tip-text', d.about),
        h('p.tip-text.muted', { style: { fontSize: '14px' } }, `Both numbers use the same ${done.runs} market histories, so the difference is the change itself.` +
          (r.kind === 'risk' ? '' : sc.id === 'base' ? ' Applying it changes Baseline (and every scenario that doesn’t override it).' : ` Applying it changes only “${sc.name}”.`)),
      ],
      actions: r.kind === 'risk'
        ? [{ label: 'Try as a scenario', primary: true, onClick: () => makeScenario(r, d) }]
        : [{ label: 'Try as a scenario', onClick: () => makeScenario(r, d) }, { label: 'Apply', primary: true, onClick: () => apply(r, d) }],
    });
  }
  function apply(r, d) {
    UI.sheet.close();
    if (!current()) { UI.toast('Your plan changed: retesting first'); return; }
    store().setMany(r.overrides);
    UI.toast(`${d.label}: applied`, 'Undo', () => store().undo());
  }
  function makeScenario(r, d) {
    if (!current()) { UI.sheet.close(); UI.toast('Your plan changed: retesting first'); return; }
    const sc = store().addScenario(store().state.active, d.name, r.overrides);
    UI.sheet.close();
    UI.toast(`Added “${d.name}”`, 'Compare', () => {
      if (!store().state.compare.includes(sc.id) && !store().toggleCompare(sc.id)) UI.toast('Compare shows up to 4: turn one off first');
      RP.app.go('compare');
    });
  }

  /** Test the active scenario, unless that's already done or underway. */
  function run() {
    const plan = store().activePlan();
    const key = JSON.stringify(plan);
    if (done && done.key === key) { if (body.classList.contains('stale')) paint(done, true); return; } // e.g. after an undo
    if (pending === key) return;
    pending = key;
    const P = RP.engine.resolvePlan(plan);
    const state = { key, P, base: null, levers: RP.engine.leverList(P), results: {} };
    // First time: fill rows in as they arrive. Later: keep the old (dimmed) rows until the new set is complete.
    const live = !done;
    if (live) paint(state, false);
    RP.engineClient.levers(plan, (k, v) => {
      if (pending !== key) return;
      if (k === 'base') state.base = v; else state.results[k] = v;
      if (live) paint(state, false);
    }).then((out) => {
      if (pending !== key) return;
      pending = null;
      done = { key, P, base: out.base, runs: out.runs, list: out.list };
      paint(done, true);
    }).catch((e) => {
      if (pending === key) pending = null;
      if (e.message !== 'cancelled') console.error(e);
    });
  }

  LV.build = function () {
    body = h('div.lv-body', h('p.lv-intro', 'Calculating…'));
    const isOpen = !!store().state.settings.leversOpen;
    card = UI.expand({
      title: 'What moves the needle', summary: 'How common changes shift your chance of success', body, open: isOpen,
      onToggle: (on) => { store().updateSettings({ leversOpen: on }); if (on) run(); },
    });
    return card;
  };
  /** Inputs settled (the other numbers are done): retest if the card is open. */
  LV.refresh = function () { if (card && card.classList.contains('open')) run(); };
  /** Inputs changed: what's shown is now out of date (and not tappable until retested). */
  LV.invalidate = function () {
    if (!body || !done) return;
    body.classList.add('stale');
    body.querySelectorAll('.lv-row').forEach((b) => { b.disabled = true; });
  };
})(globalThis.RP = globalThis.RP || {});
