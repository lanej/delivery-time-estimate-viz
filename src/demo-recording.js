import { geoCentroid } from "d3";
import map from "./data/oakland.json" with { type: "json" };
import { createDemo } from "./model.js";
import { createProjection, OAKLAND_BOUNDS, WORLD } from "./geography.js";
import { parseRecording } from "./recording.js";

let cached;
export function demoRecording() {
  if (cached) return cached;
  const projection = createProjection(OAKLAND_BOUNDS);
  const locations = map.features.filter((feature) => feature.properties.kind === "building")
    .map((feature, i) => {
      const coordinates = geoCentroid(feature), p = projection.project(...coordinates);
      return { ...p, coordinates, id: `building-${i + 1}`, label: feature.properties.name || `Building ${i + 1}` };
    }).filter((p) => Math.abs(p.x) < WORLD.width * 0.42 && Math.abs(p.z) < WORLD.depth * 0.41);
  const demo = createDemo({ sites: locations });
  const areaIds = ["west", "central", "east"];
  const origin = Date.parse("2026-09-13T09:00:00-07:00");
  const iso = (minute) => new Date(origin + minute * 60000).toISOString();
  const timeDomain = [iso(0), iso(480)];
  const quantiles = (p) => [p.lower, p.median, p.upper].map((hour) => Number(((hour - 9) * 60).toFixed(7)));
  const inspections = locations.map((p) => demo.inspect(p));
  const scans = demo.scans.map((scan, i) => {
    const site = locations.find((p) => p.x === scan.x && p.z === scan.z);
    if (!site) throw new Error("Synthetic delivery does not match a selectable building");
    return { id: `delivery-${i + 1}`, siteId: site.id, eventAt: iso(scan.availableMinutes - 540), availableAt: iso(scan.availableMinutes - 540) };
  });
  const snapshots = demo.predictions.map((values, i) => ({
    id: `forecast-${i}`, asOf: i ? scans[i - 1].availableAt : iso(0),
    availableAt: i ? scans[i - 1].availableAt : iso(0), modelVersion: "synthetic-spatial-gp-v1",
    evidenceIds: scans.slice(0, i).map((scan) => scan.id), gridValues: values.map(quantiles),
    siteValues: Object.fromEntries(locations.map((site, j) => [site.id, quantiles(inspections[j].predictions[i])])),
  }));
  snapshots.push({
    id: "synthetic-outcomes", asOf: iso(480), availableAt: iso(480), modelVersion: "synthetic-outcome-field-v1",
    evidenceIds: scans.map((scan) => scan.id), syntheticResolved: true,
    gridValues: demo.completion.values.map(quantiles),
    siteValues: Object.fromEntries(locations.map((site, j) => [site.id, quantiles(inspections[j].outcome)])),
  });
  const raw = {
    version: 1, id: "oakland-synthetic", label: "Oakland · synthetic delivery day", synthetic: true,
    timeZone: "America/Los_Angeles", timeDomain, replay: timeDomain,
    bounds: OAKLAND_BOUNDS, map, mapAttribution: "© OpenStreetMap contributors · ODbL",
    distributionFamily: "logit-normal",
    areas: demo.regions.map((region, i) => ({ id: areaIds[i], name: region.name, serviceWindow: timeDomain })),
    grid: { columns: demo.NX + 1, rows: demo.NZ + 1,
      points: demo.vertices.map((p) => ({ coordinates: projection.unproject(p.x, p.z), areaId: areaIds[p.region] })) },
    sites: locations.map((site, i) => ({ id: site.id, label: site.label, coordinates: site.coordinates, areaId: areaIds[inspections[i].region] })),
    observations: scans, snapshots,
  };
  cached = parseRecording(raw);
  return cached;
}
