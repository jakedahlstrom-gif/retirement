/*
 * postcard.js — "Postcard from retirement": a vintage picture postcard from
 * January of your first year of retirement, written from your plan (ages,
 * savings, what you'll live on, what's next).
 *
 * The pictures are painted seaside cottages (img/postcards/, made with
 * Magnific). Each plan gets one by its retirement year; "Another view" flips
 * through the rest. Drawn on a canvas at 1080×1350 so it shares well; nothing
 * leaves the phone unless you tap Share.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h, fmt = UI.fmt;
  const store = () => RP.store;
  const PO = (UI.postcard = {});
  const W = 1080, H = 1350;
  const PIC = { x: 60, y: 60, w: 960, h: 680 }; // the picture's window
  const PICTURES = ['img/postcards/coast-1.webp', 'img/postcards/coast-2.webp', 'img/postcards/coast-3.webp', 'img/postcards/coast-4.webp'];
  const INK = '#3f3124', SERIF = "Georgia, 'Times New Roman', serif";

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

  /** One of the pictures, loaded (null if it can't be). */
  const cache = {};
  function picture(i) {
    const src = PICTURES[((i % PICTURES.length) + PICTURES.length) % PICTURES.length];
    if (!cache[src]) {
      cache[src] = new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      });
    }
    return cache[src];
  }

  /** Paint the postcard (with picture `img`, or a painted sky if there's none) and return its canvas. */
  PO.paint = function (a, img) {
    const s = story(a);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const font = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui, sans-serif';
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

    // Old card stock: warm paper, a soft vignette and a little grain
    c.fillStyle = '#f3e6cf'; c.fillRect(0, 0, W, H);
    let g = c.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.95);
    g.addColorStop(0, 'rgba(255,250,238,0)'); g.addColorStop(1, 'rgba(176,140,92,0.28)');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = rnd() < 0.5 ? `rgba(120,90,50,${(0.04 + rnd() * 0.06).toFixed(3)})` : `rgba(255,255,255,${(0.06 + rnd() * 0.1).toFixed(3)})`;
      c.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }

    // The picture, on a pale mat with a soft shadow
    c.save();
    c.shadowColor = 'rgba(70,45,20,0.35)'; c.shadowBlur = 22; c.shadowOffsetY = 6;
    c.fillStyle = '#fbf5e8'; c.fillRect(PIC.x - 14, PIC.y - 14, PIC.w + 28, PIC.h + 28);
    c.restore();
    if (img) c.drawImage(img, PIC.x, PIC.y, PIC.w, PIC.h);
    else { // no picture (offline before it was saved): a painted dusk
      g = c.createLinearGradient(0, PIC.y, 0, PIC.y + PIC.h);
      g.addColorStop(0, '#f6cdb0'); g.addColorStop(0.55, '#f2b48e'); g.addColorStop(0.56, '#8fb9b4'); g.addColorStop(1, '#5f8f8c');
      c.fillStyle = g; c.fillRect(PIC.x, PIC.y, PIC.w, PIC.h);
      c.fillStyle = '#fff3dc'; c.beginPath(); c.arc(PIC.x + PIC.w * 0.3, PIC.y + PIC.h * 0.53, 34, Math.PI, 0); c.fill();
    }
    c.strokeStyle = 'rgba(90,60,30,0.25)'; c.lineWidth = 1; c.strokeRect(PIC.x + 0.5, PIC.y + 0.5, PIC.w - 1, PIC.h - 1);

    // Big-letter greeting, like the old souvenir cards
    c.save();
    c.font = `italic 44px ${SERIF}`;
    c.fillStyle = '#fffaf0'; c.shadowColor = 'rgba(50,32,18,0.8)'; c.shadowBlur = 9; c.shadowOffsetY = 2;
    c.fillText('Greetings from', PIC.x + 36, PIC.y + 70);
    c.restore();
    c.save();
    c.font = `700 104px ${SERIF}`;
    c.lineJoin = 'round';
    const title = `January ${s.year}`, tx = PIC.x + 30, ty = PIC.y + 178;
    c.fillStyle = '#c4573a'; c.fillText(title, tx + 6, ty + 6); // offset shadow
    c.strokeStyle = '#2d5557'; c.lineWidth = 8; c.strokeText(title, tx, ty);
    c.fillStyle = '#fff6e4'; c.fillText(title, tx, ty);
    c.restore();

    // A stamp stuck over the corner, and a postmark
    const stx = PIC.x + PIC.w - 92, sty = PIC.y + PIC.h - 6;
    c.save();
    c.translate(stx, sty); c.rotate(0.07);
    c.shadowColor = 'rgba(60,40,20,0.35)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
    c.fillStyle = '#fbf3e2'; c.fillRect(-76, -92, 152, 184);
    c.shadowColor = 'transparent';
    c.fillStyle = '#f3e6cf'; // perforations
    for (let k = 0; k < 8; k++) { c.beginPath(); c.arc(-76 + 9.5 + k * 19, -92, 5, 0, 7); c.arc(-76 + 9.5 + k * 19, 92, 5, 0, 7); c.fill(); }
    for (let k = 0; k < 10; k++) { c.beginPath(); c.arc(-76, -92 + 9.2 + k * 18.4, 5, 0, 7); c.arc(76, -92 + 9.2 + k * 18.4, 5, 0, 7); c.fill(); }
    g = c.createLinearGradient(0, -76, 0, 50);
    g.addColorStop(0, '#2a1a86'); g.addColorStop(1, '#5a24ad');
    c.fillStyle = g; c.fillRect(-62, -78, 124, 112);
    c.fillStyle = '#211a8f'; c.fillRect(-62, 6, 124, 28);
    g = c.createLinearGradient(0, -30, 0, 6);
    g.addColorStop(0, '#f7b51e'); g.addColorStop(1, '#e2740b');
    c.fillStyle = g; c.beginPath(); c.arc(0, 6, 34, Math.PI, 0); c.fill();
    c.fillStyle = 'rgba(232,180,130,0.9)';
    for (const [w2, y2] of [[44, 13], [32, 20], [18, 27]]) c.fillRect(-w2, y2, w2 * 2, 2.5);
    c.fillStyle = INK; c.textAlign = 'center';
    c.font = `700 30px ${SERIF}`; c.fillText(String(s.year), 0, 72);
    c.font = `600 13px ${font}`; c.fillText('H O R I Z O N', 0, 86);
    c.restore();
    c.save();
    const pmx = stx - 150, pmy = sty + 24;
    c.strokeStyle = 'rgba(48,52,78,0.6)'; c.fillStyle = 'rgba(48,52,78,0.62)'; c.lineWidth = 3;
    c.beginPath(); c.arc(pmx, pmy, 64, 0, 7); c.stroke();
    c.lineWidth = 1.5; c.beginPath(); c.arc(pmx, pmy, 56, 0, 7); c.stroke();
    c.textAlign = 'center';
    c.font = `700 20px ${font}`; c.fillText('JAN 1', pmx, pmy - 6);
    c.font = `700 26px ${font}`; c.fillText(String(s.year), pmx, pmy + 22);
    c.lineWidth = 3;
    for (let k = -1; k <= 1; k++) { // wavy cancellation lines
      c.beginPath();
      for (let x = 0; x <= 170; x += 4) { const y = pmy + k * 16 + Math.sin(x / 13) * 5; if (x) c.lineTo(pmx - 70 - x, y); else c.moveTo(pmx - 70, y); }
      c.stroke();
    }
    c.restore();

    // The message, in ink
    const M = 84;
    c.fillStyle = INK;
    c.font = `italic 48px ${SERIF}`;
    c.fillText(s.greeting, M, PIC.y + PIC.h + 104);
    // Each block of words gets the biggest size (34px down to 25px) that fits its space.
    const block = (paras, top, bottom, maxW, gap) => {
      for (let size = 34; size >= 25; size -= 1) {
        c.font = `400 ${size}px ${SERIF}`;
        const lh = Math.round(size * 1.42);
        const wrapped = paras.map((p) => wrap(c, p, maxW));
        const need = wrapped.reduce((t, l) => t + l.length * lh, 0) + gap * (paras.length - 1);
        if (need <= bottom - top || size === 25) {
          let y = top + size;
          for (const lines of wrapped) { for (const ln of lines) { c.fillText(ln, M, y); y += lh; } y += gap; }
          return y - gap;
        }
      }
      return top;
    };
    const end = block(s.lines, PIC.y + PIC.h + 128, H - 150, W - M * 2, 10);
    c.font = `italic 40px ${SERIF}`;
    c.fillStyle = '#b4532f';
    c.fillText('— Your plan', W - M - c.measureText('— Your plan').width, Math.min(H - 100, end + 58));
    c.font = `500 20px ${font}`;
    c.fillStyle = 'rgba(63,49,36,0.55)';
    c.fillText('Horizon · a typical market, in today’s dollars · an estimate, not financial advice', M, H - 40);
    return cv;
  };

  PO.open = function () {
    const a = RP.app.last;
    if (!a) { UI.toast('Still calculating…'); return; }
    const year = a.schedule.retireYear;
    let which = year, file = null, closed = false;
    const img = h('img.pc-postcard', { alt: `Postcard from January ${year}: ${story(a).lines.join(' ')}` });
    const box = h('div.pc-box', h('div.x-wait', h('span.busy-dot'), 'Writing your postcard…'));
    const show = () => picture(which).then((pic) => {
      if (closed) return;
      const cv = PO.paint(a, pic);
      img.src = cv.toDataURL('image/jpeg', 0.9);
      UI.mount(box, img);
      // Make the file now: phones only allow the share sheet right after a tap, with no waiting in between.
      file = null;
      cv.toBlob((b) => { file = b; }, 'image/jpeg', 0.92); // a painting: JPEG is small and quick
      picture(which + 1); // have the next view ready
    });
    UI.sheet.open({
      title: 'Postcard from retirement',
      body: [box, h('p.x-note', `Written from your “${store().scenario().name}” plan, in a typical market. It stays on this phone unless you share it.`)],
      onClose: () => { closed = true; },
      actions: [
        { label: 'Another view', onClick: () => { which++; show(); } },
        { label: 'Share', onClick: () => {
          if (!file) { UI.toast('Still drawing your postcard…'); return; }
          RP.app.saveFile(file, `postcard-from-${year}.jpg`, `Postcard from ${year}`).then((how) => { if (how === 'downloaded') UI.toast('Postcard saved'); });
        } },
        { label: 'Done', primary: true, onClick: () => UI.sheet.close() },
      ],
    });
    show();
  };
})(globalThis.RP = globalThis.RP || {});
