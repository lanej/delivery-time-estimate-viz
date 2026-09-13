import * as THREE from "three";
import * as d3 from "d3";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createTerrain, createTimeEncoding } from "./terrain.js";
import { WORLD } from "./geography.js";
import { recordingAt, nextRecordingTime, inspectSite } from "./recording.js";
import { mountInspector } from "./inspector.js";

/** Mount a validated recording; the caller owns the renderer and receives a teardown hook. */
export function mountApp(root, renderer, day) {
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
  renderer?.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer?.setClearColor(0, 0);
  if (renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = Boolean(renderer);
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

  const { width: worldW, depth: worldD, textureWidth: texW, textureHeight: texH } = WORLD;
  const mapData = day.map;
  const { geo } = day.projection;
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = texW;
  mapCanvas.height = texH;
  const ctx = mapCanvas.getContext("2d");
  const mapTexture = new THREE.CanvasTexture(mapCanvas);
  mapTexture.colorSpace = THREE.SRGBColorSpace;
  mapTexture.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 1;
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

  const { vertices, scans, regions, timeMin, timeMax } = day;
  const clock = (hour) => day.clock(hour * 60);
  const timeTicks = [timeMin, ...d3.ticks(timeMin, timeMax, 4).filter((t) => t > timeMin && t < timeMax), timeMax];
  const encoding = createTimeEncoding(timeMin, timeMax);
  const { timeScale, timeColor, timeY } = encoding;
  const terrain = createTerrain(day, encoding);
  scene.add(terrain.group);
  let activeState = recordingAt(day, day.start);
  let current = activeState.values;
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
  const roadNames = [...new Set(mapData.features
    .filter((f) => f.properties.kind === "road" && f.properties.name)
    .sort((a, b) => d3.geoLength(b) - d3.geoLength(a))
    .map((f) => f.properties.name))].slice(0, 10);
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
  for (const t of timeTicks)
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
  for (const t of timeTicks)
    addLabel(
      clock(t),
      [axisX - 0.42, timeY(t), axisZ],
      "time-label",
    );
  addLabel(
    "Delivery time",
    [axisX - 0.1, timeY(timeMax) + 0.4, axisZ],
    "axis-label",
  );
  addLabel("N", [0, 0.02, -worldD / 2 + 0.12], "north-label");
  const selection = new THREE.Group();
  const selectionMaterial = new THREE.MeshBasicMaterial({ color: colors.foreground, transparent: true, depthTest: false, depthWrite: false });
  const selectionPoint = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), selectionMaterial);
  const selectionFoot = new THREE.Mesh(new THREE.RingGeometry(0.14, 0.19, 32), selectionMaterial);
  selectionFoot.rotation.x = -Math.PI / 2;
  const selectionLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: colors.foreground, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false }));
  selectionPoint.renderOrder = selectionFoot.renderOrder = selectionLine.renderOrder = 10;
  selection.add(selectionPoint, selectionFoot, selectionLine);
  scene.add(selection);
  let inspector = null;
  function updateSelection() {
    const index = inspector?.selected ?? -1;
    selection.visible = index >= 0;
    if (index < 0) return;
    const { site, current: value } = inspectSite(day, activeState, index);
    selectionPoint.visible = selectionLine.visible = Boolean(value);
    selectionFoot.position.set(site.x, 0.04, site.z);
    if (value) {
      selectionPoint.position.set(site.x, timeY(value.median), site.z);
      const positions = selectionLine.geometry.attributes.position;
      positions.setXYZ(0, site.x, 0.04, site.z);
      positions.setXYZ(1, site.x, timeY(value.median), site.z);
      positions.needsUpdate = true;
      selectionLine.geometry.computeBoundingSphere();
    }
  }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let pointerStart = null;
  listen(canvas, "pointerdown", (event) => { pointerStart = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null; });
  listen(canvas, "pointercancel", () => { pointerStart = null; });
  listen(canvas, "pointerup", (event) => {
    const start = pointerStart; pointerStart = null;
    if (!renderer || !start || start.id !== event.pointerId || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    const rect = canvas.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const median = terrain.group.getObjectByName("median");
    const hit = raycaster.intersectObjects([median, mapPlane], false)[0];
    if (!hit) return;
    const region = hit.object === median ? vertices[hit.face.a].region : null;
    let nearest = -1, distance = 0.65;
    for (const i of inspector.candidates()) {
      const site = day.sites[i];
      if (region !== null && site.region !== region) continue;
      const d = Math.hypot(site.x - hit.point.x, site.z - hit.point.z);
      if (d < distance) { nearest = i; distance = d; }
    }
    if (nearest >= 0) inspector.select(nearest);
  });
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
    updateSelection();
    if (renderer) { renderer.render(scene, camera); layoutLabels(); }
  }
  function resize() {
    width = view.clientWidth;
    if (!width) return;
    height = renderer ? Math.round(Math.min(530, width * 0.6 + 230)) : 110;
    view.style.height = renderer ? `${height}px` : "auto";
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer?.setSize(width, height, false);
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
  const { start: startMinutes, end: endMinutes } = day;
  root.querySelector("#terrain-subtitle").textContent = `${day.label} · ${day.dateLabel} · ${day.timeZone}`;
  root.querySelector("#terrain-mid").textContent = day.clock((startMinutes + endMinutes) / 2);
  root.querySelector("#legend-early").textContent = `Earlier · ${clock(timeMin)}`;
  root.querySelector("#legend-late").textContent = `${clock(timeMax)} · Later`;
  root.querySelector(".time-legend").setAttribute("aria-label", `Blue at ${clock(timeMin)}, red at ${clock(timeMax)}`);
  root.querySelector("#map-attribution").textContent = day.mapAttribution;
  root.querySelector("#osm-attribution-link").hidden = !day.mapAttribution.includes("OpenStreetMap");
  root.querySelector("#data-kind").textContent = day.synthetic ? "Synthetic deliveries; no routes assumed" : "Recorded forecasts and deliveries; no routes inferred";
  root.querySelector("#terrain-canvas").setAttribute("aria-label", `Interactive delivery-time terrain for ${day.label}. Select a location on the map or with the location picker to inspect its forecast.`);
  root.querySelector("#graphics-notice").hidden = Boolean(renderer);
  canvas.hidden = labelLayer.hidden = !renderer;
  for (const id of ["terrain-rotate", "terrain-tilt", "terrain-in", "terrain-out"])
    root.querySelector(`#${id}`).disabled = !renderer;
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
    tick.hidden = scan.availableMinutes < startMinutes || scan.availableMinutes > endMinutes;
    tick.style.left = `${(scan.availableMinutes - startMinutes) / (endMinutes - startMinutes) * 100}%`;
    tick.style.background = colors.border;
    root.querySelector("#terrain-events").appendChild(tick);
    return tick;
  });
  const regionSummaries = regions.map((region, r) => {
    const card = document.createElement("div");
    card.className = "region-summary";
    card.innerHTML = `<strong></strong><span class="region-schedule text-small text-muted"></span><span class="region-delivered text-small"></span>
      <span class="region-window tabular-nums"></span><span class="text-small text-muted">Average 80% window · <span class="region-prior"></span> initially</span>`;
    card.querySelector("strong").textContent = `${region.name} area`;
    card.querySelector(".region-schedule").textContent = `${day.clock(region.window[0])}–${day.clock(region.window[1])}`;
    root.querySelector("#terrain-regions").appendChild(card);
    const indices = vertices.flatMap((p, i) => p.region === r ? [i] : []);
    const windowMinutes = (values) => Math.round(d3.mean(indices, (i) => (values[i].upper - values[i].lower) * 60));
    card.querySelector(".region-prior").textContent = `${windowMinutes(day.snapshots[0].values)} min`;
    return { card, windowMinutes };
  });
  let activeStage = -1,
    activeComplete = false,
    activeSnapshot = -1,
    playing = false,
    playFrame = 0,
    playStarted = 0,
    playFrom = startMinutes;
  function syncReplay() {
    const minutes = Number(evidence.value);
    const state = recordingAt(day, minutes);
    const { stage, complete, values: target } = state;
    activeState = state;
    root.querySelector("#terrain-clock").textContent = clock(minutes / 60);
    evidence.setAttribute("aria-valuetext", complete
      ? `${clock(minutes / 60)}. Day complete. No remaining uncertainty.`
      : `${clock(minutes / 60)}. ${stage} deliveries observed.`);
    nextButton.disabled = minutes >= endMinutes;
    nextButton.textContent = minutes >= endMinutes ? "Replay ended" : "Next update";
    if (stage === activeStage && complete === activeComplete && state.index === activeSnapshot) return;
    const forward = stage > activeStage && stage > 0;
    activeStage = stage;
    activeComplete = complete;
    activeSnapshot = state.index;
    inspector.update(state);
    const from = current.map((p) => ({ ...p }));
    root.querySelector("#terrain-state").textContent = complete
      ? "Day complete · simulated final surface"
      : `${stage} confirmed · ${day.sites.length - stage} unconfirmed locations`;
    const supported = target.filter((_, i) => vertices[i].region !== null);
    const avg = d3.mean(supported, (p) => (p.upper - p.lower) * 60);
    root.querySelector("#terrain-accessible").textContent = complete
      ? "The supplied synthetic outcomes leave one textured surface with zero range."
      : `${stage} deliveries available. Average central 80 percent field window: ${Math.round(avg)} minutes. Select a location for its forecast and confirmed delivery time, if available.`;
    root.querySelector("#terrain-surface-key").textContent = complete
      ? "Surface = simulated final times · no remaining range"
      : "Surface = forecast median · thickness = central 80% range";
    regionSummaries.forEach(({ card, windowMinutes }, r) => {
      card.querySelector(".region-window").textContent = `${windowMinutes(target)} min`;
      card.querySelector(".region-delivered").textContent = complete
        ? "Synthetic outcomes resolved"
        : `${scans.slice(0, stage).filter((p) => p.region === r).length} confirmed deliveries`;
    });
    observationMarks.forEach((mark, i) => (mark.visible = i < stage));
    eventTicks.forEach((tick, i) => {
      tick.classList.toggle("observed", i < stage);
      tick.style.background = i < stage ? timeScale(scans[i].time) : colors.border;
    });
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
    evidence.value = nextRecordingTime(day, Number(evidence.value));
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
        Math.floor((playFrom + ((now - playStarted) / 1000) * (endMinutes - startMinutes) / 40) * 60) / 60,
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
  inspector = mountInspector(root, day, () => render());
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
    selectionMaterial.color.set(colors.foreground);
    selectionLine.material.color.set(colors.foreground);
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
    inspector.dispose();
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
