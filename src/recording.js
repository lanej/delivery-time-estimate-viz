import { createProjection } from "./geography.js";

export const MAX_RECORDING_BYTES = 25 * 1024 * 1024;
const fail = (path, message) => { throw new Error(`${path}: ${message}`); };
const object = (value, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value;
};
const text = (value, path) => {
  if (typeof value !== "string" || !value.trim() || value.length > 300) fail(path, "expected 1–300 characters");
  return value;
};
const number = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path, "expected a finite number");
  return value;
};
const list = (value, path, min, max) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected ${min}–${max} entries`);
  return value;
};
function timestamp(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
      || !Number.isFinite(Date.parse(value))) fail(path, "expected an ISO timestamp with an explicit timezone");
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
      || hour > 23 || minute > 59 || second > 59) fail(path, "invalid calendar date or time");
  return Date.parse(value);
}
function unique(items, path) {
  const seen = new Set();
  items.forEach((item, i) => {
    object(item, `${path}[${i}]`);
    text(item.id, `${path}[${i}].id`);
    if (seen.has(item.id)) fail(path, `duplicate ID ${item.id}`);
    seen.add(item.id);
  });
}

/** Parse a self-contained recorded forecast day. No inference or networking occurs. */
export function parseRecording(input) {
  const raw = object(input, "recording");
  if (raw.version !== 1) fail("version", "only version 1 is supported");
  text(raw.id, "id"); text(raw.label, "label"); text(raw.timeZone, "timeZone");
  if (typeof raw.synthetic !== "boolean") fail("synthetic", "must explicitly identify simulated data");
  let formatter;
  try { formatter = new Intl.DateTimeFormat("en-US", { timeZone: raw.timeZone, hour: "numeric", minute: "2-digit" }); }
  catch { fail("timeZone", "unknown timezone"); }
  const dates = new Intl.DateTimeFormat("en-US", { timeZone: raw.timeZone, month: "short", day: "numeric" });
  const domain = list(raw.timeDomain, "timeDomain", 2, 2).map((t, i) => timestamp(t, `timeDomain[${i}]`));
  const origin = domain[0], duration = (domain[1] - origin) / 60000;
  if (duration <= 0 || duration > 7 * 24 * 60) fail("timeDomain", "must span more than zero and at most seven days");
  const minutes = (value, path) => (timestamp(value, path) - origin) / 60000;
  const replay = list(raw.replay, "replay", 2, 2).map((t, i) => minutes(t, `replay[${i}]`));
  if (replay[1] <= replay[0] || replay[1] - replay[0] > 7 * 24 * 60) fail("replay", "must span more than zero and at most seven days");
  const bounds = list(raw.bounds, "bounds", 4, 4).map((v, i) => number(v, `bounds[${i}]`));
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || south <= -85 || north >= 85 || east <= west || north <= south
      || east - west > 10 || north - south > 10) fail("bounds", "expected a local west/south/east/north extent");
  const projection = createProjection(bounds);
  function coordinate(value, path, within = true) {
    const [longitude, latitude] = list(value, path, 2, 2).map((n, i) => number(n, `${path}[${i}]`));
    if (longitude < -180 || longitude > 180 || latitude <= -85 || latitude >= 85) fail(path, "invalid longitude/latitude");
    // Geometry may cross the viewport; sites and grid points must remain visible.
    const p = projection.project(longitude, latitude);
    if (within && (Math.abs(p.x) > 6.2 || Math.abs(p.z) > 4.65)) fail(path, "point falls outside the projected view");
    return { longitude, latitude, ...p };
  }
  const areas = list(raw.areas, "areas", 1, 24);
  unique(areas, "areas");
  const areaIndex = new Map(areas.map((area, i) => [area.id, i]));
  const regions = areas.map((area, i) => {
    text(area.name, `areas[${i}].name`);
    const window = list(area.serviceWindow, `areas[${i}].serviceWindow`, 2, 2)
      .map((t, j) => minutes(t, `areas[${i}].serviceWindow[${j}]`));
    if (window[0] < 0 || window[1] > duration || window[1] <= window[0]) fail(`areas[${i}].serviceWindow`, "must be ordered and inside the time domain");
    return { id: area.id, name: area.name, window };
  });
  const grid = object(raw.grid, "grid");
  if (!Number.isInteger(grid.columns) || !Number.isInteger(grid.rows) || grid.columns < 2 || grid.rows < 2)
    fail("grid", "columns and rows must be integers of at least 2");
  const points = list(grid.points, "grid.points", 4, 20000);
  if (points.length !== grid.columns * grid.rows) fail("grid.points", "length must equal columns × rows in row-major order");
  const vertices = points.map((point, i) => {
    object(point, `grid.points[${i}]`);
    if (point.areaId !== null && !areaIndex.has(point.areaId)) fail(`grid.points[${i}].areaId`, "unknown area");
    return { ...coordinate(point.coordinates, `grid.points[${i}].coordinates`), region: point.areaId === null ? null : areaIndex.get(point.areaId) };
  });
  if (!vertices.some((p) => p.region !== null)) fail("grid", "must contain supported points");
  regions.forEach((region, r) => {
    const members = vertices.filter((p) => p.region === r);
    if (!members.length) fail("grid", `no points assigned to ${region.name}`);
    region.center = members.reduce((sum, p) => sum + p.x, 0) / members.length / 6.2;
  });
  const rawSites = list(raw.sites, "sites", 1, 5000);
  unique(rawSites, "sites");
  const sites = rawSites.map((site, i) => {
    text(site.label, `sites[${i}].label`);
    if (!areaIndex.has(site.areaId)) fail(`sites[${i}].areaId`, "unknown area");
    if (site.zip != null && !/^\d{5}$/.test(site.zip)) fail(`sites[${i}].zip`, "expected a five-digit ZIP");
    return { id: site.id, label: site.label, zip: site.zip || "", region: areaIndex.get(site.areaId), ...coordinate(site.coordinates, `sites[${i}].coordinates`) };
  });
  const siteIndex = new Map(sites.map((site, i) => [site.id, i]));
  const observations = list(raw.observations, "observations", 0, 10000);
  unique(observations, "observations");
  const seenSites = new Set();
  const scans = observations.map((scan, i) => {
    if (!siteIndex.has(scan.siteId)) fail(`observations[${i}].siteId`, "unknown site");
    if (seenSites.has(scan.siteId)) fail("observations", "version 1 supports one confirmed delivery per site; revisions need a new recording");
    seenSites.add(scan.siteId);
    const eventMinutes = minutes(scan.eventAt, `observations[${i}].eventAt`);
    const availableMinutes = minutes(scan.availableAt, `observations[${i}].availableAt`);
    if (eventMinutes < 0 || eventMinutes > duration) fail(`observations[${i}].eventAt`, "delivery falls outside the time domain");
    if (availableMinutes < eventMinutes) fail(`observations[${i}].availableAt`, "cannot precede the delivery");
    return { ...sites[siteIndex.get(scan.siteId)], id: scan.id, siteId: scan.siteId, time: eventMinutes / 60, availableMinutes };
  }).sort((a, b) => a.availableMinutes - b.availableMinutes || a.id.localeCompare(b.id));
  const scanIndex = new Map(scans.map((scan) => [scan.id, scan]));
  function quantiles(value, path) {
    const q = list(value, path, 3, 3).map((n, i) => number(n, `${path}[${i}]`));
    if (q[0] < 0 || q[2] > duration || q[0] > q[1] || q[1] > q[2]) fail(path, "expected ordered 10th/50th/90th percentiles inside the time domain");
    return { lower: q[0] / 60, median: q[1] / 60, upper: q[2] / 60 };
  }
  const rawSnapshots = list(raw.snapshots, "snapshots", 1, 300);
  unique(rawSnapshots, "snapshots");
  if (rawSnapshots.length * (vertices.length + sites.length) > 500000) fail("snapshots", "exceeds 500,000 location/snapshot values");
  let distributionPoints = 0;
  const snapshots = rawSnapshots.map((snapshot, i) => {
    const path = `snapshots[${i}]`;
    const at = minutes(snapshot.availableAt, `${path}.availableAt`), asOf = minutes(snapshot.asOf, `${path}.asOf`);
    if (asOf > at) fail(`${path}.asOf`, "cannot follow forecast availability");
    text(snapshot.modelVersion, `${path}.modelVersion`);
    const evidenceIds = list(snapshot.evidenceIds, `${path}.evidenceIds`, 0, scans.length);
    if (new Set(evidenceIds).size !== evidenceIds.length) fail(`${path}.evidenceIds`, "duplicate evidence ID");
    evidenceIds.forEach((id) => {
      if (!scanIndex.has(id) || scanIndex.get(id).availableMinutes > asOf) fail(`${path}.evidenceIds`, `unknown or future evidence ${id}`);
    });
    const values = list(snapshot.gridValues, `${path}.gridValues`, vertices.length, vertices.length).map((value, j) => {
      if (vertices[j].region === null) {
        if (value !== null) fail(`${path}.gridValues[${j}]`, "unsupported points must have null values");
        return { lower: 0, median: 0, upper: 0 };
      }
      return quantiles(value, `${path}.gridValues[${j}]`);
    });
    const supplied = object(snapshot.siteValues, `${path}.siteValues`);
    for (const id of Object.keys(supplied)) if (!siteIndex.has(id)) fail(`${path}.siteValues`, `unknown site ${id}`);
    const siteValues = sites.map((site) => {
      if (!Object.hasOwn(supplied, site.id)) fail(`${path}.siteValues`, `missing ${site.id}; use null for unsupported predictions`);
      return supplied[site.id] === null ? null : quantiles(supplied[site.id], `${path}.siteValues.${site.id}`);
    });
    const distributions = new Map();
    if (snapshot.distributions != null) {
      for (const [id, curve] of Object.entries(object(snapshot.distributions, `${path}.distributions`))) {
        if (!siteIndex.has(id) || !siteValues[siteIndex.get(id)]) fail(`${path}.distributions`, `no prediction for ${id}`);
        const samples = list(curve, `${path}.distributions.${id}`, 3, 512).map((sample, j) => {
          const [t, weight] = list(sample, `${path}.distributions.${id}[${j}]`, 2, 2).map((n) => number(n, path));
          if (t < 0 || t > duration || weight < 0) fail(`${path}.distributions.${id}`, "times must be in-domain and weights nonnegative");
          return [t / 60, weight];
        });
        if (samples.some((sample, j) => j && sample[0] <= samples[j - 1][0]) || !samples.some((p) => p[1] > 0))
          fail(`${path}.distributions.${id}`, "times must increase and some density must be positive");
        if (samples[0][0] !== 0 || samples.at(-1)[0] !== duration / 60) fail(`${path}.distributions.${id}`, "density must span the complete display domain");
        const mass = samples.slice(1).reduce((sum, p, j) => sum + (p[0] - samples[j][0]) * (p[1] + samples[j][1]) / 2, 0);
        if (!Number.isFinite(mass) || mass <= 0) fail(`${path}.distributions.${id}`, "density must have finite positive total mass");
        samples.forEach((p) => { p[1] /= mass; });
        distributionPoints += samples.length;
        if (distributionPoints > 500000) fail("distributions", "too many density samples");
        distributions.set(id, samples);
      }
    }
    const complete = snapshot.syntheticResolved === true;
    if (complete && (!raw.synthetic || !values.every((p) => p.lower === p.upper)
        || !siteValues.every((p) => p && p.lower === p.upper))) fail(`${path}.syntheticResolved`, "requires a complete, zero-range synthetic outcome field");
    return { id: snapshot.id, at, asOf, modelVersion: snapshot.modelVersion, evidenceIds, values, siteValues, distributions, complete };
  }).sort((a, b) => a.at - b.at);
  if (snapshots[0].at > replay[0]) fail("snapshots", "a forecast must be available at replay start");
  if (snapshots.some((snapshot, i) => i && snapshot.at === snapshots[i - 1].at)) fail("snapshots", "forecast availability timestamps must be unique");
  if (raw.distributionFamily != null && (raw.distributionFamily !== "logit-normal" || !raw.synthetic))
    fail("distributionFamily", "only the synthetic logit-normal demo is supported; supply density samples for recorded models");
  const map = object(raw.map, "map");
  if (map.type !== "FeatureCollection") fail("map", "expected a GeoJSON FeatureCollection");
  let mapPoints = 0;
  list(map.features, "map.features", 0, 30000).forEach((feature, i) => {
    const path = `map.features[${i}]`;
    object(feature, path); object(feature.properties, `${path}.properties`); object(feature.geometry, `${path}.geometry`);
    if (feature.type !== "Feature") fail(path, "expected a GeoJSON Feature");
    if (!["road", "building", "water"].includes(feature.properties.kind)) fail(path, "kind must be road, building, or water");
    if (feature.properties.name != null && typeof feature.properties.name !== "string") fail(path, "name must be text");
    const geometry = feature.geometry;
    if (geometry.type !== (feature.properties.kind === "road" ? "LineString" : "Polygon")) fail(path, "roads must be LineStrings; buildings and water must be Polygons");
    const lines = geometry.type === "LineString" ? [geometry.coordinates]
      : geometry.type === "Polygon" ? geometry.coordinates : null;
    if (!lines) fail(path, "only LineString and Polygon map geometry are supported");
    list(lines, `${path}.coordinates`, 1, 1000).forEach((line) => {
      list(line, `${path}.coordinates`, 2, 10000).forEach((p) => coordinate(p, path, false));
      mapPoints += line.length;
      if (mapPoints > 300000) fail("map", "too many map coordinates");
      if (geometry.type === "Polygon" && (line.length < 4 || line[0][0] !== line.at(-1)[0] || line[0][1] !== line.at(-1)[1])) fail(path, "polygon rings must be closed");
    });
  });
  text(raw.mapAttribution, "mapAttribution");
  const multiDay = dates.format(domain[0]) !== dates.format(domain[1]);
  const clock = (minute, withSeconds = false) => {
    const date = new Date(origin + minute * 60000);
    const format = withSeconds ? new Intl.DateTimeFormat("en-US", { timeZone: raw.timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }) : formatter;
    return `${multiDay ? `${dates.format(date)} ` : ""}${format.format(date)}`;
  };
  return {
    raw, id: raw.id, label: raw.label, synthetic: raw.synthetic, timeZone: raw.timeZone,
    dateLabel: dates.format(origin), projection, map, mapAttribution: raw.mapAttribution,
    NX: grid.columns - 1, NZ: grid.rows - 1, vertices, sites, regions, scans, snapshots,
    timeMin: 0, timeMax: duration / 60, start: replay[0], end: replay[1], clock,
  };
}

function upperBound(items, value, select) {
  let low = 0, high = items.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (select(items[mid]) <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Select model snapshots and delivery evidence independently, using knowledge time. */
export function recordingAt(day, minutes) {
  const index = upperBound(day.snapshots, minutes, (s) => s.at) - 1;
  const stage = upperBound(day.scans, minutes, (s) => s.availableMinutes);
  const snapshot = index >= 0 ? day.snapshots[index] : null;
  return { index, stage, snapshot, previous: index > 0 ? day.snapshots[index - 1] : null,
    values: snapshot?.values || null, complete: snapshot?.complete || false };
}

export function nextRecordingTime(day, minutes) {
  return Math.min(day.end, ...day.snapshots.filter((s) => s.at > minutes).map((s) => s.at),
    ...day.scans.filter((s) => s.availableMinutes > minutes).map((s) => s.availableMinutes));
}

export function inspectSite(day, state, siteIndex) {
  const site = day.sites[siteIndex];
  const observed = day.scans.slice(0, state.stage).find((scan) => scan.siteId === site.id) || null;
  const prediction = state.snapshot?.siteValues[siteIndex] || null;
  return { site, observed, prediction,
    current: observed ? { lower: observed.time, median: observed.time, upper: observed.time } : prediction,
    previous: state.previous?.siteValues[siteIndex] || null };
}

/** Draw only supplied density, or the explicitly declared synthetic model density. */
export function siteDensity(day, snapshot, siteIndex) {
  if (!snapshot) return null;
  const supplied = snapshot.distributions.get(day.sites[siteIndex].id);
  if (supplied) return supplied;
  const p = snapshot.siteValues[siteIndex];
  if (day.raw.distributionFamily !== "logit-normal" || !p || p.upper === p.lower) return null;
  const span = day.timeMax;
  if (p.lower <= 0 || p.upper >= span) return null;
  const logit = (t) => Math.log(t / (span - t));
  const mean = logit(p.median), sigma = (logit(p.upper) - logit(p.lower)) / (2 * 1.281551566);
  if (!(sigma > 0)) return null;
  return Array.from({ length: 161 }, (_, i) => {
    const t = span * i / 160;
    if (!i || i === 160) return [t, 0];
    const z = (logit(t) - mean) / sigma;
    return [t, Math.exp(-z * z / 2) / (sigma * Math.sqrt(2 * Math.PI)) * span / (t * (span - t))];
  });
}
