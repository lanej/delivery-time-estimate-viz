# Delivery time estimate visualization

An interactive 3D replay of a dense delivery-time probability field over real Oakland streets and building footprints.

- Orbit, tilt, and zoom the map with mouse, touch, or the camera buttons.
- Play, pause, and scrub from **9 AM to 5 PM**, or step through evidence and forecast arrivals with **Next update**.
- Read delivery time as height and color: **blue is earlier, purple is midday, red is later**. The scale stays fixed at 9–5. Surface thickness shows the central 80% prediction interval.
- Watch 18 synthetic deliveries appear as persistent points across **West, Central, and East** regions. Each is an independent delivery area operating throughout **9 AM–5 PM**, with interleaved observations and its own early, midday, and late locations. Each point connects to its location on the street map, and nearby time ranges animate toward the updated estimate.
- Finish the synthetic day at **5 PM** with a single resolved surface: the upper and lower bounds meet the final delivery times, all regional windows read **0 min**, and the uncertainty meshes disappear. **Next update** advances from the last sample delivery to that endpoint. Rewinding restores the earlier ranges.
- Show smooth, textured surfaces with hills, valleys, and smaller ripples within every area; sheer discontinuities occur only at the boundaries between independent areas. Preserve distance-dependent uncertainty. Regional summaries show average prediction-window width and observed-delivery counts.

The replay clock controls which observations are available, including the complete outcome snapshot released at 5 PM. The vertical axis represents predicted local delivery time. Rewinding removes later delivery points and restores the earlier ranges. Event ticks under the slider locate deliveries in this recorded demo; solid ticks indicate evidence available at the selected time.

Click the terrain to select a nearby location, or search the location picker and filter by service area or supplied ZIP. The bundled day has **418 selectable building locations**. The inspector shows the current and previous distributions, median, central 80% window, range change, and confirmed delivery time when its evidence is available. Building names are sourced; unnamed buildings use generic labels rather than invented addresses.

Use **Export example** to download the full synthetic day as JSON, or **Load recorded day** to load real model snapshots and delivery evidence. Files remain in your browser. Map geometry, grid support, service areas, site labels, ZIPs, service windows, display/replay ranges, and timezone are configurable. Imported forecasts are displayed as supplied; the browser does not infer a forecast from raw scans. See [the recording format](docs/recording-format.md) and the small [test fixture](test/fixtures/recorded-day.json). No real shipment dataset is bundled.

Delivery occurrence, evidence availability, forecast cutoff, and forecast availability are separate. Replay reveals each only at the appropriate time. Confirmed sites show exact outcomes; the clock never resolves unknown sites in a real recording. Density samples can have multiple peaks. When only quantiles are provided, the inspector shows only a range, without inventing a density curve.

[Open the live visualization](https://lanej.io/delivery-time-estimate-viz/). Updates to `main` are tested, built, and deployed by GitHub Actions.

## Run locally

Requires Node.js 22.12 or newer. The 3D map requires WebGL 2; replay, recording import, and location inspection remain usable when graphics are unavailable.

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
| `src/main.js`                       | Startup, graphics failure feedback, and app lifecycle |
| `src/app.js`                        | Recording map/scene, camera controls, point selection, replay interaction, and teardown |
| `src/terrain.js`                    | Reusable quantile meshes and shared height/color encoding |
| `src/model.js`                      | Bounded spatial probability field, local conditioning, and evidence snapshot selection  |
| `src/recording.js`                  | Validated data adapter, knowledge-time replay, confirmed outcomes, and density selection |
| `src/demo-recording.js`             | Synthetic Oakland day in the same import/export contract |
| `src/geography.js`                  | Geographic projection shared by map, field, and locations |
| `src/inspector.js`                  | Location search/filtering and current/previous distribution chart |
| `src/styles.css`, `src/terrain.css` | Standalone responsive styling and light/dark appearance                              |
| `src/data/oakland.json`             | Bundled OpenStreetMap geometry                                                       |
| `test/replay.test.js`               | Regression check for 9–5 bounds, smooth textured independent areas, local collapse, exact completion, and rewind behavior                          |
| `test/terrain.test.js`              | Rendered geometry boundaries, resolved surface, and band restoration on rewind |
| `test/recording.test.js`            | Import, delayed evidence/forecasts, unknown outcomes, density, validation, and export/reload |
| `docs/review-and-roadmap.md`        | Code review, proposed data contract, and phased expansion plan |

## Model scope

This is the visualization prototype developed in the conversation, packaged as a standalone application. Delivery times and dependencies are illustrative; the street geometry is real. The 6,497 grid locations form a dense surface, not a set of measured address predictions.

The demo uses a spatial Gaussian process in transformed time, mapped monotonically into 9 AM–5 PM. Its median and 10th/90th percentiles form the surfaces; these are bounded quantiles, not clipped Gaussian intervals. Covariance falls with geographic distance within each area and is exactly zero across region boundaries. An observation in one region leaves every prediction in the other two unchanged. Each area spans the full day with its own smooth spatial timing pattern. The prior combines continuous variation at several spatial scales, giving each area multiple local peaks and valleys instead of a directional ramp or internal steps. Synthetic delivery locations are sampled near plausible prior times across the landscape, without a prescribed travel sequence. The meshes have separate boundaries so their ranges are not interpolated together. Daytime observations update the correlated field while retaining independent residual uncertainty. At 5 PM, a separate synthetic snapshot supplies resolved outcomes for the entire field. Its smooth values interpolate the shown deliveries; each final value is displayed with identical lower and upper bounds. This completion state is explicitly supplied by the demo, not inferred as certainty from the 18 sparse observations. The clock alone does not shrink the daytime distributions. Delivery markers use actual observed times; the surrounding surface represents predictions for the dense grid.

The West, Central, and East labels describe illustrative model regions, not known routes or ZIP boundaries. Synthetic event locations are anchored to distinct building footprints. The synthetic model is restricted to 9–5; recorded datasets can configure a wider common time domain for late or next-day outcomes. The synthetic model is unimodal, while recorded density samples can have multiple peaks. Evidence from known non-delivery is not modeled. The internal demo uses explicit `availableMinutes`; its recording adapter exports absolute availability timestamps and elapsed-minute quantiles. Imported snapshots and observations are independently ordered by availability.

For real data, load a version 1 recording with supplied model snapshots and explicit evidence/forecast availability. Future observations remain excluded from earlier replay states, and the renderer preserves separate area boundaries and permanently unsupported grid points. V1 rejects revisions and duplicate deliveries per site; those require a later event-store extension.

See the [code review and expansion plan](docs/review-and-roadmap.md) for implementation status and the remaining path toward live evidence, calibration, and larger spatial fields.

## Map attribution

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). See [the data notes](src/data/README.md) for provenance and transformations.
