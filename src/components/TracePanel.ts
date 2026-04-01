import m from 'mithril';
import type { FeatureCollection } from 'geojson';
import type { MeiosisCell } from '../state';
import type { AppState } from '../state/types';
import { traceImageToGeoJSON } from '../services/imageTracer';
import { downloadGeoJSON } from '../services/geojsonExport';
import { getMap } from './MapView';
import { refreshDraw } from './DrawPanel';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

const PREVIEW_SOURCE = 'trace-preview';

let tracing = false;
let previewFc: FeatureCollection | null = null;

function showPreviewOnMap(fc: FeatureCollection) {
  const map = getMap();
  if (!map) return;
  clearPreviewFromMap();
  map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: fc });
  map.addLayer({ id: 'trace-preview-fills',   type: 'fill',   source: PREVIEW_SOURCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#e63946', 'fill-opacity': 0.25 } });
  map.addLayer({ id: 'trace-preview-lines',   type: 'line',   source: PREVIEW_SOURCE,
    filter: ['in', ['geometry-type'], ['literal', ['LineString', 'Polygon']]],
    paint: { 'line-color': '#e63946', 'line-width': 2 } });
  map.addLayer({ id: 'trace-preview-points',  type: 'circle', source: PREVIEW_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-color': '#e63946', 'circle-radius': 5 } });
}

function clearPreviewFromMap() {
  const map = getMap();
  if (!map) return;
  try {
    for (const id of ['trace-preview-points', 'trace-preview-lines', 'trace-preview-fills']) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(PREVIEW_SOURCE)) map.removeSource(PREVIEW_SOURCE);
  } catch { /* ignore — map may be mid-style-reload */ }
}

export const TracePanel: m.Component<Attrs> = {
  onremove() {
    clearPreviewFromMap();
  },

  view({ attrs: { cell } }) {
    if (cell.state.ui.mode !== 'trace') {
      clearPreviewFromMap();
      return null;
    }

    const img = cell.state.image;
    const ts = cell.state.ui.traceSettings;
    const canTrace = !!img.src && img.pinned && !!img.geoCorners;

    const runTrace = async () => {
      if (!canTrace || tracing) return;
      tracing = true;
      previewFc = null;
      clearPreviewFromMap();
      m.redraw();
      try {
        previewFc = await traceImageToGeoJSON(img.src!, img.geoCorners!, ts);
        if (previewFc.features.length > 0) showPreviewOnMap(previewFc);
      } finally {
        tracing = false;
        m.redraw();
      }
    };

    const commit = () => {
      if (!previewFc) return;
      const merged: FeatureCollection = {
        type: 'FeatureCollection',
        features: [...cell.state.geojson.features, ...previewFc.features],
      };
      cell.update({
        geojson: merged,
        ui: { ...cell.state.ui, mode: 'draw' },   // switch to draw so features are visible
      });
      clearPreviewFromMap();
      // Give mapbox-gl-draw time to initialise before pushing features
      setTimeout(() => refreshDraw(cell, merged), 150);
      previewFc = null;
      m.redraw();
    };

    const discard = () => {
      clearPreviewFromMap();
      previewFc = null;
      m.redraw();
    };

    const setTs = (partial: Partial<typeof ts>) =>
      cell.update({ ui: { ...cell.state.ui, traceSettings: { ...ts, ...partial } } });

    return m('div#trace-panel', [
      m('div.panel-header', m('h3', 'Trace Image')),
      !img.src && m('p.hint', 'Upload an image first (Georeference mode).'),
      img.src && !img.pinned && m('p.hint', 'Pin the image to the map before tracing.'),
      canTrace && [
        m('div.trace-settings', [
          m('label', ['Threshold (dark line detection)',
            m('input', { type: 'range', min: 10, max: 245, step: 5, value: ts.threshold,
              oninput: (e: Event) => setTs({ threshold: parseInt((e.target as HTMLInputElement).value, 10) }) }),
            m('span', ts.threshold),
          ]),
          m('label', ['Blur radius',
            m('input', { type: 'range', min: 0, max: 5, step: 1, value: ts.blurRadius,
              oninput: (e: Event) => setTs({ blurRadius: parseInt((e.target as HTMLInputElement).value, 10) }) }),
            m('span', ts.blurRadius),
          ]),
          m('label', ['Simplification',
            m('input', { type: 'range', min: 0, max: 0.001, step: 0.00001, value: ts.simplification,
              oninput: (e: Event) => setTs({ simplification: parseFloat((e.target as HTMLInputElement).value) }) }),
            m('span', ts.simplification.toFixed(5)),
          ]),
        ]),
        m('button.btn.btn-primary', { onclick: () => void runTrace(), disabled: tracing },
          tracing ? '⏳ Tracing…' : '🔍 Run trace'),
      ],
      previewFc && [
        m('p.trace-result', `Found ${previewFc.features.length} features — shown in red on map.`),
        m('div.trace-actions', [
          m('button.btn.btn-primary', { onclick: commit }, '✅ Add to GeoJSON'),
          m('button.btn', { onclick: () => downloadGeoJSON(previewFc!, 'traced.geojson') }, '💾 Export preview'),
          m('button.btn', { onclick: discard }, '✕ Discard'),
        ]),
      ],
    ]);
  },
};

