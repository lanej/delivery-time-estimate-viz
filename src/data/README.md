# Oakland map data

`oakland.json` contains 1,716 OpenStreetMap features used by the prototype: streets, building footprints, and small water features. It is a downtown detail, not a ZIP boundary dataset.

- Source: [OpenStreetMap](https://www.openstreetmap.org/), retrieved through [Overpass](https://overpass.kumi.systems/api/interpreter).
- Retrieval date: September 13, 2026.
- Street/water query bounds: south 37.799, west -122.278, north 37.814, east -122.259.
- Building query bounds: south 37.802, west -122.275, north 37.811, east -122.263.
- Transformations: select road classes, building outlines, and water polygons; round coordinates to six decimals; retain feature kind, name, and road class; orient polygon rings for D3's spherical projection.
- Coordinates: longitude/latitude, WGS 84.

The application projects the geometry with D3 Mercator and paints it into a Three.js map texture. Prediction values are generated separately and are not OpenStreetMap data.

`oakland-sites.json` freezes the 418 building locations used by the recording demo. IDs retain each building's one-based position among `oakland.json` building features; labels use the source name or `Building N`. Coordinates were derived once with D3 `geoCentroid`, then limited to the illustrated field (`|x| < 12.4 × 0.42`, `|z| < 9.3 × 0.41` under the projection in `geography.js`). Storing these derived coordinates avoids runtime-dependent changes in spherical centroid calculation and view-boundary inclusion. This file shares the map attribution/license below. It is not a verified address or ZIP dataset.

Map data © OpenStreetMap contributors. Licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
