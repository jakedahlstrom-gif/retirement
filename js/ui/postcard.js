/*
 * postcard.js — "Postcard from retirement": a picture postcard from January of
 * your first year of retirement, painted in the app's golden-hour sky and
 * written from your plan (ages, savings, what you'll live on, what's next).
 * Drawn on a canvas at 1080×1350 so it shares well; nothing leaves the phone
 * unless you tap Share.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const PO = (UI.postcard = {});
  const W = 1080, H = 1350, HZ = 800; // canvas size and the horizon line

  /** What the postcard says, from the latest analysis. */
  function story(a) {
    const P = a.plan, S = a.schedule;
    const year = S.retireYear;
    const n1 = P.people.p1.name, n2 = P.people.p2.name;
    const lines = [];
    const p1 = year - P.people.p1.birthYear, p2 = year - P.people.p2.birthYear;
    lines.push(`This year ${n1} turns ${p1} and ${n2} turns ${p2}. The alarm clock is retired too.`);
    const kids = (P.kids || []).map((k) => [k.name, year - k.birthYear]).filter(([, age]) => age >= 0 && age <= 30);
    if (kids.length) lines.push(kids.map(([nm, age]) => `${nm} is ${age}`).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.');
    if (a.summary.balanceAtRetirement) lines.push(`You start with about ${fmt.money(a.summary.balanceAtRetirement)} saved.`);
    const ph = UI.paycheck.phases(a)[0];
    if (ph) {
      const { ins, outs } = UI.flow.items(ph.row, P);
      const spend = outs.filter((o) => !['tax', 'pen'].includes(o.key) && !o.key.startsWith('save')).reduce((t, o) => t + o.value, 0);
      lines.push(`You’ll live on ${fmt.money(spend / 12, { full: true })} a month, mostly from ${ins[0].label.replace(/^\w/, (c) => c.toLowerCase()).replace('social security', 'Social Security')}.`);
    }
    const next = [];
    const med = Math.min(S.unlock.p1.medicareYear, S.unlock.p2.medicareYear);
    if (med > year) next.push(`Medicare in ${med}`);
    const ss = Math.min(S.ssDetail.p1.claimYear, S.ssDetail.p2.claimYear);
    if (ss > year) next.push(`Social Security in ${ss}`);
    if (next.length) lines.push(`Still ahead: ${next.join(', ')}.`);
    if (a.summary.successRate != null) lines.push(`The odds this all works out: ${fmt.pct(a.summary.successRate)}.`);
    return { year, greeting: `Dear ${n1} & ${n2},`, lines };
  }

  /** Wrap `text` into lines no wider than `max`. */
  function wrap(c, text, max) {
    const out = [];
    let line = '';
    for (const w of text.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
    }
    if (line) out.push(line);
    return out;
  }

  /** Paint the postcard and return its canvas. */
  PO.paint = function (a) {
    const s = story(a);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui, sans-serif';

    // Golden-hour sky (the app's retirement palette) and the sea
    const sky = c.createLinearGradient(0, 0, 0, HZ);
    sky.addColorStop(0, '#0d1534'); sky.addColorStop(0.45, '#28346c'); sky.addColorStop(0.84, '#6a4568'); sky.addColorStop(1, '#ffb257');
    c.fillStyle = sky; c.fillRect(0, 0, W, HZ);
    const sea = c.createLinearGradient(0, HZ, 0, H);
    sea.addColorStop(0, '#573a48'); sea.addColorStop(0.6, '#07070f'); sea.addColorStop(1, '#05050b');
    c.fillStyle = sea; c.fillRect(0, HZ, W, H - HZ);
    // A few last stars
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 70; i++) {
      c.fillStyle = `rgba(255,255,255,${(0.15 + rnd() * 0.45) * (1 - i / 90)})`;
      c.beginPath(); c.arc(rnd() * W, Math.pow(rnd(), 1.6) * HZ * 0.55, 0.8 + rnd() * 1.6, 0, 7); c.fill();
    }
    // The sun sitting on the horizon, its glow and its path on the water
    const sx = W * 0.74, sy = HZ - 34;
    let g = c.createRadialGradient(sx, sy, 0, sx, sy, 420);
    g.addColorStop(0, 'rgba(255,184,94,0.55)'); g.addColorStop(1, 'rgba(255,184,94,0)');
    c.fillStyle = g; c.fillRect(0, 0, W, HZ);
    c.save(); c.beginPath(); c.rect(0, 0, W, HZ); c.clip();
    g = c.createRadialGradient(sx, sy, 0, sx, sy, 70);
    g.addColorStop(0, '#fffaf0'); g.addColorStop(0.5, '#fff1d6'); g.addColorStop(0.85, '#ffcf80'); g.addColorStop(1, 'rgba(255,207,128,0)');
    c.fillStyle = g; c.beginPath(); c.arc(sx, sy, 70, 0, 7); c.fill();
    c.restore();
    for (let i = 0; i < 14; i++) { // the sun's path on the water, fading before the words begin
      const y = HZ + 8 + i * 12, wd = 150 * (1 - i / 18) * (0.6 + rnd() * 0.5);
      c.fillStyle = `rgba(255,214,160,${0.5 * Math.pow(1 - i / 14, 1.6)})`;
      c.fillRect(sx - wd / 2 + (rnd() - 0.5) * 30, y, wd, 3);
    }
    c.fillStyle = 'rgba(255,178,87,0.65)'; c.fillRect(0, HZ, W, 2);

    // Words
    const M = 92;
    c.fillStyle = 'rgba(255,255,255,0.78)';
    c.font = `600 30px ${font}`;
    c.fillText('P O S T C A R D   F R O M', M, 150);
    c.fillStyle = '#ffffff';
    c.font = `200 128px ${font}`;
    c.fillText(`January ${s.year}`, M - 6, 280);
    c.font = `italic 44px Georgia, 'Times New Roman', serif`;
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fillText(s.greeting, M, 410);
    // Each block of words gets the biggest size (36px down to 26px) that fits its space.
    const block = (paras, top, bottom, maxW, gap) => {
      for (let size = 36; size >= 26; size -= 2) {
        c.font = `400 ${size}px ${font}`;
        const lh = Math.round(size * 1.38);
        const wrapped = paras.map((p) => wrap(c, p, maxW));
        const need = wrapped.reduce((t, l) => t + l.length * lh, 0) + gap * (paras.length - 1);
        if (need <= bottom - top || size === 26) {
          let y = top + size;
          for (const lines of wrapped) { for (const ln of lines) { c.fillText(ln, M, y); y += lh; } y += gap; }
          return y - gap;
        }
      }
      return top;
    };
    block(s.lines.slice(0, 2), 444, HZ - 90, W * 0.62, 6);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    const end = block(s.lines.slice(2), HZ + 64, H - 176, W - M * 2, 12);
    c.font = `italic 38px Georgia, 'Times New Roman', serif`;
    c.fillStyle = 'rgba(255,214,160,0.95)';
    c.fillText('— Your plan', M, end + 64);
    c.font = `500 22px ${font}`;
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillText('Horizon · a typical market, in today’s dollars · an estimate, not financial advice', M, H - 48);
    return cv;
  };

  PO.open = function () {
    const a = RP.app.last;
    if (!a) { UI.toast('Still calculating…'); return; }
    const cv = PO.paint(a);
    const year = a.schedule.retireYear;
    const img = h('img.pc-postcard', { src: cv.toDataURL('image/png'), alt: `Postcard from January ${year}: ${story(a).lines.join(' ')}` });
    // Make the file now: phones only allow the share sheet right after a tap, with no waiting in between.
    let file = null;
    cv.toBlob((b) => { file = b; }, 'image/png');
    UI.sheet.open({
      title: 'Postcard from retirement',
      body: [img, h('p.x-note', `Written from your “${store().scenario().name}” plan, in a typical market. It stays on this phone unless you share it.`)],
      actions: [
        { label: 'Share', onClick: () => {
          if (!file) return;
          RP.app.saveFile(file, `postcard-from-${year}.png`, `Postcard from ${year}`).then((how) => { if (how === 'downloaded') UI.toast('Postcard saved'); });
        } },
        { label: 'Done', primary: true, onClick: () => UI.sheet.close() },
      ],
    });
  };
})(globalThis.RP = globalThis.RP || {});
