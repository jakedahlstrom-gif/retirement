#!/usr/bin/env node
/*
 * tools/make-icons.js — rebuilds every PNG app icon from the master picture,
 * icons/source/horizon-icon-1024.png (a 1024×1024 painting of the sun on the sea).
 *
 *   node tools/make-icons.js                 # use the best tool you have
 *   node tools/make-icons.js --with=sharp    # force one: playwright | sharp | magick
 *
 * To change the icon, replace the master with another square picture and rerun this.
 * Each icon is a crop of the master: home-screen icons zoom in a little so the sun
 * reads at small sizes, the Android "maskable" icon keeps the whole picture (Android
 * trims the edges itself), and the favicon zooms in most. It tries, in order:
 *   1. Playwright + Chromium (draws on a canvas, halving the size step by step for smooth results)
 *   2. the 'sharp' npm package
 *   3. ImageMagick ('magick' or 'convert' on your PATH)
 * Nothing is installed for you, and the app itself never needs any of these. Every icon is made
 * in memory first and written only if all succeed, so a problem stops the run and changes nothing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ICONS = path.join(__dirname, '..', 'icons');
const MASTER = path.join(ICONS, 'source', 'horizon-icon-1024.png');
const M = 1024; // the master's size

// Crops of the master: [left, top, size] in master pixels.
const HOME = [132, 140, 760]; // the sun about 45% wide
const WHOLE = [0, 0, M]; // everything (Android masks it to a circle or squircle)
const TIGHT = [210, 230, 600]; // the sun fills the tab icon

// [output PNG, size in px, crop, rounded transparent corners?]
const JOBS = [
  ['apple-touch-icon.png', 180, HOME, false], // iOS home screen (iOS rounds the corners)
  ['icon-192.png', 192, HOME, false], // Android / manifest
  ['icon-512.png', 512, HOME, false], // Android splash / manifest
  ['icon-maskable-512.png', 512, WHOLE, false], // Android adaptive icon
  ['favicon-32.png', 32, TIGHT, true], // browser tab
  ['favicon-180.png', 180, TIGHT, true], // browser tab on high-density screens
];
const RADIUS = 0.22; // corner radius for the favicons, as a share of their size

// Thrown when a tool simply isn't installed, so the next one is tried. Any other error stops the run.
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

// Tool 1: draw on a canvas in headless Chromium.
async function withPlaywright() {
  const pw = load('playwright');
  if (!pw) throw new Unavailable('playwright is not installed');
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { throw new Unavailable(`Chromium will not start (${firstLine(e)})`); }
  const out = [];
  try {
    const page = await browser.newPage();
    const data = fs.readFileSync(MASTER).toString('base64');
    await page.setContent(`<img src="data:image/png;base64,${data}">`);
    if (!(await page.evaluate(() => document.images[0].naturalWidth > 0))) throw new Error('the master picture failed to load');
    for (const [png, size, crop, round] of JOBS) {
      const url = await page.evaluate(([[x, y, s], size, round, radius]) => {
        // Halve step by step from the crop down to the target, so small icons stay smooth.
        let src = document.images[0], sx = x, sy = y, sw = s;
        while (sw / 2 >= size) {
          const c = document.createElement('canvas');
          c.width = c.height = Math.round(sw / 2);
          const g = c.getContext('2d');
          g.imageSmoothingQuality = 'high';
          g.drawImage(src, sx, sy, sw, sw, 0, 0, c.width, c.height);
          src = c; sx = 0; sy = 0; sw = c.width;
        }
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        if (round) { g.beginPath(); g.roundRect(0, 0, size, size, size * radius); g.clip(); }
        g.drawImage(src, sx, sy, sw, sw, 0, 0, size, size);
        return c.toDataURL('image/png');
      }, [crop, size, round, RADIUS]);
      out.push([png, size, Buffer.from(url.split(',')[1], 'base64')]);
    }
  } finally { await browser.close(); }
  return out;
}

// Tool 2: sharp.
async function withSharp() {
  const sharp = load('sharp');
  if (!sharp) throw new Unavailable('sharp is not installed');
  const out = [];
  for (const [png, size, [left, top, s], round] of JOBS) {
    let img = sharp(MASTER).extract({ left, top, width: s, height: s }).resize(size, size, { kernel: 'lanczos3' });
    if (round) {
      const r = size * RADIUS;
      const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`);
      img = sharp(await img.png().toBuffer()).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]);
    } else img = img.removeAlpha();
    out.push([png, size, await img.png().toBuffer()]);
  }
  return out;
}

// Tool 3: ImageMagick (version 7's 'magick', or version 6's 'convert').
async function withMagick() {
  const bin = ['magick', 'convert'].find((b) => { try { execFileSync(b, ['-version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } });
  if (!bin) throw new Unavailable('ImageMagick is not on your PATH');
  return JOBS.map(([png, size, [left, top, s], round]) => {
    const args = [MASTER, '-crop', `${s}x${s}+${left}+${top}`, '+repage', '-filter', 'Lanczos', '-resize', `${size}x${size}!`];
    if (round) {
      const r = Math.round(size * RADIUS);
      args.push('(', '-size', `${size}x${size}`, 'xc:none', '-fill', 'white', '-draw', `roundrectangle 0,0,${size - 1},${size - 1},${r},${r}`, ')',
        '-alpha', 'set', '-compose', 'DstIn', '-composite');
    } else args.push('-alpha', 'off');
    args.push('-strip', 'png:-');
    return [png, size, execFileSync(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })];
  });
}

// Last line of defence before overwriting anything: each result must be a PNG of the right size.
function checkPng([png, size, buf]) {
  const ok = buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' && buf.readUInt32BE(16) === size && buf.readUInt32BE(20) === size;
  if (!ok) throw new Error(`${png} did not come out as a ${size}x${size} PNG`);
}

const TOOLS = { playwright: withPlaywright, sharp: withSharp, magick: withMagick };

(async () => {
  const forced = (process.argv.find((a) => a.startsWith('--with=')) || '').slice(7);
  if (forced && !TOOLS[forced]) {
    console.error(`Unknown tool "${forced}". Use one of: ${Object.keys(TOOLS).join(', ')}`);
    process.exit(2);
  }
  if (!fs.existsSync(MASTER)) { console.error(`Missing the master picture: ${path.relative(process.cwd(), MASTER)}`); process.exit(1); }
  const order = forced ? [forced] : Object.keys(TOOLS);
  for (const name of order) {
    console.log(`Making icons with ${name}...`);
    let results;
    try {
      results = await TOOLS[name]();
      results.forEach(checkPng);
    } catch (err) {
      if (err instanceof Unavailable) { console.log(`  ${name} unavailable: ${err.message}`); continue; }
      console.error(`\nFailed: ${firstLine(err)}\nNo icons were changed.`);
      process.exit(1);
    }
    // Everything made: only now overwrite the real files.
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
    'No image tool found. Install any ONE of these, then rerun:',
    '  npm i --no-save sharp                                   (quickest)',
    '  npm i --no-save playwright && npx playwright install chromium',
    '  brew install imagemagick  (macOS)  /  sudo apt install imagemagick   (Linux)',
  ].join('\n'));
  process.exit(1);
})();
