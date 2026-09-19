// /api/tms/v1/stations (the list endpoint) is confirmed live to have no
// road address at all (id/tmsNumber/name/bearing/collectionStatus/state
// only) across all ~519 nationwide stations -- but it does have
// coordinates. The road address (properties.roadAddress.roadNumber) only
// shows up on the single-station detail endpoint, /api/tms/v1/stations/{id}
// (confirmed live against station 89). Fetching detail for all ~519
// stations nationwide on every cold start would be excessive, so the list
// is first narrowed to a rough Helsinki-metro bounding box covering both
// ring roads, and only those candidates get a detail fetch.
const STATIONS_URL = "https://tie.digitraffic.fi/api/tms/v1/stations";
const STATION_DETAIL_URL = (id) => `https://tie.digitraffic.fi/api/tms/v1/stations/${id}`;
const STATIONS_DATA_URL = "https://tie.digitraffic.fi/api/tms/v1/stations/data";

// Kehä I is signed as regional road 101, Kehä III as national road 50.
const ROADS = [
  { number: 101, label: "Kehä I" },
  { number: 50, label: "Kehä III" },
];

// Generous box around the Helsinki metro area -- both ring roads sit
// comfortably inside lat 60.10-60.45 / lon 24.60-25.35.
const HELSINKI_BBOX = { minLat: 60.1, maxLat: 60.45, minLon: 24.6, maxLon: 25.35 };

// Cached across warm serverless invocations -- which TMS station sits on
// which road changes essentially never, unlike the live speed readings.
let cachedStationRoadMap = null;
let cachedStationDebugInfo = null;

function isWithinHelsinkiBbox(feature) {
  const coords = feature.geometry && feature.geometry.coordinates;
  if (!coords || coords.length < 2) return false;
  const lon = coords[0];
  const lat = coords[1];
  return (
    lat >= HELSINKI_BBOX.minLat &&
    lat <= HELSINKI_BBOX.maxLat &&
    lon >= HELSINKI_BBOX.minLon &&
    lon <= HELSINKI_BBOX.maxLon
  );
}

async function fetchStationDetail(id) {
  try {
    const res = await fetch(STATION_DETAIL_URL(id));
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function resolveStationRoadMap() {
  if (cachedStationRoadMap) {
    return cachedStationRoadMap;
  }

  const listRes = await fetch(STATIONS_URL);
  if (!listRes.ok) {
    throw new Error(`TMS station list failed with HTTP ${listRes.status}`);
  }
  const listData = await listRes.json();
  const allFeatures = listData.features || [];
  const candidates = allFeatures.filter(isWithinHelsinkiBbox);

  const details = await Promise.all(
    candidates.map((feature) => fetchStationDetail(feature.properties.id))
  );

  const map = {};
  const roadNumbersSeen = new Set();
  let sampleDetail = null;

  for (const detail of details) {
    if (!detail) continue;
    const props = detail.properties || {};
    if (!sampleDetail) sampleDetail = detail;

    const roadNumber = props.roadAddress && props.roadAddress.roadNumber;
    if (typeof roadNumber === "number") roadNumbersSeen.add(roadNumber);

    const match = ROADS.find((r) => r.number === roadNumber);
    if (!match) continue;
    if (props.id != null) map[props.id] = match.label;
    if (props.tmsNumber != null) map[props.tmsNumber] = match.label;
  }

  cachedStationRoadMap = map;
  // Not returned to the client unless ?debug=1.
  cachedStationDebugInfo = {
    totalStationsNationwide: allFeatures.length,
    candidatesInBoundingBox: candidates.length,
    detailsFetchedOk: details.filter(Boolean).length,
    roadNumbersSeen: Array.from(roadNumbersSeen).sort((a, b) => a - b),
    sampleDetailFeature: sampleDetail,
  };
  return map;
}

// Digitraffic's average-speed sensors are named e.g.
// "KESKINOPEUS_5MIN_LIUKUVA_SUUNTA1" / "..._SUUNTA2" (Finnish for "average
// speed, 5-min rolling, direction 1/2"), with a coarser "60MIN" variant too.
// Confirmed live that stations also report a second family with "KESKINOPEUS"
// AND "5MIN" in the name but a "_VVAPAAS1/2" suffix and unit "***" -- some
// free-flow-speed ratio, not an actual speed -- so name matching alone
// wrongly pulls those in too. The real speed sensors are reliably
// unit === "km/h"; require both.
function isSpeedSensor(sensor) {
  return (
    sensor &&
    typeof sensor.name === "string" &&
    sensor.name.toUpperCase().indexOf("KESKINOPEUS") !== -1 &&
    sensor.unit === "km/h"
  );
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
        if (!isSpeedSensor(sensor) || typeof sensor.value !== "number") continue;
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
