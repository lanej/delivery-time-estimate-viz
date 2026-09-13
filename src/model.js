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
    const hour = [10.8, 13, 15.2][region]
      + 0.24 * Math.sin(4 * u + 2 * v) + 0.18 * Math.cos(5 * v);
    return {
      x, z, region,
      mean: toLatent(hour),
      amplitude: 0.86 + 0.12 * Math.cos(3 * u - 2 * v),
      noise: 0.12,
    };
  }
  const regions = [
    { name: "West", center: -0.57 },
    { name: "Central", center: 0.01 },
    { name: "East", center: 0.58 },
  ];
  const offsets = [[-0.06, -0.54], [0.09, -0.39], [-0.04, -0.12],
    [0.09, 0.06], [-0.08, 0.32], [0.03, 0.56]];
  const eventMinutes = [
    [565, 590, 620, 645, 675, 700],
    [710, 735, 760, 790, 825, 850],
    [855, 880, 905, 935, 965, 995],
  ];
  const usableSites = sites
    .filter((p) => Math.abs(p.x) < worldW * 0.42 && Math.abs(p.z) < worldD * 0.41)
    .map((p) => field(p.x, p.z));
  const usedSites = new Set();
  const scans = regions.flatMap((region, r) => offsets.map(([du, v], i) => {
    const x = (region.center + du) * worldW / 2, z = v * worldD / 2;
    // Anchor to distinct building footprints when map sites are supplied.
    const nearest = usableSites
      .filter((p) => p.region === r && !usedSites.has(p))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    if (nearest) usedSites.add(nearest);
    return { ...(nearest || field(x, z)), time: eventMinutes[r][i] / 60 };
  })).sort((a, b) => a.time - b.time);

  // Spatial covariance decays with distance and drops sharply at region edges.
  // No routes are supplied or inferred. Independent address noise remains.
  const lengthScale = 1.8;
  function kernel(a, b) {
    const distance2 = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
    return a.amplitude * b.amplitude * (a.region === b.region ? 1 : 0.02)
      * Math.exp(-distance2 / (2 * lengthScale ** 2)) + 0.025 ** 2;
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

  const NX = 88, NZ = 72, vertices = [];
  for (let iz = 0; iz <= NZ; iz++)
    for (let ix = 0; ix <= NX; ix++)
      vertices.push(field((ix / NX - 0.5) * worldW * 0.84,
        (iz / NZ - 0.5) * worldD * 0.82));

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
