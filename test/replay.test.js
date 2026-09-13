import test from "node:test";
import assert from "node:assert/strict";
import { createDemo, stageAt, replayBounds } from "../src/model.js";

test("replay applies evidence at its timestamp and restores the prior when rewound", () => {
  const demo = createDemo((lng, lat) => [
    (lng + 122.27) * 850,
    (37.806 - lat) * 1000,
  ]);
  const { scans, predictions } = demo;
  const bounds = replayBounds(scans);
  const times = scans.map((scan) => scan.time * 60);
  const sequence = [
    bounds.start,
    times[0] - 0.001,
    times[0],
    times[1],
    bounds.end,
    times[0],
    bounds.start,
  ];
  assert.deepEqual(
    sequence.map((time) => stageAt(scans, time)),
    [0, 0, 1, 2, 3, 1, 0],
  );
  const original = structuredClone(predictions[0]);
  assert.ok(demo.vertices.length > 6000);
  for (const snapshot of predictions) {
    assert.ok(
      snapshot.every(
        (p) => Number.isFinite(p.mean) && Number.isFinite(p.sd) && p.sd > 0,
      ),
    );
  }
  assert.ok(predictions[3].some((p, i) => p.sd < original[i].sd * 0.7));
  assert.deepEqual(predictions[stageAt(scans, bounds.start)], original);
});
