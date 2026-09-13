# Recorded delivery day · format v1

Choose **Export example** to download the complete synthetic Oakland recording. Choose **Load recorded day** to open a recording in this format. JSON is parsed locally; no addresses or predictions are uploaded. Invalid input leaves the current day selected. The maximum file size is 25 MB.

This imports **supplied forecasts**, not raw scans from which the browser invents a forecast. For a real day, export predictions from the model you want to inspect together with delivery evidence and its availability timestamps. No real shipment dataset is bundled.

## Time and identity

All metadata timestamps use ISO 8601 with an explicit `Z` or UTC offset. `timeZone` is the timezone used for presentation, such as `America/Los_Angeles`. Forecast quantiles and density sample times are **elapsed minutes since `timeDomain[0]`**. They are not wall-clock minutes after midnight. This keeps replay consistent across midnight and timezone offsets.

Keep IDs stable across snapshots. Array order for grid values follows the grid point order; site values are keyed by site ID. Service areas are explicit modeling regions and are independent of ZIP labels. The renderer does not estimate routes or learn correlations from area labels.

```json
{
  "version": 1,
  "id": "example-day",
  "label": "Downtown delivery day",
  "synthetic": false,
  "timeZone": "America/Los_Angeles",
  "timeDomain": ["2026-09-13T09:00:00-07:00", "2026-09-13T17:00:00-07:00"],
  "replay": ["2026-09-13T09:00:00-07:00", "2026-09-13T17:30:00-07:00"],
  "bounds": [-122.2763, 37.8011, -122.2622, 37.8104]
}
```

The following sections are also required; the snippet above is metadata only. A display domain may span up to seven days. Its blue-to-red scale is shared by all areas. Widen that domain to represent late or next-day delivery outcomes rather than clipping them. Replay can continue after the delivery-time domain to show delayed evidence.

## Geography

| Field | Shape | Meaning |
| --- | --- | --- |
| `bounds` | `[west, south, east, north]` | Local geographic extent, at most ten degrees in either direction; antimeridian views are not supported. |
| `map` | GeoJSON `FeatureCollection` | Bundled street/building/water geometry. Features use `properties.kind` = `road`, `building`, or `water`; optional `name` and road `type`. Supported geometry: `LineString`, `Polygon`. |
| `mapAttribution` | String | Attribution displayed beneath the map. Include the source/license appropriate to your data. |
| `areas` | `[{id, name, serviceWindow: [startISO, endISO]}]` | 1–24 service areas. Windows must fit inside the common display domain. |
| `grid` | `{columns, rows, points}` | A spatial grid, ordered row by row; adjacent points determine mesh connections. |
| `grid.points` | `[{coordinates: [longitude, latitude], areaId}]` | `columns × rows` points, at most 20,000. Use `areaId: null` for permanently unsupported cells. Triangles never cross areas or unsupported points. |
| `sites` | `[{id, label, coordinates, areaId, zip?}]` | 1–5,000 inspectable locations. Labels may be addresses, names, or IDs. Optional ZIPs must have five digits. |

Supply a grid aligned to your field and assign each point to its service area. Area boundaries follow grid edges in v1; polygon-conforming triangulation is not implemented. Sites need not lie on grid vertices. Supply their predictions independently to avoid silently treating a nearby grid estimate as an address forecast. The bundled demo uses sourced building locations/names; unnamed buildings have explicit generic labels, not invented addresses or ZIPs.

## Confirmed deliveries

```json
{
  "observations": [
    {
      "id": "delivery-1",
      "siteId": "address-1",
      "eventAt": "2026-09-13T10:00:00-07:00",
      "availableAt": "2026-09-13T10:05:00-07:00"
    }
  ]
}
```

The marker appears at replay **10:05**, at height/color **10:00**. A location becomes confirmed when this evidence is available, even if the inference provider has not published a new forecast yet. V1 accepts one confirmed delivery per site; duplicate delivery records and revisions are rejected. Cancellations, failures, and inferred non-delivery are not represented by these records.

## Forecast snapshots

```json
{
  "id": "forecast-2",
  "asOf": "2026-09-13T10:05:00-07:00",
  "availableAt": "2026-09-13T10:07:00-07:00",
  "modelVersion": "delivery-model-2026-09",
  "evidenceIds": ["delivery-1"],
  "gridValues": [[50, 60, 90], [100, 130, 170], null],
  "siteValues": {
    "address-1": [50, 60, 90],
    "address-2": null
  }
}
```

Place snapshot objects in the top-level `snapshots` array. The example above illustrates value shapes; the grid array must contain one value for **every** grid point, and `siteValues` must contain **every** site ID.

- Each numeric triple is `[p10, p50, p90]` in elapsed minutes. Values must be finite, ordered, and within the display domain. For a 9 AM origin, `[50, 60, 90]` means 9:50 / 10:00 / 10:30 AM.
- Grid values are `null` exactly where `areaId` is `null`. A site's prediction may be `null` in a snapshot when no forecast is supported there.
- `asOf` is the knowledge cutoff used to compute the forecast. Every referenced observation must have become available by then.
- `availableAt` is when this forecast could be viewed. It cannot precede `asOf`. Replay does not reveal this snapshot earlier, even when its evidence is already known.
- The first snapshot must be available by replay start. Snapshot availability times must be unique. Input snapshots and observations may be unordered; the loader orders them by availability.
- `evidenceIds` lists what the provider used. It can omit recently arrived scans; the inspector makes the gap visible.
- At most 300 snapshots and 500,000 combined grid/site values across snapshots are accepted.

The inspector compares the current snapshot with the preceding available snapshot. Its range-change label describes that comparison; it is not a causal attribution or a calibration score.

## Optional distributions

Three quantiles do not identify a complete probability density. To display one, provide sampled relative density for any site in a snapshot:

```json
{
  "distributions": {
    "address-1": [[0, 0], [60, 0.8], [120, 0.1], [240, 1.0], [360, 0.2], [480, 0]]
  }
}
```

Times are elapsed minutes and must increase from zero through the end of the display domain. Weights must be finite/nonnegative, with some positive mass. Supply 3–512 points per curve, at most 500,000 density points per recording. Each curve is normalized by its trapezoidal area so current and previous forecasts use comparable scales, then drawn with linear interpolation and labeled **relative likelihood**. Providers are responsible for consistency between their density and quantiles. Multiple peaks are supported. Without density, the inspector shows only the supplied quantile range and median.

The bundled synthetic day declares `distributionFamily: "logit-normal"`, allowing its exact model family to be reconstructed from quantiles for inspection. That shortcut is restricted to synthetic recordings; it is not assumed for imported real models.

## Resolution and replay end

The UI distinguishes a confirmed delivery from a forecast with a narrow range. A known delivery appears as an exact time in the location inspector. Other locations retain their supplied forecasts, and missing predictions remain unknown.

Ending replay does not force the surface to resolve. The synthetic demo has an explicit snapshot with `syntheticResolved: true` and zero-width values for every grid point and site. This flag is rejected for real recordings. A real forecast may supply equal quantiles, but that alone is not labeled a confirmed outcome.

This release implements recorded replay, configurable areas/time windows, and location inspection. Live feeds, corrected/retracted observations, model calibration dashboards, learned dependencies, and changing grid support over time remain future work.
