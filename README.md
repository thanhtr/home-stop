# home-stop
HSL home stop — a fixed info-panel page (with three tiny serverless functions) showing live departures for the Vaaralan Talkootie
stop (V9305) side by side with current weather and the general traffic load on Kehä I / Kehä III. Meant to be left running on an
old device as a display, not interacted with.

## How it works

- `index.html` is the whole UI: no build step, deploy as-is on Vercel. It has no settings, buttons, or forms, and no page title
  or "Updated" text outside the panes — the stop code is hardcoded (`STOP_IDS` in the script), and the only status text ("Updated
  HH:MM:SS") lives inside the departures pane itself. Departures refresh every 30 seconds, weather every hour, and traffic every
  15 minutes (all three intervals are hardcoded at the top of the script).
- `api/departures.js` is a Vercel serverless function that calls the Digitransit routing API using an `API_KEY` environment variable,
  so the key never reaches the browser. It accepts either a public HSL stop code (e.g. `V9305`) or a full `gtfsId` (e.g. `HSL:1174509`)
  in the `stop` query parameter — a bare code is resolved to a `gtfsId` via the Digitransit geocoding API first. Add `&debug=1` to see
  the raw geocoding response and resolved gtfsId while diagnosing lookup issues. Returns up to 5 upcoming departures.
- `api/weather.js` is a Vercel serverless function that proxies Open-Meteo (free, no API key required) for current conditions near
  Vaarala, Vantaa, plus the next 6 hours (`HOURLY_COUNT` in the file — kept short so the hour-chip row stays on one line and the
  weather pane doesn't grow taller than the other two columns). It geocodes the location name once (cached across warm invocations)
  and fetches temperature, feels-like, description, wind, humidity, and a small icon category per hour. Add `?debug=1` to see the
  resolved coordinates and raw geocoding results — already verified against production to resolve to the correct Vaarala in Vantaa,
  not one of the several other Finnish villages with the same name.
- `api/traffic.js` is a Vercel serverless function that proxies Fintraffic's [Digitraffic](https://www.digitraffic.fi/en/road-traffic/)
  TMS ("LAM") road sensor data (`tie.digitraffic.fi`, free, no API key) — the same real-time speed/volume feed behind Fintraffic's own
  traffic map. Rather than listing individual incidents, it shows a general traffic-load reading per ring road: it fetches every TMS
  station's road number once from the `/api/v3/metadata/tms-stations` metadata endpoint (cached across warm invocations, via
  `resolveStationRoadMap()` — note this is a *different, richer* endpoint than `/api/tms/v1/stations`, which turned out on production
  to carry no road address at all), keeps the stations on regional road 101 (Kehä I) and national road 50 (Kehä III), then for each
  request averages the live speed sensors for those stations from `/api/tms/v1/stations/data` and classifies the result as Free flow
  (≥70 km/h) / Slow (45–69) / Congested (<45). This answers "how's the whole loop right now", which is more useful for an end-to-end
  drive than a specific announcement, at the cost of being a ring-wide average that can smooth over a jam on just one stretch.
  **The exact field names on both endpoints (road number on the metadata side, the station-list key and sensor naming on the live-data
  side) still aren't fully verified live** (`tie.digitraffic.fi` isn't reachable from the environment this was written in), so
  `extractRoadNumber()` / `extractStationIds()` try several plausible property names and `isSpeedSensorName()` matches loosely
  (anything containing `KESKINOPEUS`, Finnish for "average speed") rather than assuming one exact shape. Check `/api/traffic?debug=1`
  once deployed — it echoes `matchedStations`, `stationMetadata` (a raw metadata sample plus every road number actually seen), and
  `sampleLiveStation` (a raw live-data sample regardless of match) — and adjust those functions if the counts still look wrong.
