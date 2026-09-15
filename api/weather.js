const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const LOCATION_NAME = "Vaarala";
const COUNTRY_CODE = "FI";
const HOURLY_COUNT = 12;

// Groups of Open-Meteo's WMO weather_code -> a small icon category the
// client draws as inline SVG (no emoji/font glyphs, so it's safe on very
// old iOS Safari, which may lack later-added weather emoji).
const ICON_CATEGORIES = {
  clear: [0, 1],
  partly: [2],
  cloudy: [3, 45, 48],
  rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
  snow: [71, 73, 75, 77, 85, 86],
  thunder: [95, 96, 99],
};

function iconCategory(code) {
  for (const category in ICON_CATEGORIES) {
    if (ICON_CATEGORIES[category].indexOf(code) !== -1) {
      return category;
    }
  }
  return "cloudy";
}

// Open-Meteo's WMO weather_code -> short text description.
// https://open-meteo.com/en/docs (weather_code)
const WEATHER_DESCRIPTIONS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  85: "Light snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

// Cached across warm serverless invocations so we don't re-geocode every request.
let cachedCoords = null;

async function resolveCoords() {
  if (cachedCoords) {
    return cachedCoords;
  }

  const url = `${GEOCODE_URL}?name=${encodeURIComponent(LOCATION_NAME)}&count=10&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Geocoding failed with HTTP ${res.status}`);
  }
  const json = await res.json();
  const results = json.results || [];

  const match = results.find((r) => r.country_code === COUNTRY_CODE) || results[0];

  if (!match) {
    const err = new Error(`No location found for "${LOCATION_NAME}"`);
    err.debugInfo = { results };
    throw err;
  }

  cachedCoords = {
    latitude: match.latitude,
    longitude: match.longitude,
    name: match.name,
    admin1: match.admin1,
    debugInfo: { results },
  };
  return cachedCoords;
}

module.exports = async function handler(req, res) {
  const debug = req.query.debug === "1";

  try {
    const coords = await resolveCoords();

    const url =
      `${FORECAST_URL}?latitude=${coords.latitude}&longitude=${coords.longitude}` +
      "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m" +
      "&hourly=temperature_2m,weather_code" +
      "&forecast_days=2" +
      "&timezone=Europe%2FHelsinki";
    const upstream = await fetch(url);
    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json(data);
      return;
    }

    const current = data.current || {};
    const hourlyRaw = data.hourly || {};
    const hourlyTimes = hourlyRaw.time || [];
    const hourlyTemps = hourlyRaw.temperature_2m || [];
    const hourlyCodes = hourlyRaw.weather_code || [];

    // A rolling window of the next HOURLY_COUNT hours from now, not tied to
    // the calendar day -- forecast_days=2 guarantees enough hours are always
    // available even when "now" is late in the day.
    const hourly = [];
    for (let i = 0; i < hourlyTimes.length && hourly.length < HOURLY_COUNT; i++) {
      if (hourlyTimes[i] <= current.time) continue;
      hourly.push({
        time: hourlyTimes[i],
        temperature: hourlyTemps[i],
        weatherCode: hourlyCodes[i],
        description: WEATHER_DESCRIPTIONS[hourlyCodes[i]] || "Unknown",
        category: iconCategory(hourlyCodes[i]),
      });
    }

    const payload = {
      location: coords.name,
      current: {
        temperature: current.temperature_2m,
        apparentTemperature: current.apparent_temperature,
        weatherCode: current.weather_code,
        description: WEATHER_DESCRIPTIONS[current.weather_code] || "Unknown",
        category: iconCategory(current.weather_code),
        windSpeed: current.wind_speed_10m,
        humidity: current.relative_humidity_2m,
        time: current.time,
      },
      hourly: hourly,
    };

    if (debug) {
      payload.debug = { coords: coords, geocoding: coords.debugInfo };
    }

    res.status(200).json(payload);
  } catch (err) {
    const payload = { error: err.message };
    if (debug && err.debugInfo) {
      payload.debug = err.debugInfo;
    }
    res.status(502).json(payload);
  }
};
