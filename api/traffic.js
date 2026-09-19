const STATIONS_URL = "https://tie.digitraffic.fi/api/tms/v1/stations";
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
  let featuresWithId = 0;

  for (const feature of features) {
    const props = feature.properties || {};
    if (props.id != null) featuresWithId++;

    const roadNumber = props.roadAddress && props.roadAddress.road;
    if (typeof roadNumber === "number") roadNumbersSeen.add(roadNumber);

    const match = ROADS.find((r) => r.number === roadNumber);
    if (match && props.id != null) {
      map[props.id] = match.label;
    }
  }

  cachedStationRoadMap = map;
  // Not returned to the client unless ?debug=1 -- lets us see the actual
  // station metadata shape without guessing further if matching comes up
  // empty (see README on the TMS schema not being verified pre-deploy).
  cachedStationDebugInfo = {
    totalFeatures: features.length,
    featuresWithId: featuresWithId,
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
    let sampleStation = null;

    for (const station of stations) {
      const stationId = station.id != null ? station.id : station.tmsNumber;
      const roadLabel = stationRoadMap[stationId];
      if (!roadLabel) continue;
      matchedStations++;
      if (!sampleStation) sampleStation = station;

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
        sampleStation: sampleStation,
        stationMetadata: cachedStationDebugInfo,
      };
    }

    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
