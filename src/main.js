import * as THREE from "three";
import * as d3 from "d3";
import mapData from "./data/oakland.json";
import { createDemo, stageAt, replayBounds, replayAt } from "./model.js";
import "./styles.css";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const root = document.getElementById("delivery-probability-terrain");
const canvas = root.querySelector("#terrain-canvas");
const view = root.querySelector("#terrain-view");
const labelLayer = root.querySelector("#terrain-labels");
const evidence = root.querySelector("#terrain-evidence");
const colors = {},
  colorProbe = document.createElement("span");
colorProbe.style.display = "none";
root.appendChild(colorProbe);
const colorCanvas = document.createElement("canvas");
colorCanvas.width = 1;
colorCanvas.height = 1;
const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
function readColors() {
  for (const key of [
    "background",
    "foreground",
    "border",
    "muted",
    "blue",
    "viz-series-1",
  ]) {
    colorProbe.style.color = `var(--${key})`;
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = getComputedStyle(colorProbe).color;
    colorContext.fillRect(0, 0, 1, 1);
    const rgba = colorContext.getImageData(0, 0, 1, 1).data;
    colors[key] = `rgb(${rgba[0]},${rgba[1]},${rgba[2]})`;
  }
}
readColors();
const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;
controls.enablePan = false;
controls.minDistance = 11;
controls.maxDistance = 48;
controls.minPolarAngle = 0.1;
controls.maxPolarAngle = Math.PI * 0.47;
controls.target.set(0, 2.1, 0);
const ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, 2.0);
scene.add(ambient);
const light = new THREE.DirectionalLight(0xffffff, 2.2);
light.position.set(-5, 12, 8);
scene.add(light);

// Mercator projection of sourced OSM geometry. World units here are visual scale.
const texW = 2048,
  texH = 1536,
  worldW = 12.4,
  worldD = 9.3;
const geo = d3.geoMercator().fitExtent(
  [
    [24, 24],
    [texW - 24, texH - 24],
  ],
  {
    type: "MultiPoint",
    coordinates: [
      [-122.2763, 37.8011],
      [-122.2622, 37.8104],
    ],
  },
);
const mapCanvas = document.createElement("canvas");
mapCanvas.width = texW;
mapCanvas.height = texH;
const ctx = mapCanvas.getContext("2d");
const mapTexture = new THREE.CanvasTexture(mapCanvas);
mapTexture.colorSpace = THREE.SRGBColorSpace;
mapTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const mapMaterial = new THREE.MeshBasicMaterial({
  map: mapTexture,
  side: THREE.DoubleSide,
});
const mapPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(worldW, worldD),
  mapMaterial,
);
mapPlane.rotation.x = -Math.PI / 2;
mapPlane.position.y = -0.018;
scene.add(mapPlane);
function worldCoord(lng, lat) {
  const p = geo([lng, lat]);
  return [(p[0] / texW - 0.5) * worldW, (p[1] / texH - 0.5) * worldD];
}
function drawMap() {
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, texW, texH);
  const path = d3.geoPath(geo, ctx);
  for (const f of mapData.features) {
    const kind = f.properties.kind;
    if (kind === "road") continue;
    ctx.beginPath();
    path(f);
    ctx.fillStyle = kind === "water" ? colors.blue : colors.border;
    ctx.globalAlpha = kind === "water" ? 0.2 : 0.85;
    ctx.fill();
  }
  for (const f of mapData.features) {
    if (f.properties.kind !== "road") continue;
    ctx.beginPath();
    path(f);
    ctx.strokeStyle = colors.foreground;
    ctx.globalAlpha = ["service", "pedestrian"].includes(f.properties.type)
      ? 0.16
      : 0.45;
    ctx.lineWidth = ["primary", "secondary"].includes(f.properties.type)
      ? 5
      : 2;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  mapTexture.needsUpdate = true;
}
drawMap();

const sites = mapData.features
  .filter((feature) => feature.properties.kind === "building")
  .map((feature) => {
    const [x, z] = worldCoord(...d3.geoCentroid(feature));
    return { x, z };
  });
