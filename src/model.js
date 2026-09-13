/** Build the illustrative field and posterior states without any future observations. */
export function createDemo(worldCoord, { worldW = 12.4, worldD = 9.3 } = {}) {
  // A synthetic dense Gaussian field. Latent factors stand in for correlations
  // learned from history; the discontinuities do not represent supplied routes.
  // Independent residual variance remains after observations.
  function field(x, z) {
    const u = x / (worldW / 2),
      v = z / (worldD / 2);
    const a = u + 0.28 * v < 0.1 ? 1 : 0;
    const b = v - 0.18 * u > 0.36 ? 1 : 0;
    const bump = Math.exp(-((u + 0.36) ** 2 / 0.21 + (v + 0.16) ** 2 / 0.28));
    const mean =
      12.6 +
      1.6 * (1 - a) +
      1.05 * b +
      0.55 * Math.sin(4 * u + v) +
      0.38 * Math.cos(4.5 * v) -
      0.75 * bump;
    const f = [
      0.15,
      0.91 * a + 0.13 * (1 - a),
      0.18 * a + 0.79 * (1 - a),
      0.44 * b + 0.09 * (1 - b),
    ];
    const noise = 0.2 + 0.16 * (0.5 + 0.5 * Math.sin(4 * u - 3 * v));
    return { mean, f, noise };
  }
  const scanCoords = [
    [-122.27042, 37.808017],
    [-122.269095, 37.808809],
    [-122.267612, 37.806954],
  ];
  const scans = scanCoords
    .map((p, i) => {
      const [x, z] = worldCoord(...p),
        v = field(x, z);
      return { x, z, ...v, time: v.mean - [0.82, 0.97, 0.88][i] };
    })
    .sort((a, b) => a.time - b.time);
  const identity = () =>
    Array.from({ length: 4 }, (_, i) =>
      Array.from({ length: 4 }, (_, j) => (i === j ? 1 : 0)),
    );
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const matVec = (m, v) => m.map((row) => dot(row, v));
  const states = [{ mean: [0, 0, 0, 0], cov: identity() }];
  for (const obs of scans) {
    const previous = states[states.length - 1],
      cf = matVec(previous.cov, obs.f);
    const variance = dot(obs.f, cf) + obs.noise ** 2;
    const residual = obs.time - obs.mean - dot(obs.f, previous.mean);
    states.push({
      mean: previous.mean.map((v, i) => v + (cf[i] * residual) / variance),
      cov: previous.cov.map((row, i) =>
        row.map((v, j) => v - (cf[i] * cf[j]) / variance),
      ),
    });
  }
  const NX = 88,
    NZ = 72,
    vertices = [];
  for (let iz = 0; iz <= NZ; iz++)
    for (let ix = 0; ix <= NX; ix++) {
      const x = (ix / NX - 0.5) * worldW * 0.84,
        z = (iz / NZ - 0.5) * worldD * 0.82;
      vertices.push({ x, z, ...field(x, z) });
    }
  const predictions = states.map((state) =>
    vertices.map((p) => ({
      mean: p.mean + dot(p.f, state.mean),
      sd: Math.sqrt(
        Math.max(0, dot(p.f, matVec(state.cov, p.f))) + p.noise ** 2,
      ),
    })),
  );
  const allTimes = predictions.flatMap((set) =>
    set.flatMap((p) => [
      p.mean - 1.281551566 * p.sd,
      p.mean + 1.281551566 * p.sd,
    ]),
  );
  const timeMin = Math.floor(Math.min(...allTimes)),
    timeMax = Math.ceil(Math.max(...allTimes));

  return { NX, NZ, vertices, predictions, scans, timeMin, timeMax };
}

/** Return the evidence snapshot available at a replay timestamp (minutes after midnight). */
export function stageAt(scans, minutes) {
  return scans.filter((scan) => scan.time * 60 <= minutes).length;
}

/** Include a short lead-in and tail around the observed event timestamps. */
export function replayBounds(scans) {
  return {
    start: Math.floor(scans[0].time * 60) - 12,
    end: Math.ceil(scans[scans.length - 1].time * 60) + 12,
  };
}
