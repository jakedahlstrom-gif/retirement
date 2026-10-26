/*
 * sw.js — the service worker. It saves a copy of the app's own files on your
 * phone so the planner opens instantly and works with no internet.
 *
 * It only ever caches this app's files. It never sends your data anywhere.
 * When you update the app, bump VERSION so phones fetch the new files.
 */
const VERSION = 'horizon-v8';
const FILES = [
  './', 'index.html', 'manifest.json', 'css/app.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png',
  'icons/icon.svg', 'icons/favicon.svg', 'icons/favicon-32.png',
  'vendor/chart.umd.min.js', 'data/historical-returns.js',
  'js/engine/util.js', 'js/engine/defaults.js', 'js/engine/tax.js', 'js/engine/socialsecurity.js',
  'js/engine/health.js', 'js/engine/schedule.js', 'js/engine/simulate.js', 'js/engine/montecarlo.js',
  'js/engine/api.js', 'js/engine/scenarios.js', 'js/engine/slim.js', 'js/engine/levers.js', 'js/engine/explore.js', 'js/worker.js',
  'js/ui/core.js', 'js/ui/tips.js', 'js/ui/controls.js', 'js/ui/sky.js', 'js/ui/insights.js', 'js/ui/levers.js', 'js/ui/paycheck.js', 'js/ui/plan-fields.js',
  'js/ui/plan.js', 'js/ui/scenarios.js', 'js/ui/projection.js', 'js/ui/home.js', 'js/ui/charts.js', 'js/ui/flow.js', 'js/ui/compare.js', 'js/ui/timeline.js', 'js/ui/checklist.js', 'js/ui/checkin.js', 'js/ui/progress.js', 'js/ui/setup.js', 'js/ui/explore.js',
  'js/app/store.js', 'js/app/engine-client.js', 'js/app/pin.js', 'js/app/app.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Serve from the saved copy first; fall back to the network (same site only).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  })));
});
