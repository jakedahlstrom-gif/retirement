#!/usr/bin/env node
/*
 * tools/make-icons.js — rebuilds every PNG app icon from the SVG masters in icons/.
 *
 *   node tools/make-icons.js                 # use the best renderer you have
 *   node tools/make-icons.js --with=sharp    # force one: playwright | sharp | rsvg
 *
 * Edit icons/icon.svg, icons/icon-maskable.svg or icons/favicon.svg, then rerun this. It tries, in order:
 *   1. Playwright + Chromium  (most faithful: the same engine that shows the SVGs in the app)
 *   2. the 'sharp' npm package (uses librsvg under the hood)
 *   3. the 'rsvg-convert' command-line tool (librsvg)
 * Nothing is installed for you, and the app itself never needs any of these. Every icon is rendered
 * in memory first and written only if all succeed, so a broken SVG stops the run and changes nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ICONS = path.join(__dirname, '..', 'icons');
const BG = '#070a1c'; // pre-dawn sky; app icons are flattened onto it so they carry no alpha channel

// [source SVG, output PNG, size in px, opaque?]
const JOBS = [
  ['icon.svg', 'apple-touch-icon.png', 180, true], // iOS home screen
  ['icon.svg', 'icon-192.png', 192, true], // Android / manifest
  ['icon.svg', 'icon-512.png', 512, true], // Android splash / manifest
  ['icon-maskable.svg', 'icon-maskable-512.png', 512, true], // Android adaptive (padded art)
  ['favicon.svg', 'favicon-32.png', 32, false], // browser tab fallback: keeps its transparent rounded corners
];

// Thrown when a renderer simply isn't installed, so the next one is tried. Any other error stops the run.
class Unavailable extends Error {}
const firstLine = (err) => String((err && err.message) || err).split('\n')[0];

// require() a package from this folder, or failing that from the global npm folder.
function load(name) {
  try { return require(name); } catch (_) { /* not installed locally */ }
  try {
    const globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require(path.join(globalRoot, name));
  } catch (_) { return null; }
}

// Renderer 1: draw each SVG in headless Chromium at the exact pixel size and screenshot it.
async function withPlaywright() {
  const pw = load('playwright');
  if (!pw) throw new Unavailable('playwright is not installed');
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { throw new Unavailable(`Chromium will not start (${firstLine(e)})`); }
  const out = [];
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const [svg, png, size, opaque] of JOBS) {
      const data = fs.readFileSync(path.join(ICONS, svg)).toString('base64');
      await page.setViewportSize({ width: size, height: size });
      // setContent waits for the page's load event, so by now the <img> has either loaded or failed.
      await page.setContent(`<body style="margin:0;background:${opaque ? BG : 'transparent'}">
        <img width="${size}" height="${size}" style="display:block" src="data:image/svg+xml;base64,${data}">`);
      // A broken image is still "complete"; only a real decode gives it a width.
      const loaded = await page.evaluate(() => document.images[0].naturalWidth > 0);
      if (!loaded) throw new Error(`icons/${svg} failed to load - is it valid SVG?`);
      out.push([png, size, await page.screenshot({ omitBackground: !opaque })]);
    }
  } finally { await browser.close(); }
  return out;
}

// Renderer 2: sharp. Rasterise at 2x the target, then downscale for smooth edges.
async function withSharp() {
  const sharp = load('sharp');
  if (!sharp) throw new Unavailable('sharp is not installed');
  const out = [];
  for (const [svg, png, size, opaque] of JOBS) {
    const file = path.join(ICONS, svg);
    const viewBoxWidth = Number((fs.readFileSync(file, 'utf8').match(/viewBox="[\d.\s-]+?\s([\d.]+)\s[\d.]+"/) || [])[1]) || size;
    const density = Math.min(2400, (72 * size * 2) / viewBoxWidth);
    let img = sharp(file, { density }).resize(size, size);
    if (opaque) img = img.flatten({ background: BG }); // drop the alpha channel
    out.push([png, size, await img.png().toBuffer()]);
  }
  return out;
}

// Renderer 3: the rsvg-convert CLI (Homebrew / apt package "librsvg"). It exits non-zero on a bad SVG.
async function withRsvg() {
  try { execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' }); } catch (_) { throw new Unavailable('rsvg-convert is not on your PATH'); }
  return JOBS.map(([svg, png, size, opaque]) => {
    const args = ['-w', String(size), '-h', String(size), ...(opaque ? ['-b', BG] : []), path.join(ICONS, svg)];
    return [png, size, execFileSync('rsvg-convert', args, { stdio: ['ignore', 'pipe', 'pipe'] })];
  });
}

// Last line of defence before overwriting anything: each result must be a PNG of the right size.
function checkPng([png, size, buf]) {
  const ok = buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' && buf.readUInt32BE(16) === size && buf.readUInt32BE(20) === size;
  if (!ok) throw new Error(`${png} did not come out as a ${size}x${size} PNG`);
}

const RENDERERS = { playwright: withPlaywright, sharp: withSharp, rsvg: withRsvg };

(async () => {
  const forced = (process.argv.find((a) => a.startsWith('--with=')) || '').slice(7);
  if (forced && !RENDERERS[forced]) {
    console.error(`Unknown renderer "${forced}". Use one of: ${Object.keys(RENDERERS).join(', ')}`);
    process.exit(2);
  }
  const order = forced ? [forced] : Object.keys(RENDERERS);
  for (const name of order) {
    console.log(`Rendering icons with ${name}...`);
    let results;
    try {
      results = await RENDERERS[name]();
      results.forEach(checkPng);
    } catch (err) {
      if (err instanceof Unavailable) { console.log(`  ${name} unavailable: ${err.message}`); continue; }
      console.error(`\nFailed: ${firstLine(err)}\nNo icons were changed.`);
      process.exit(1);
    }
    // Everything rendered: only now overwrite the real files.
    for (const [png, size, buf] of results) {
      fs.writeFileSync(path.join(ICONS, png), buf);
      console.log(`  wrote icons/${png}  (${size}x${size})`);
    }
    console.log([
      'Done. Now bump VERSION in sw.js so new installs and Android pick up the icons.',
      '(An iPhone keeps the icon and name it was added with: remove the app and Add to Home Screen again.)',
    ].join('\n'));
    return;
  }
  console.error([
    '',
    'No SVG renderer found. Install any ONE of these, then rerun:',
    '  npm i --no-save sharp                                   (quickest)',
    '  npm i --no-save playwright && npx playwright install chromium',
    '  brew install librsvg      (macOS)  /  sudo apt install librsvg2-bin   (Linux)',
  ].join('\n'));
  process.exit(1);
})();
