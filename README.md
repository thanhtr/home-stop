# home-stop
HSL home stop — a static page (with one tiny serverless function) showing live departures for Vaaralan Talkootie (both stops: V9305, V9306).

## How it works

- `index.html` is the whole UI: no build step, deploy as-is on Vercel.
- `api/departures.js` is a Vercel serverless function that calls the Digitransit routing API using an `API_KEY` environment variable,
  so the key never reaches the browser. It accepts either a public HSL stop code (e.g. `V9305`) or a full `gtfsId` (e.g. `HSL:1174509`)
  in the `stop` query parameter — a bare code is resolved to a `gtfsId` via the Digitransit geocoding API first.

## Setup

1. In the Vercel project settings, add an **Environment Variable** named `API_KEY` with your Digitransit routing API subscription key
   (get one free at https://digitransit.fi/en/developers/api-registration/). A GitHub Actions repository secret alone is not visible
   to the Vercel runtime — it must also exist as a Vercel environment variable (either add it directly in Vercel, or have your deploy
   workflow pass it through).
2. Deploy this repo to Vercel.
3. Open the deployed page. It defaults to stops `V9305` and `V9306`; change them via the ⚙ settings button if needed — the values are
   stored in your browser's `localStorage`.
