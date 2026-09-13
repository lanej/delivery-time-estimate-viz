# Delivery time estimate visualization

An interactive 3D replay of a dense delivery-time probability field over real Oakland streets and building footprints.

- Orbit, tilt, and zoom the map with mouse, touch, or the camera buttons.
- Play, pause, and scrub backward or forward through delivery observations.
- See median delivery time as height and a central 80% prediction interval as thickness.
- Preserve sharp changes across nearby locations as new evidence shifts and narrows the field.

The replay clock controls which observations are available. The vertical axis represents predicted local delivery time. Rewinding restores an earlier evidence snapshot.

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
| `src/model.js`                      | Synthetic Gaussian field, observation conditioning, and evidence snapshot selection  |
| `src/styles.css`, `src/terrain.css` | Standalone responsive styling and light/dark appearance                              |
| `src/data/oakland.json`             | Bundled OpenStreetMap geometry                                                       |
| `test/replay.test.js`               | Regression check for observation timing and rewind behavior                          |

## Model scope

This is the visualization prototype developed in the conversation, packaged as a standalone application. Delivery times and dependencies are illustrative; the street geometry is real. The 6,497 grid locations form a dense surface, not a set of measured address predictions.

The demo uses a Gaussian field with latent factors to illustrate correlated updates without known routes. It retains residual uncertainty and deliberately includes sharp spatial boundaries. Each location has one Gaussian distribution; multimodal distributions, delayed scan ingestion, and evidence from known non-delivery are not modeled here. Replay uses event time as availability time.

For real data, replace `createDemo` with model snapshots or observations carrying explicit availability timestamps. Keep future observations out of earlier replay states, and preserve spatial discontinuities supported by the underlying predictions.

## Map attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). See [the data notes](src/data/README.md) for provenance and transformations.
