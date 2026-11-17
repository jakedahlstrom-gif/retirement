/*
 * home.js — the Home screen. One glance tells you where you stand:
 * the hero (when you retire and how long to go) right on the sky, the
 * retirement-age slider, chance of success and safe spending, the projection
 * chart, alerts, and tap-to-expand details (more numbers, the plan in words).
 * Milestones and badges sit at the bottom.
 *
 * The layout is built once; new results only update the numbers, so they can
 * glide smoothly from old to new values. Moving a retirement slider moves the
 * hero countdown and the sky immediately, before the new results arrive.
 *
 * Retired mode: once everyone has stopped working, "when do I retire" is
 * history. The hero then answers "how much can I spend?" (safe spending per
 * month, and the chance the money lasts) and the retirement-age card gives
 * way to a spending slider. The mode follows the plan, so it flips by itself
 * when you switch scenarios, undo, or start a new plan.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const Home = (UI.home = {});
  let els = null;
  let lastSuccess = null;
  let anchor = null; // last analysed retirement year, to preview slider moves
  let scrubbing = false;
  let ageShown = false;
  let retiredMode = null; // true once everyone has stopped working (null until first sync)
  let modeKey = null;     // active scenario the retired-mode numbers belong to
  let spendKey = null;    // plan the spending slider's range was last set for
  let lastSafe = null;    // latest safe spending for THIS plan (never one from another plan)
  let safeStale = false;  // true while safe spending is being recalculated

  /** Retirement year as a slider preview: the last result, shifted by the change. */
  function naiveYear(P) { const ry = RP.engine.retireYears(P); return Math.max(ry.p1, ry.p2) + 1; }
  function previewYear(P) { return anchor ? anchor.year + (naiveYear(P) - anchor.naive) : naiveYear(P); }

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
  /** "in 18 years" for a calendar year, counted like the hero countdown (to Jan 1). */
  function untilText(year) {
    const months = UI.sky.monthsUntil(year);
    if (months <= 0) return 'this year';
    return 'in ' + (months < 12 ? plural(months, 'month') : plural(Math.floor(months / 12), 'year'));
  }
  function togoText(months) {
    if (months <= -12) return `Retired ${plural(Math.floor(-months / 12), 'year')}`;
    if (months <= 0) return 'Retirement is here';
    const y = Math.floor(months / 12), m = months % 12;
    return [y ? plural(y, 'year') : '', m ? plural(m, 'month') : ''].filter(Boolean).join(', ') + ' to go';
  }

  /** Hero countdown + sky for a retirement year (Jan 1 of that year). */
  function showCountdown(year) {
    const months = UI.sky.monthsUntil(year);
    els.togo.textContent = togoText(months);
    UI.sky.set(UI.sky.progressFor(months));
  }

  function stat(key, label, tipKey) {
    const v = h('div.value-md', '—');
    const s = h('div.value-sub', '');
    els[key] = v; els[key + 'Sub'] = s;
    return h('div.stat', h('div.stat-l', h('div.stat-t', label, tipKey ? UI.tipButton(tipKey) : null), s), v);
  }

  Home.build = function (root) {
    els = {};
    // Hero, right on the sky
    els.busy = h('span.busy-dot');
    els.ageTitle = h('span', 'Retirement age');
    els.ageVal = h('div.hero-num', '—');
    els.togo = h('div.hero-togo', '');
    els.ageSub = h('div.hero-meta', '');
    els.postcardText = h('span', 'Postcard from retirement');
    els.postcard = h('button.sky-pill.hero-postcard', { type: 'button', hidden: true, onclick: () => UI.postcard.open() }, UI.icon('mail'), els.postcardText);
    // Retired mode swaps the countdown for spending (shown instead of ageVal, togo, ageSub)
    els.ageTip = UI.tipButton('retireAge');
    els.spendTip = UI.tipButton('safeSpend'); els.spendTip.hidden = true;
    els.rNumVal = h('span', '…'); els.rSuf = h('small', '/mo');
    els.rNum = h('div.hero-num.hero-spend', { hidden: true }, els.rNumVal, els.rSuf);
    els.rLine = h('div.hero-togo', { hidden: true }, '…');
    els.rSub = h('div.hero-meta', { hidden: true });
    els.hero = h('div.hero-sky',
      h('div.hero-label', els.ageTitle, els.ageTip, els.spendTip, els.busy),
      els.ageVal, els.togo, els.ageSub, els.rNum, els.rLine, els.rSub, els.postcard);

    // Retirement age slider
    els.ageSlider = h('input.slider', { type: 'range', min: 45, max: 65, step: 1, 'aria-label': 'Retirement age' });
    els.ageScale = h('div.slider-scale');
    // Earliest age that still meets the success target, with a shortcut to it
    els.earliestLabel = h('span', 'Earliest age for 90% success');
    els.earliestVal = h('span.e-val', '…');
    els.earliestUse = h('button.link-btn.e-use', { type: 'button', hidden: true, onclick: () => {
      const e = Home._metrics && Home._metrics.earliest;
      if (!e || e.age == null) return;
      // Same move the search made: a separate date for person 2 shifts by as many years.
      const R = store().activePlan().retirement;
      const o = { 'retirement.p1Age': e.age };
      if (!R.together) o['retirement.p2Age'] = RP.util.clamp(R.p2Age + e.age - R.p1Age, 30, 80);
      store().setMany(o);
      UI.toast(`${store().activePlan().people.p1.name} retires at ${e.age}`, 'Undo', () => store().undo());
    } }, 'Use');
    els.earliest = h('div.earliest', h('span.e-label', els.earliestLabel, UI.tipButton('earliest')), els.earliestVal, els.earliestUse);
    els.togetherWrap = h('div');
    els.p2Wrap = h('div');
    const retire = els.retire = h('div.card.retire-card',
      els.ageSlider,
      els.ageScale,
      els.earliest,
      els.togetherWrap, els.p2Wrap);
    const commitAge = UI.debounce((v) => store().set('retirement.p1Age', v), 60);
    trackDrag(els.ageSlider);
    els.ageSlider.addEventListener('input', () => {
      const v = Number(els.ageSlider.value);
      paintSlider(els.ageSlider);
      els.ageVal.textContent = v; els.ageVal._val = v;
      const P = store().activePlan();
      const Q = Object.assign({}, P, { retirement: Object.assign({}, P.retirement, { p1Age: v }) });
      updateAgeSub(Q);
      showCountdown(previewYear(Q));
      UI.haptic();
      commitAge(v);
    });

    // Retired mode: spending slider in place of the retirement-age card
    els.spendNum = h('span'); els.spendMo = h('div.value-sub');
    els.spendSlider = h('input.slider', { type: 'range', min: 10000, max: 140000, step: 1000, 'aria-label': 'Retirement spending per year' });
    els.spendScale = h('div.slider-scale');
    els.spendMain = h('div', h('div.value-lg', els.spendNum, h('small', ' a year')), els.spendMo, els.spendSlider, els.spendScale);
    els.spendPhases = h('div.retire-row.phase-row', { hidden: true },
      h('span', 'Your spending follows your phases.'),
      h('button.link-btn.e-use', { type: 'button', onclick: () => RP.app.go('plan') }, 'Edit in Plan'));
    els.spendSafe = h('span.e-label');
    els.spendUse = h('button.link-btn.e-use', { type: 'button', hidden: true, onclick: () => {
      const s = lastSafe;
      if (!s || s.floor || s.amount == null) return;
      const v = Math.floor(s.amount / 500) * 500;
      store().set('spending.retirement', v, { forceUndo: true });
      UI.toast(`Spending set to ${fmt.money(v)} a year`, 'Undo', () => store().undo());
    } }, 'Use');
    els.spendHelp = h('div.earliest.spend-help', { hidden: true }, els.spendSafe, els.spendUse);
    els.spend = h('div.card.retire-card.spend-card', { hidden: true },
      h('div.card-title', h('span', 'Your spending')), els.spendMain, els.spendPhases, els.spendHelp);
    const commitSpend = UI.debounce((v) => store().set('spending.retirement', v), 60);
    trackDrag(els.spendSlider);
    els.spendSlider.addEventListener('input', () => {
      const v = Number(els.spendSlider.value);
      paintSlider(els.spendSlider);
      paintSpendValue(v);
      UI.haptic();
      commitSpend(v);
    });

    // Chance of success | safe spending
    els.pct = h('span', '—');
    els.meter = h('span');
    els.safe = h('div.value-lg', '—');
    els.goalLine = h('div.value-sub', { hidden: true });
    els.ringWrap = h('div.cell.ring-wrap', h('div.ring-glow'),
      h('div.label', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, 'Chance of success', UI.tipButton('success')),
      h('div.value-lg', els.pct, h('small', '%')),
      h('div.meter', els.meter), els.goalLine);
    const duo = h('div.card.duo', els.ringWrap, h('div.sep'),
      h('div.cell', h('div.label', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, 'Safe spending', UI.tipButton('safeSpend')),
        els.safe, h('div.value-sub', 'per year')));

    // Projection chart
    els.balRet = h('div.ph-value', '—');
    els.balRetSub = h('div.ph-sub', '');
    els.projLabel = h('span', 'At retirement');
    els.projBox = h('div.proj-box');
    const proj = h('div.card.proj-card',
      h('div.proj-head', h('div', h('div.ph-label', els.projLabel, UI.tipButton('balRet')), els.balRet), els.balRetSub),
      els.projBox,
      h('div.proj-legend', h('span', h('i'), 'Typical market'), h('span', h('i.band'), 'Likely range')),
      h('button.more-btn.proj-more', { type: 'button', onclick: () => UI.futures.open() }, 'See 100 possible futures →'));
    if (UI.projection) {
      els.chart = UI.projection.create(els.projBox, { format: (v) => fmt.money(v), onScrub: onScrub });
    }

    // Tap-to-expand details
    els.more = UI.expand({ title: 'More numbers', summary: '—',
      body: h('div.stat-list', stat('netWorth', 'Net worth', 'netWorth'), stat('coast', 'Coast FIRE', 'coast'), stat('green', 'Green light', 'greenLight')) });
    els.summary = h('div.summary-text', '');
    els.brief = UI.expand({ title: 'Your plan in brief', summary: '', body: els.summary });

    els.sampleBanner = h('div');
    els.alerts = h('div');
    els.milestone = h('div');
    els.levers = UI.levers.build();
    els.paycheck = UI.paycheck.build();
    els.playbook = UI.playbook.card();

    // Order: when you retire → the big lever → where you stand → the path →
    // what to do this year → what retirement pays → what needs attention → what would help →
    // details on demand → what's next.
    UI.mount(root,
      els.hero,
      retire,
      els.spend,
      els.sampleBanner,
      duo,
      proj,
      els.playbook,
      els.paycheck,
      els.alerts,
      els.levers,
      els.more,
      els.brief,
      els.milestone,
      h('p.footer-note', 'Results are educational estimates, not financial advice.'));
  };

  function paintSlider(s) {
    const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
    s.style.setProperty('--fill', pct + '%');
  }

  /** While a finger is on a slider, updates from the store don't move it. */
  function trackDrag(s) {
    s.addEventListener('input', () => { s._drag = true; });
    for (const t of ['change', 'pointerup', 'pointercancel', 'blur']) s.addEventListener(t, () => { s._drag = false; });
  }
  /** Show a stored value on a slider, widening its range if the value is outside it. */
  function showOnSlider(s, v) {
    if (s._drag) return;
    if (v < Number(s.min)) s.min = v;
    if (v > Number(s.max)) s.max = v;
    s.value = v;
    paintSlider(s);
  }

  // ------------------------------------------------------------ retired mode
  function paintSpendValue(v) {
    els.spendNum.textContent = fmt.money(v);
    els.spendMo.textContent = `${fmt.money(v / 12, { full: true })} a month`;
  }
  /** Slider range: about half to double the value, in $1,000s. Set rarely so the thumb never jumps. */
  function setSpendRange(v) {
    const s = els.spendSlider;
    const lo = Math.min(Math.max(10000, Math.round(v * 0.5 / 1000) * 1000), Math.floor(v / 1000) * 1000);
    const hi = Math.max(Math.round(v * 2 / 1000) * 1000, Math.ceil(v / 1000) * 1000, lo + 10000);
    s.min = lo; s.max = hi;
    const k = (x) => '$' + Math.round(x / 1000) + 'K';
    UI.mount(els.spendScale, h('span', k(lo)), h('span', k((lo + hi) / 2)), h('span', k(hi)));
  }
  /** Hero number and the "safe at" helper from the latest safe spending. */
  function paintSpend() {
    if (!retiredMode) return;
    const P = store().activePlan(), s = lastSafe, ok = !!s && s.amount != null;
    if (ok) {
      els.rSuf.hidden = false;
      UI.countTo(els.rNumVal, s.amount / 12, (x) => (s.floor ? '<' : '') + fmt.money(x, { full: true }) + (s.capped ? '+' : ''), 900, 0);
    } else { els.rNumVal.textContent = '…'; els.rNumVal._val = null; els.rSuf.hidden = true; }
    els.rNum.style.opacity = ok && !safeStale ? '1' : '0.45';
    const phases = !!(P.spending.phases && P.spending.phases.enabled);
    els.spendHelp.hidden = !ok;
    els.spendHelp.style.opacity = safeStale ? '0.45' : '1';
    if (ok) {
      els.spendSafe.textContent = `Safe at ${P.sim.successTarget}%: ${fmt.safe(s)}/yr`;
      els.spendUse.hidden = safeStale || phases || !!s.floor || Math.abs(s.amount - P.spending.retirement) <= 500;
    }
  }
  /** Switch the Home screen between working and retired layouts. */
  function applyMode(retired) {
    retiredMode = retired;
    els.retire.hidden = retired; els.spend.hidden = !retired;
    els.ageVal.hidden = els.togo.hidden = els.ageSub.hidden = els.ageTip.hidden = retired;
    els.rNum.hidden = els.rLine.hidden = els.rSub.hidden = els.spendTip.hidden = !retired;
    if (retired) els.postcard.hidden = true; // Home.update decides again for a working plan
    else { els.rNum.style.opacity = ''; spendKey = null; }
  }
  function syncRetired(P) {
    const ry = RP.engine.retireYears(P), now = new Date().getFullYear();
    els.ageTitle.textContent = 'You can spend about';
    els.rSub.textContent = `Retired since ${Math.max(ry.p1, ry.p2) + 1} · ${P.people.p1.name} ${now - P.people.p1.birthYear} · ${P.people.p2.name} ${now - P.people.p2.birthYear}`;
    const sp = P.spending, phases = !!(sp.phases && sp.phases.enabled);
    els.spendMain.hidden = phases; els.spendPhases.hidden = !phases;
    if (!phases) {
      const s = els.spendSlider, v = sp.retirement, key = store().state.active;
      if (!s._drag) {
        if (spendKey !== key || v < Number(s.min) || v > Number(s.max)) { setSpendRange(v); spendKey = key; }
        s.value = v; paintSlider(s); paintSpendValue(v);
      }
    }
    paintSpend();
  }

  function updateAgeSub(P) {
    const year = P.people.p1.birthYear + P.retirement.p1Age;
    const p2 = P.retirement.together ? year - P.people.p2.birthYear : P.retirement.p2Age;
    els.ageSub.textContent = `Work ${year < new Date().getFullYear() ? 'ended' : 'ends'} Dec ${year}` + (P.retirement.together ? ` · ${P.people.p2.name} ${p2}` : '');
  }

  /** Refresh the input-driven parts immediately (before results arrive). */
  Home.syncInputs = function () {
    if (!els) return;
    const P = store().activePlan();
    const ry = RP.engine.retireYears(P), y0 = Number(String(P.balances.asOf).slice(0, 4));
    const retired = Math.max(ry.p1, ry.p2) < y0, key = store().state.active;
    if (retired !== retiredMode || key !== modeKey) {
      // A different plan: don't show the last plan's safe spending as if it were this one's
      lastSafe = null; modeKey = key;
      if (retired) els.rLine.textContent = '…';
    }
    if (retired !== retiredMode) applyMode(retired);
    if (!retired) els.ageTitle.textContent = `${P.people.p1.name} ${P.people.p1.birthYear + P.retirement.p1Age < new Date().getFullYear() ? 'retired' : 'retires'} at`;
    showOnSlider(els.ageSlider, P.retirement.p1Age);
    const lo = Number(els.ageSlider.min), hi = Number(els.ageSlider.max);
    UI.mount(els.ageScale, h('span', String(lo)), h('span', String(Math.round((lo + hi) / 2))), h('span', String(hi)));
    // Mid-drag, the slider's own handler keeps the hero current; the store lags a few ms behind.
    const dragging = els.ageSlider._drag || (els.p2 && els.p2.s2._drag);
    if (!ageShown) { ageShown = true; UI.countTo(els.ageVal, P.retirement.p1Age, (x) => String(Math.round(x)), 1100, Math.max(0, P.retirement.p1Age - 40)); }
    else if (!dragging && els.ageVal._val !== P.retirement.p1Age) {
      cancelAnimationFrame(els.ageVal._raf); // a change during the launch count-up wins
      els.ageVal.textContent = P.retirement.p1Age; els.ageVal._val = P.retirement.p1Age;
    }
    if (!dragging) { updateAgeSub(P); showCountdown(previewYear(P)); }
    UI.mount(els.togetherWrap, h('div.retire-row',
      h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Retire together', UI.tipButton('together')),
      UI.toggle({ checked: P.retirement.together, label: 'Retire together', onChange: (on) => {
        if (!on) store().set('retirement.p2Age', P.people.p1.birthYear + P.retirement.p1Age - P.people.p2.birthYear, { silent: true });
        store().set('retirement.together', on);
      } })));
    // Person 2's own slider. Built once and then only updated, so a sync in the
    // middle of a drag doesn't swap the slider out from under the finger.
    if (!P.retirement.together) {
      if (!els.p2) {
        const s2 = h('input.slider', { type: 'range', min: 40, max: 65, step: 1 });
        const val = h('span'), sub = h('span.value-sub'), title = h('span.label');
        const commit = UI.debounce((v) => store().set('retirement.p2Age', v), 60);
        trackDrag(s2);
        s2.addEventListener('input', () => {
          const Q = store().activePlan();
          const v = Number(s2.value);
          paintSlider(s2); val.textContent = v; sub.textContent = `End of ${Q.people.p2.birthYear + v}`;
          showCountdown(previewYear(Object.assign({}, Q, { retirement: Object.assign({}, Q.retirement, { p2Age: v }) })));
          UI.haptic();
          commit(v);
        });
        els.p2 = { s2, val, sub, title };
        UI.mount(els.p2Wrap, h('div.p2-block', h('div.p2-top', title, sub), h('div.value-lg', val), s2));
      }
      const { s2, val, sub, title } = els.p2;
      s2.setAttribute('aria-label', P.people.p2.name + ' retirement age');
      title.textContent = `${P.people.p2.name} retires at`;
      if (!s2._drag) { val.textContent = P.retirement.p2Age; sub.textContent = `End of ${P.people.p2.birthYear + P.retirement.p2Age}`; }
      showOnSlider(s2, P.retirement.p2Age);
    } else if (els.p2) { els.p2 = null; UI.mount(els.p2Wrap); }

    if (retired) syncRetired(P);

    if (P.meta && P.meta.isSample) {
      UI.mount(els.sampleBanner, h('div.card.banner',
        h('div.b-text', h('b', 'You’re looking at a sample household. '), 'Set up your own plan in a few minutes, or import a plan file. Your numbers stay on this device.'),
        h('div.b-actions',
          h('button.btn.small.primary', { onclick: () => UI.setup.start() }, 'Set up'),
          h('button.btn.small', { onclick: () => RP.app.importFile() }, 'Import'))));
    } else UI.mount(els.sampleBanner);
  };

  Home.setBusy = function (on) { if (els) els.hero.classList.toggle('busy', !!on); };

  // ------------------------------------------------------------ projection
  function chartData(a) {
    const rows = a.rows, years = a.schedule.years;
    // Balances on Jan 1 of each year, so the retirement point matches "At retirement".
    const p50 = rows.map((r) => r.startTotal);
    const b = a.mc && a.mc.bands;
    const shift = (arr) => (arr ? [rows[0].startTotal, ...arr.slice(0, -1)] : undefined);
    return {
      years, p50, p10: b ? shift(b.p10) : undefined, p90: b ? shift(b.p90) : undefined,
      retireYear: a.schedule.retireYear, retireLabel: 'Retire ' + a.schedule.retireYear,
      // Same wording and year as the "Money runs short" alert
      runOutLabel: a.summary.shortfallYear ? 'Runs short ' + a.summary.shortfallYear : undefined,
    };
  }
  function showDefaultReadout() {
    const a = Home._a;
    if (!a) return;
    const now = headline(a);
    els.projLabel.textContent = now.label;
    els.balRet.textContent = fmt.money(now.value);
    els.balRetSub.textContent = now.sub;
  }
  /** The number over the projection: savings at retirement, or savings today once you're retired. */
  function headline(a) {
    const s = a.summary;
    return retiredMode ? { label: 'Savings now', value: s.portfolioToday || 0, sub: fmt.date(a.plan.balances.asOf) }
      : { label: 'At retirement', value: s.balanceAtRetirement || 0, sub: `Jan 1, ${s.retireYear}` };
  }
  function onScrub(info) {
    const a = Home._a;
    if (!info || !a) {
      scrubbing = false; showDefaultReadout();
      if (a) UI.sky.set(UI.sky.progressFor(UI.sky.monthsUntil(a.summary.retireYear))); // back to today's sky
      return;
    }
    scrubbing = true;
    // The sky shows the hour you'd see from that year: how close retirement is then.
    UI.sky.set(UI.sky.progressFor(Math.max(0, a.summary.retireYear - info.year) * 12));
    const P = a.plan;
    els.projLabel.textContent = `Jan 1, ${info.year} · ${P.people.p1.name} ${info.year - P.people.p1.birthYear - 1}`;
    els.balRet.textContent = fmt.money(info.p50);
    els.balRetSub.textContent = info.p10 != null && info.p90 != null && info.p10 !== info.p90 ? `${fmt.money(info.p10)}–${fmt.money(info.p90)}` : '';
  }

  /** New analysis results arrived. */
  Home.update = function (a) {
    if (!els || !a) return;
    const s = a.summary;
    anchor = { year: s.retireYear, naive: naiveYear(a.plan) };
    if (!els.ageSlider._drag && !(els.p2 && els.p2.s2._drag)) showCountdown(s.retireYear);

    const pct = s.successRate;
    UI.countTo(els.pct, Math.round(pct * 100), (x) => String(Math.round(x)), 900, 0);
    els.meter.style.width = (pct * 100) + '%';
    els.goalLine.hidden = !(s.legacyGoal > 0);
    if (s.legacyGoal > 0) els.goalLine.textContent = `with ${fmt.money(s.legacyGoal)} left at the end`;
    els.ringWrap.classList.toggle('warn', pct < 0.9 && pct >= 0.75);
    els.ringWrap.classList.toggle('bad', pct < 0.75);
    if (lastSuccess != null && lastSuccess < 0.9 && pct >= 0.9) Home.celebrate();
    lastSuccess = pct;

    Home._a = a;
    UI.countTo(els.netWorth, s.netWorthToday, (x) => fmt.money(x), 900, 0);
    els.netWorthSub.textContent = `Savings ${fmt.money(s.portfolioToday)} + home & 529`;
    if (!scrubbing) {
      const now = headline(a);
      els.projLabel.textContent = now.label;
      UI.countTo(els.balRet, now.value, (x) => fmt.money(x), 900, 0);
      els.balRetSub.textContent = now.sub;
    }
    if (els.chart) els.chart.update(chartData(a));
    UI.paycheck.update(a);
    UI.playbook.update(a);
    els.postcardText.textContent = `Postcard from ${s.retireYear}`;
    els.postcard.hidden = retiredMode || s.retireYear <= a.schedule.y0; // only for a retirement still ahead
    if (retiredMode) els.rLine.textContent = `${Math.round(pct * 100)}% chance your money lasts to ${a.plan.household.horizonAge}${s.legacyGoal > 0 ? `, with ${fmt.money(s.legacyGoal)} left` : ''}`;

    els.summary.innerHTML = UI.insights.summary(a, Home._metrics);
    renderAlerts(a, Home._metrics);
    renderMilestones(a, Home._metrics);
    renderMoreSummary();
    renderBrief();
  };

  /** Slower numbers (safe spending, green light, Coast FIRE) arrive one by one. */
  Home.updateMetrics = function (m) {
    if (!els) return;
    Home._metrics = Object.assign({}, Home._metrics || {}, m);
    const mm = Home._metrics;
    if (m.safe) { lastSafe = m.safe; safeStale = false; paintSpend(); }
    if (mm.safe) UI.countTo(els.safe, mm.safe.amount, (x) => (mm.safe.floor ? '<' : '') + fmt.money(x) + (mm.safe.capped ? '+' : ''), 900, 0);
    if (mm.green) {
      UI.countTo(els.green, mm.green.amount || 0, (x) => (mm.green.amount ? fmt.money(x) : '—'));
      const a = Home._a;
      const above = mm.green.amount && a && a.summary.balanceAtRetirement >= mm.green.amount;
      els.green.classList.toggle('value-pos', !!above);
      els.greenSub.textContent = mm.green.amount && a ? (above ? 'Projected: above it ✓' : 'Projected: below it') : `For ${store().activePlan().sim.greenLightTarget}% success`;
    }
    if (mm.coast) {
      els.coast.textContent = mm.coast.year ? String(mm.coast.year) : 'Not yet';
      els.coastSub.textContent = mm.coast.year ? (mm.coast.year <= new Date().getFullYear() ? 'Reached ✓' : `Could stop saving then`) : 'Keep saving for now';
    }
    if (mm.earliest) paintEarliest(mm.earliest);
    if (Home._a) {
      els.summary.innerHTML = UI.insights.summary(Home._a, mm);
      renderAlerts(Home._a, mm);
      renderMilestones(Home._a, mm);
      renderBrief();
    }
    renderMoreSummary();
  };
  Home.clearMetrics = function () {
    Home._metrics = {};
    if (!els) return;
    for (const k of ['safe', 'earliest', 'green', 'coast']) els[k].style.opacity = '0.45';
    els.earliestUse.hidden = true;
    safeStale = true; paintSpend();
  };

  /** "Earliest age for 90% success: 54  Use" under the retirement slider. */
  function paintEarliest(e) {
    const P = store().activePlan();
    els.earliestLabel.textContent = `Earliest age for ${P.sim.successTarget}% success`;
    els.earliest.hidden = !!e.retired; // nothing left to decide once you've both stopped working
    if (e.age == null) {
      els.earliestVal.textContent = `Not by ${e.maxAge}`;
      els.earliestUse.hidden = true;
      return;
    }
    const here = e.age === P.retirement.p1Age;
    els.earliestVal.textContent = e.now ? `${e.age} · now` : here ? `${e.age} ✓` : String(e.age);
    els.earliestUse.hidden = here;
  }
  Home.metricsArrived = function (k) { if (els && els[k]) els[k].style.opacity = '1'; };

  function renderMoreSummary() {
    const a = Home._a, m = Home._metrics || {};
    const parts = [];
    if (a) parts.push(`Net worth ${fmt.money(a.summary.netWorthToday)}`);
    // Coast FIRE and the green light are about getting to retirement: nothing to say once you're there.
    const done = !!a && a.summary.retireYear <= a.schedule.y0;
    els.coast.closest('.stat').hidden = els.green.closest('.stat').hidden = done;
    if (m.safe && done) parts.push(`Safe spending ${fmt.safe(m.safe)}`);
    if (m.coast && !done) parts.push(`Coast FIRE ${m.coast.year || 'not yet'}`);
    if (m.green && m.green.amount && !done) parts.push(`Green light ${fmt.money(m.green.amount)}`);
    els.more.setSummary(parts.join(' · ') || '—');
  }
  function renderBrief() {
    const tmp = document.createElement('div');
    tmp.innerHTML = els.summary.innerHTML;
    const text = tmp.textContent || '';
    const m = text.match(/^.*?\.(?=\s|$)/);
    els.brief.setSummary(m ? m[0] : text);
  }

  /** Re-check alerts without new results (e.g. right after a backup). */
  Home.refreshAlerts = function () { if (Home._a) renderAlerts(Home._a, Home._metrics); };

  function renderAlerts(a, m) {
    const list = UI.insights.alerts(a, m);
    Home._alerts = list;
    if (!list.length) {
      UI.mount(els.alerts, h('div.card', h('div.card-title', h('span', 'Alerts')),
        h('div.alert.ok', h('div.ico', UI.icon('check')),
          h('div', h('div.a-title', 'All clear'), h('div.a-text', 'No cliffs, penalties or shortfalls in the typical path.')))));
      return;
    }
    const item = (al) => h('button.alert.' + al.level, {
      onclick: () => {
        if (al.action === 'checkin') UI.checkin.start();
        else if (al.action === 'backup') RP.app.exportFile();
        else UI.plan.focusField(al.path);
      },
    },
    h('div.ico', UI.icon(al.level === 'info' ? 'info' : 'alert')),
    h('div', h('div.a-title', al.title), h('div.a-text', al.text), h('div.a-fix', al.fix + ' →')));
    const shown = list.slice(0, 6);
    const first = shown.slice(0, 2), rest = shown.slice(2);
    const restBox = h('div', { hidden: true }, rest.map(item));
    const more = rest.length ? h('button.more-btn', { type: 'button', onclick: () => {
      restBox.hidden = !restBox.hidden;
      more.textContent = restBox.hidden ? `Show ${rest.length} more` : 'Show fewer';
    } }, `Show ${rest.length} more`) : null;
    UI.mount(els.alerts, h('div.card', h('div.card-title', h('span', 'Alerts'), h('span.grow'), h('span.pill', String(list.length))),
      first.map(item), restBox, more));
  }

  function renderMilestones(a, m) {
    const list = UI.insights.milestones(a, m);
    const next = list.find((x) => !x.earned);
    const earned = list.filter((x) => x.earned);
    Home.checkNewBadges(earned);
    UI.mount(els.milestone, h('div.card',
      h('div.card-title', h('span', 'Next milestone')),
      next ? h('div.badge-card', h('div.medal', next.emoji),
        h('div', h('div.value-md', next.title), h('div.value-sub', `${next.year} · ${untilText(next.year)}`))) : h('div', 'Every milestone reached.'),
      h('div', { style: { marginTop: '18px' } }, h('div.badges-row', list.map((x) =>
        h('div.mini-badge' + (x.earned ? '.earned' : ''), h('div.medal' + (x.earned ? '.earned' : ''), { style: { opacity: x.earned ? 1 : 0.55 } }, x.emoji), h('div', x.title), h('div', { style: { color: 'var(--muted)' } }, String(x.year))))))));
  }

  /** Celebrate badges reached for the first time. */
  Home.checkNewBadges = function (earned) {
    const st = store().state;
    const seen = new Set(st.settings.badgesSeen || []);
    const fresh = earned.filter((b) => !seen.has(b.key));
    if (!fresh.length) return;
    st.settings.badgesSeen = [...seen, ...fresh.map((b) => b.key)];
    store().save();
    if (st.settings.badgesSeen.length > fresh.length) { // not on the very first run
      Home.celebrate();
      UI.toast(`${fresh[0].emoji} ${fresh[0].title}!`);
    }
  };

  /** A brief glow and a light particle burst. */
  Home.celebrate = function () {
    if (!els || UI.reducedMotion()) return;
    const g = els.ringWrap.querySelector('.ring-glow');
    g.classList.remove('go'); void g.offsetWidth; g.classList.add('go');
    const rect = els.ringWrap.getBoundingClientRect();
    const c = h('canvas.burst');
    document.body.appendChild(c);
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ffb65c';
    const parts = Array.from({ length: 46 }, () => {
      const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4.5;
      return { x: cx + Math.cos(ang) * 50, y: cy + Math.sin(ang) * 50, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 1.2 + Math.random() * 2.2, life: 1 };
    });
    let t0 = performance.now();
    const step = (t) => {
      const dt = Math.min(32, t - t0) / 16; t0 = t;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = false;
      for (const p of parts) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 0.05 * dt; p.life -= 0.018 * dt;
        if (p.life > 0) {
          alive = true;
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (alive) requestAnimationFrame(step); else c.remove();
    };
    requestAnimationFrame(step);
  };
})(globalThis.RP = globalThis.RP || {});
