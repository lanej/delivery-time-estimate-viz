import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/recorded-day.json" with { type: "json" };
import { parseRecording, recordingAt, nextRecordingTime, inspectSite, siteDensity } from "../src/recording.js";
import { demoRecording } from "../src/demo-recording.js";

test("recorded-day import preserves knowledge time, independent snapshots, unknown outcomes, and rewind", () => {
  const raw = structuredClone(fixture);
  raw.snapshots.reverse(); raw.observations.reverse();
  const day = parseRecording(raw);
  assert.equal(day.clock(0), "9:00 AM");
  assert.deepEqual(day.regions.map((r) => r.window), [[0, 480], [0, 480], [0, 480]]);
  assert.deepEqual([0, 60, 64.999, 65, 74.999, 75, 480, 0].map((t) => {
    const state = recordingAt(day, t); return [state.stage, state.index, state.complete];
  }), [[0, 0, false], [0, 0, false], [0, 0, false], [1, 0, false], [1, 0, false], [1, 1, false], [1, 1, false], [0, 0, false]]);
  assert.equal(recordingAt(day, -1).snapshot, null, "No prediction is shown before one becomes available");
  assert.deepEqual([0, 65, 75, 480].map((t) => nextRecordingTime(day, t)), [65, 75, 480, 480]);
  const before = inspectSite(day, recordingAt(day, 64), 0);
  const after = inspectSite(day, recordingAt(day, 65), 0);
  assert.equal(before.observed, null);
  assert.deepEqual(after.current, { lower: 1, median: 1, upper: 1 });
  assert.deepEqual(after.prediction, before.prediction, "Confirmed outcome can arrive before a new model forecast");
  const updated = recordingAt(day, 75);
  assert.deepEqual(updated.values[2], updated.previous.values[2], "Supplied unchanged areas remain unchanged");
  assert.equal(inspectSite(day, recordingAt(day, 480), 2).current, null, "A missing forecast and late scan remain unknown at replay end");
  assert.equal(inspectSite(day, recordingAt(day, 510), 2).observed.id, "late-east-scan");
  assert.equal(inspectSite(day, recordingAt(day, 0), 0).observed, null, "Rewind removes confirmed outcomes");
  assert.equal(siteDensity(day, day.snapshots[0], 0), null, "Quantiles do not imply a density family");
  const density = siteDensity(day, updated.snapshot, 1);
  assert.ok(density[1][1] > density[2][1] && density[3][1] > density[2][1], "Supplied multimodal density is preserved");
  const mass = density.slice(1).reduce((sum, p, i) => sum + (p[0] - density[i][0]) * (p[1] + density[i][1]) / 2, 0);
  assert.ok(Math.abs(mass - 1) < 1e-12);
  for (const [edit, expected] of [
    [(r) => { r.sites[1].id = r.sites[0].id; }, /duplicate ID/],
    [(r) => { r.snapshots[0].evidenceIds = ["west-delivery"]; }, /future evidence/],
    [(r) => { r.snapshots[1].availableAt = r.snapshots[0].availableAt; }, /cannot follow/],
    [(r) => { r.snapshots[0].siteValues.west = [100, 50, 150]; }, /ordered/],
    [(r) => { r.timeDomain[0] = "2026-02-30T09:00:00Z"; }, /invalid calendar/],
    [(r) => { r.snapshots[1].syntheticResolved = true; }, /synthetic outcome/],
  ]) {
    const invalid = structuredClone(fixture); edit(invalid); assert.throws(() => parseRecording(invalid), expected);
  }
});

test("the exported Oakland example reloads as a dense, inspectable day with an explicit resolved endpoint", () => {
  const bundled = demoRecording();
  const day = parseRecording(JSON.parse(JSON.stringify(bundled.raw)));
  assert.ok(day.sites.length > 400 && day.vertices.length > 6000);
  assert.equal(day.regions.length, 3);
  assert.equal(day.snapshots.length, 20);
  assert.equal(recordingAt(day, day.end - 0.001).complete, false);
  assert.equal(recordingAt(day, day.end).complete, true);
  assert.ok(recordingAt(day, day.end).values.every((p) => p.lower === p.upper));
  const early = recordingAt(day, day.start);
  assert.equal(early.stage, 0);
  assert.ok(siteDensity(day, early.snapshot, 0).length > 100);
  assert.deepEqual(day.snapshots[5].values, bundled.snapshots[5].values);
});
