# Oakland map data

`oakland.json` contains 1,716 OpenStreetMap features used by the prototype: streets, building footprints, and small water features. It is a downtown detail, not a ZIP boundary dataset.

- Source: [OpenStreetMap](https://www.openstreetmap.org/), retrieved through [Overpass](https://overpass.kumi.systems/api/interpreter).
- Retrieval date: September 13, 2026.
- Street/water query bounds: south 37.799, west -122.278, north 37.814, east -122.259.
- Building query bounds: south 37.802, west -122.275, north 37.811, east -122.263.
- Transformations: select road classes, building outlines, and water polygons; round coordinates to six decimals; retain feature kind, name, and road class; orient polygon rings for D3's spherical projection.
- Coordinates: longitude/latitude, WGS 84.

The application projects the geometry with D3 Mercator and paints it into a Three.js map texture. Prediction values are generated separately and are not OpenStreetMap data.

Map data © OpenStreetMap contributors. Licensed under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
