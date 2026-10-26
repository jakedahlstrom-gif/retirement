# Horizon

A private retirement planner that runs entirely on your phone.

- Open the site, add it to your home screen, and either import your own plan
  file or tap **Set up** for a five-step guide that builds one from scratch.
- Your numbers are stored only in your browser on your device. Nothing is sent anywhere.
- The site itself shows a fictional sample household until you set up or import a plan.

Plain HTML, CSS and JavaScript. No build step. Works offline once installed.

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

## Your data

Plan › Export backup saves everything as a `.json` file (import it on any
device). If you've changed the plan and haven't backed up for a month, Home
reminds you. Plan › Year-by-year spreadsheet exports the projection as `.csv`.
Plan › Appearance pins light or dark mode.

## The sky

The app lives under a sky whose time of day follows how close retirement is,
using the same countdown the Home screen shows (months until January 1 of your
retirement year): 30 or more years away is pre-dawn with stars, 15 years is the
sun cresting the horizon, and retirement itself is golden hour. Move the
retirement-age slider and the sky moves with it. The scale lives in
`js/ui/sky.js` (`Sky.SPAN_YEARS`). With "Reduce motion" on, the stars and water
hold still and the sky changes without gliding.

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
