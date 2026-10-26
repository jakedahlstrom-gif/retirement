/*
 * dice.js — roll a life: one of the Monte Carlo's market histories (the very
 * same ones behind your chance of success), played out year by year and told
 * as a short story: the best and worst years, a rough start, spending cuts,
 * how it ends and how lucky that life was compared with all the others.
 *
 * The chart draws itself like a timeline: each year's market return as a bar
 * (green up, red down) and your savings as a glowing line above.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const DC = (UI.dice = {});
  const DRAW_MS = 2600;
  const PIPS = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]] };
  const signed = (v) => (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(0) + '%';

  function dieFace(n) {
    const span = h('span');
    span.innerHTML = `<svg viewBox="0 0 30 30" aria-hidden="true">${PIPS[n].map(([r, c]) => `<circle cx="${7 + c * 8}" cy="${7 + r * 8}" r="2.6"/>`).join('')}</svg>`;
    return span.firstChild;
  }

  DC.open = function () {
    const sc = store().scenario();
    const P = RP.engine.resolvePlan(store().activePlan());
    const runs = P.sim.runs;
    let last = -1, life = null, raf = 0, closed = false, t0 = 0;

    const die = h('button.dc-die', { 'aria-label': 'Roll a life' }, dieFace(5));
    const label = h('div.dc-label', 'Tap the die');
    const canvas = h('canvas.dc-canvas', { role: 'img', 'aria-label': 'One possible life: yearly market returns and your savings' });
    const story = h('div.dc-story');
    const pill = h('span.pill', { style: { color: `var(--s${sc.color})` } }, sc.name);
    UI.sheet.open({
      title: 'Roll a life',
      body: [
        h('div.x-head', pill),
        h('p.x-note', `Your chance of success comes from ${runs.toLocaleString()} possible market histories. Roll the die to live one of them, year by year.`),
        h('div.dc-top', die, label),
        h('div.dc-box', canvas),
        h('div.ss-legend',
          h('span.lg', h('i.x-sw', { style: { background: 'var(--pos)' } }), 'Market up'),
          h('span.lg', h('i.x-sw', { style: { background: 'var(--bad)' } }), 'Market down'),
          h('span.lg', h('i.pg-dash', { style: { borderTopStyle: 'solid', borderTopWidth: '2px', borderColor: 'var(--accent)' } }), 'Savings')),
        story,
      ],
      onClose: () => { closed = true; cancelAnimationFrame(raf); },
      actions: [{ label: 'Roll again', onClick: roll }, { label: 'Done', primary: true, onClick: () => UI.sheet.close() }],
    });

    function roll() {
      let k;
      do { k = Math.floor(Math.random() * runs); } while (k === last && runs > 1);
      last = k;
      UI.haptic();
      die.classList.remove('rolling'); void die.offsetWidth; die.classList.add('rolling');
      let face = 1;
      const spin = setInterval(() => { face = (face % 6) + 1; UI.mount(die, dieFace(face)); }, 90);
      label.textContent = 'Rolling…';
      UI.mount(story);
      const started = performance.now();
      RP.engineClient.lab('roll', P, { k }).then((res) => {
        const wait = Math.max(0, 650 - (performance.now() - started));
        setTimeout(() => {
          clearInterval(spin);
          if (closed) return;
          UI.mount(die, dieFace(1 + (k % 6)));
          die.classList.remove('rolling');
          life = res;
          label.innerHTML = '';
          label.append(h('b', `Life #${(k + 1).toLocaleString()}`), ` of ${runs.toLocaleString()}`);
          t0 = performance.now();
          if (!raf) raf = requestAnimationFrame(draw);
          tell(res);
        }, wait);
      }).catch((e) => { clearInterval(spin); if (e.message !== 'stale') { console.error(e); label.textContent = 'Couldn’t roll.'; } });
    }
    die.addEventListener('click', roll);

    function draw(t) {
      raf = 0;
      if (closed || !life) return;
      const dpr = window.devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      const css = (k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim();
      const rows = life.rows, n = rows.length;
      const p = UI.reducedMotion() ? 1 : Math.min(1, Math.max(0, (t - t0) / DRAW_MS)); // a frame can be stamped just before t0
      const upto = p * n;
      const L = 6, R = 6, T = 16, mid = H * 0.66, B = 16;
      const bw = (W - L - R) / n;
      const X = (i) => L + (i + 0.5) * bw;
      const top = Math.max(...rows.map((r) => r.end), 1) * 1.1;
      const Y = (v) => T + (1 - Math.max(0, v) / top) * (mid - 14 - T);
      const RET = 0.4, Yr = (r) => mid + 2 + (H - B - mid - 2) / 2 - Math.max(-RET, Math.min(RET, r)) / RET * ((H - B - mid - 2) / 2);
      const zero = Yr(0);
      const pos = css('--pos'), bad = css('--bad'), acc = css('--accent'), muted = css('--muted');
      // Return bars
      c.fillStyle = css('--line-strong'); c.fillRect(L, zero, W - L - R, 1);
      for (let i = 0; i < Math.min(n, Math.ceil(upto)); i++) {
        const r = rows[i].ret, y = Yr(r), grow = Math.min(1, upto - i);
        c.fillStyle = r >= 0 ? pos : bad;
        c.globalAlpha = 0.85;
        const hgt = (y - zero) * grow;
        c.fillRect(X(i) - bw * 0.32, Math.min(zero, zero + hgt), bw * 0.64, Math.abs(hgt) || 1);
      }
      c.globalAlpha = 1;
      // Retirement marker
      const ri = rows.findIndex((r) => r.retired);
      if (ri >= 0) {
        c.strokeStyle = css('--line-strong'); c.setLineDash([2, 3]);
        c.beginPath(); c.moveTo(X(ri) - bw / 2, T); c.lineTo(X(ri) - bw / 2, H - B); c.stroke(); c.setLineDash([]);
        c.fillStyle = muted; c.font = `600 10.5px ${css('--font')}`; c.textAlign = 'left';
        c.fillText('Retire', X(ri) - bw / 2 + 4, T + 2);
      }
      // Savings line, drawn up to "now"
      const head = Math.min(n - 1, Math.floor(upto));
      c.save();
      c.lineJoin = c.lineCap = 'round';
      c.strokeStyle = acc; c.lineWidth = 2.4; c.shadowColor = acc; c.shadowBlur = 10;
      c.beginPath();
      for (let i = 0; i <= head; i++) { const x = X(i), y = Y(rows[i].end); if (i) c.lineTo(x, y); else c.moveTo(x, y); }
      c.stroke(); c.restore();
      if (p < 1) {
        const x = X(head), y = Y(rows[head].end);
        const g = c.createRadialGradient(x, y, 0, x, y, 9);
        g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill();
      }
      if (life.failYear != null && p >= 1) {
        const fi = rows.findIndex((r) => r.year === life.failYear);
        if (fi >= 0) { c.fillStyle = bad; c.shadowColor = bad; c.shadowBlur = 10; c.beginPath(); c.arc(X(fi), Y(0), 4, 0, 7); c.fill(); c.shadowBlur = 0; }
      }
      // Labels
      c.fillStyle = muted; c.font = `600 10.5px ${css('--font')}`;
      c.textAlign = 'left'; c.fillText(String(rows[0].year), L, H - 3);
      c.textAlign = 'right'; c.fillText(String(rows[n - 1].year), W - R, H - 3);
      c.fillText(fmt.money(top), W - R, 10);
      c.fillText('+40%', W - R, Yr(0.4) + 9); c.fillText('−40%', W - R, Yr(-0.4) - 2);
      if (p < 1) raf = requestAnimationFrame(draw);
    }

    function tell(res) {
      const rows = res.rows;
      const hz = P.household.horizonPerson, hzName = P.people[hz].name, birth = P.people[hz].birthYear;
      const p1 = P.people.p1.name;
      const ageAt = (r) => `${p1} ${r.ages.p1}`;
      const by = (f) => rows.reduce((best, r) => (f(r) > f(best) ? r : best), rows[0]);
      const best = by((r) => r.ret), worst = by((r) => -r.ret);
      const retRow = rows.find((r) => r.retired);
      const firstFive = rows.filter((r) => r.retired).slice(0, 5);
      const geo = (l) => (l.length ? Math.exp(l.reduce((t, r) => t + Math.log(1 + r.ret), 0) / l.length) - 1 : 0);
      const cuts = rows.filter((r) => r.cut).length;
      let streak = 0, run = 0;
      for (const r of rows) { run = r.ret < 0 ? run + 1 : 0; streak = Math.max(streak, run); }
      const lines = [];
      if (retRow) lines.push(['flag', `You retire in ${retRow.year} with ${fmt.money(retRow.start)}.`]);
      lines.push(['trend', `Markets average ${signed(res.avgReturn)} a year over the whole stretch (your plan assumes about ${signed(res.planReturn)}).`]);
      lines.push(['sparkle', `Best year: ${best.year} (${ageAt(best)}), ${signed(best.ret)}.`]);
      lines.push(['alert', `Worst year: ${worst.year} (${ageAt(worst)}), ${signed(worst.ret)}.` + (streak >= 3 ? ` Longest losing streak: ${streak} years in a row.` : '')]);
      if (firstFive.length >= 3) {
        const g = geo(firstFive);
        if (g < 0.01) lines.push(['alert', `A rough start: your first ${firstFive.length} retired years average ${signed(g)} a year, the stretch that matters most.`]);
        else if (g > 0.07) lines.push(['sparkle', `A lucky start: your first ${firstFive.length} retired years average ${signed(g)} a year.`]);
      }
      if (cuts) lines.push(['shield', `Your guardrails trim spending in ${cuts} year${cuts === 1 ? '' : 's'} after bad stretches.`]);
      const ending = res.failYear != null
        ? h('div.dc-end.bad', h('b', `Runs short in ${res.failYear}`), h('span', `when ${hzName} is ${res.failYear - birth}`))
        : h('div.dc-end.ok', h('b', `${fmt.money(res.end)} left`), h('span', `when ${hzName} is ${P.household.horizonAge}`));
      const luck = Math.round(res.rank * 100);
      UI.mount(story,
        h('div.dc-ends', ending, h('div.dc-end', h('b', `${luck}%`), h('span', `of lives end worse than this one`))),
        h('div.dc-lines', lines.map(([ic, text], i) => h('div.dc-line', { style: { animationDelay: (0.25 + i * 0.28).toFixed(2) + 's' } }, UI.icon(ic), h('span', text)))));
    }

    requestAnimationFrame(roll);
  };
})(globalThis.RP = globalThis.RP || {});
