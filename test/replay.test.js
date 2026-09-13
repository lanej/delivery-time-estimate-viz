import test from "node:test";
import assert from "node:assert/strict";
import { createDemo, stageAt, replayBounds, replayAt } from "../src/model.js";

test("smooth independent areas collapse locally, finish without a range, and rewind correctly", () => {
  const demo = createDemo();
  const { NX, NZ, scans, predictions, vertices } = demo;
  const bounds = replayBounds();
  const times = scans.map((scan) => Math.round(scan.time * 60));
  assert.deepEqual(bounds, { start: 540, end: 1020 });
  assert.deepEqual([0, 1, 2].map((r) => scans.filter((p) => p.region === r).length), [6, 6, 6]);
  assert.ok(times.every((time) => time > bounds.start && time < bounds.end));
  assert.ok(vertices.length > 6000);
  assert.deepEqual(
    [bounds.start, times[0] - 0.001, times[0], times[1], bounds.end, times[0], bounds.start]
      .map((time) => stageAt(scans, time)),
    [0, 0, 1, 2, scans.length, 1, 0],
  );
  const original = structuredClone(predictions[0]);
  for (const snapshot of predictions) {
    assert.ok(snapshot.every((p) =>
      Number.isFinite(p.median) && p.lower >= 9 && p.lower < p.median
      && p.median < p.upper && p.upper <= 17));
  }
  const peaks = [0, 0, 0], valleys = [0, 0, 0];
  for (let z = 1; z < NZ; z++) for (let x = 1; x < NX; x++) {
    const i = z * (NX + 1) + x, region = vertices[i].region;
    const neighbors = [i - 1, i + 1, i - NX - 1, i + NX + 1];
    if (!neighbors.every((j) => vertices[j].region === region)) continue;
    const value = original[i].median;
    assert.ok(neighbors.every((j) => Math.abs(value - original[j].median) < 0.75),
      "No abrupt steps inside a delivery area; boundary cliffs are allowed");
    if (neighbors.every((j) => value > original[j].median)) peaks[region]++;
    if (neighbors.every((j) => value < original[j].median)) valleys[region]++;
  }
  assert.ok(peaks.every((count) => count >= 2) && valleys.every((count) => count >= 1),
    "Every area needs local hills and valleys, not one directional ramp");
  const width = (p) => p.upper - p.lower;
  for (let region = 0; region < 3; region++) {
    const stage = scans.findIndex((p) => p.region === region), scan = scans[stage];
    const distance = (p) => Math.hypot(p.x - scan.x, p.z - scan.z);
    const ranked = vertices.map((p, i) => ({ p, i })).sort((a, b) => distance(a.p) - distance(b.p));
    const near = ranked.find(({ p }) => p.region === region).i;
    const far = ranked.findLast(({ p }) => p.region === region).i;
    const before = predictions[stage], after = predictions[stage + 1];
    assert.ok(width(after[near]) < width(before[near]) * 0.4, `Region ${region}: local window collapses`);
    assert.ok(Math.abs(width(after[far]) / width(before[far]) - 1) < 0.02, "Distant locations retain uncertainty");
    const priorMedians = vertices.flatMap((p, i) => p.region === region ? [original[i].median] : []);
    assert.ok(Math.min(...priorMedians) < 11 && Math.max(...priorMedians) > 15,
      "Every region includes early and late predictions");
    const events = scans.filter((p) => p.region === region);
    assert.ok(events[0].time < 10 && events.at(-1).time > 16,
      "Every region has deliveries near both ends of 9–5");
    assert.ok(events.some((p) => p.time > 11.5 && p.time < 14.5),
      "Every region also has midday deliveries");
  }
  scans.forEach((scan, stage) => {
    assert.ok(vertices.every((p, i) => p.region === scan.region ||
      ["median", "lower", "upper"].every((key) => predictions[stage][i][key] === predictions[stage + 1][i][key])),
      `Delivery ${stage + 1} must leave every other region unchanged`);
  });
  const justBefore = replayAt(demo, bounds.end - 0.001);
  assert.equal(justBefore.complete, false);
  assert.equal(justBefore.stage, scans.length);
  assert.ok(justBefore.values.every((p) => p.upper > p.lower),
    "Sparse daytime observations must retain uncertainty until the complete outcomes arrive");
  const finished = replayAt(demo, bounds.end);
  assert.equal(finished.complete, true);
  assert.ok(finished.values.every((p) =>
    p.lower === p.median && p.upper === p.median && p.median >= 9 && p.median <= 17),
    "All three areas finish with exactly one delivery time at every location");
  const finalTimes = finished.values.map((p) => p.median);
  assert.ok(Math.max(...finalTimes) - Math.min(...finalTimes) > 5,
    "Zero range preserves the textured delivery-time surface, rather than flattening it");
  assert.deepEqual(replayAt(demo, bounds.end + 30), finished);
  assert.deepEqual(replayAt(demo, bounds.end - 1).values, predictions.at(-1));
  assert.deepEqual(replayAt(demo, times[5]).values, predictions[6]);
  assert.deepEqual(replayAt(demo, bounds.start).values, original);
  assert.equal(replayAt(demo, bounds.start).complete, false);
});
