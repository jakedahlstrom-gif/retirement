/*
 * pin.js — optional 4-digit PIN lock.
 *
 * The PIN itself is never stored, only a salted, slow hash of it (PBKDF2), so
 * someone reading this browser's storage can't read your PIN. Be realistic: a
 * 4-digit PIN in a web app is a privacy screen (keeps casual eyes out); your
 * phone's own passcode is the real lock. Forgot it? Erase and re-import a backup.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h;
  const store = () => RP.store;
  const PIN = (RP.pin = {});
  let hiddenAt = null;
  const RELOCK_MS = 2 * 60 * 1000;

  function toHex(buf) { return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
  function randomSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return toHex(a); }

  async function hashPin(pin, salt) {
    const enc = new TextEncoder();
    if (crypto && crypto.subtle) {
      const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
      return 'pbkdf2:' + toHex(bits);
    }
    // Fallback for insecure contexts (e.g. a file opened directly): repeated FNV-1a.
    let hsh = 2166136261 >>> 0;
    const s = salt + ':' + pin;
    for (let r = 0; r < 20000; r++) for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i) + r; hsh = Math.imul(hsh, 16777619) >>> 0; }
    return 'fnv:' + hsh.toString(16);
  }

  /** Full-screen keypad. mode: 'unlock' | 'create' | 'confirm'. Resolves with the 4 digits. */
  function keypad({ title, text, allowSkip, onSkip, extra }) {
    return new Promise((resolve) => {
      let digits = '';
      const dots = h('div.pin-dots', [0, 1, 2, 3].map(() => h('span')));
      const paint = () => dots.querySelectorAll('span').forEach((d, i) => d.classList.toggle('on', i < digits.length));
      const press = (k) => {
        if (k === 'del') digits = digits.slice(0, -1);
        else if (digits.length < 4) digits += k;
        UI.haptic(); paint();
        if (digits.length === 4) setTimeout(() => resolve({ digits, shake: () => { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); digits = ''; paint(); } }), 120);
      };
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', allowSkip ? 'skip' : '', '0', 'del'];
      const pad = h('div.keypad', keys.map((k) => {
        if (k === '') return h('span');
        if (k === 'skip') return h('button.key.ghost', { onclick: () => onSkip && onSkip() }, 'Skip');
        if (k === 'del') return h('button.key.ghost', { 'aria-label': 'Delete', onclick: () => press('del') }, 'Delete');
        return h('button.key', { onclick: () => press(k) }, k);
      }));
      const logo = h('div', { html: '<svg class="lock-logo" viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="lkSun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff6e4"/><stop offset=".55" stop-color="#ffc677"/><stop offset="1" stop-color="#ff9a48"/></radialGradient><clipPath id="lkSky"><path d="M0 0H64V44C46 42 30 38 0 46Z"/></clipPath></defs><circle cx="32" cy="40" r="15" fill="url(#lkSun)" clip-path="url(#lkSky)"/><path d="M4 46C24 40 40 41 60 34" fill="none" stroke="#ffd9a6" stroke-width="2.5" stroke-linecap="round"/><path d="M28 50h8M26.5 54.5h11M30 59h4" stroke="#ffc677" stroke-width="2" stroke-linecap="round" opacity=".7"/></svg>' });
      const el = h('div.lock', logo, h('h2', title), h('p', text), dots, pad, extra || null);
      const old = document.querySelector('.lock');
      if (old) old.remove();
      document.body.appendChild(el);
      document.body.classList.add('locked');
      PIN._el = el;
      // Physical keyboard support
      const onKey = (e) => {
        if (!document.body.contains(el)) { window.removeEventListener('keydown', onKey); return; }
        if (/^[0-9]$/.test(e.key)) press(e.key);
        else if (e.key === 'Backspace') press('del');
      };
      window.addEventListener('keydown', onKey);
    });
  }
  function closeLock() { if (PIN._el) { PIN._el.remove(); PIN._el = null; } document.body.classList.remove('locked'); }

  /** Ask for the PIN until it's right. */
  async function unlockLoop() {
    const st = store().state.settings;
    const forgot = h('button.link-btn', { style: { marginTop: '22px' }, onclick: forgotFlow }, 'Forgot PIN?');
    for (;;) {
      const r = await keypad({ title: 'Enter PIN', text: 'Your plan is locked.', extra: forgot });
      if ((await hashPin(r.digits, st.pinSalt)) === st.pinHash) { closeLock(); return true; }
      r.shake();
      await new Promise((res) => setTimeout(res, 450));
    }
  }

  function forgotFlow() {
    UI.sheet.open({
      title: 'Forgot your PIN?',
      body: h('p.tip-text', 'For privacy there’s no way to recover it. You can erase everything on this device and re-import your plan file or a backup.'),
      actions: [
        { label: 'Cancel', onClick: () => UI.sheet.close() },
        { label: 'Erase all data', danger: true, onClick: () => { store().eraseAll(); UI.sheet.close(); closeLock(); location.reload(); } },
      ],
    });
  }

  async function createFlow(allowSkip) {
    const skip = () => { store().updateSettings({ pinAsked: true }); closeLock(); PIN._resolveCreate && PIN._resolveCreate(false); };
    return new Promise(async (resolve) => {
      PIN._resolveCreate = resolve;
      for (;;) {
        const a = await keypad({ title: 'Create a PIN', text: 'Keep your plan private on this phone. You can turn this off later in Plan › PIN lock.', allowSkip, onSkip: skip });
        const b = await keypad({ title: 'Confirm PIN', text: 'Enter the same 4 digits again.', allowSkip, onSkip: skip });
        if (a.digits === b.digits) {
          const salt = randomSalt();
          store().updateSettings({ pinSalt: salt, pinHash: await hashPin(a.digits, salt), pinAsked: true });
          closeLock();
          UI.toast('PIN set');
          resolve(true);
          return;
        }
        b.shake();
        await new Promise((res) => setTimeout(res, 500));
      }
    });
  }

  /** Called at startup: lock if a PIN is set, or offer to create one the first time. */
  PIN.boot = async function () {
    const st = store().state.settings;
    if (st.pinHash) await unlockLoop();
    else if (!st.pinAsked) await createFlow(true);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (store().state.settings.pinHash && hiddenAt && Date.now() - hiddenAt > RELOCK_MS && !PIN._el) unlockLoop();
    });
  };

  /** PIN settings sheet (from the Plan tab). */
  PIN.settings = function () {
    const st = store().state.settings;
    UI.sheet.open({
      title: 'PIN lock',
      body: [
        h('p.tip-text', st.pinHash ? 'Your plan asks for a PIN when the app opens, and again after 2 minutes in the background.' : 'Add a 4-digit PIN to keep your plan private on this device.'),
        h('p.tip-text.muted', { style: { fontSize: '14px' } }, 'Only a scrambled version is stored. It’s a privacy screen, not bank-grade encryption; your phone’s passcode is the main protection.'),
      ],
      actions: st.pinHash
        ? [
          { label: 'Turn off', onClick: () => { store().updateSettings({ pinHash: null, pinSalt: null, pinAsked: true }); UI.sheet.close(); UI.toast('PIN turned off'); RP.app.refreshPlan(); } },
          { label: 'Change PIN', primary: true, onClick: async () => { UI.sheet.close(); await createFlow(false); RP.app.refreshPlan(); } },
        ]
        : [{ label: 'Create PIN', primary: true, onClick: async () => { UI.sheet.close(); await createFlow(false); RP.app.refreshPlan(); } }],
    });
  };
})(globalThis.RP = globalThis.RP || {});
