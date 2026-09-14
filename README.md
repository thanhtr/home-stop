# home-stop
HSL home stop — a fixed info-panel page (with two tiny serverless functions) showing live departures for the Vaaralan Talkootie
stop (V9305) side by side with current weather. Meant to be left running on an old device as a display, not interacted with.

## How it works

- `index.html` is the whole UI: no build step, deploy as-is on Vercel. It has no settings, buttons, or forms — the stop code
  is hardcoded (`STOP_IDS` in the script). Departures refresh every 30 seconds; weather refreshes every hour (both intervals
  are also hardcoded at the top of the script).
- `api/departures.js` is a Vercel serverless function that calls the Digitransit routing API using an `API_KEY` environment variable,
  so the key never reaches the browser. It accepts either a public HSL stop code (e.g. `V9305`) or a full `gtfsId` (e.g. `HSL:1174509`)
  in the `stop` query parameter — a bare code is resolved to a `gtfsId` via the Digitransit geocoding API first. Add `&debug=1` to see
  the raw geocoding response and resolved gtfsId while diagnosing lookup issues. Returns up to 5 upcoming departures.
- `api/weather.js` is a Vercel serverless function that proxies Open-Meteo (free, no API key required) for current conditions near
  Vaarala, Vantaa. It geocodes the location name once (cached across warm invocations) and fetches temperature, feels-like,
  description, wind, and humidity. Add `?debug=1` to see the resolved coordinates and raw geocoding results.

To change the stop shown or either refresh interval, edit the constants at the top of the `<script>` in `index.html` and redeploy —
there is intentionally no runtime configuration UI.

### Old-device compatibility

`index.html` is intentionally written for very old Safari (iOS 9 and earlier), since it's meant to run on an old iPad/iPhone kept at
home as a display. That rules out a lot of modern web features, so the page deliberately avoids:

- `<dialog>`, forms, and buttons entirely — it's a read-only display, not something to interact with
- CSS custom properties / `prefers-color-scheme` (single hardcoded light theme, no dark mode)
- Flexbox (departure rows use a `<table>`; the two-column layout uses floats)
- `fetch`, `Promise`, arrow functions, `const`/`let`, template literals, destructuring, spread (plain ES5 with `var`,
  `function`, and `XMLHttpRequest`)
- Emoji/icon glyphs for weather (plain text descriptions instead, since old iOS fonts may not have later-added weather emoji)

Keep any future edits to `index.html` within this same ES5 + table/float-layout, no-interaction style. Both `api/*.js` files run
on Vercel's Node runtime, not on the device, so they're free to use modern JS.

## Setup

1. In the Vercel project settings, add an **Environment Variable** named `API_KEY` with your Digitransit routing API subscription key
   (get one free at https://digitransit.fi/en/developers/api-registration/). A GitHub Actions repository secret alone is not visible
   to the Vercel runtime — it must also exist as a Vercel environment variable (either add it directly in Vercel, or have your deploy
   workflow pass it through). No key is needed for weather — Open-Meteo is free and unauthenticated.
2. Deploy this repo to Vercel (import the existing GitHub repo, don't let it clone into a new one).
3. Open the deployed page — it shows departures for `V9305` and current weather immediately, no configuration needed.