- Departures and weather sit side by side in a top row (36%/64%, the weather column wider for its large current-temperature number
  and icon); the traffic pane is a separate full-width row below, with its two roads' readings arranged side by side rather than
  stacked so the row stays short. Both rows only stack fully vertically below 480px width. All three panes use large, high-contrast
  text throughout — this is a kiosk meant to be read from across a room, not a compact widget, so the whole page still fits on screen
  without scrolling.
- Weather icons are hand-built inline SVG shapes (sun/cloud/rain/snow/thunder), not emoji — see Old-device compatibility below.

To change the stop shown, the tracked roads, or any refresh interval, edit the constants at the top of the `<script>` in
`index.html` (or the matching constants in `api/weather.js` / `api/traffic.js`) and redeploy — there is intentionally no runtime
configuration UI.

### Old-device compatibility

`index.html` is intentionally written for very old Safari (iOS 9 and earlier), since it's meant to run on an old iPad/iPhone kept at
home as a display. That rules out a lot of modern web features, so the page deliberately avoids:

- `<dialog>`, forms, and buttons entirely — it's a read-only display, not something to interact with
- CSS custom properties / `prefers-color-scheme` (single hardcoded light theme, no dark mode)
- Flexbox (departure rows use a `<table>`; the two-column layout uses floats)
- `fetch`, `Promise`, arrow functions, `const`/`let`, template literals, destructuring, spread (plain ES5 with `var`,
  `function`, and `XMLHttpRequest`)
- Emoji glyphs for weather — icons are drawn as inline SVG shapes (`weatherIcon()` in the script) built from `<circle>`/`<rect>`/
  `<line>`/`<polygon>` primitives instead, since several weather emoji were added to Unicode/fonts after old iOS shipped and would
  render as blank boxes there, while SVG rendering has always worked

Keep any future edits to `index.html` within this same ES5 + table/float-layout, no-interaction style. Both `api/*.js` files run
on Vercel's Node runtime, not on the device, so they're free to use modern JS.

## Setup

1. In the Vercel project settings, add an **Environment Variable** named `API_KEY` with your Digitransit routing API subscription key
   (get one free at https://digitransit.fi/en/developers/api-registration/). A GitHub Actions repository secret alone is not visible
   to the Vercel runtime — it must also exist as a Vercel environment variable (either add it directly in Vercel, or have your deploy
   workflow pass it through). No key is needed for weather or traffic — Open-Meteo and Digitraffic are both free and unauthenticated.
2. Deploy this repo to Vercel (import the existing GitHub repo, don't let it clone into a new one).
3. Open the deployed page — it shows departures for `V9305`, current weather, and the Kehä I / Kehä III traffic load immediately,
   no configuration needed. If the traffic pane shows "No data" or an error, hit `/api/traffic?debug=1` and check `matchedStations`,
   `stationMetadata`, and `sampleLiveStation` against the field names in `api/traffic.js` (see the note above about the TMS schema
   not being fully verified pre-deploy).

## Turning the device into a kiosk

1. On the device, add the page to the Home Screen from Safari's Share sheet (rather than just bookmarking it) — combined with
   the `apple-mobile-web-app-capable` meta tag in `index.html`, launching it from that Home Screen icon opens it full-screen
   without Safari's address bar or toolbar.
2. Turn on Guided Access: **Settings → General → Accessibility → Guided Access**, toggle it on, and set a Guided Access passcode
   under **Passcode Settings** if you haven't already (this can be different from the device's own lock passcode).
3. Open the page (ideally via the Home Screen icon from step 1), then **triple-click the Home button** to start a Guided Access
   session. You can circle any area of the screen first to disable touch there (not really needed here since the page has no
   interactive elements), then tap **Start**.
4. To turn Guided Access **off** (e.g. to update the device): triple-click the Home button again, enter the Guided Access
   passcode, then tap **End** in the top-left.
5. Also set **Settings → Display & Brightness → Auto-Lock → Never** (on very old iOS this may be under **Settings → General →
   Auto-Lock**) so the screen doesn't sleep — Guided Access alone doesn't prevent Auto-Lock from turning the display off.
