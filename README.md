# home-stop
HSL home stop — a fixed info-panel page (with one tiny serverless function) showing live departures for Vaaralan Talkootie
(both stops: V9305, V9306). Meant to be left running on an old device as a display, not interacted with.

## How it works

- `index.html` is the whole UI: no build step, deploy as-is on Vercel. It has no settings, buttons, or forms — the two stop
  codes are hardcoded (`STOP_IDS` in the script) and it auto-refreshes every 30 seconds on its own.
- `api/departures.js` is a Vercel serverless function that calls the Digitransit routing API using an `API_KEY` environment variable,
  so the key never reaches the browser. It accepts either a public HSL stop code (e.g. `V9305`) or a full `gtfsId` (e.g. `HSL:1174509`)
  in the `stop` query parameter — a bare code is resolved to a `gtfsId` via the Digitransit geocoding API first. Add `&debug=1` to see
  the raw geocoding response and resolved gtfsId while diagnosing lookup issues.

To change which stops are shown, edit `STOP_IDS` in `index.html` directly and redeploy — there is intentionally no runtime
configuration UI.

### Old-device compatibility

`index.html` is intentionally written for very old Safari (iOS 9 and earlier), since it's meant to run on an old iPad/iPhone kept at
home as a display. That rules out a lot of modern web features, so the page deliberately avoids:

- `<dialog>`, forms, and buttons entirely — it's a read-only display, not something to interact with
- CSS custom properties / `prefers-color-scheme` (single hardcoded light theme, no dark mode)
- Flexbox (departure rows use a `<table>`)
- `fetch`, `Promise`, arrow functions, `const`/`let`, template literals, destructuring, spread (plain ES5 with `var`,
  `function`, and `XMLHttpRequest`)

Keep any future edits to `index.html` within this same ES5 + table-layout, no-interaction style. `api/departures.js` runs on
Vercel's Node runtime, not on the device, so it's free to use modern JS.

## Setup

1. In the Vercel project settings, add an **Environment Variable** named `API_KEY` with your Digitransit routing API subscription key
   (get one free at https://digitransit.fi/en/developers/api-registration/). A GitHub Actions repository secret alone is not visible
   to the Vercel runtime — it must also exist as a Vercel environment variable (either add it directly in Vercel, or have your deploy
   workflow pass it through).
2. Deploy this repo to Vercel (import the existing GitHub repo, don't let it clone into a new one).
3. Open the deployed page — it shows departures for `V9305` and `V9306` immediately, no configuration needed.
