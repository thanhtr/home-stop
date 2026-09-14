const GRAPHQL_URL = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";
const GEOCODING_URL = "https://api.digitransit.fi/geocoding/v1/search";

// Digitransit geocoding "gid" looks like "gtfshsl:stop:1174509" — this maps
// its source prefix to the feed id used by the routing API's gtfsId ("HSL:1174509").
const SOURCE_TO_FEED = {
  gtfshsl: "HSL",
  gtfshsltest: "HSL",
};

const QUERY = `
  query StopTimes($id: String!) {
    stop(id: $id) {
      gtfsId
      name
      code
      desc
      stoptimesWithoutPatterns(numberOfDepartures: 8, omitNonPickups: true) {
        scheduledDeparture
        realtimeDeparture
        realtime
        serviceDay
        headsign
        trip {
          route {
            shortName
          }
        }
      }
    }
  }
`;

async function resolveGtfsId(codeOrId, apiKey, debug) {
  if (codeOrId.includes(":")) {
    return { gtfsId: codeOrId };
  }

  const url = `${GEOCODING_URL}?text=${encodeURIComponent(codeOrId)}&layers=stop&size=10`;
  const res = await fetch(url, {
    headers: { "digitransit-subscription-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Geocoding lookup failed with HTTP ${res.status}`);
  }
  const json = await res.json();
  const rawFeatures = json.features || [];
  const features = rawFeatures.filter((f) => f.properties && f.properties.gid);

  const match =
    features.find((f) => (f.properties.code || "").toUpperCase() === codeOrId.toUpperCase()) ||
    features[0];

  const debugInfo = debug
    ? {
        featureCount: rawFeatures.length,
        features: rawFeatures.map((f) => f.properties),
      }
    : undefined;

  if (!match) {
    const err = new Error(`No stop found matching code "${codeOrId}"`);
    err.debugInfo = debugInfo;
    throw err;
  }

  const [source, , rawId] = match.properties.gid.split(":");
  const feed = SOURCE_TO_FEED[source];
  if (!feed || !rawId) {
    const err = new Error(`Could not resolve gtfsId for code "${codeOrId}" (gid: ${match.properties.gid})`);
    err.debugInfo = debugInfo;
    throw err;
  }
  return { gtfsId: `${feed}:${rawId}`, debugInfo };
}

module.exports = async function handler(req, res) {
  const stopParam = req.query.stop;
  const debug = req.query.debug === "1";

  if (!stopParam) {
    res.status(400).json({ error: "Missing 'stop' query parameter" });
    return;
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "API_KEY is not configured on the server" });
    return;
  }

  try {
    const resolved = await resolveGtfsId(stopParam, apiKey, debug);

    const upstream = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "digitransit-subscription-key": apiKey,
      },
      body: JSON.stringify({ query: QUERY, variables: { id: resolved.gtfsId } }),
    });

    const data = await upstream.json();
    if (debug) {
      data.debug = { resolvedGtfsId: resolved.gtfsId, geocoding: resolved.debugInfo };
    }
    res.status(upstream.status).json(data);
  } catch (err) {
    const payload = { error: err.message };
    if (debug && err.debugInfo) {
      payload.debug = { geocoding: err.debugInfo };
    }
    res.status(502).json(payload);
  }
};
