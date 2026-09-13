import * as THREE from "three";
import * as d3 from "d3";
import mapData from "./data/oakland.json";
import { createDemo, stageAt, replayBounds } from "./model.js";
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

const { NX, NZ, vertices, predictions, scans, timeMin, timeMax } = createDemo(
  worldCoord,
  { worldW, worldD },
);
const timeY = (t) => 0.4 + (t - timeMin) * 0.66;
const triangles = [];
for (let iz = 0; iz < NZ; iz++)
  for (let ix = 0; ix < NX; ix++) {
    const a = iz * (NX + 1) + ix,
      b = a + 1,
      c = a + NX + 1,
      d = c + 1;
    triangles.push(a, c, b, b, c, d);
  }
const geometries = [];
function surfaceGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices.length * 3), 3),
  );
  g.setIndex(triangles);
  geometries.push(g);
  return g;
}
const baseColor = new THREE.Color(colors["viz-series-1"]);
const medianMaterial = new THREE.MeshStandardMaterial({
  color: baseColor,
  transparent: true,
  opacity: 0.55,
  roughness: 0.88,
  metalness: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const bandMaterial = new THREE.MeshStandardMaterial({
  color: baseColor,
  transparent: true,
  opacity: 0.15,
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
for (let iz = 0; iz <= NZ; iz += 6)
  for (let ix = 0; ix < NX; ix++)
    traceIndices.push(iz * (NX + 1) + ix, iz * (NX + 1) + ix + 1);
for (let ix = 0; ix <= NX; ix += 6)
  for (let iz = 0; iz < NZ; iz++)
    traceIndices.push(iz * (NX + 1) + ix, (iz + 1) * (NX + 1) + ix);
const traceGeometry = new THREE.BufferGeometry();
traceGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(traceIndices.length * 3), 3),
);
const traceMaterial = new THREE.LineBasicMaterial({
  color: baseColor,
  transparent: true,
  opacity: 0.26,
  depthWrite: false,
});
const traces = new THREE.LineSegments(traceGeometry, traceMaterial);
traces.renderOrder = 4;
scene.add(traces);
const boundary = [];
for (let i = 0; i <= NX; i++) boundary.push(i);
for (let i = 1; i <= NZ; i++) boundary.push(i * (NX + 1) + NX);
for (let i = NX - 1; i >= 0; i--) boundary.push(NZ * (NX + 1) + i);
for (let i = NZ - 1; i > 0; i--) boundary.push(i * (NX + 1));
const sideGeometry = new THREE.BufferGeometry();
sideGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(new Float32Array(boundary.length * 18), 3),
);
const sides = new THREE.Mesh(sideGeometry, bandMaterial);
sides.renderOrder = 1;
scene.add(sides);
let current = predictions[0].map((p) => ({ ...p }));
function updateGeometry(values) {
  const q = 1.281551566;
  [lower, median, upper].forEach((mesh, j) => {
    const array = mesh.geometry.attributes.position.array;
    vertices.forEach((p, i) => {
      array[i * 3] = p.x;
      array[i * 3 + 1] = timeY(values[i].mean + (j - 1) * q * values[i].sd);
      array[i * 3 + 2] = p.z;
    });
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  });
  const a = traceGeometry.attributes.position.array;
  traceIndices.forEach((index, i) => {
    a[i * 3] = vertices[index].x;
    a[i * 3 + 1] = timeY(values[index].mean) + 0.008;
    a[i * 3 + 2] = vertices[index].z;
  });
  traceGeometry.attributes.position.needsUpdate = true;
  traceGeometry.computeBoundingSphere();
  const edge = sideGeometry.attributes.position.array;
  boundary.forEach((index, i) => {
    const next = boundary[(i + 1) % boundary.length],
      p = vertices[index],
      r = vertices[next];
    const lo = [p.x, timeY(values[index].mean - q * values[index].sd), p.z],
      hi = [p.x, timeY(values[index].mean + q * values[index].sd), p.z];
    const lo2 = [r.x, timeY(values[next].mean - q * values[next].sd), r.z],
      hi2 = [r.x, timeY(values[next].mean + q * values[next].sd), r.z];
    edge.set([...lo, ...hi, ...lo2, ...lo2, ...hi, ...hi2], i * 18);
  });
  sideGeometry.attributes.position.needsUpdate = true;
  sideGeometry.computeVertexNormals();
  sideGeometry.computeBoundingSphere();
}
updateGeometry(current);

const observationMaterial = new THREE.MeshBasicMaterial({
  color: colors.foreground,
});
const observationMarks = scans.map((p) => {
  const mark = new THREE.Mesh(
    new THREE.SphereGeometry(0.072, 12, 8),
    observationMaterial,
  );
  mark.position.set(p.x, timeY(p.time), p.z);
  mark.visible = false;
  mark.renderOrder = 6;
  scene.add(mark);
  return mark;
});
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
const { start: startMinutes, end: endMinutes } = replayBounds(scans);
evidence.min = startMinutes;
evidence.max = endMinutes;
evidence.value = startMinutes;
root.querySelector("#terrain-start").textContent = clock(startMinutes / 60);
root.querySelector("#terrain-end").textContent = clock(endMinutes / 60);
const playButton = root.querySelector("#terrain-play");
let activeStage = 0,
  playing = false,
  playFrame = 0,
  playStarted = 0,
  playFrom = startMinutes;
function syncReplay() {
  const minutes = Number(evidence.value),
    stage = stageAt(scans, minutes);
  root.querySelector("#terrain-clock").textContent = clock(minutes / 60);
  evidence.setAttribute(
    "aria-valuetext",
    `${clock(minutes / 60)}. ${stage} local observations available.`,
  );
  if (stage === activeStage) return;
  activeStage = stage;
  const target = predictions[stage],
    from = current.map((p) => ({ ...p }));
  root.querySelector("#terrain-state").textContent = stage
    ? `${stage} observations · latest ${clock(scans[stage - 1].time)}`
    : "Prior distribution";
  const avg = d3.mean(target, (p) => 2 * 1.281551566 * p.sd * 60);
  root.querySelector("#terrain-accessible").textContent =
    `${stage} local observations. Average central 80 percent interval: ${Math.round(avg)} minutes. Nearby areas may retain different times and uncertainty.`;
  observationMarks.forEach((mark, i) => (mark.visible = i < stage));
  cancelAnimationFrame(animation);
  const start = performance.now(),
    duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 650;
  function frame(now) {
    const t = duration ? Math.min(1, (now - start) / duration) : 1,
      e = 1 - (1 - t) ** 3;
    current = from.map((p, i) => ({
      mean: p.mean + (target[i].mean - p.mean) * e,
      sd: p.sd + (target[i].sd - p.sd) * e,
    }));
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
      Math.floor(playFrom + ((now - playStarted) / 1000) * 18),
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
  medianMaterial.color.set(colors["viz-series-1"]);
  bandMaterial.color.set(colors["viz-series-1"]);
  traceMaterial.color.set(colors["viz-series-1"]);
  axisMaterial.color.set(colors.foreground);
  observationMaterial.color.set(colors.foreground);
  render();
}
new MutationObserver(updateTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["class", "style", "data-theme"],
});
window
  .matchMedia("(prefers-color-scheme: dark)")
  .addEventListener("change", updateTheme);
