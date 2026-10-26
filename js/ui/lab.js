/*
 * lab.js — the Lab tab: things to play with.
 *
 *   - your plan's report card (score rings)
 *   - the Mixer (faders and pads, a live gauge and scope)
 *   - experiments, each in its own sheet: the decision map, money buckets,
 *     roll a life, the range of outcomes, your life in years, future prices,
 *     plus possible futures, the postcard and history replay from elsewhere
 *
 * Nothing in the Lab changes your plan unless you tap Apply or Use.
 */
(function (RP) {
  'use strict';

  const UI = RP.ui, h = UI.h;
  const store = () => RP.store;
  const LB = (UI.lab = {});
  let root = null, scoreBox = null;

  const EXPERIMENTS = [
    { key: 'map', icon: 'grid', title: 'Decision map', sub: 'Every retirement age × spending level, colored by success', open: () => UI.decision.open(), art: 'map' },
    { key: 'buckets', icon: 'jar', title: 'Money buckets', sub: 'Watch each account fill and drain, year by year', open: () => UI.buckets.open(), art: 'buckets' },
    { key: 'dice', icon: 'dice', title: 'Roll a life', sub: 'One random market history, told as a story', open: () => UI.dice.open(), art: 'dice' },
    { key: 'ridge', icon: 'ridge', title: 'Range of outcomes', sub: 'How spread out your savings could be at each age', open: () => UI.ridge.open(), art: 'ridge' },
    { key: 'life', icon: 'dots', title: 'Life in years', sub: 'Every year of your lives as a dot, by phase', open: () => UI.lifegrid.open(), art: 'life' },
    { key: 'prices', icon: 'tag', title: 'Future prices', sub: 'What today’s dollars look like on the price tags of your retirement', open: () => UI.lifegrid.prices(), art: 'prices' },
    { key: 'futures', icon: 'sparkle', title: 'Possible futures', sub: '100 lives of your savings as light trails', open: () => UI.futures.open(), art: 'futures' },
    { key: 'history', icon: 'book', title: 'Replay history', sub: 'Retire into every stretch of markets since 1871', open: () => UI.explore.history(store().state.active), art: 'history' },
  ];

  LB.render = function (el) {
    root = el;
    scoreBox = h('div');
    const tiles = h('div.lab-grid', EXPERIMENTS.map((x) => h('button.lab-tile.lab-' + x.art, { onclick: x.open },
      h('span.lab-art', UI.icon(x.icon)), h('b', x.title), h('small', x.sub))));
    UI.mount(el,
      h('h1.large-title', 'Lab'),
      h('p.on-sky-note', 'Experiments to play with. Nothing here changes your plan unless you say so.'),
      scoreBox,
      UI.mixer.build(),
      h('div.section-label', 'Experiments'),
      tiles,
      h('p.footer-note', 'Everything is in today’s dollars and uses the same market simulations as the rest of the app.'));
    paintScore();
  };

  function paintScore() {
    if (!scoreBox || !scoreBox.isConnected) return;
    UI.mount(scoreBox, UI.score.card(RP.app.last, RP.app.metrics && RP.app.metrics.safe));
  }

  /** New results for the active scenario: refresh the report card. */
  LB.onResult = () => paintScore();
  LB.onMetrics = (key) => { if (key === 'safe') paintScore(); };
  LB.repaint = () => UI.mixer.repaint();
})(globalThis.RP = globalThis.RP || {});
