import * as THREE from "three";
import * as d3 from "d3";
import mapData from "./data/oakland.json";
import { createDemo, stageAt, replayBounds, replayAt, observationMinutes } from "./model.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createTerrain, createTimeEncoding } from "./terrain.js";

/** Mount the demo UI; the caller owns the renderer and receives a teardown hook. */
export function mountApp(root, renderer) {
  const eventListeners = new AbortController();
  const listen = (target, event, listener) =>
    target.addEventListener(event, listener, { signal: eventListeners.signal });
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
      "blue",
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
  const { vertices, predictions, scans, regions, timeMin, timeMax } = demo;
  const encoding = createTimeEncoding(timeMin, timeMax);
  const { timeScale, timeColor, timeY } = encoding;
  const terrain = createTerrain(demo, encoding);
  scene.add(terrain.group);
  let current = predictions[0];
  terrain.update(current);

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
    const ordered = [
      ...labels.filter((l) => l.kind !== "map-label"),
      ...labels.filter((l) => l.kind === "map-label"),
    ];
    for (const { element } of ordered) element.style.display = "block";
    const sizes = ordered.map(({ element }) => [element.offsetWidth, element.offsetHeight]);
    for (const [i, label] of ordered.entries()) {
      projectPoint.copy(label.position).project(camera);
      const x = (projectPoint.x * 0.5 + 0.5) * width,
        y = (-projectPoint.y * 0.5 + 0.5) * height;
      const el = label.element;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const [rw, rh] = sizes[i];
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
    if (!width) return;
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
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(view);
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
    tick.style.left = `${(observationMinutes(scan) - startMinutes) / (endMinutes - startMinutes) * 100}%`;
    tick.style.background = timeScale(scan.time);
    root.querySelector("#terrain-events").appendChild(tick);
    return tick;
  });
  const regionSummaries = regions.map((region, r) => {
    const card = document.createElement("div");
    card.className = "region-summary";
    card.innerHTML = `<strong></strong><span class="text-small text-muted">Independent 9 AM–5 PM area</span><span class="region-delivered text-small"></span>
      <span class="region-window tabular-nums"></span><span class="text-small text-muted">Average 80% window · <span class="region-prior"></span> at 9 AM</span>`;
    card.querySelector("strong").textContent = `${region.name} region`;
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
      terrain.update(current);
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
  listen(evidence, "input", () => {
    stopPlayback();
    syncReplay();
  });
  listen(nextButton, "click", () => {
    stopPlayback();
    const next = scans[stageAt(scans, Number(evidence.value))];
    evidence.value = next ? Math.ceil(observationMinutes(next)) : endMinutes;
    syncReplay();
  });
  listen(playButton, "click", () => {
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
  listen(root.querySelector("#terrain-rotate"), "click", () => moveCamera(Math.PI / 6));
  listen(root.querySelector("#terrain-tilt"), "click", () => {
    const s = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(controls.target),
    );
    moveCamera(0, s.phi > 0.65 ? -0.35 : 0.65);
  });
  listen(root.querySelector("#terrain-in"), "click", () => moveCamera(0, 0, 0.82));
  listen(root.querySelector("#terrain-out"), "click", () => moveCamera(0, 0, 1.22));
  function updateTheme() {
    readColors();
    drawMap();
    axisMaterial.color.set(colors.foreground);
    observationOutline.color.set(colors.foreground);
    render();
  }
  const themeObserver = new MutationObserver(updateTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  listen(window.matchMedia("(prefers-color-scheme: dark)"), "change", updateTheme);

  // Release listeners and GPU resources when replaced during development or embed teardown.
  return () => {
    cancelAnimationFrame(animation);
    stopPlayback();
    eventListeners.abort();
    resizeObserver.disconnect();
    themeObserver.disconnect();
    controls.removeEventListener("change", render);
    controls.dispose();
    const geometries = new Set(), materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    mapTexture.dispose();
    colorProbe.remove();
    labelLayer.replaceChildren();
    root.querySelector("#terrain-events").replaceChildren();
    root.querySelector("#terrain-regions").replaceChildren();
  };
}
