import m from 'mithril';
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { MeiosisCell } from '../state';
import type { AppState } from '../state/types';
import { buildMapStyle } from '../services/mapHelpers';
import { inspectPmtiles } from '../services/pmtiles';
import { SearchBox } from './SearchBox';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

let map: maplibregl.Map | null = null;
let coordEl: HTMLElement | null = null;
let lastTileSourceKey = '';

function tileSourceKey(s: AppState['tileSource']): string {
  return s.type === 'preset'
    ? `preset::${s.preset}`
    : `custom::${s.customType}::${s.customUrl}`;
}

function fitMapToPmtilesBounds(
  mapInstance: maplibregl.Map,
  bounds: [number, number, number, number] | null,
): void {
  if (!bounds) return;
  mapInstance.fitBounds(
    [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    { padding: 40, duration: 0 },
  );
}

async function syncPmtilesViewport(
  mapInstance: maplibregl.Map,
  tileSource: AppState['tileSource'],
): Promise<void> {
  if (tileSource.type !== 'custom' || !tileSource.customType.startsWith('pmtiles') || !tileSource.customUrl) {
    return;
  }

  try {
    const { bounds } = await inspectPmtiles(tileSource.customUrl);
    fitMapToPmtilesBounds(mapInstance, bounds);
  } catch {
    // Ignore PMTiles header failures; the map style may still be usable.
  }
}

// Register PMTiles protocol once
export const pmProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmProtocol.tile.bind(pmProtocol));

export const MapView: m.Component<Attrs> = {
  oncreate({ attrs: { cell }, dom }) {
    const state = cell.state;
    lastTileSourceKey = tileSourceKey(state.tileSource);

    map = new maplibregl.Map({
      container: dom as HTMLElement,
      style: buildMapStyle(state.tileSource) as StyleSpecification | string,
      center: state.map.center,
      zoom: state.map.zoom,
      validateStyle: false,
    });
    void syncPmtilesViewport(map, state.tileSource);

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    map.on('moveend', () => {
      if (!map) return;
      const c = map.getCenter();
      cell.update({ map: { center: [c.lng, c.lat], zoom: map.getZoom() } });
    });

    map.on('mousemove', (e) => {
      if (coordEl) {
        coordEl.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
      }
    });

    // Re-attach pinned image overlay after style reloads
    map.on('style.load', () => {
      if (!map) return;
      const img = cell.state.image;
      if (img.pinned && img.src && img.geoCorners) {
        map.addSource('overlay-image', { type: 'image', url: img.src, coordinates: img.geoCorners });
        map.addLayer({
          id: 'overlay-image-layer', type: 'raster', source: 'overlay-image',
          paint: { 'raster-opacity': img.opacity },
        });
      }
    });

    // Watch tile source changes — only call setStyle when source actually changes
    cell.states.map((s) => {
      if (!map) return;
      const key = tileSourceKey(s.tileSource);
      if (key !== lastTileSourceKey) {
        lastTileSourceKey = key;
        const style = buildMapStyle(s.tileSource) as StyleSpecification | string;
        try {
          map.setStyle(style);
          void syncPmtilesViewport(map, s.tileSource);
        } catch {
          /* ignore during init */
        }
      }
    });

    // Watch zoom changes from scale buttons
    cell.states.map((s) => {
      if (!map) return;
      if (Math.abs(s.map.zoom - map.getZoom()) > 0.1) {
        map.easeTo({ zoom: s.map.zoom });
      }
    });
  },

  onremove() {
    map?.remove();
    map = null;
  },

  view() {
    return m('div#map-container', [
      m('div#map', { style: 'width:100%;height:100%;' }),
      m('div#coord-display', {
        oncreate: ({ dom }) => { coordEl = dom as HTMLElement; },
        onremove: () => { coordEl = null; },
      }, '—'),
      m(SearchBox),
    ]);
  },
};

export function getMap(): maplibregl.Map | null {
  return map;
}
