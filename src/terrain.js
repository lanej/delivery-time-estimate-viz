import * as THREE from "three";
import { scaleLinear } from "d3";

/** One fixed time encoding shared by surfaces, pins, ticks, and the height axis. */
export function createTimeEncoding(timeMin, timeMax) {
  const timeScale = scaleLinear()
    .domain([timeMin, (timeMin + timeMax) / 2, timeMax])
    .range(["#2563eb", "#995ac7", "#e3343f"])
    .clamp(true);
  const palette = Array.from({ length: 257 }, (_, i) =>
    new THREE.Color(timeScale(timeMin + (timeMax - timeMin) * i / 256)));
  return {
    timeScale,
    timeColor: (hour) => palette[Math.round(THREE.MathUtils.clamp(
      (hour - timeMin) / (timeMax - timeMin) * 256, 0, 256))],
    timeY: (hour) => 0.4 + (hour - timeMin) / (timeMax - timeMin) * 5.28,
  };
}

/** Render grid-aligned quantile snapshots without knowing how they were inferred. */
export function createTerrain({ NX, NZ, vertices, timeMin, timeMax }, { timeY, timeColor }) {
  const group = new THREE.Group();
  group.name = "probability-terrain";
  const triangles = [];
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const a = iz * (NX + 1) + ix, b = a + 1, c = a + NX + 1, d = c + 1;
      for (const face of [[a, c, b], [b, c, d]]) {
        if (vertices[face[0]].region !== null && face.every((i) => vertices[i].region === vertices[face[0]].region))
          triangles.push(...face);
      }
    }
  }

  // All replay heights remain inside this fixed volume, so culling bounds do not
  // need recalculating during each animation frame. Include the trace offset.
  const bounds = new THREE.Box3();
  for (const p of vertices) {
    bounds.expandByPoint(new THREE.Vector3(p.x, timeY(timeMin), p.z));
    bounds.expandByPoint(new THREE.Vector3(p.x, timeY(timeMax) + 0.008, p.z));
  }
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  function geometryFor(sources, indexed = false) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(sources.length * 3);
    sources.forEach(([id], i) => {
      positions[i * 3] = vertices[id].x;
      positions[i * 3 + 2] = vertices[id].z;
    });
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage));
    if (indexed) geometry.setIndex(triangles);
    geometry.boundingSphere = sphere.clone();
    return geometry;
  }
  const medianMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.65,
    roughness: 0.88, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  const bandMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.16,
    roughness: 1, metalness: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  const surfaces = ["lower", "median", "upper"].map((key, i) => {
    const sources = vertices.map((_, id) => [id, key]);
    const mesh = new THREE.Mesh(geometryFor(sources, true), key === "median" ? medianMaterial : bandMaterial);
    mesh.name = key;
    mesh.renderOrder = i + 1;
    group.add(mesh);
    return { mesh, sources };
  });

  // Fine traces expose curvature during orbit; never connect independent areas.
  const traceSources = [];
  function addTrace(a, b) {
    if (vertices[a].region !== null && vertices[a].region === vertices[b].region)
      traceSources.push([a, "median"], [b, "median"]);
  }
  for (let iz = 0; iz <= NZ; iz += 6)
    for (let ix = 0; ix < NX; ix++)
      addTrace(iz * (NX + 1) + ix, iz * (NX + 1) + ix + 1);
  for (let ix = 0; ix <= NX; ix += 6)
    for (let iz = 0; iz < NZ; iz++)
      addTrace(iz * (NX + 1) + ix, (iz + 1) * (NX + 1) + ix);
  const traceMaterial = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.26, depthWrite: false,
  });
  const traces = new THREE.LineSegments(geometryFor(traceSources), traceMaterial);
  traces.name = "traces";
  traces.renderOrder = 4;
  group.add(traces);

  // Only boundary edges occur once. Close each area's uncertainty volume using
  // those edges, including its side of the shared regional boundary.
  const edges = new Map();
  for (let i = 0; i < triangles.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      const a = triangles[i + j], b = triangles[i + (j + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (edges.has(key)) edges.delete(key);
      else edges.set(key, [a, b]);
    }
  }
  const sideSources = [...edges.values()].flatMap(([a, b]) => [
    [a, "lower"], [a, "upper"], [b, "lower"],
    [b, "lower"], [a, "upper"], [b, "upper"],
  ]);
  const sides = new THREE.Mesh(geometryFor(sideSources), bandMaterial);
  sides.name = "sides";
  sides.renderOrder = 1;
  group.add(sides);

  function updatePart(mesh, sources, values, offset = 0) {
    const { position, color } = mesh.geometry.attributes;
    sources.forEach(([id, key], i) => {
      const hour = values[id][key];
      position.array[i * 3 + 1] = timeY(hour) + offset;
      timeColor(hour).toArray(color.array, i * 3);
    });
    position.needsUpdate = color.needsUpdate = true;
    if (mesh.isMesh) mesh.geometry.computeVertexNormals();
  }

  function update(values) {
    const hasRange = values.some((p) => p.upper - p.lower > 1e-8);
    for (const { mesh, sources } of surfaces) {
      mesh.visible = mesh.name === "median" || hasRange;
      if (mesh.visible) updatePart(mesh, sources, values);
    }
    sides.visible = hasRange;
    if (hasRange) updatePart(sides, sideSources, values);
    updatePart(traces, traceSources, values, 0.008);
  }

  return { group, update };
}
