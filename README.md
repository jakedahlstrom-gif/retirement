# Horizon

A private retirement planner that runs entirely on your phone.

- Open the site, add it to your home screen, and import your own plan file.
- Your numbers are stored only in your browser on your device. Nothing is sent anywhere.
- The site itself shows a fictional sample household until you import a plan.

Plain HTML, CSS and JavaScript. No build step. Works offline once installed.

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

*Results are educational estimates, not financial advice.*