const demo = createDemo({ worldW, worldD, sites });
const { NX, NZ, vertices, predictions, scans, regions, timeMin, timeMax } = demo;
// Height and color use the same fixed scale, even while uncertainty collapses.
const timeScale = d3.scaleLinear().domain([9, 13, 17])
  .range(["#2563eb", "#995ac7", "#e3343f"]).clamp(true);
const palette = Array.from({ length: 257 }, (_, i) => new THREE.Color(timeScale(9 + i / 32)));
const timeColor = (hour) => palette[Math.round(THREE.MathUtils.clamp((hour - 9) * 32, 0, 256))];
const timeY = (t) => 0.4 + (t - timeMin) * 0.66;
const triangles = [];
for (let iz = 0; iz < NZ; iz++)
  for (let ix = 0; ix < NX; ix++) {
    const a = iz * (NX + 1) + ix,
      b = a + 1,
      c = a + NX + 1,
      d = c + 1;
    for (const face of [[a, c, b], [b, c, d]]) {
      if (face.every((i) => vertices[i].region === vertices[face[0]].region))
        triangles.push(...face);
    }
  }
const geometries = [];
function surfaceGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices.length * 3), 3),
  );
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vertices.length * 3), 3));
  g.setIndex(triangles);
  geometries.push(g);
  return g;
}
const baseColor = new THREE.Color(0xffffff);
const medianMaterial = new THREE.MeshStandardMaterial({
  color: baseColor,
  vertexColors: true,
  transparent: true,
  opacity: 0.65,
  roughness: 0.88,
  metalness: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const bandMaterial = new THREE.MeshStandardMaterial({
  color: baseColor,
  vertexColors: true,
  transparent: true,
  opacity: 0.16,
  roughness: 1,
  metalness: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const lower = new THREE.Mesh(surfaceGeometry(), bandMaterial);
lower.renderOrder = 1;
scene.add(lower);
const median = new THREE.Mesh(surfaceGeometry(), medianMaterial);
median.renderOrder = 2;
scene.add(median);
const upper = new THREE.Mesh(surfaceGeometry(), bandMaterial);
upper.renderOrder = 3;
scene.add(upper);

// Fine mesh traces make curvature and the abrupt boundaries legible during orbit.
const traceIndices = [];
function addTrace(a, b) {
  if (vertices[a].region === vertices[b].region) traceIndices.push(a, b);
}
for (let iz = 0; iz <= NZ; iz += 6)
  for (let ix = 0; ix < NX; ix++)
    addTrace(iz * (NX + 1) + ix, iz * (NX + 1) + ix + 1);
for (let ix = 0; ix <= NX; ix += 6)
  for (let iz = 0; iz < NZ; iz++)
    addTrace(iz * (NX + 1) + ix, (iz + 1) * (NX + 1) + ix);
const traceGeometry = new THREE.BufferGeometry();
traceGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(traceIndices.length * 3), 3),
);
traceGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(traceIndices.length * 3), 3));
const traceMaterial = new THREE.LineBasicMaterial({
  vertexColors: true,
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
});
const traces = new THREE.LineSegments(traceGeometry, traceMaterial);
traces.renderOrder = 4;
scene.add(traces);
// Close each area's uncertainty volume separately, including the shared edges.
// The mesh never interpolates predictions across independent delivery areas.
const edges = new Map();
for (let i = 0; i < triangles.length; i += 3) {
  const face = triangles.slice(i, i + 3);
  for (let j = 0; j < 3; j++) {
    const a = face[j], b = face[(j + 1) % 3];
    const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
    if (edges.has(key)) edges.delete(key);
    else edges.set(key, [a, b]);
  }
}
const boundary = [...edges.values()];
const sideGeometry = new THREE.BufferGeometry();
sideGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(boundary.length * 18), 3),
);
sideGeometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(boundary.length * 18), 3));
const sides = new THREE.Mesh(sideGeometry, bandMaterial);
sides.renderOrder = 1;
scene.add(sides);
let current = predictions[0].map((p) => ({ ...p }));
function updateGeometry(values) {
  // At completion, render only the final surface. Coincident translucent bounds
  // would otherwise darken the terrain and leave a false impression of a band.
  const hasRange = values.some((p) => p.upper - p.lower > 1e-8);
  lower.visible = upper.visible = sides.visible = hasRange;
  [lower, median, upper].forEach((mesh, j) => {
    const key = ["lower", "median", "upper"][j];
    const array = mesh.geometry.attributes.position.array;
    const color = mesh.geometry.attributes.color.array;
    vertices.forEach((p, i) => {
      const hour = values[i][key];
      array[i * 3] = p.x;
      array[i * 3 + 1] = timeY(hour);
      array[i * 3 + 2] = p.z;
      timeColor(hour).toArray(color, i * 3);
    });
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.color.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  });
  const a = traceGeometry.attributes.position.array;
  const traceColors = traceGeometry.attributes.color.array;
  traceIndices.forEach((index, i) => {
    a[i * 3] = vertices[index].x;
    a[i * 3 + 1] = timeY(values[index].median) + 0.008;
    a[i * 3 + 2] = vertices[index].z;
    timeColor(values[index].median).toArray(traceColors, i * 3);
  });
  traceGeometry.attributes.position.needsUpdate = true;
  traceGeometry.attributes.color.needsUpdate = true;
  traceGeometry.computeBoundingSphere();
  const edge = sideGeometry.attributes.position.array;
  const edgeColors = sideGeometry.attributes.color.array;
  boundary.forEach(([index, next], i) => {
    [[index, "lower"], [index, "upper"], [next, "lower"],
      [next, "lower"], [index, "upper"], [next, "upper"]].forEach(([id, key], j) => {
      const p = vertices[id], hour = values[id][key], offset = i * 18 + j * 3;
      edge.set([p.x, timeY(hour), p.z], offset);
      timeColor(hour).toArray(edgeColors, offset);
    });
  });
  sideGeometry.attributes.position.needsUpdate = true;
  sideGeometry.attributes.color.needsUpdate = true;
  sideGeometry.computeVertexNormals();
  sideGeometry.computeBoundingSphere();
}
updateGeometry(current);

