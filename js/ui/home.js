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

  /** Retirement year as a slider preview: the last result, shifted by the change. */
  function naiveYear(P) { const ry = RP.engine.retireYears(P); return Math.max(ry.p1, ry.p2) + 1; }
  function previewYear(P) { return anchor ? anchor.year + (naiveYear(P) - anchor.naive) : naiveYear(P); }

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }
  function togoText(months) {
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
    els.hero = h('div.hero-sky',
      h('div.hero-label', els.ageTitle, UI.tipButton('retireAge'), els.busy),
      els.ageVal, els.togo, els.ageSub);

    // Retirement age slider
    els.ageSlider = h('input.slider', { type: 'range', min: 45, max: 65, step: 1, 'aria-label': 'Retirement age' });
    els.togetherWrap = h('div');
    els.p2Wrap = h('div');
    const retire = h('div.card.retire-card',
      els.ageSlider,
      h('div.slider-scale', h('span', '45'), h('span', '55'), h('span', '65')),
      els.togetherWrap, els.p2Wrap);
    const commitAge = UI.debounce((v) => store().set('retirement.p1Age', v), 60);
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

    // Chance of success | safe spending
    els.pct = h('span', '—');
    els.meter = h('span');
    els.safe = h('div.value-lg', '—');
    els.ringWrap = h('div.cell.ring-wrap', h('div.ring-glow'),
      h('div.label', { style: { display: 'flex', alignItems: 'center', gap: '5px' } }, 'Chance of success', UI.tipButton('success')),
      h('div.value-lg', els.pct, h('small', '%')),
      h('div.meter', els.meter));
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
      h('div.proj-legend', h('span', h('i'), 'Typical market'), h('span', h('i.band'), 'Likely range')));
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

    // Order: when you retire → the big lever → where you stand → the path →
    // what needs attention → details on demand → what's next.
    UI.mount(root,
      els.hero,
      retire,
      els.sampleBanner,
      duo,
      proj,
      els.alerts,
      els.more,
      els.brief,
      els.milestone,
      h('p.footer-note', 'Results are educational estimates, not financial advice.'));
  };

  function paintSlider(s) {
    const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
    s.style.setProperty('--fill', pct + '%');
  }

  function updateAgeSub(P) {
    const year = P.people.p1.birthYear + P.retirement.p1Age;
    const p2 = P.retirement.together ? year - P.people.p2.birthYear : P.retirement.p2Age;
    els.ageSub.textContent = `Work ends Dec ${year}` + (P.retirement.together ? ` · ${P.people.p2.name} ${p2}` : '');
  }

  /** Refresh the input-driven parts immediately (before results arrive). */
  Home.syncInputs = function () {
    if (!els) return;
    const P = store().activePlan();
    els.ageTitle.textContent = `${P.people.p1.name} retires at`;
    els.ageSlider.value = P.retirement.p1Age;
    paintSlider(els.ageSlider);
    if (!ageShown) { ageShown = true; UI.countTo(els.ageVal, P.retirement.p1Age, (x) => String(Math.round(x)), 1100, Math.max(0, P.retirement.p1Age - 40)); }
    else if (els.ageVal._val !== P.retirement.p1Age) { els.ageVal.textContent = P.retirement.p1Age; els.ageVal._val = P.retirement.p1Age; }
    updateAgeSub(P);
    showCountdown(previewYear(P));
    UI.mount(els.togetherWrap, h('div.retire-row',
      h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, 'Retire together', UI.tipButton('together')),
      UI.toggle({ checked: P.retirement.together, label: 'Retire together', onChange: (on) => {
        if (!on) store().set('retirement.p2Age', P.people.p1.birthYear + P.retirement.p1Age - P.people.p2.birthYear, { silent: true });
        store().set('retirement.together', on);
      } })));
    if (!P.retirement.together) {
      const s2 = h('input.slider', { type: 'range', min: 40, max: 65, step: 1, value: P.retirement.p2Age, 'aria-label': P.people.p2.name + ' retirement age' });
      const val = h('span', String(P.retirement.p2Age));
      const sub = h('span.value-sub', `End of ${P.people.p2.birthYear + P.retirement.p2Age}`);
      const commit = UI.debounce((v) => store().set('retirement.p2Age', v), 60);
      s2.addEventListener('input', () => {
        paintSlider(s2); val.textContent = s2.value; sub.textContent = `End of ${P.people.p2.birthYear + Number(s2.value)}`;
        const Q = Object.assign({}, P, { retirement: Object.assign({}, P.retirement, { p2Age: Number(s2.value) }) });
        showCountdown(previewYear(Q));
        commit(Number(s2.value));
      });
      paintSlider(s2);
      UI.mount(els.p2Wrap, h('div.p2-block',
        h('div.p2-top', h('span.label', `${P.people.p2.name} retires at`), sub),
        h('div.value-lg', val), s2));
    } else UI.mount(els.p2Wrap);

    if (P.meta && P.meta.isSample) {
      UI.mount(els.sampleBanner, h('div.card.banner',
        h('div.b-text', h('b', 'You’re looking at a sample household. '), 'Import your plan file to see your own numbers. It stays on this device.'),
        h('button.btn.small.primary', { onclick: () => RP.app.importFile() }, 'Import')));
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
    els.projLabel.textContent = 'At retirement';
    els.balRet.textContent = fmt.money(a.summary.balanceAtRetirement || 0);
    els.balRetSub.textContent = `Jan 1, ${a.summary.retireYear}`;
  }
  function onScrub(info) {
    const a = Home._a;
    if (!info || !a) { scrubbing = false; showDefaultReadout(); return; }
    scrubbing = true;
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
    showCountdown(s.retireYear);

    const pct = s.successRate;
    UI.countTo(els.pct, Math.round(pct * 100), (x) => String(Math.round(x)), 900, 0);
    els.meter.style.width = (pct * 100) + '%';
    els.ringWrap.classList.toggle('warn', pct < 0.9 && pct >= 0.75);
    els.ringWrap.classList.toggle('bad', pct < 0.75);
    if (lastSuccess != null && lastSuccess < 0.9 && pct >= 0.9) Home.celebrate();
    lastSuccess = pct;

    Home._a = a;
    UI.countTo(els.netWorth, s.netWorthToday, (x) => fmt.money(x), 900, 0);
    els.netWorthSub.textContent = `Savings ${fmt.money(s.portfolioToday)} + home & 529`;
    if (!scrubbing) {
      els.projLabel.textContent = 'At retirement';
      UI.countTo(els.balRet, s.balanceAtRetirement || 0, (x) => fmt.money(x), 900, 0);
      els.balRetSub.textContent = `Jan 1, ${s.retireYear}`;
    }
    if (els.chart) els.chart.update(chartData(a));

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
    if (mm.safe) UI.countTo(els.safe, mm.safe.amount, (x) => fmt.money(x), 900, 0);
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
    for (const k of ['safe', 'green', 'coast']) els[k].style.opacity = '0.45';
  };
  Home.metricsArrived = function (k) { if (els && els[k]) els[k].style.opacity = '1'; };

  function renderMoreSummary() {
    const a = Home._a, m = Home._metrics || {};
    const parts = [];
    if (a) parts.push(`Net worth ${fmt.money(a.summary.netWorthToday)}`);
    if (m.coast) parts.push(`Coast FIRE ${m.coast.year || 'not yet'}`);
    if (m.green && m.green.amount) parts.push(`Green light ${fmt.money(m.green.amount)}`);
    els.more.setSummary(parts.join(' · ') || '—');
  }
  function renderBrief() {
    const tmp = document.createElement('div');
    tmp.innerHTML = els.summary.innerHTML;
    const text = tmp.textContent || '';
    const m = text.match(/^.*?\.(?=\s|$)/);
    els.brief.setSummary(m ? m[0] : text);
  }

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
      onclick: () => { if (al.action === 'checkin' && UI.checkin) UI.checkin.start(); else UI.plan.focusField(al.path); },
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
        h('div', h('div.value-md', next.title), h('div.value-sub', `${next.year} · in ${Math.max(0, next.year - new Date().getFullYear())} years`))) : h('div', 'Every milestone reached.'),
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
