import test from "node:test";
import assert from "node:assert/strict";
import { createDemo, stageAt, replayBounds } from "../src/model.js";

test("9–5 replay collapses nearby ranges in three regions and restores earlier evidence", () => {
  const { scans, predictions, vertices } = createDemo();
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
  const width = (p) => p.upper - p.lower;
  for (let region = 0; region < 3; region++) {
    const stage = scans.findIndex((p) => p.region === region), scan = scans[stage];
    const distance = (p) => Math.hypot(p.x - scan.x, p.z - scan.z);
    const ranked = vertices.map((p, i) => ({ p, i })).sort((a, b) => distance(a.p) - distance(b.p));
    const near = ranked.find(({ p }) => p.region === region).i;
    const far = ranked.findLast(({ p }) => p.region === region).i;
    const across = ranked.find(({ p }) => p.region !== region).i;
    const before = predictions[stage], after = predictions[stage + 1];
    assert.ok(width(after[near]) < width(before[near]) * 0.4, `Region ${region}: local window collapses`);
    assert.ok(Math.abs(width(after[far]) / width(before[far]) - 1) < 0.02, "Distant locations retain uncertainty");
    assert.ok(Math.abs(width(after[across]) / width(before[across]) - 1) < 0.03, "Region boundary limits influence");
    const priorMedians = vertices.flatMap((p, i) => p.region === region ? [original[i].median] : []);
    const median = priorMedians.reduce((a, b) => a + b) / priorMedians.length;
    assert.ok(Math.abs(median - [10.8, 13, 15.2][region]) < 0.5, "Regions have distinct timing");
  }
  assert.deepEqual(predictions[stageAt(scans, bounds.start)], original);
});