const observationOutline = new THREE.MeshBasicMaterial({
  color: colors.foreground, side: THREE.BackSide, transparent: true, depthTest: false, depthWrite: false,
});
const observationMarks = scans.map((p) => {
  const group = new THREE.Group();
  // Share the transparent render pass so pins draw after the probability band.
  const material = new THREE.MeshBasicMaterial({ color: timeColor(p.time), transparent: true, depthTest: false, depthWrite: false });
  const mark = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 8), material);
  const outline = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 8), observationOutline);
  mark.position.set(p.x, timeY(p.time), p.z);
  outline.position.copy(mark.position);
  outline.renderOrder = 7;
  mark.renderOrder = 8;
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(p.x, 0.025, p.z), mark.position.clone(),
  ]), new THREE.LineBasicMaterial({ color: timeColor(p.time), transparent: true, opacity: 0.65, depthWrite: false }));
  const foot = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.105, 20), material);
  foot.rotation.x = -Math.PI / 2;
  foot.position.set(p.x, 0.025, p.z);
  foot.renderOrder = 8;
  group.add(outline, mark, stem, foot);
  group.visible = false;
  scene.add(group);
  return group;
});
const pulseMaterial = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
});
const pulse = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.23, 40), pulseMaterial);
pulse.rotation.x = -Math.PI / 2;
pulse.renderOrder = 9;
scene.add(pulse);
const labels = [];
function addLabel(text, position, kind) {
  const element = document.createElement("span");
  element.className = `world-label ${kind}`;
  element.textContent = text;
  labelLayer.appendChild(element);
  const label = { element, position: new THREE.Vector3(...position), kind };
  labels.push(label);
  return label;
}
for (const region of regions) {
  addLabel(`${region.name} region`, [region.center * worldW / 2, 0.08, -worldD * 0.43], "region-label");
}
const roadNames = [
  "Broadway",
  "Telegraph Avenue",
  "Franklin Street",
  "14th Street",
  "19th Street",
  "Clay Street",
  "Alice Street",
];
for (const name of roadNames) {
  const candidates = mapData.features
    .filter((f) => f.properties.kind === "road" && f.properties.name === name)
    .map((f) => {
      const coords = f.geometry.coordinates,
        points = coords.map((p) => worldCoord(...p));
      const a = points[0],
        b = points[points.length - 1];
      return {
        x: (a[0] + b[0]) / 2,
        z: (a[1] + b[1]) / 2,
        length: d3.sum(
          points
            .slice(1)
            .map((p, i) =>
              Math.hypot(p[0] - points[i][0], p[1] - points[i][1]),
            ),
        ),
      };
    })
    .filter(
      (p) => Math.abs(p.x) < worldW * 0.45 && Math.abs(p.z) < worldD * 0.44,
    )
    .sort((a, b) => b.length - a.length);
  if (candidates[0]) {
    const p = candidates[0];
    addLabel(
      name.replace("Street", "St").replace("Avenue", "Ave"),
      [p.x, 0.03, p.z],
      "map-label",
    );
  }
}
const axisX = -worldW / 2 - 0.18,
  axisZ = worldD / 2 + 0.12;
