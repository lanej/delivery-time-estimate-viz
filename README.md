# Delivery time estimate visualization

An interactive 3D replay of a dense delivery-time probability field over real Oakland streets and building footprints.

- Orbit, tilt, and zoom the map with mouse, touch, or the camera buttons.
- Play, pause, and scrub from **9 AM to 5 PM**, or step through events with **Next delivery**.
- Read delivery time as height and color: **blue is earlier, purple is midday, red is later**. The scale stays fixed at 9–5. Surface thickness shows the central 80% prediction interval.
- Watch 18 synthetic deliveries appear as persistent points across **West, Central, and East** regions. Each point connects to its location on the street map, and nearby time ranges animate toward the updated estimate.
- Preserve sharp boundaries and distance-dependent uncertainty. Regional summaries show average prediction-window width and observed-delivery counts.

The replay clock controls which observations are available. The vertical axis represents predicted local delivery time. Rewinding removes later delivery points and restores the earlier ranges. Event ticks under the slider locate deliveries in this recorded demo; solid ticks indicate evidence available at the selected time.

[Open the live visualization](https://lanej.io/delivery-time-estimate-viz/). Updates to `main` are tested, built, and deployed by GitHub Actions.

## Run locally

Requires Node.js 22.12 or newer and a browser with WebGL 2 support.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The application bundles its dependencies and map data; it does not request live map tiles or require an API key.

```sh
npm test
npm run build
npm run preview
```

The production build is written to `dist/`. Relative asset paths allow serving it from a subdirectory.

## Source

| File                                | Purpose                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `src/main.js`                       | Three.js scene, map texture, dense surfaces, camera controls, and replay interaction |
| `src/model.js`                      | Bounded spatial probability field, local conditioning, and evidence snapshot selection  |
| `src/styles.css`, `src/terrain.css` | Standalone responsive styling and light/dark appearance                              |
| `src/data/oakland.json`             | Bundled OpenStreetMap geometry                                                       |
| `test/replay.test.js`               | Regression check for 9–5 bounds, three regions, local collapse, and rewind behavior                          |

## Model scope

This is the visualization prototype developed in the conversation, packaged as a standalone application. Delivery times and dependencies are illustrative; the street geometry is real. The 6,497 grid locations form a dense surface, not a set of measured address predictions.

The demo uses a spatial Gaussian process in transformed time, mapped monotonically into 9 AM–5 PM. Its median and 10th/90th percentiles form the surfaces; these are bounded quantiles, not clipped Gaussian intervals. Covariance falls with geographic distance and drops sharply across three synthetic region boundaries. Observations update the correlated field while retaining independent residual uncertainty. Delivery markers use actual observed times; the surrounding surface represents predictions for the dense grid.

The West, Central, and East labels describe illustrative model regions, not known routes or ZIP boundaries. Synthetic event locations are anchored to distinct building footprints. This example assumes deliveries occur within the illustrated day; real systems should allow outcomes outside business hours. Multimodal distributions, delayed scan ingestion, and evidence from known non-delivery are not modeled here. Replay uses event time as availability time.

For real data, replace `createDemo` with model snapshots or observations carrying explicit availability timestamps. Keep future observations out of earlier replay states, and preserve spatial discontinuities supported by the underlying predictions.

## Map attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). See [the data notes](src/data/README.md) for provenance and transformations.
