export const DAY_START = 9;
export const DAY_END = 17;
const QUANTILE_80 = 1.281551566;

// A monotone transform keeps every prediction inside the illustrated 9–5 day.
const toLatent = (hour) => Math.log((hour - DAY_START) / (DAY_END - hour));
const toHour = (value) => DAY_START + (DAY_END - DAY_START) / (1 + Math.exp(-value));

/** Synthetic regional predictions; supplied sites only locate demo deliveries. */
export function createDemo({ worldW = 12.4, worldD = 9.3, sites = [] } = {}) {
  function field(x, z) {
    const u = x / (worldW / 2), v = z / (worldD / 2);
    const region = u + 0.18 * v < -0.25 ? 0 : u - 0.1 * v < 0.27 ? 1 : 2;
    const localX = (u - [-0.57, 0.01, 0.58][region]) / 0.29;
    // Smooth variation at several spatial scales: hills, valleys, and smaller
    // ripples throughout every area. No directional ramp or interior thresholds.
    const phase = [0.35, 2.1, 4.4][region];
    const hour = 13
      + 2.2 * Math.sin(2.6 * localX + 1.2 * v + phase) * Math.cos(4.1 * v - 0.4 * localX + phase)
      + 0.95 * Math.sin(7.5 * v + 2 * localX - 1.3 * phase)
      + 0.4 * Math.cos(5.8 * localX - 4.3 * v + phase);
    return {
      x, z, region,
      mean: toLatent(hour),
      amplitude: 0.82 + 0.14 * Math.cos(2 * localX + 3 * v + phase) + 0.08 * Math.sin(5 * v - localX),
      noise: 0.12,
    };
  }
  const regions = [
    { name: "West", center: -0.57 },
    { name: "Central", center: 0.01 },
    { name: "East", center: 0.58 },
  ];
  const NX = 88, NZ = 72, vertices = [];
  for (let iz = 0; iz <= NZ; iz++)
    for (let ix = 0; ix <= NX; ix++)
      vertices.push(field((ix / NX - 0.5) * worldW * 0.84,
        (iz / NZ - 0.5) * worldD * 0.82));

  const offsets = [[-0.06, -0.54], [0.09, -0.39], [-0.04, -0.12],
    [0.09, 0.06], [-0.08, 0.32], [0.03, 0.56]];
  const eventMinutes = [
    [565, 640, 725, 815, 900, 995],
    [550, 655, 740, 825, 915, 1005],
    [575, 630, 710, 800, 925, 985],
  ];
  const buildingSites = sites
    .filter((p) => Math.abs(p.x) < worldW * 0.42 && Math.abs(p.z) < worldD * 0.41)
    .map((p) => field(p.x, p.z));
  const usableSites = buildingSites.length ? buildingSites : vertices;
  const usedSites = new Set();
  const scans = regions.flatMap((region, r) => offsets.map(([du, v], i) => {
    const x = (region.center + du) * worldW / 2;
    const z = (r === 1 ? -v : v) * worldD / 2;
    const time = eventMinutes[r][i] / 60;
    // Observe distinct locations with plausible prior times across the whole day,
    // rather than walking a prescribed north–south sequence through the map.
    const score = (p) => Math.abs(toHour(p.mean) - time - 0.2 * Math.sin(i + r))
      + 0.045 * Math.hypot(p.x - x, p.z - z)
      + [...usedSites].filter((q) => q.region === r)
        .reduce((sum, q) => sum + 0.5 * Math.exp(-((p.x - q.x) ** 2 + (p.z - q.z) ** 2) / 0.7), 0);
    let nearest, bestScore = Infinity;
    for (const p of usableSites) {
      if (p.region !== r || usedSites.has(p)) continue;
      const value = score(p);
      if (value < bestScore) { bestScore = value; nearest = p; }
    }
    if (nearest) usedSites.add(nearest);
    return { ...(nearest || field(x, z)), time };
  })).sort((a, b) => a.time - b.time);

  // Each region is a separate 9–5 delivery area: no covariance across boundaries.
  // Within an area, spatial covariance decays with geographic distance.
  // No routes are supplied or inferred. Independent address noise remains.
  const lengthScale = 1.8;
  function kernel(a, b) {
    if (a.region !== b.region) return 0;
    const distance2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
    return a.amplitude * b.amplitude
      * Math.exp(-distance2 / (2 * lengthScale ** 2));
  }
  const L = scans.map(() => []), residuals = [];
  scans.forEach((obs, i) => {
    for (let j = 0; j <= i; j++) {
      let value = kernel(obs, scans[j]) + (i === j ? obs.noise ** 2 : 0);
      for (let k = 0; k < j; k++) value -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(value, 1e-12)) : value / L[j][j];
    }
    let residual = toLatent(obs.time) - obs.mean;
    for (let j = 0; j < i; j++) residual -= L[i][j] * residuals[j];
    residuals.push(residual / L[i][i]);
  });

  const predictions = Array.from({ length: scans.length + 1 }, () => []);
  function interval(mean, variance) {
    const radius = QUANTILE_80 * Math.sqrt(Math.max(variance, 1e-12));
    return { median: toHour(mean), lower: toHour(mean - radius), upper: toHour(mean + radius) };
  }
  vertices.forEach((p) => {
    let mean = p.mean, variance = kernel(p, p) + p.noise ** 2;
    const weights = [];
    predictions[0].push(interval(mean, variance));
    scans.forEach((obs, i) => {
      let weight = kernel(p, obs);
      for (let j = 0; j < i; j++) weight -= L[i][j] * weights[j];
      weight /= L[i][i];
      weights.push(weight);
      mean += weight * residuals[i];
      variance -= weight ** 2;
      predictions[i + 1].push(interval(mean, variance));
    });
  });
  return { NX, NZ, vertices, predictions, scans, regions, timeMin: DAY_START, timeMax: DAY_END };
}

/** Evidence available at the replay timestamp, in minutes after midnight. */
export function stageAt(scans, minutes) {
  return scans.filter((scan) => Math.round(scan.time * 60) <= minutes).length;
}

/** The replay and vertical/color scales share the same fixed 9 AM–5 PM day. */
export function replayBounds() {
  return { start: DAY_START * 60, end: DAY_END * 60 };
}
