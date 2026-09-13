import test from "node:test";
import assert from "node:assert/strict";
import { createDemo } from "../src/model.js";
import { createTerrain, createTimeEncoding } from "../src/terrain.js";

test("rendered terrain preserves boundaries, resolves to one surface, and restores its band on rewind", () => {
  const demo = createDemo();
  const encoding = createTimeEncoding(demo.timeMin, demo.timeMax);
  const { group, update } = createTerrain(demo, encoding);
  const median = group.getObjectByName("median");
  const band = ["lower", "upper", "sides"].map((name) => group.getObjectByName(name));
  const indices = median.geometry.index.array;
  assert.ok(indices.length > 30000, "The rendered surface remains dense");
  for (let i = 0; i < indices.length; i += 3) {
    const regions = Array.from(indices.slice(i, i + 3), (id) => demo.vertices[id].region);
    assert.ok(regions.every((region) => region === regions[0]), "No triangle bridges independent areas");
  }
  update(demo.predictions[0]);
  assert.ok(band.every((mesh) => mesh.visible));
  update(demo.completion.values);
  assert.ok(median.visible && band.every((mesh) => !mesh.visible),
    "Coincident transparent bounds must disappear at completion");
  const positions = median.geometry.attributes.position.array;
  demo.completion.values.forEach((p, i) => {
    assert.ok(Math.abs(positions[i * 3 + 1] - encoding.timeY(p.median)) < 1e-6);
    assert.ok(Math.abs(positions[i * 3] - demo.vertices[i].x) < 1e-6);
    assert.ok(Math.abs(positions[i * 3 + 2] - demo.vertices[i].z) < 1e-6);
  });
  update(demo.predictions[0]);
  assert.ok(band.every((mesh) => mesh.visible), "Rewind restores the uncertainty volume");
  const lower = band[0].geometry.attributes.position.array;
  const upper = band[1].geometry.attributes.position.array;
  demo.vertices.forEach((_, i) => assert.ok(lower[i * 3 + 1] < upper[i * 3 + 1]));
});
