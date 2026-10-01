/*
 * home.js — the Home screen. One glance tells you where you stand:
 * success ring, safe spending, countdown, the retirement-age slider, key
 * numbers, next milestone, alerts and a plain-English summary.
 *
 * The layout is built once; new results only update the numbers, so they can
 * glide smoothly from old to new values.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const Home = (UI.home = {});
  let els = null;
  let lastSuccess = null;
  const R = 104, CIRC = 2 * Math.PI * R;

  function stat(key, label, tipKey) {
    const v = h('div.value-md', '—');
    const s = h('div.value-sub', '');
    const card = h('div.card', h('div.card-title', h('span', label), tipKey ? UI.tipButton(tipKey) : null), v, s);
    els[key] = v; els[key + 'Sub'] = s;
    return card;
  }

  Home.build = function (root) {
    els = {};
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 236 236');
    svg.innerHTML = `<circle class="ring-track" cx="118" cy="118" r="${R}" fill="none" stroke-width="10"/>
      <circle class="ring-bar" cx="118" cy="118" r="${R}" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>`;
    els.ringBar = svg.querySelector('.ring-bar');
    els.pct = h('span', '—');
    els.ringWrap = h('div.ring-wrap', svg, h('div.ring-glow'),
      h('div.ring-center', h('div.pct', els.pct, h('small', '%')), h('div.lbl', 'Chance of success', UI.tipButton('success'))));
    els.safe = h('div.value-md', '—');
    els.count = h('div.value-md', '—');
    els.countSub = h('div.value-sub', '');
    els.busy = h('span.busy-dot');
    const hero = h('div.card.hero',
      els.ringWrap,
      h('div.hero-stats',
        h('div', h('div.label', 'Safe spending ', UI.tipButton('safeSpend')), els.safe, h('div.value-sub', 'per year')),
        h('div.sep'),
        h('div', h('div.label', 'Retire in ', UI.tipButton('countdown')), els.count, els.countSub)));

    // Retirement age card
    els.ageVal = h('span', '—');
    els.ageSub = h('div.value-sub', '');
    els.ageSlider = h('input.slider', { type: 'range', min: 45, max: 65, step: 1, 'aria-label': 'Retirement age' });
    els.togetherWrap = h('div');
    els.p2Wrap = h('div');
    const retire = h('div.card.retire-card',
      h('div.card-title', els.ageTitle = h('span', 'Retirement age'), UI.tipButton('retireAge'), h('span.grow'), els.busy),
      h('div.who', h('div.value-xl', els.ageVal), els.ageSub),
      els.ageSlider,
      h('div.slider-scale', h('span', '45'), h('span', '55'), h('span', '65')),
      els.togetherWrap, els.p2Wrap);
    const commitAge = UI.debounce((v) => store().set('retirement.p1Age', v), 60);
    els.ageSlider.addEventListener('input', () => {
      const v = Number(els.ageSlider.value);
      paintSlider(els.ageSlider);
      els.ageVal.textContent = v;
      updateAgeSub(v);
      UI.haptic();
      commitAge(v);
    });

    els.summary = h('div.summary-text', '');
    els.sampleBanner = h('div');
    els.alerts = h('div');
    els.milestone = h('div');
    els.badges = h('div.badges-row');

    // Order: where you stand → the big lever → key numbers → what needs
    // attention → the story in words → what's next.
    UI.mount(root,
      els.sampleBanner,
      hero,
      retire,
      h('div.grid2', stat('netWorth', 'Net worth', 'netWorth'), stat('balRet', 'At retirement', 'balRet')),
      h('div', { style: { height: 'var(--gap)' } }),
      h('div.grid2', stat('coast', 'Coast FIRE', 'coast'), stat('green', 'Green light', 'greenLight')),
      h('div', { style: { height: 'var(--gap)' } }),
      els.alerts,
      h('div.card', h('div.card-title', h('span', 'Your plan in brief')), els.summary),
      els.milestone,
      h('p.footer-note', 'Results are educational estimates, not financial advice.'));
  };

  function paintSlider(s) {
    const pct = ((s.value - s.min) / (s.max - s.min)) * 100;
    s.style.setProperty('--fill', pct + '%');
  }

  function updateAgeSub(v) {
    const P = store().activePlan();
    const year = P.people.p1.birthYear + v;
    const p2 = P.retirement.together ? year - P.people.p2.birthYear : P.retirement.p2Age;
    els.ageSub.textContent = `End of ${year}` + (P.retirement.together ? ` · ${P.people.p2.name} ${p2}` : '');
  }

  /** Refresh the input-driven parts immediately (before results arrive). */
  Home.syncInputs = function () {
    if (!els) return;
    const P = store().activePlan();
    els.ageTitle.textContent = `${P.people.p1.name} retires at`;
    els.ageSlider.value = P.retirement.p1Age;
    paintSlider(els.ageSlider);
    els.ageVal.textContent = P.retirement.p1Age;
    updateAgeSub(P.retirement.p1Age);
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
      s2.addEventListener('input', () => { paintSlider(s2); val.textContent = s2.value; sub.textContent = `End of ${P.people.p2.birthYear + Number(s2.value)}`; commit(Number(s2.value)); });
      paintSlider(s2);
      UI.mount(els.p2Wrap, h('div', { style: { marginTop: '14px' } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
          h('span.label', `${P.people.p2.name} retires at`), sub),
        h('div.value-lg', val), s2));
    } else UI.mount(els.p2Wrap);

    if (P.meta && P.meta.isSample) {
      UI.mount(els.sampleBanner, h('div.card.banner',
        h('div.b-text', h('b', 'You’re looking at a sample household. '), 'Import your plan file to see your own numbers. It stays on this device.'),
        h('button.btn.small.primary', { onclick: () => RP.app.importFile() }, 'Import')));
    } else UI.mount(els.sampleBanner);
  };

  Home.setBusy = function (on) { if (els) els.busy.parentNode.parentNode.classList.toggle('busy', !!on); };

  /** New analysis results arrived. */
  Home.update = function (a) {
    if (!els || !a) return;
    const s = a.summary;
    const pct = s.successRate;
    UI.countTo(els.pct, Math.round(pct * 100), (x) => String(Math.round(x)));
    els.ringBar.style.strokeDashoffset = String(CIRC * (1 - pct));
    els.ringWrap.classList.toggle('warn', pct < 0.9 && pct >= 0.75);
    els.ringWrap.classList.toggle('bad', pct < 0.75);
    if (lastSuccess != null && lastSuccess < 0.9 && pct >= 0.9) Home.celebrate();
    lastSuccess = pct;

    UI.countTo(els.netWorth, s.netWorthToday, (x) => fmt.money(x));
    els.netWorthSub.textContent = `Savings ${fmt.money(s.portfolioToday)} + home & 529`;
    UI.countTo(els.balRet, s.balanceAtRetirement || 0, (x) => fmt.money(x));
    els.balRetSub.textContent = `On Jan 1, ${s.retireYear}`;

    // Countdown to Jan 1 of the retirement year
    const now = new Date();
    const target = new Date(s.retireYear, 0, 1);
    let months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
    if (target.getDate() < now.getDate()) months--;
    if (months <= 0) { els.count.textContent = 'Now'; els.countSub.textContent = 'retired'; }
    else {
      const y = Math.floor(months / 12), m = months % 12;
      els.count.textContent = y ? `${y}y ${m}m` : `${m}m`;
      els.countSub.textContent = `Jan ${s.retireYear}`;
    }
    els.summary.innerHTML = UI.insights.summary(a, Home._metrics);
    Home._a = a;
    renderAlerts(a, Home._metrics);
    renderMilestones(a, Home._metrics);
  };

  /** Slower numbers (safe spending, green light, Coast FIRE) arrive one by one. */
  Home.updateMetrics = function (m) {
    if (!els) return;
    Home._metrics = Object.assign({}, Home._metrics || {}, m);
    const mm = Home._metrics;
    if (mm.safe) UI.countTo(els.safe, mm.safe.amount, (x) => fmt.money(x));
    if (mm.green) {
      UI.countTo(els.green, mm.green.amount || 0, (x) => (mm.green.amount ? fmt.money(x) : '—'));
      const a = Home._a;
      els.greenSub.textContent = mm.green.amount && a ? (a.summary.balanceAtRetirement >= mm.green.amount ? 'Projected: above it ✓' : 'Projected: below it') : `For ${store().activePlan().sim.greenLightTarget}% success`;
    }
    if (mm.coast) {
      els.coast.textContent = mm.coast.year ? String(mm.coast.year) : 'Not yet';
      els.coastSub.textContent = mm.coast.year ? (mm.coast.year <= new Date().getFullYear() ? 'Reached ✓' : `Could stop saving then`) : 'Keep saving for now';
    }
    if (Home._a) {
      els.summary.innerHTML = UI.insights.summary(Home._a, mm);
      renderAlerts(Home._a, mm);
      renderMilestones(Home._a, mm);
    }
  };
  Home.clearMetrics = function () {
    Home._metrics = {};
    if (!els) return;
    for (const k of ['safe', 'green', 'coast']) els[k].style.opacity = '0.45';
  };
  Home.metricsArrived = function (k) { if (els && els[k]) els[k].style.opacity = '1'; };

  function renderAlerts(a, m) {
    const list = UI.insights.alerts(a, m);
    Home._alerts = list;
    if (!list.length) {
      UI.mount(els.alerts, h('div.card', h('div.card-title', h('span', 'Alerts')),
        h('div.alert.info', h('div.ico', { style: { background: 'var(--accent-soft)', color: 'var(--accent)' } }, UI.icon('check')),
          h('div', h('div.a-title', 'All clear'), h('div.a-text', 'No cliffs, penalties or shortfalls in the typical path.')))));
      return;
    }
    UI.mount(els.alerts, h('div.card', h('div.card-title', h('span', 'Alerts'), h('span.grow'), h('span.pill', String(list.length))),
      list.slice(0, 6).map((al) => h('button.alert.' + al.level, {
        onclick: () => { if (al.action === 'checkin' && UI.checkin) UI.checkin.start(); else UI.plan.focusField(al.path); },
      },
      h('div.ico', UI.icon(al.level === 'info' ? 'info' : 'alert')),
      h('div', h('div.a-title', al.title), h('div.a-text', al.text), h('div.a-fix', al.fix + ' →'))))));
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
      h('div', { style: { marginTop: '16px' } }, h('div.badges-row', list.map((x) =>
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
    const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3fc493';
    const parts = Array.from({ length: 46 }, () => {
      const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 4.5;
      return { x: cx + Math.cos(ang) * 90, y: cy + Math.sin(ang) * 90, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 1.2 + Math.random() * 2.2, life: 1 };
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
