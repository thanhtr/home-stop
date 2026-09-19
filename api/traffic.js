// /api/tms/v1/stations turned out to be a slim endpoint with no road
// address at all (id/tmsNumber/name/bearing/collectionStatus/state only,
// confirmed live) -- road numbers live in the richer v3 metadata endpoint.
const STATIONS_URL = "https://tie.digitraffic.fi/api/v3/metadata/tms-stations";
const STATIONS_DATA_URL = "https://tie.digitraffic.fi/api/tms/v1/stations/data";

// Kehä I is signed as regional road 101, Kehä III as national road 50.
const ROADS = [
  { number: 101, label: "Kehä I" },
  { number: 50, label: "Kehä III" },
];

// Cached across warm serverless invocations -- which TMS station sits on
// which road changes essentially never, unlike the live speed readings.
let cachedStationRoadMap = null;
let cachedStationDebugInfo = null;

// The exact property name for a station's road number on the v3 metadata
// endpoint isn't verified live (see README) -- try the plausible variants.
function extractRoadNumber(props) {
  if (props.roadAddress && typeof props.roadAddress.road === "number") {
    return props.roadAddress.road;
  }
  if (typeof props.roadNumber === "number") return props.roadNumber;
  if (typeof props.road_number === "number") return props.road_number;
  return null;
}

// Likewise for the station identifier -- collect every plausible id field so
// whichever one /stations/data actually keys its entries by still matches.
function extractStationIds(props) {
  const ids = [];
  if (props.id != null) ids.push(props.id);
  if (props.tmsNumber != null) ids.push(props.tmsNumber);
  if (props.roadStationId != null) ids.push(props.roadStationId);
  return ids;
}

async function resolveStationRoadMap() {
  if (cachedStationRoadMap) {
    return cachedStationRoadMap;
  }

  const res = await fetch(STATIONS_URL);
  if (!res.ok) {
    throw new Error(`TMS station metadata failed with HTTP ${res.status}`);
  }
  const data = await res.json();
  const features = data.features || [];

  const map = {};
  const roadNumbersSeen = new Set();

  for (const feature of features) {
    const props = feature.properties || {};
    const roadNumber = extractRoadNumber(props);
    if (typeof roadNumber === "number") roadNumbersSeen.add(roadNumber);

    const match = ROADS.find((r) => r.number === roadNumber);
    if (!match) continue;
    for (const id of extractStationIds(props)) {
      map[id] = match.label;
    }
  }

  cachedStationRoadMap = map;
  // Not returned to the client unless ?debug=1 -- lets us see the actual
  // station metadata shape without guessing further if matching comes up
  // empty (see README on the TMS schema not being verified pre-deploy).
  cachedStationDebugInfo = {
    totalFeatures: features.length,
    roadNumbersSeen: Array.from(roadNumbersSeen).sort((a, b) => a - b),
    sampleFeature: features[0] || null,
  };
  return map;
}

// Digitraffic's average-speed sensors are named e.g.
// "KESKINOPEUS_5MIN_LIUKUVA_SUUNTA1" / "..._SUUNTA2" (Finnish for "average
// speed, 5-min rolling, direction 1/2"), with a coarser "60MIN" variant too.
// Match loosely on "KESKINOPEUS" rather than the full name in case the exact
// suffix differs from what's assumed here, and prefer the finest-grained
// sensors available on a given station so directions aren't mixed across
// different averaging windows.
function isSpeedSensorName(name) {
  return typeof name === "string" && name.toUpperCase().indexOf("KESKINOPEUS") !== -1;
}

function speedSensorGranularity(name) {
  const upper = (name || "").toUpperCase();
  if (upper.indexOf("5MIN") !== -1) return 0;
  if (upper.indexOf("60MIN") !== -1) return 1;
  return 2;
}

function classifySpeed(avgSpeed) {
  if (avgSpeed >= 70) return { level: "free", label: "Free flow" };
  if (avgSpeed >= 45) return { level: "moderate", label: "Slow" };
  return { level: "congested", label: "Congested" };
}

module.exports = async function handler(req, res) {
  const debug = req.query.debug === "1";

  try {
    const stationRoadMap = await resolveStationRoadMap();

    const dataRes = await fetch(STATIONS_DATA_URL);
    const data = await dataRes.json();
    if (!dataRes.ok) {
      res.status(dataRes.status).json(data);
      return;
    }

    // Field name for the station list on this endpoint isn't verified live
    // (see README) -- try the plausible variants rather than assume one.
    const stations = data.stations || data.tmsStations || data.features || [];

    const totals = {};
    for (const road of ROADS) {
      totals[road.label] = { sum: 0, count: 0 };
    }

    let matchedStations = 0;
    let sampleMatchedStation = null;

    for (const station of stations) {
      const stationId = station.id != null ? station.id : station.tmsNumber;
      const roadLabel = stationRoadMap[stationId];
      if (!roadLabel) continue;
      matchedStations++;
      if (!sampleMatchedStation) sampleMatchedStation = station;

      const sensorValues = station.sensorValues || [];
      let bestGranularity = null;
      const candidates = [];
      for (const sensor of sensorValues) {
        if (!isSpeedSensorName(sensor.name) || typeof sensor.value !== "number") continue;
        const granularity = speedSensorGranularity(sensor.name);
        if (bestGranularity === null || granularity < bestGranularity) {
          bestGranularity = granularity;
        }
        candidates.push({ granularity, value: sensor.value });
      }
      for (const candidate of candidates) {
        if (candidate.granularity !== bestGranularity) continue;
        totals[roadLabel].sum += candidate.value;
        totals[roadLabel].count += 1;
      }
    }

    const roads = ROADS.map((road) => {
      const totalsForRoad = totals[road.label];
      if (!totalsForRoad || totalsForRoad.count === 0) {
        return { road: road.label, avgSpeed: null, level: "unknown", levelLabel: "No data", stationCount: 0 };
      }
      const avgSpeed = Math.round(totalsForRoad.sum / totalsForRoad.count);
      const classification = classifySpeed(avgSpeed);
      return {
        road: road.label,
        avgSpeed: avgSpeed,
        level: classification.level,
        levelLabel: classification.label,
        stationCount: totalsForRoad.count,
      };
    });

    const payload = { roads: roads, updatedTime: data.dataUpdatedTime || null };

    if (debug) {
      payload.debug = {
        totalStationsInMap: Object.keys(stationRoadMap).length,
        matchedStations: matchedStations,
        sampleMatchedStation: sampleMatchedStation,
        // Regardless of whether matching worked, so a live-data shape
        // mismatch (station id field, sensorValues naming) is visible in
        // the same debug round instead of needing another one.
        sampleLiveStation: stations[0] || null,
        stationMetadata: cachedStationDebugInfo,
      };
    }

    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
