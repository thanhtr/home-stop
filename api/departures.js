const GRAPHQL_URL = "https://api.digitransit.fi/routing/v2/hsl/gtfs/v1";

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

module.exports = async function handler(req, res) {
  const stopId = req.query.stop;
  if (!stopId) {
    res.status(400).json({ error: "Missing 'stop' query parameter" });
    return;
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "API_KEY is not configured on the server" });
    return;
  }

  try {
    const upstream = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "digitransit-subscription-key": apiKey,
      },
      body: JSON.stringify({ query: QUERY, variables: { id: stopId } }),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Failed to reach Digitransit API", detail: err.message });
  }
};
