/*
 * paycheck.js — the Home card "Retirement paycheck": what you'll have to spend
 * each month in retirement, what goes to taxes, and which accounts pay for it.
 * Early retirement, Medicare and Social Security years are funded very
 * differently, so you can flip between those phases. Tap through for the
 * full year (with its cash-flow diagram).
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const PC = (UI.paycheck = {});
  let card = null, body = null, a = null, pick = 'first';

  /** Up to three full retirement years: the first, once you're both on Medicare, once Social Security has fully started. */
  function phases(an) {
    const S = an.schedule;
    const full = (y) => an.rows.find((r) => r.year === y && r.year > S.y0 && !r.working);
    const out = [];
    const add = (key, label, y) => {
      const r = full(y);
      if (r && !out.some((p) => p.row.year === r.year)) out.push({ key, label, row: r });
    };
    add('first', 'First year', Math.max(S.retireYear, S.y0 + 1));
    add('medicare', 'Medicare', Math.max(S.unlock.p1.medicareYear, S.unlock.p2.medicareYear));
    add('ss', 'Social Security', Math.max(S.ssDetail.p1.claimYear, S.ssDetail.p2.claimYear) + 1);
    return out.sort((x, y) => x.row.year - y.row.year);
  }

  const mo = (v) => fmt.money(v / 12, { full: true });

  function draw() {
    if (!body || !a) return;
    const list = phases(a);
    card.hidden = !list.length;
    if (!list.length) return;
    const ph = list.find((p) => p.key === pick) || list[0];
    const r = ph.row, P = a.plan;
    const { ins, outs } = UI.flow.items(r, P);
    const spend = outs.filter((o) => !['tax', 'pen'].includes(o.key) && !o.key.startsWith('save')).reduce((t, o) => t + o.value, 0);
    const taxes = outs.filter((o) => o.key === 'tax' || o.key === 'pen').reduce((t, o) => t + o.value, 0);
    const saved = outs.filter((o) => o.key.startsWith('save')).reduce((t, o) => t + o.value, 0);
    const total = ins.reduce((t, x) => t + x.value, 0) || 1;
    const age = (pid) => `${P.people[pid].name} ${r.ages[pid]}`;
    UI.mount(body,
      list.length > 1 ? UI.segmented({ options: list.map((p) => ({ value: p.key, label: p.label })), value: ph.key, onChange: (v) => { pick = v; draw(); } }) : null,
      h('div.pc-head',
        h('div', h('div.value-lg', mo(spend), h('small', '/mo')), h('div.value-sub', `to spend in ${r.year}`), h('div.value-sub', `${age('p1')} · ${age('p2')}`)),
        h('div.pc-side', h('div.pc-tax', `+ ${mo(taxes)}`), h('div.value-sub', 'a month in tax'),
          saved > 600 ? h('div.value-sub', `${mo(saved)} reinvested`) : null)),
      h('div.pc-bar', { 'aria-hidden': 'true' }, ins.map((x) => h('span', { style: { flex: String(x.value / total), background: x.color } }))),
      h('div.pc-list', ins.map((x) => h('div.pc-item', h('span.pc-dot', { style: { background: x.color } }), h('span.pc-name', x.label), h('span.pc-val', `${mo(x.value)}/mo`)))),
      h('button.more-btn', { type: 'button', onclick: () => UI.compare.showYear(a, r.year, store().scenario()) }, `See all of ${r.year} →`));
  }

  PC.build = function () {
    body = h('div');
    card = h('div.card.pc-card', h('div.card-title', h('span', 'Retirement paycheck'), UI.tipButton('paycheck')), body);
    card.hidden = true;
    return card;
  };
  /** New results for the active scenario. */
  PC.update = function (an) { a = an; draw(); };
})(globalThis.RP = globalThis.RP || {});
