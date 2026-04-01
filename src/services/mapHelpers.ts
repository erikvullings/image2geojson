import maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import type { TileSourceConfig } from '../state/types';

const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 19,
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

/**
 * Clean, sprite-free style for OpenMapTiles / Planetiler vector PMTiles.
 *
 * Key design decisions:
 * - No sprite → no "image could not be loaded" errors killing label layers
 * - Uses `match` (not `in`) for set membership → MapLibre v5 compatible
 * - Uses `coalesce` on numeric properties → avoids "Expected number, found null" crashes
 * - All road classes get labels; all place types get labels at appropriate zoom levels
 */
function buildVectorPMTilesStyle(url: string): StyleSpecification {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const src = 'openmaptiles';
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { [src]: { type: 'vector', url: `pmtiles://${url}` } },
    layers: [
      // ── Base ──────────────────────────────────────────────────────────────
      { id: 'background', type: 'background',
        paint: { 'background-color': '#f8f4f0' } },

      // ── Land cover ────────────────────────────────────────────────────────
      { id: 'lc-forest', type: 'fill', source: src, 'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['wood', 'forest'], true, false] as any,
        paint: { 'fill-color': '#b8dcb8', 'fill-opacity': 0.7 } },
      { id: 'lc-grass', type: 'fill', source: src, 'source-layer': 'landcover',
        filter: ['match', ['get', 'class'], ['grass', 'scrub', 'wetland', 'sand'], true, false] as any,
        paint: { 'fill-color': '#ddf0d0', 'fill-opacity': 0.6 } },

      // ── Land use ──────────────────────────────────────────────────────────
      { id: 'lu-residential', type: 'fill', source: src, 'source-layer': 'landuse',
        filter: ['==', ['get', 'class'], 'residential'] as any,
        paint: { 'fill-color': '#ede8e0', 'fill-opacity': 0.8 } },
      { id: 'lu-industrial', type: 'fill', source: src, 'source-layer': 'landuse',
        filter: ['match', ['get', 'class'], ['industrial', 'commercial', 'retail'], true, false] as any,
        paint: { 'fill-color': '#f5e6c8', 'fill-opacity': 0.7 } },
      { id: 'lu-park', type: 'fill', source: src, 'source-layer': 'park',
        paint: { 'fill-color': '#c6e8c6', 'fill-opacity': 0.6 } },

      // ── Water ─────────────────────────────────────────────────────────────
      { id: 'water', type: 'fill', source: src, 'source-layer': 'water',
        paint: { 'fill-color': '#9fc8e8' } },
      { id: 'waterway', type: 'line', source: src, 'source-layer': 'waterway',
        paint: { 'line-color': '#9fc8e8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] as any } },

      // ── Buildings ─────────────────────────────────────────────────────────
      { id: 'building', type: 'fill', source: src, 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-color': '#d6cfc7', 'fill-outline-color': '#b8b0a6' } },

      // ── Roads (drawn back-to-front for proper overlap) ────────────────────
      { id: 'road-path', type: 'line', source: src, 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['path', 'track'], true, false] as any,
        paint: { 'line-color': '#d8d0c0', 'line-width': 1,
          'line-dasharray': [3, 2] as any } },
      { id: 'road-minor', type: 'line', source: src, 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['minor', 'service'], true, false] as any,
        paint: { 'line-color': '#f8f4f0',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 4] as any } },
      { id: 'road-secondary', type: 'line', source: src, 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['secondary', 'tertiary'], true, false] as any,
        paint: { 'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 5] as any } },
      { id: 'road-primary', type: 'line', source: src, 'source-layer': 'transportation',
        filter: ['match', ['get', 'class'], ['primary', 'trunk'], true, false] as any,
        paint: { 'line-color': '#ffd080',
          'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 14, 7] as any } },
      { id: 'road-motorway', type: 'line', source: src, 'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'motorway'] as any,
        paint: { 'line-color': '#fc8d62',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 14, 9] as any } },
      { id: 'railway', type: 'line', source: src, 'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'] as any, minzoom: 9,
        paint: { 'line-color': '#aaa', 'line-width': 1 } },

      // ── Boundaries ───────────────────────────────────────────────────────
      // This Planetiler build stores no admin_level field in boundary tiles,
      // so just draw all boundary lines with a uniform style.
      { id: 'boundary', type: 'line', source: src, 'source-layer': 'boundary',
        paint: { 'line-color': '#aaa', 'line-width': 1,
          'line-dasharray': [4, 2] as any } },

      // ── Labels ────────────────────────────────────────────────────────────
      // Water names (italic blue)
      { id: 'lbl-water', type: 'symbol', source: src, 'source-layer': 'water_name',
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Italic'],
          'text-size': 12,
        },
        paint: { 'text-color': '#4080b0', 'text-halo-color': '#f8f4f0', 'text-halo-width': 1 } },

      // Country names
      { id: 'lbl-country', type: 'symbol', source: src, 'source-layer': 'place',
        maxzoom: 7,
        filter: ['==', ['get', 'class'], 'country'] as any,
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 6, 16] as any,
          'text-max-width': 6,
        },
        paint: { 'text-color': '#333', 'text-halo-color': '#f8f4f0', 'text-halo-width': 2 } },

      // State / Bundesland names
      { id: 'lbl-state', type: 'symbol', source: src, 'source-layer': 'place',
        minzoom: 5, maxzoom: 10,
        filter: ['==', ['get', 'class'], 'state'] as any,
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Regular'],
          'text-size': 12, 'text-max-width': 8,
        },
        paint: { 'text-color': '#666', 'text-halo-color': '#f8f4f0', 'text-halo-width': 1.5 } },

      // City names
      { id: 'lbl-city', type: 'symbol', source: src, 'source-layer': 'place',
        minzoom: 4,
        filter: ['==', ['get', 'class'], 'city'] as any,
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 14, 12, 20] as any,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#222', 'text-halo-color': '#f8f4f0', 'text-halo-width': 2 } },

      // Town names
      { id: 'lbl-town', type: 'symbol', source: src, 'source-layer': 'place',
        minzoom: 8,
        filter: ['==', ['get', 'class'], 'town'] as any,
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 14] as any,
          'text-max-width': 8,
        },
        paint: { 'text-color': '#333', 'text-halo-color': '#f8f4f0', 'text-halo-width': 1.5 } },

      // Village / suburb / neighbourhood names
      { id: 'lbl-village', type: 'symbol', source: src, 'source-layer': 'place',
        minzoom: 11,
        filter: ['match', ['get', 'class'],
          ['village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'isolated_dwelling'],
          true, false] as any,
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11, 'text-max-width': 8,
        },
        paint: { 'text-color': '#555', 'text-halo-color': '#f8f4f0', 'text-halo-width': 1 } },

      // Road names — all classes, symbol-placement:line keeps them on the road
      { id: 'lbl-road', type: 'symbol', source: src, 'source-layer': 'transportation_name',
        minzoom: 12,
        layout: {
          'text-field': ['get', 'name:latin'] as any,
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'symbol-placement': 'line',
          'text-max-angle': 30,
          'text-padding': 2,
        },
        paint: { 'text-color': '#555', 'text-halo-color': '#fff', 'text-halo-width': 1 } },
    ],
  } as StyleSpecification;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function buildMapStyle(cfg: TileSourceConfig): string | StyleSpecification {
  if (cfg.type === 'preset') {
    return cfg.preset === 'openfreemap' ? OPENFREEMAP_STYLE : OSM_RASTER_STYLE;
  }
  switch (cfg.customType) {
    case 'style-url':
      return cfg.customUrl;
    case 'xyz-raster':
      return {
        version: 8,
        sources: {
          custom: {
            type: 'raster',
            tiles: [cfg.customUrl],
            tileSize: 256,
            attribution: 'Custom tile source',
          },
        },
        layers: [{ id: 'custom', type: 'raster', source: 'custom' }],
      } as StyleSpecification;
    case 'pmtiles-vector':
      return buildVectorPMTilesStyle(cfg.customUrl);
    case 'pmtiles-raster':
      return {
        version: 8,
        sources: {
          pmraster: { type: 'raster', url: `pmtiles://${cfg.customUrl}`, tileSize: 256 },
        },
        layers: [{ id: 'pmraster', type: 'raster', source: 'pmraster' }],
      } as StyleSpecification;
  }
}

export { maplibregl };
