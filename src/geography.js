import { geoMercator } from "d3";

export const WORLD = { width: 12.4, depth: 9.3, textureWidth: 2048, textureHeight: 1536 };
export const OAKLAND_BOUNDS = [-122.2763, 37.8011, -122.2622, 37.8104];

/** Geography stays independent of the camera and probability model. */
export function createProjection([west, south, east, north]) {
  const { width, depth, textureWidth, textureHeight } = WORLD;
  const geo = geoMercator().fitExtent([[24, 24], [textureWidth - 24, textureHeight - 24]], {
    type: "MultiPoint", coordinates: [[west, south], [east, north]],
  });
  return {
    geo,
    project(longitude, latitude) {
      const [x, y] = geo([longitude, latitude]);
      return { x: (x / textureWidth - 0.5) * width, z: (y / textureHeight - 0.5) * depth };
    },
    unproject(x, z) {
      return geo.invert([(x / width + 0.5) * textureWidth, (z / depth + 0.5) * textureHeight]);
    },
  };
}
