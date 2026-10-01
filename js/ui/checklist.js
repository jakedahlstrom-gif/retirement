/*
 * checklist.js — the Checklist tab: your to-dos for the plan. Tap the circle
 * to check an item off, tap the text to edit or delete, add your own.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h;
  const store = () => RP.store;
  const CL = (UI.checklist = {});
  let root = null;

  function save() { store().save(); }

  CL.render = function (el) {
    root = el || root;
    if (!root) return;
    const items = store().state.checklist;
    const done = items.filter((i) => i.done).length;
    const pct = items.length ? done / items.length : 0;
    const todo = items.filter((i) => !i.done), finished = items.filter((i) => i.done);

    const row = (it) => {
      const check = h('button.ck' + (it.done ? '.on' : ''), { 'aria-label': it.done ? 'Mark not done' : 'Mark done', onclick: () => {
        it.done = !it.done; save(); UI.haptic();
        if (it.done && items.every((x) => x.done)) { UI.home.celebrate(); UI.toast('Everything’s done!'); }
        setTimeout(() => CL.render(), it.done && !UI.reducedMotion() ? 260 : 0);
        check.classList.toggle('on', it.done);
      } }, UI.icon('check'));
      return h('div.ck-row' + (it.done ? '.done' : ''), check, h('button.ck-text', { onclick: () => edit(it) }, it.text));
    };

    UI.mount(root,
      h('h1.large-title', 'Checklist'),
      h('div.card.ck-head',
        h('div', h('div.value-lg', `${done} of ${items.length}`), h('div.value-sub', 'done')),
        h('div.ck-meter', h('span', { style: { width: (pct * 100) + '%' } }))),
      h('div.list', todo.length ? todo.map(row) : h('div.row', h('span.muted', 'Nothing left to do.'))),
      h('button.btn.block', { style: { marginBottom: '12px' }, onclick: () => edit(null) }, UI.icon('plus'), 'Add item'),
      finished.length ? h('div', h('div.section-label', 'Done'), h('div.list', finished.map(row))) : null,
      h('p.footer-note', 'Results are educational estimates, not financial advice.'));
  };

  function edit(it) {
    const input = h('textarea.textfield', { style: { height: '96px', padding: '12px' }, placeholder: 'What needs doing?' });
    input.value = it ? it.text : '';
    UI.sheet.open({
      title: it ? 'Edit item' : 'New item',
      body: input,
      actions: [
        it ? { label: 'Delete', danger: true, onClick: () => {
          store().pushUndo(true);
          store().state.checklist = store().state.checklist.filter((x) => x !== it); save(); UI.sheet.close(); CL.render();
          UI.toast('Deleted', 'Undo', () => { store().undo(); CL.render(); });
        } } : { label: 'Cancel', onClick: () => UI.sheet.close() },
        { label: 'Save', primary: true, onClick: () => {
          const text = input.value.trim();
          if (!text) { UI.sheet.close(); return; }
          if (it) it.text = text; else store().state.checklist.push({ id: 'c' + Date.now().toString(36), text, done: false });
          save(); UI.sheet.close(); CL.render();
        } },
      ],
    });
    setTimeout(() => input.focus(), 350);
  }
})(globalThis.RP = globalThis.RP || {});
