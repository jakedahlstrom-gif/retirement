# Horizon

A private retirement planner that runs entirely on your phone.

- Open the site, add it to your home screen, and either import your own plan
  file or tap **Set up** for a five-step guide that builds one from scratch.
- Your numbers are stored only in your browser on your device. Nothing is sent anywhere.
- The site itself shows a fictional sample household until you set up or import a plan.

Plain HTML, CSS and JavaScript. No build step. Works offline once installed.

## The Lab

A tab of things to play with. Nothing in it changes your plan until you tap
**Apply**, **Use** or **Save as scenario**.

- **Plan score**: six rings (chance of success, spending cushion, withdrawal
  rate, taxes in retirement, flexible money, tax diversification), a score out
  of 100 and a grade. Tap it to see what each part means and what would raise it.
- **The Mixer**: a little mixing desk. Faders for retirement age, spending,
  saving, returns, market swings, Social Security age, part-time work and how
  long to plan for; pads for guardrails, Roth conversions, long-term care, an
  inheritance, a crash at retirement and a lost decade. A needle gauge shows
  the chance of success and a glowing scope redraws the typical path as you
  drag (your plan stays behind it as a dashed ghost). Drag a fader's cap, tap
  its track, or double-tap to reset it.
- **Decision map**: retirement age × spending as a smooth heat map of success,
  with a bright line along your target. It's calculated on several background
  workers at once and fills in from your own square outward. Tap a square to
  use it.
- **Money buckets**: your accounts as jars of liquid, played year by year.
  Savings drip in, withdrawals drain out, conversions pour from pre-tax to Roth.
- **Roll a life**: one of the 1,000 market histories behind your chance of
  success, drawn year by year and told as a story, with how lucky it was.
- **Range of outcomes**: a ridgeline of where your savings could be at each
  age, on a log scale, in color or as white "Pulsar" lines on black.
- **Life in years**: your lives as dots (or weeks), colored by phase.
- **Future prices**: everyday things on price tags in any future year at your
  inflation assumption, to make "today's dollars" concrete.

Engine: `js/engine/lab.js`. Screens: `js/ui/lab.js`, `mixer.js`, `score.js`,
`decision.js`, `buckets.js`, `dice.js`, `ridge.js`, `lifegrid.js`.

## Finding your levers

- **Earliest age**, under the retirement slider on Home: the youngest age that
  still meets your success target (90% by default). Tap **Use** to move there.
- **What moves the needle**, a card on Home: retire a year later or earlier,
  spend $5K more or less, save more now, part-time work, Social Security
  timing, spending guardrails, and markets earning 1% less, ranked by how much
  each one moves your chance of success. Every test reuses the same market
  histories, so the differences are real. Tap a row to apply it or try it as a
  scenario. It only calculates while the card is open
  (`js/engine/levers.js`, `js/ui/levers.js`).

## Deep dives

Ideas borrowed from the best paid planners (Boldin, ProjectionLab, FIRECalc),
on Compare › Deep dives and Plan › Deep dives:

- **Social Security timing**: every pair of claiming ages (62–70 for each of
  you) as a heat map of the money left at the end of the plan. Tap a square;
  **Use** applies it.
- **Roth conversions**: no conversions, until Medicare, then the 12% or 22%
  bracket, or up to the IRMAA line, compared on lifetime taxes and health
  costs, what's left after tax (pre-tax money counted at 75%), and chance of
  success.
- **Replay history**: your retirement through every complete stretch of US
  market history since 1871. "At your returns" keeps history's real ups and
  downs, scaled to the return your plan assumes; "Actual returns" uses them
  as they were.

Engine: `js/engine/explore.js`. Screens: `js/ui/explore.js`.

## Cash flow and progress

- **Retirement paycheck** (Home): what you'll have to spend each month in your
  first year of retirement, once you're both on Medicare, and once Social
  Security has started, plus taxes and which accounts pay for it.
- **Where the money went**: every year's details (tap a chart, a Timeline
  event or the paycheck) open with a flow diagram of money in and out, with
  buttons to step through the years (`js/ui/flow.js`).
- **Progress** (Plan › Tools): each annual check-in saves your savings and the
  path the plan expected. Later check-ins show whether you're ahead or behind,
  adjusted for inflation (`js/ui/progress.js`).

## Little delights

- **Possible futures** (Home, under the projection): 100 of the market
  histories your plan is tested on, streaking in like light trails. Mint ones
  last, coral ones run short, your typical path glows amber (`js/ui/futures.js`).
- **Postcard from retirement** (Home, under the countdown): a golden-hour
  postcard from January of your first retirement year, written from your plan.
  Share it or keep it; it's drawn on the phone (`js/ui/postcard.js`).
- **The sky follows your finger**: scrub the projection and the sun moves to
  the hour you'd see from that year, then settles back when you let go.
- **Markets fall 30% tomorrow**: a row in What moves the needle for scary
  headlines: how much a crash right now would really change your odds.

## Your data

Plan › Export backup saves everything as a `.json` file (import it on any
device). If you've changed the plan and haven't backed up for a month, Home
reminds you. Plan › Year-by-year spreadsheet exports the projection as `.csv`.
Plan › Appearance picks the sky scene and pins light or dark mode.

## The sky

The app lives under a sky whose time of day follows how close retirement is,
using the same countdown the Home screen shows (months until January 1 of your
retirement year): 30 or more years away is pre-dawn with stars, 15 years is the
sun cresting the horizon, and retirement itself is golden hour. Move the
retirement-age slider and the sky moves with it. The scale lives in
`js/ui/sky.js` (`Sky.SPAN_YEARS`). With "Reduce motion" on, the stars and water
hold still and the sky changes without gliding.

Plan › Appearance also offers three night scenes that tell the same countdown
their own way, each with its own accent colors: **Aurora** (northern lights
that strengthen over a mountain lake), **Synthwave** (a striped neon sun rising
over a moving grid) and **Nebula** (drifting gas clouds and a star rising over
a planet's rim). They always use the dark look.

## App icons

The icons are drawn as SVG in `icons/` (`icon.svg`, `icon-maskable.svg`,
`favicon.svg`). After editing one, rebuild the PNGs with:

    node tools/make-icons.js

It uses Playwright/Chromium, the `sharp` package, or `rsvg-convert`, whichever
you have, and tells you how to get one if none is installed.

## Checks

    node tools/test.js

Runs the math engine in Node (nothing to install) and checks results that must
always hold. When you change the app's files, bump `VERSION` in `sw.js` so
installed copies fetch them.

*Results are educational estimates, not financial advice.*
