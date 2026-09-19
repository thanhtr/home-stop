const MESSAGES_URL = "https://tie.digitraffic.fi/api/traffic-message/v1/messages";

// Kehä I is signed as regional road 101, Kehä III as national road 50.
const ROADS = [
  { number: 101, label: "Kehä I" },
  { number: 50, label: "Kehä III" },
];

const RELEVANT_SITUATION_TYPES = ["TRAFFIC_ANNOUNCEMENT", "ROAD_WORK"];
const MAX_ITEMS = 3;
const DESCRIPTION_MAX_LENGTH = 110;

function roadLabelForAnnouncement(announcement) {
  const details = announcement.locationDetails || {};
  const location = details.roadAddressLocation || {};
  const candidates = [];

  if (location.primaryPoint && location.primaryPoint.roadAddress) {
    candidates.push(location.primaryPoint.roadAddress.road);
  }
  if (location.secondaryPoint && location.secondaryPoint.roadAddress) {
    candidates.push(location.secondaryPoint.roadAddress.road);
  }
  if (typeof location.roadNumber === "number") {
    candidates.push(location.roadNumber);
  }

  for (const road of ROADS) {
    if (candidates.indexOf(road.number) !== -1) {
      return road.label;
    }
  }
  return null;
}

// Prefer the Finnish-language copy of an announcement (Digitraffic ships one
// per language, with the language code seen as "FI" in production); fall
// back to whatever is first.
function pickText(announcements) {
  return (
    announcements.find((a) => (a.language || "").toUpperCase() === "FI") ||
    announcements[0] ||
    {}
  );
}

function truncate(text) {
  if (!text || text.length <= DESCRIPTION_MAX_LENGTH) return text;
  return text.slice(0, DESCRIPTION_MAX_LENGTH - 1).trim() + "…";
}

// Digitraffic's free-text fields come with literal newlines and stray
// trailing spaces (e.g. "Tie 101, eli Kehä I, Helsinki. Tietyö. ").
function cleanText(text) {
  if (!text) return text;
  return text.replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
}

module.exports = async function handler(req, res) {
  const debug = req.query.debug === "1";

  try {
    const upstream = await fetch(`${MESSAGES_URL}?includeAreaGeometry=false`);
    const data = await upstream.json();

    if (!upstream.ok) {
      res.status(upstream.status).json(data);
      return;
    }

    const features = data.features || [];
    const items = [];
    let skipped = 0;

    for (let i = 0; i < features.length; i++) {
      try {
        const props = features[i].properties || {};
        if (RELEVANT_SITUATION_TYPES.indexOf(props.situationType) === -1) continue;

        const announcements = props.announcements || [];
        let road = null;
        for (let a = 0; a < announcements.length && !road; a++) {
          road = roadLabelForAnnouncement(announcements[a]);
        }
        if (!road) continue;

        const text = pickText(announcements);
        // "comment" carries the human-written incident summary when present
        // (mainly TRAFFIC_ANNOUNCEMENT); ROAD_WORK items instead put the
        // useful, item-specific detail in location.description, since
        // additionalInformation is just a generic boilerplate URL repeated
        // on every message.
        const rawDescription =
          text.comment ||
          (text.location && text.location.description) ||
          text.additionalInformation ||
          text.title ||
          null;
        items.push({
          road: road,
          situationType: props.situationType,
          title: cleanText(text.title) || null,
          description: truncate(cleanText(rawDescription)),
          releaseTime: props.releaseTime || null,
        });
      } catch (e) {
        skipped++;
      }
    }

    items.sort((a, b) => (b.releaseTime || "").localeCompare(a.releaseTime || ""));

    const payload = {
      items: items.slice(0, MAX_ITEMS),
      updatedTime: data.dataUpdatedTime || null,
    };

    if (debug) {
      payload.debug = {
        totalFeatures: features.length,
        matchedBeforeLimit: items.length,
        skippedWithErrors: skipped,
        sampleFeature: features[0] || null,
      };
    }

    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
