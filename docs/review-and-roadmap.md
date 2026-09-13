# Code review and expansion plan

Reviewed against `cd0d342e3f2b9e1efbc338e1e7b952494cac865a` on 2026-09-13.

**Implementation update:** The first expansion now supports validated recorded-day import/export, configurable map extents/service areas/windows/timezones, and map selection plus searchable location inspection. The inspector compares current/previous quantiles, displays supplied density samples (including multiple peaks), and keeps delivery evidence separate from forecast availability. The synthetic Oakland day uses the same import contract. See [format v1](recording-format.md). A real shipment dataset, live feeds, revision handling, calibration dashboards, and polygon-conforming meshes remain future work. The review below describes the preceding code state.

## Review outcome

The core behavior is sound for an illustrative replay: spatial conditioning is independent between areas, the 9–5 time scale stays fixed, rewind selects earlier evidence, and completion preserves the textured surface while removing the range. The map and synthetic outcomes remain distinct. No route is supplied or inferred.

| Finding | Impact | Change |
| --- | --- | --- |
| Vite 7.1.5 had published development-server advisories | Affected local development-server configurations; the deployed Pages site serves static files | Updated the pinned Vite dependency and lockfile to 7.3.6 within the existing major version. |
| Evidence selection rounded delivery times to minutes | Subminute observations could appear before they were available; delivery time could not express ingestion delay | Added explicit `availableMinutes`, exact comparisons, and an availability-ordered binary search. Integer demo timestamps are retained directly to avoid hour/minute floating-point round trips. |
| Renderer initialization could throw before any feedback appeared | A browser without WebGL 2 showed a blank, inert view | Added a visible error state, disabled unusable controls, and a recovery message on graphics context loss. |
| Scene code mixed terrain construction, model setup, and replay interaction | Changes to one concern required navigating a single large module | Extracted `terrain.js` for quantile rendering, `app.js` for the demo scene/controller, and a small startup entry point. |
| Every animation frame rewrote static coordinates, rebuilt side bindings, and recomputed bounds | Unnecessary CPU work during collapse animations | Precomputed coordinates, bindings, and conservative bounds; update heights/colors and required normals only. Skip hidden uncertainty meshes at completion. |
| Animation, observers, event listeners, and GPU resources had no teardown | Replacement or embedding could retain work/resources | Added an unmount hook that cancels frames, removes listeners, disconnects observers, and disposes scene resources. |
| Completion selection assumed every dataset supplied a complete snapshot | Reusing replay with incomplete outcomes would throw | An absent completion snapshot now leaves uncertainty intact, even past the end of the clock. |

Also batched label measurements before positioning, guarded zero-width resize, removed unused state/theme reads, and inserted region names as text rather than HTML.

The dependency review used `npm audit` and the upstream [Vite advisory](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff). Development and preview scripts continue binding to the loopback interface.

The current synthetic behavior is preserved. In particular, uncertainty does **not** decay simply because time passes. At 5 PM the demo supplies a separate synthetic outcome snapshot. This is a visualization device, not evidence that 18 scans can establish every address's actual delivery time.

## Verification and limits

- Regression tests cover smooth, textured independent areas, spatial collapse, exact event boundaries, fractional and delayed availability, simultaneous events, completion, and rewind.
- A renderer test checks actual Three.js geometry: triangles never connect independent areas, the resolved median has the expected heights, completion hides the bounds/sides, and rewind restores them.
- Compared the before/after model using the app's 496 Oakland building sites: all 19 prediction snapshots, 18 marker locations/times, and final outcomes are numerically unchanged.
- `npm test` and `npm run build` pass. GitHub Pages runs both before deploying.
- After the Vite update, `npm audit` reports zero known vulnerabilities across production and development dependencies as of the review date.
- GPU visual inspection remains unverified in the available browser, where WebGL is disabled. Geometry checks do not establish transparency ordering, text layout, or touch behavior on supported devices.

This is still a fixed Oakland demo, not a production forecast. The model, map extent, grid, region assignment, display labels, and synthetic schedule are still configured in code. Runtime input validation, model calibration, missing deliveries, and correction/retraction handling are future work. The renderer's conservative bounds assume all values lie within its declared time domain.

## General concept: an arrival-time field

At each location, represent a distribution over **when an event will happen**, conditioned on evidence available at the selected replay time. Render selected quantiles as a terrain over geography. This can support package delivery, technician visits, pickups, or other geographically correlated service events, if their evidence and dependence assumptions are modeled appropriately.

Keep two times explicit:

- **Delivery time:** the vertical axis and blue-to-red color scale.
- **Knowledge time:** the replay slider, which controls what the model could know.

The current band is the interval between the 10th and 90th percentiles at each location. Its height is time, and its thickness is uncertainty. It does not show the entire probability density, nor an 80% guarantee that all locations fall inside their bands together.

The most useful next interaction is selecting an address. Keep the 3D neighborhood context visible while a small detail panel shows the address's full time distribution, current range, observed time if known, and the evidence that changed its forecast. A before/after comparison can expose the footprint of one observation without implying a delivery route.

## Separate data, inference, replay, and presentation

The cleanup establishes a small seam: `createTerrain(grid, encoding).update(values)` renders grid-aligned `{lower, median, upper}` snapshots. It does not perform inference. `createDemo()` remains the synthetic producer, and `app.js` still owns the Oakland-specific composition.

Build outward from that seam:

