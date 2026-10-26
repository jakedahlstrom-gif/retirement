/*
 * lifegrid.js — two small perspective tools:
 *
 *   lifegrid.open()    Life in years: each of your lives as a grid of dots, one
 *                      per year (or, for you, one per week), colored by phase:
 *                      growing up, working, retired. Past years are solid,
 *                      years ahead are rings, and this year glows.
 *   lifegrid.prices()  Future prices: the app works in today's dollars; these
 *                      price tags show what the same things will likely cost
 *                      in a given year at your inflation assumption.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const E = RP.engine;
  const store = () => RP.store;
  const LG = (UI.lifegrid = {});
  const ADULT = 18;
  let view = 'years';

  /** Phase of a person's life in a given year: kid, work, ret (or null if past the plan). */
  function phaseOf(P, pid, year, retireYear) {
    const age = year - P.people[pid].birthYear;
    if (age < ADULT) return 'kid';
    return year >= retireYear ? 'ret' : 'work';
  }

  LG.open = function () {
    const P = E.resolvePlan(store().activePlan());
    const a = RP.app.last;
    const ry = E.retireYears(P);
    const now = new Date().getFullYear();
    const horizonYear = P.people[P.household.horizonPerson].birthYear + P.household.horizonAge;
    const people = ['p1', 'p2'];
    const body = h('div');
    const seg = UI.segmented({
      options: [{ value: 'years', label: 'Years' }, { value: 'weeks', label: 'Weeks' }], value: view,
      onChange: (v) => { view = v; paint(); },
    });
    UI.sheet.open({ title: 'Life in years', body: [seg, body], onClose: () => { cancelAnimationFrame(weekRaf); }, actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }] });

    let weekRaf = 0;
    function paint() {
      cancelAnimationFrame(weekRaf);
      if (view === 'weeks') return paintWeeks();
      const blocks = people.map((pid) => {
        const p = P.people[pid];
        const end = P.death.enabled && P.death.person === pid ? Math.min(horizonYear, P.death.year) : horizonYear; // the plan's last year
        const retireYear = ry[pid] + 1; // first full year retired
        const dots = [];
        for (let y = p.birthYear; y <= end; y++) {
          const ph = phaseOf(P, pid, y, retireYear);
          const cls = 'i.lg-dot.' + ph + (y < now ? '.past' : y === now ? '.now' : '');
          dots.push(h(cls, { title: `${y}: ${p.name} ${y - p.birthYear}` }));
        }
        const lived = now - p.birthYear, work = Math.max(0, retireYear - Math.max(now, p.birthYear + ADULT)), ret = Math.max(0, end - Math.max(retireYear, now) + 1);
        const adult = end - (p.birthYear + ADULT) + 1, retired = Math.max(0, end - retireYear + 1);
        return h('div.lg-person',
          h('div.lg-name', h('b', p.name), h('span', `born ${p.birthYear}`)),
          h('div.lg-grid', dots),
          h('div.lg-stats',
            h('div', h('b', String(lived)), h('span', 'years lived')),
            h('div', h('b', String(work)), h('span', 'working years left')),
            h('div', h('b', String(ret)), h('span', 'retired years planned'))),
          h('p.x-note', `Retirement is ${Math.round(retired / Math.max(1, adult) * 100)}% of ${p.name}’s adult life in this plan.`));
      });
      // Shared retirement and the kids
      const bothRet = Math.max(0, Math.min(horizonYear, P.death.enabled ? P.death.year : horizonYear) - Math.max(ry.p1, ry.p2));
      const kids = (P.kids || []).map((k) => `${k.name} will be ${E.retireYears(P).p1 + 1 - k.birthYear}`);
      UI.mount(body,
        h('div.lg-key',
          h('span', h('i.lg-dot.kid.past'), 'Growing up'), h('span', h('i.lg-dot.work.past'), 'Working'), h('span', h('i.lg-dot.ret.past'), 'Retired'),
          h('span', h('i.lg-dot.ret'), 'Ahead'), h('span', h('i.lg-dot.now.work'), 'This year')),
        blocks,
        h('div.card.lg-together',
          h('div', h('b', String(bothRet)), h('span', ' years retired together, if all goes to plan')),
          kids.length ? h('p.x-note', `When ${P.people.p1.name} retires: ${kids.join(', ')}.`) : null,
          a ? h('p.x-note', `Your savings have to cover ${Math.max(0, horizonYear - Math.max(a.summary.retireYear, now) + 1)} years of retirement. That’s the number the whole plan is built around.`) : null));
    }

    /** One person's life in weeks: 52 tiny squares a row, one row per year of age. */
    function paintWeeks() {
      const p = P.people.p1;
      const years = P.household.horizonPerson === 'p1' ? P.household.horizonAge : Math.max(90, horizonYear - p.birthYear);
      const birth = new Date(p.birthYear, (p.birthMonth || 1) - 1, 15);
      const weekNow = Math.floor((Date.now() - birth) / (7 * 864e5));
      const retireWeek = Math.floor((new Date(ry.p1 + 1, 0, 1) - birth) / (7 * 864e5));
      const total = years * 52;
      const canvas = h('canvas.lg-weeks', { role: 'img', 'aria-label': `${p.name}’s life in weeks` });
      const box = h('div.lg-weeks-box', canvas);
      UI.mount(body,
        h('p.x-note', `${p.name}’s life to ${years}, one square per week. Each row is a year of age.`),
        box,
        h('div.lg-stats',
          h('div', h('b', weekNow.toLocaleString()), h('span', 'weeks lived')),
          h('div', h('b', Math.max(0, retireWeek - weekNow).toLocaleString()), h('span', 'weeks to retirement')),
          h('div', h('b', Math.max(0, total - Math.max(retireWeek, weekNow)).toLocaleString()), h('span', 'weeks retired'))));
      const cols = 52, cell = 6, gap = 1.2;
      const W = cols * (cell + gap) + 26, H = years * (cell + gap) + 4;
      box.style.aspectRatio = `${W} / ${H}`;
      const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
      const colors = { kid: '#6fa8ff', work: '#5fd1c0', ret: css('--accent') || '#ffb65c' };
      const t0 = performance.now();
      const draw = (t) => {
        const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth;
        if (!cw) return;
        const k = cw / W;
        if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(H * k * dpr); }
        const c = canvas.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
        const reveal = UI.reducedMotion() ? Infinity : (t - t0) * 6; // weeks drawn so far
        c.font = `600 6px ${css('--font')}`; c.fillStyle = css('--muted'); c.textAlign = 'right';
        for (let y = 0; y < years; y++) {
          if (y % 10 === 0) c.fillText(String(y), 20, y * (cell + gap) + cell);
          for (let w = 0; w < cols; w++) {
            const i = y * cols + w;
            if (i > reveal) continue;
            const ph = y < ADULT ? 'kid' : i >= retireWeek ? 'ret' : 'work';
            const x = 24 + w * (cell + gap), yy = y * (cell + gap) + 1;
            c.globalAlpha = i < weekNow ? 0.9 : 0.22;
            c.fillStyle = colors[ph];
            c.fillRect(x, yy, cell, cell);
          }
        }
        // This week glows
        if (weekNow < total && weekNow <= reveal) {
          const y = Math.floor(weekNow / cols), w = weekNow % cols;
          const x = 24 + w * (cell + gap), yy = y * (cell + gap) + 1;
          const pulse = 0.6 + 0.4 * Math.sin(t / 300);
          c.globalAlpha = 1; c.fillStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 8 * pulse;
          c.fillRect(x - 0.5, yy - 0.5, cell + 1, cell + 1); c.shadowBlur = 0;
        }
        c.globalAlpha = 1;
        if (!UI.reducedMotion()) weekRaf = requestAnimationFrame(draw);
      };
      weekRaf = requestAnimationFrame(draw);
    }
    paint();
  };

  // ------------------------------------------------------------ future prices
  // Roughly what these cost in the U.S. in 2026.
  const TAGS = [
    { label: 'Latte', price: 5.75, icon: '☕' },
    { label: 'Gallon of gas', price: 3.2, icon: '⛽' },
    { label: 'Dozen eggs', price: 3.5, icon: '🥚' },
    { label: 'Movie ticket', price: 13, icon: '🎬' },
    { label: 'Streaming, a month', price: 18, icon: '📺' },
    { label: 'Week at the beach', price: 3000, icon: '🏖️' },
    { label: 'New car', price: 49000, icon: '🚗' },
    { label: 'Median home', price: 420000, icon: '🏡' },
  ];
  const cents = (v) => (v < 100 ? '$' + v.toFixed(2) : fmt.money(v, v < 1e6 ? { full: true } : undefined));

  LG.prices = function () {
    const P = E.resolvePlan(store().activePlan());
    const a = RP.app.last;
    const infl = P.returns.inflation / 100;
    const y0 = new Date().getFullYear();
    const ret = a ? a.summary.retireYear : E.retireYears(P).p1 + 1;
    const yEnd = P.people[P.household.horizonPerson].birthYear + P.household.horizonAge;
    let year = Math.max(y0 + 1, ret);
    const yearEl = h('b.fp-year');
    const sub = h('span.fp-sub');
    const slider = h('input.slider', { type: 'range', min: String(y0), max: String(yEnd), step: '1', value: String(year), 'aria-label': 'Year' });
    const tags = TAGS.map((t) => ({ t, val: h('div.fp-val'), was: h('div.fp-was') }));
    const budget = h('div.fp-big'), budgetSub = h('div.fp-bigsub'), budgetLabel = h('div.label');
    const nest = h('div.fp-big'), nestSub = h('div.fp-bigsub');
    UI.sheet.open({
      title: 'Future prices',
      body: [
        h('p.x-note', `Everything in this app is in today’s dollars, so years compare fairly. These tags show the same things in that year’s dollars, at your ${P.returns.inflation}% inflation assumption.`),
        h('div.fp-head', yearEl, sub), slider,
        h('div.fp-grid', tags.map(({ t, val, was }) => h('div.fp-tag', h('span.fp-hole'), h('span.fp-icon', t.icon), h('div.fp-label', t.label), val, was))),
        h('div.fp-pair',
          h('div.fp-card', budgetLabel, budget, budgetSub),
          h('div.fp-card', h('div.label', `Savings at retirement, in ${ret} dollars`), nest, nestSub)),
      ],
      actions: [{ label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });
    const setYear = (y) => {
      year = y;
      const k = Math.pow(1 + infl, y - y0);
      slider.style.setProperty('--fill', ((y - y0) / Math.max(1, yEnd - y0) * 100).toFixed(1) + '%');
      yearEl.textContent = String(y);
      const ages = `${P.people.p1.name} ${y - P.people.p1.birthYear} · ${P.people.p2.name} ${y - P.people.p2.birthYear}`;
      sub.textContent = (y === ret ? 'The year you retire · ' : '') + ages + ` · prices ×${k.toFixed(2)}`;
      for (const { t, val, was } of tags) {
        UI.countTo(val, t.price * k, cents, 450);
        was.textContent = `${cents(t.price)} today`;
      }
      UI.countTo(budget, P.spending.retirement * k, (v) => fmt.money(v), 450);
      budgetLabel.textContent = `Retirement budget, in ${y} dollars`;
      budgetSub.textContent = `${fmt.money(P.spending.retirement)} a year in today’s dollars`;
      const row = a && a.rows.find((r) => r.year === ret);
      const bal = row ? row.startTotal : null;
      UI.countTo(nest, bal == null ? 0 : bal * Math.pow(1 + infl, ret - y0), (v) => fmt.money(v), 450);
      nestSub.textContent = bal == null ? 'Still calculating' : `${fmt.money(bal)} in today’s dollars (typical market)`;
    };
    slider.addEventListener('input', () => setYear(Number(slider.value)));
    setYear(year);
  };
})(globalThis.RP = globalThis.RP || {});
