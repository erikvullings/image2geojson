/**
 * Custom MapLibre style layers for maplibre-gl-draw.
 *
 * MapLibre v5 requires array literals inside expressions to be wrapped in
 * ["literal", [...]]. The default draw styles use bare arrays in the
 * `line-dasharray` case expression which now causes validation errors.
 */

const blue   = '#3bb2d0';
const orange = '#fbb03b';
const white  = '#fff';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const drawStyles: any[] = [
  // Polygon fill
  {
    id: 'gl-draw-polygon-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: {
      'fill-color': ['case', ['==', ['get', 'active'], 'true'], orange, blue],
      'fill-opacity': 0.1,
    },
  },
  // Lines + polygon outlines
  {
    id: 'gl-draw-lines',
    type: 'line',
    filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['==', ['get', 'active'], 'true'], orange, blue],
      'line-dasharray': [
        'case',
        ['==', ['get', 'active'], 'true'], ['literal', [0.2, 2]],
        ['literal', [2, 0]],
      ],
      'line-width': 2,
    },
  },
  // Feature points — outer ring (larger for visibility)
  {
    id: 'gl-draw-point-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 12, 9],
      'circle-color': white,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': ['case', ['==', ['get', 'active'], 'true'], orange, blue],
    },
  },
  // Feature points — inner fill
  {
    id: 'gl-draw-point-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'feature']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 8, 6],
      'circle-color': ['case', ['==', ['get', 'active'], 'true'], orange, blue],
    },
  },
  // Vertex handles (direct_select mode) — outer ring
  {
    id: 'gl-draw-vertex-outer',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 8, 6],
      'circle-color': white,
    },
  },
  // Vertex handles — inner fill
  {
    id: 'gl-draw-vertex-inner',
    type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'vertex'], ['!=', 'mode', 'simple_select']],
    paint: {
      'circle-radius': ['case', ['==', ['get', 'active'], 'true'], 6, 4],
      'circle-color': orange,
    },
  },
  // Midpoint handles (click/drag to insert vertex)
  {
    id: 'gl-draw-midpoint',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'midpoint']],
    paint: { 'circle-radius': 5, 'circle-color': orange },
  },
];
