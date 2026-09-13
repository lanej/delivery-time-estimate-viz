import { WebGLRenderer } from "three";
import { mountApp } from "./app.js";
import "./styles.css";

const root = document.getElementById("delivery-probability-terrain");
const canvas = root.querySelector("#terrain-canvas");
function showFailure(message, error) {
  console.error(error);
  const notice = document.createElement("p");
  notice.className = "terrain-error";
  notice.setAttribute("role", "alert");
  notice.textContent = message;
  const view = root.querySelector("#terrain-view");
  view.style.height = "auto";
  view.replaceChildren(notice);
  root.querySelectorAll("button, input").forEach((control) => { control.disabled = true; });
  root.querySelector("#terrain-state").textContent = "3D view unavailable";
}

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
} catch (error) {
  showFailure("This browser couldn’t start the 3D view. Open it in a browser with WebGL 2 enabled.", error);
}
if (renderer) {
  try {
    const unmount = mountApp(root, renderer);
    let active = true;
    function dispose() {
      if (!active) return;
      active = false;
      canvas.removeEventListener("webglcontextlost", contextLost);
      unmount();
      renderer.dispose();
    }
    function contextLost(event) {
      event.preventDefault();
      dispose();
      showFailure("The 3D view lost its graphics connection. Reload the page to restart it.", "WebGL context lost");
    }
    canvas.addEventListener("webglcontextlost", contextLost);
    if (import.meta.hot) import.meta.hot.dispose(dispose);
  } catch (error) {
    renderer.dispose();
    showFailure("The visualization couldn’t start. Reload the page to try again.", error);
  }
}
