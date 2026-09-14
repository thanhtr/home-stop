# home-stop
HSL home stop — a static page (with one tiny serverless function) showing live departures for Vaaralan Talkootie (both stops).

## How it works

- `index.html` is the whole UI: no build step, deploy as-is on Vercel.
- `api/departures.js` is a Vercel serverless function that calls the Digitransit routing API using an `API_KEY` environment variable, so the key never reaches the browser.

## Setup

1. In the Vercel project settings, add an **Environment Variable** named `API_KEY` with your Digitransit routing API subscription key
   (get one free at https://digitransit.fi/en/developers/api-registration/). A GitHub Actions repository secret alone is not visible
   to the Vercel runtime — it must also exist as a Vercel environment variable (either add it directly in Vercel, or have your deploy
   workflow pass it through).
2. Deploy this repo to Vercel.
3. Open the deployed page and click the ⚙ settings button.
4. Find the GTFS stop IDs for both Vaaralan Talkootie stops by searching
   https://reittiopas.hsl.fi/haku/Vaaralan%20Talkootie and copying each stop's ID (e.g. `HSL:1234567`).
5. Save — the stop IDs are stored in your browser's `localStorage` and the page starts polling `/api/departures` for live departures.