1. **Data adapter:** validate locations, area polygons, service windows, and evidence; retain provenance and stable identifiers.
2. **Inference provider:** return distributions or quantile snapshots for a requested evidence cutoff. It may be the demo, a recorded model run, or a service. Keep it independent of Three.js.
3. **Replay store:** order evidence by availability, select a reproducible snapshot, and handle revisions without leaking future knowledge.
4. **Spatial view:** project geography, select supported cells, render boundaries/quantiles, and expose address inspection.

Do not require a new modeling stack to make the first real-data prototype. An adapter for recorded predictions and actual outcomes is enough to validate whether the visual explanation is useful.

## Proposed data contract

This is a proposal, not an implemented import format. Replace demo-only hours/minutes with absolute timestamps at the data boundary; format them in the dataset's local timezone in the UI.

| Record | Essential fields | Meaning |
| --- | --- | --- |
| Dataset | `id`, `serviceDate`, `timeZone`, geographic extent, display time domain | Identifies one reproducible day/view; keeps timezone and display scale explicit. |
| Service area | `id`, `name`, polygon, service window, dependence metadata | Areas can have independent schedules and hard boundaries; a ZIP is a selection boundary and need not equal one service area. |
| Site | `id`, longitude, latitude, `areaId`, eligibility/status | Provides stable address/site identity without relying on a grid position or building centroid. |
| Observation | `id`, `siteId`, `eventAt`, `availableAt`, kind, revision, source | Separates occurrence from knowledge; supports delayed ingestion and corrections. |
| Prediction snapshot | `id`, `asOf`, `modelVersion`, evidence version, site/cell IDs, quantiles, support mask | Binds forecasts to the evidence actually available. Lower/median/upper values must be finite and ordered. Unsupported cells stay absent. |
| Outcome | `siteId`, `actualAt`, `availableAt`, status | Resolves a confirmed site; canceled, failed, and unresolved deliveries remain distinct outcomes. |

Use stable IDs to align values across snapshots. Explicitly version area geometry and grid/site order when either changes. Validate duplicate IDs, missing coordinates, non-finite values, out-of-order quantiles, and evidence beyond the snapshot's knowledge cutoff before rendering. Preserve revisions with their availability timestamps so replay can reconstruct what was known then.

For the present model, scan order and prediction-prefix order must match **availability order**. A count of available scans is insufficient for arbitrary unordered snapshots or retractable events; those require snapshot/evidence IDs and a replay store.

## Modeling choices that matter

**Boundaries:** Preserve independent regions as separate meshes. A ZIP may include multiple areas or portions of them. Use supplied boundaries first; treating uncertain membership or shared disruptions requires an explicit dependence model. Do not automatically correlate adjacent addresses across a hard boundary. Current grid edges approximate boundaries; polygon-conforming meshes would make the cliff locations precise.

**Completion:** Set lower = median = upper at a site only when its outcome is known, or when the dataset explicitly supplies a complete synthetic outcome field. Interpolating between confirmed addresses does not make every intervening location measured. A real final view can contain resolved points and a surface with residual uncertainty or unsupported gaps. Show these states separately.

**Negative evidence:** “Not delivered yet” can constrain delivery time only if the site is known to be eligible and the observation process is reliable. A missing scan could mean delayed ingestion, missing coverage, cancellation, or non-delivery. Model that distinction before conditioning on absence.

**Multiple likely windows:** Three quantiles can hide morning/afternoon alternatives and put the median between modes. Start with an address-level density/CDF panel; then consider optional separate bands or time slices for multimodal distributions. Avoid presenting a single continuous band as a complete probability cloud.

**Time domain:** Keep the demo's blue-to-red 9–5 scale. General datasets need configurable service windows and explicit late/next-day outcomes. Choose and label a common scale when comparing regions; do not silently clip late deliveries to 5 PM or independently rescale regions while retaining one legend.

**Calibration:** Narrower ranges are useful only when they retain the promised coverage. Evaluate held-out delivery days using pointwise interval coverage, width, median error, and performance by area and replay time. Report unsupported sites and unresolved outcomes. For real forecasts, new evidence can move or broaden a range; universal shrinking is not an invariant to impose.

## Suggested order of expansion

| Phase | Deliverable | Why first / acceptance condition |
| --- | --- | --- |
| 1. Recorded real day | One ZIP selection with explicit service areas, prediction snapshots, and confirmed outcomes | Validates the concept without a live inference backend. Replay must exclude late/future evidence and preserve unresolved sites at day end. |
| 2. Inspect and explain | Click an address; show its distribution, actual time, and forecast before/after a selected observation | Makes the spatial collapse understandable at a concrete location. Keep the street map, time axis, and area boundaries visible. |
| 3. Compare | Side-by-side days/model versions with the same geographic/time scales; per-area coverage and width summaries | Tests whether a tighter-looking surface actually predicts better. Include address-weighted metrics rather than only grid averages. |
| 4. Live operation | Stream available evidence, expose ingestion lag, and allow pausing/replaying a historical cutoff | Maintain a clear distinction between live knowledge and recorded outcomes, including duplicates/corrections. |
| 5. Larger and richer fields | Polygon boundaries, spatial masks, configurable grids, more areas, and multimodal inspection | Profile representative data first. Add regional updates, workers, cached snapshots, or spatial detail levels where measured costs justify them. |

The current precomputed Gaussian-process demo is intentionally small. With `n` observations and `v` grid vertices, dense factorization grows roughly as O(n³), predicting the grid as O(v n²), and retaining every prefix as O(v n). These become limitations long before the synthetic 18-event example does. A production provider should partition by independent area, cache selected replay checkpoints, and return only the needed spatial/time window. Rendering can then update affected regions instead of replacing the whole field.

The first expansion should be one recorded real delivery day plus address inspection. That supplies evidence for the next modeling and performance decisions while preserving the interaction that already works.
