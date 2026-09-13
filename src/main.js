import { WebGLRenderer } from "three";
import { mountApp } from "./app.js";
import { demoRecording } from "./demo-recording.js";
import { parseRecording, MAX_RECORDING_BYTES } from "./recording.js";
import formatUrl from "../docs/recording-format.md?url";
import "./styles.css";

const root = document.getElementById("delivery-probability-terrain");
const canvas = root.querySelector("#terrain-canvas");
const status = root.querySelector("#recording-status");
const load = root.querySelector("#recording-load"), fileInput = root.querySelector("#recording-file");
const exportButton = root.querySelector("#recording-export"), demoButton = root.querySelector("#recording-demo");
root.querySelector("#recording-guide").href = formatUrl;
const events = new AbortController();
const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: events.signal });
let renderer = null, unmount = null, currentDay = null, loadVersion = 0;
try { renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true }); }
catch (error) { console.warn("3D graphics unavailable; replay and inspection remain usable.", error); }

function activate(day) {
  unmount?.();
  unmount = mountApp(root, renderer, day);
  currentDay = day;
  demoButton.hidden = day === demoRecording();
  exportButton.textContent = day === demoRecording() ? "Export example" : "Export recording";
  status.textContent = `${day.synthetic ? "Synthetic" : "Recorded"} day · ${day.sites.length} locations · ${day.regions.length} service areas`;
  status.classList.remove("recording-error");
}
listen(load, "click", () => fileInput.click());
listen(fileInput, "change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  const version = ++loadVersion;
  status.textContent = `Checking ${file.name}…`;
  let day;
  try {
    if (file.size > MAX_RECORDING_BYTES) throw new Error("Choose a JSON recording smaller than 25 MB.");
    const contents = await file.text();
    if (version !== loadVersion) return;
    day = parseRecording(JSON.parse(contents));
  } catch (error) {
    if (version !== loadVersion) return;
    status.textContent = `Could not load ${file.name}: ${error.message}. The current day is still selected.`;
    status.classList.add("recording-error");
    return;
  }
  activate(day);
});
listen(demoButton, "click", () => { loadVersion++; activate(demoRecording()); });
listen(exportButton, "click", () => {
  const blob = new Blob([JSON.stringify(currentDay.raw)], { type: "application/json" });
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = `${currentDay.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
listen(canvas, "webglcontextlost", (event) => {
  event.preventDefault();
  unmount?.(); unmount = null;
  renderer?.dispose(); renderer = null;
  if (currentDay) activate(currentDay);
});
activate(demoRecording());
if (import.meta.hot) import.meta.hot.dispose(() => { events.abort(); unmount?.(); renderer?.dispose(); });
