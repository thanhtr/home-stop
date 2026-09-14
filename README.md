# home-stop
HSL home stop — a single static page showing live departures for Vaaralan Talkootie (both stops).

## Setup

1. Deploy this repo to Vercel (no build step needed — it's plain static HTML).
2. Open the deployed page and click the ⚙ settings button.
3. Get a free API key from https://digitransit.fi/en/developers/api-registration/ (routing API product) and paste it in.
4. Find the GTFS stop IDs for both Vaaralan Talkootie stops by searching
   https://reittiopas.hsl.fi/haku/Vaaralan%20Talkootie and copying each stop's ID (e.g. `HSL:1234567`).
5. Save — the page stores the key and stop IDs in your browser's `localStorage` and starts polling for departures.

Everything runs client-side; there is no backend or server-side secret storage, so avoid using an API key you consider sensitive.