const axisPositions = [axisX, 0, axisZ, axisX, timeY(timeMax), axisZ];
for (let t = timeMin; t <= timeMax; t += 2)
  axisPositions.push(
    axisX - 0.09,
    timeY(t),
    axisZ,
    axisX + 0.09,
    timeY(t),
    axisZ,
  );
const axisGeometry = new THREE.BufferGeometry();
axisGeometry.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(axisPositions, 3),
);
const axisMaterial = new THREE.LineBasicMaterial({
  color: colors.foreground,
  transparent: true,
  opacity: 0.5,
});
scene.add(new THREE.LineSegments(axisGeometry, axisMaterial));
for (let t = timeMin; t <= timeMax; t += 2)
  addLabel(
    `${t % 12 || 12} ${t < 12 ? "AM" : "PM"}`,
    [axisX - 0.42, timeY(t), axisZ],
    "time-label",
  );
addLabel(
  "Delivery time",
  [axisX - 0.1, timeY(timeMax) + 0.4, axisZ],
  "axis-label",
);
addLabel("N", [0, 0.02, -worldD / 2 + 0.12], "north-label");
let width = 0,
  height = 0,
  initialized = false,
  animation = 0;
const projectPoint = new THREE.Vector3();
function layoutLabels() {
  const occupied = [];
  for (const label of [
    ...labels.filter((l) => l.kind !== "map-label"),
    ...labels.filter((l) => l.kind === "map-label"),
  ]) {
    projectPoint.copy(label.position).project(camera);
    const x = (projectPoint.x * 0.5 + 0.5) * width,
      y = (-projectPoint.y * 0.5 + 0.5) * height;
    const el = label.element;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.display = "block";
    const rw = el.offsetWidth,
      rh = el.offsetHeight;
    const box = { x: x - rw / 2, y: y - rh / 2, w: rw, h: rh };
    const collision = occupied.some(
      (b) =>
        box.x < b.x + b.w + 5 &&
        box.x + box.w > b.x - 5 &&
        box.y < b.y + b.h + 5 &&
        box.y + box.h > b.y - 5,
    );
    if (
      projectPoint.z > 1 ||
      projectPoint.z < -1 ||
      box.x < 4 ||
      box.x + box.w > width - 4 ||
      box.y < 4 ||
      box.y + box.h > height - 4 ||
      collision
    ) {
      el.style.display = "none";
      continue;
    }
    occupied.push(box);
  }
}
function render() {
  renderer.render(scene, camera);
  layoutLabels();
}
function resize() {
  width = view.clientWidth;
  height = Math.round(Math.min(530, width * 0.6 + 230));
  view.style.height = `${height}px`;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  if (!initialized) {
    const distance = width < 450 ? 31 : 21;
    camera.position.copy(
      new THREE.Vector3(1, 1.05, 1.2)
        .normalize()
        .multiplyScalar(distance)
        .add(controls.target),
    );
    controls.update();
    initialized = true;
  }
  render();
}
controls.addEventListener("change", render);
new ResizeObserver(resize).observe(view);
resize();
const clock = (t) => {
  const m = Math.round(t * 60),
    h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const { start: startMinutes, end: endMinutes } = replayBounds();
evidence.min = startMinutes;
evidence.max = endMinutes;
evidence.value = startMinutes;
root.querySelector("#terrain-start").textContent = clock(startMinutes / 60);
root.querySelector("#terrain-end").textContent = clock(endMinutes / 60);
const playButton = root.querySelector("#terrain-play");
const nextButton = root.querySelector("#terrain-next");
const eventTicks = scans.map((scan) => {
  const tick = document.createElement("span");
  tick.className = "event-tick";
  tick.style.left = `${(scan.time * 60 - startMinutes) / (endMinutes - startMinutes) * 100}%`;
  tick.style.background = timeScale(scan.time);
  root.querySelector("#terrain-events").appendChild(tick);
  return tick;
});
const regionSummaries = regions.map((region, r) => {
  const card = document.createElement("div");
  card.className = "region-summary";
  card.innerHTML = `<strong>${region.name} region</strong><span class="text-small text-muted">Independent 9 AM–5 PM area</span><span class="region-delivered text-small"></span>
    <span class="region-window tabular-nums"></span><span class="text-small text-muted">Average 80% window · <span class="region-prior"></span> at 9 AM</span>`;
  root.querySelector("#terrain-regions").appendChild(card);
  const indices = vertices.flatMap((p, i) => p.region === r ? [i] : []);
  const windowMinutes = (values) => Math.round(d3.mean(indices, (i) => (values[i].upper - values[i].lower) * 60));
  card.querySelector(".region-prior").textContent = `${windowMinutes(predictions[0])} min`;
  return { card, windowMinutes };
});
let activeStage = -1,
  activeComplete = false,
  playing = false,
  playFrame = 0,
  playStarted = 0,
  playFrom = startMinutes;
function syncReplay() {
  const minutes = Number(evidence.value);
  const { stage, complete, values: target } = replayAt(demo, minutes);
  root.querySelector("#terrain-clock").textContent = clock(minutes / 60);
  evidence.setAttribute("aria-valuetext", complete
    ? `${clock(minutes / 60)}. Day complete. No remaining uncertainty.`
    : `${clock(minutes / 60)}. ${stage} deliveries observed.`);
  nextButton.disabled = complete;
  nextButton.textContent = complete ? "Day complete" : stage === scans.length ? "Finish day" : "Next delivery";
  if (stage === activeStage && complete === activeComplete) return;
  const forward = stage > activeStage && stage > 0;
  activeStage = stage;
  activeComplete = complete;
  const from = current.map((p) => ({ ...p }));
  root.querySelector("#terrain-state").textContent = complete
    ? "Day complete · final delivery surface"
    : stage
    ? `${stage} deliveries · latest ${regions[scans[stage - 1].region].name}, ${clock(scans[stage - 1].time)}`
    : "No deliveries yet · broad ranges";
  const avg = d3.mean(target, (p) => (p.upper - p.lower) * 60);
  root.querySelector("#terrain-accessible").textContent = complete
    ? "Day complete. All delivery times are resolved. A single textured surface remains, with zero uncertainty in every area."
    : `${stage} deliveries observed. Average central 80 percent window: ${Math.round(avg)} minutes. Blue is earlier, red is later. Neighboring ranges narrow within the same delivery area; other areas remain unchanged.`;
  root.querySelector("#terrain-surface-key").textContent = complete
    ? "Surface = final delivery times · no remaining range"
    : "Surface = median · thickness = central 80% range";
  regionSummaries.forEach(({ card, windowMinutes }, r) => {
    card.querySelector(".region-window").textContent = `${windowMinutes(target)} min`;
    card.querySelector(".region-delivered").textContent = complete
      ? "All deliveries resolved"
      : `${scans.slice(0, stage).filter((p) => p.region === r).length} deliveries observed`;
  });
  observationMarks.forEach((mark, i) => (mark.visible = i < stage));
  eventTicks.forEach((tick, i) => tick.classList.toggle("observed", i < stage));
  cancelAnimationFrame(animation);
  pulseMaterial.opacity = 0;
  if (forward) {
    const latest = scans[stage - 1];
    pulse.position.set(latest.x, 0.035, latest.z);
    pulseMaterial.color.copy(timeColor(latest.time));
  }
  // Delivery points appear first, followed by the local interval transition.
  render();
  const start = performance.now();
  const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
  function frame(now) {
    const t = duration ? Math.min(1, (now - start) / duration) : 1;
    const e = 1 - (1 - t) ** 3;
    current = t === 1 ? target : from.map((p, i) => ({
      median: p.median + (target[i].median - p.median) * e,
      lower: p.lower + (target[i].lower - p.lower) * e,
      upper: p.upper + (target[i].upper - p.upper) * e,
    }));
    pulse.scale.setScalar(1 + t * 7);
    pulseMaterial.opacity = forward && duration ? 0.7 * (1 - t) : 0;
    updateGeometry(current);
    render();
    if (t < 1) animation = requestAnimationFrame(frame);
  }
  animation = requestAnimationFrame(frame);
}
function stopPlayback() {
  playing = false;
  cancelAnimationFrame(playFrame);
  playButton.textContent = "Play";
  playButton.setAttribute("aria-label", "Play delivery observations over time");
}
evidence.addEventListener("input", () => {
  stopPlayback();
  syncReplay();
});
nextButton.addEventListener("click", () => {
  stopPlayback();
  const next = scans[stageAt(scans, Number(evidence.value))];
  evidence.value = next ? Math.round(next.time * 60) : endMinutes;
  syncReplay();
});
playButton.addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    return;
  }
  if (Number(evidence.value) >= endMinutes) {
    evidence.value = startMinutes;
    syncReplay();
  }
  playing = true;
  playButton.textContent = "Pause";
  playButton.setAttribute("aria-label", "Pause delivery observations");
  playStarted = performance.now();
  playFrom = Number(evidence.value);
  function advance(now) {
    const minute = Math.min(
      endMinutes,
      Math.floor(playFrom + ((now - playStarted) / 1000) * 12),
    );
    evidence.value = minute;
    syncReplay();
    if (minute >= endMinutes) {
      stopPlayback();
      return;
    }
    playFrame = requestAnimationFrame(advance);
  }
  playFrame = requestAnimationFrame(advance);
});
syncReplay();
function moveCamera(theta = 0, phi = 0, scale = 1) {
  const spherical = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(controls.target),
  );
  spherical.theta += theta;
  spherical.phi = THREE.MathUtils.clamp(
    spherical.phi + phi,
    controls.minPolarAngle,
    controls.maxPolarAngle,
  );
  spherical.radius = THREE.MathUtils.clamp(
    spherical.radius * scale,
    controls.minDistance,
    controls.maxDistance,
  );
  camera.position.setFromSpherical(spherical).add(controls.target);
  controls.update();
  render();
}
root
  .querySelector("#terrain-rotate")
  .addEventListener("click", () => moveCamera(Math.PI / 6));
root.querySelector("#terrain-tilt").addEventListener("click", () => {
  const s = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(controls.target),
  );
  moveCamera(0, s.phi > 0.65 ? -0.35 : 0.65);
});
root
  .querySelector("#terrain-in")
  .addEventListener("click", () => moveCamera(0, 0, 0.82));
root
  .querySelector("#terrain-out")
  .addEventListener("click", () => moveCamera(0, 0, 1.22));
function updateTheme() {
  readColors();
  drawMap();
  axisMaterial.color.set(colors.foreground);
  observationOutline.color.set(colors.foreground);
  render();
}
new MutationObserver(updateTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "style", "data-theme"],
});
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", updateTheme);
