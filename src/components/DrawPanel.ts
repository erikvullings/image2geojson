import m from 'mithril';
import MapboxDraw from 'maplibre-gl-draw';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { MeiosisCell } from '../state';
import type { AppState } from '../state/types';
import { getMap } from './MapView';
import { downloadGeoJSON, parseGeoJSON } from '../services/geojsonExport';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

let draw: MapboxDraw | null = null;
let mapListenerAttached = false;

// ── Draw initialisation ───────────────────────────────────────────────────────

function initDraw(cell: MeiosisCell<AppState>) {
  const map = getMap();
  if (!map || draw) return;

  if (!map.loaded()) {
    map.once('idle', () => initDraw(cell));
    return;
  }

  draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: { point: true, line_string: true, polygon: true, trash: true },
    boxSelect: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map.addControl(draw as any, 'top-right');

  setTimeout(() => {
    if (!draw) return;
    if (cell.state.geojson.features.length > 0) {
      draw.add(cell.state.geojson);
      const synced = draw.getAll() as FeatureCollection;
      if (synced.features.length > 0) cell.update({ geojson: synced });
    }
  }, 0);

  if (!mapListenerAttached) {
    mapListenerAttached = true;
    const syncToState = () => {
      if (!draw) return;
      cell.update({ geojson: draw.getAll() as FeatureCollection });
    };
    map.on('draw.create', syncToState);
    map.on('draw.update', syncToState);
    map.on('draw.delete', () => {
      if (!draw) return;
      const fc = draw.getAll() as FeatureCollection;
      const remainingIds = new Set(fc.features.map((f) => String(f.id)));
      const selectedIds = cell.state.ui.selectedFeatureIds.filter((id) => remainingIds.has(id));
      cell.update({ geojson: fc, ui: { ...cell.state.ui, selectedFeatureIds: selectedIds } });
    });
    map.on('draw.selectionchange', (e: { features: Feature[] }) => {
      const ids = e.features.map((f) => String(f.id));
      cell.update({ ui: { ...cell.state.ui, selectedFeatureIds: ids } });
      // Pan (no zoom) to the centroid of the first selected feature
      if (e.features.length === 1) {
        try {
          const coords = collectCoords(e.features[0]);
          if (coords.length > 0) {
            const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
            const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
            map.panTo([lng, lat], { duration: 300 });
          }
        } catch { /* ignore */ }
      }
    });
  }
}

function removeDraw() {
  const map = getMap();
  if (!map || !draw) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  map.removeControl(draw as any);
  draw = null;
  mapListenerAttached = false;
}

/** Flatten all coordinate positions out of any GeoJSON geometry. */
function collectCoords(f: Feature): number[][] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recurse = (x: any): number[][] => {
    if (!Array.isArray(x)) return [];
    if (typeof x[0] === 'number') return [x as number[]];
    return x.flatMap(recurse);
  };
  return recurse(f.geometry);
}

/** Push an updated FeatureCollection into the draw control and sync IDs back to state. */
export function refreshDraw(cell: MeiosisCell<AppState>, fc: FeatureCollection) {
  if (!draw) return;
  draw.deleteAll();
  draw.add(fc);
  const synced = draw.getAll() as FeatureCollection;
  if (synced.features.length > 0) cell.update({ geojson: synced });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setProp(cell: MeiosisCell<AppState>, id: string, key: string, value: string) {
  const features = cell.state.geojson.features.map((f: Feature) =>
    String(f.id) === id ? { ...f, properties: { ...(f.properties ?? {}), [key]: value } } : f,
  );
  cell.update({ geojson: { ...cell.state.geojson, features } });
  draw?.setFeatureProperty(id, key, value);
}

/**
 * Join an ordered array of LineStrings by greedily connecting nearest endpoints.
 * Returns the merged Feature (id + properties taken from the first feature).
 */
function joinLines(feats: Feature[]): Feature | null {
  const lines = feats.filter((f) => f.geometry.type === 'LineString');
  if (lines.length < 2) return null;

  const d = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let chain: number[][] = [...(lines[0].geometry as LineString).coordinates];

  const remaining = lines.slice(1);
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    let bestCoords: number[][] = [];

    const chainS = chain[0];
    const chainE = chain[chain.length - 1];

    remaining.forEach((feat, idx) => {
      const bc = (feat.geometry as LineString).coordinates;
      const bS = bc[0], bE = bc[bc.length - 1];
      const opts = [
        { dist: d(chainE, bS), coords: [...chain, ...bc.slice(1)] },
        { dist: d(chainE, bE), coords: [...chain, ...[...bc].reverse().slice(1)] },
        { dist: d(chainS, bE), coords: [...bc, ...chain.slice(1)] },
        { dist: d(chainS, bS), coords: [...[...bc].reverse(), ...chain.slice(1)] },
      ];
      const best = opts.reduce((a, b) => a.dist < b.dist ? a : b);
      if (best.dist < bestDist) {
        bestDist = best.dist;
        bestIdx = idx;
        bestCoords = best.coords;
      }
    });

    chain = bestCoords;
    remaining.splice(bestIdx, 1);
  }

  return {
    type: 'Feature',
    id: lines[0].id,
    properties: { ...(lines[0].properties ?? {}) },
    geometry: { type: 'LineString', coordinates: chain } as LineString,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export const DrawPanel: m.Component<Attrs> = {
  view({ attrs: { cell } }) {
    const isDrawMode = cell.state.ui.mode === 'draw';

    if (isDrawMode) {
      setTimeout(() => initDraw(cell), 50);
    } else {
      removeDraw();
    }

    if (!isDrawMode) return null;

    const { geojson, ui } = cell.state;
    const features = geojson.features;
    const selectedIds = ui.selectedFeatureIds;
    const selectedFeats = features.filter((f: Feature) => selectedIds.includes(String(f.id)));
    const selectedLines = selectedFeats.filter((f: Feature) => f.geometry.type === 'LineString');
    const multiSelected = selectedIds.length > 1;

    const selectFeat = (f: Feature, evt?: MouseEvent) => {
      const id = String(f.id);
      let nextIds: string[];
      if (evt && (evt.metaKey || evt.ctrlKey)) {
        nextIds = selectedIds.includes(id)
          ? selectedIds.filter((x) => x !== id)
          : [...selectedIds, id];
      } else {
        nextIds = [id];
      }
      cell.update({ ui: { ...ui, selectedFeatureIds: nextIds } });
      draw?.changeMode('simple_select', { featureIds: nextIds });
    };

    const deleteSelected = () => {
      const idsToDelete = new Set(selectedIds);
      selectedIds.forEach((id) => draw?.delete(id));
      cell.update({
        geojson: { ...geojson, features: features.filter((f: Feature) => !idsToDelete.has(String(f.id))) },
        ui: { ...ui, selectedFeatureIds: [] },
      });
    };

    const deleteFeat = (f: Feature, i: number) => {
      const fid = String(f.id);
      draw?.delete(fid);
      cell.update({
        geojson: { ...geojson, features: features.filter((_: Feature, j: number) => j !== i) },
        ui: { ...ui, selectedFeatureIds: selectedIds.filter((x) => x !== fid) },
      });
    };

    const joinSelected = () => {
      if (selectedLines.length < 2) return;
      const joined = joinLines(selectedLines);
      if (!joined) { alert('Could not join — all selected features must be LineStrings.'); return; }
      const idsToRemove = new Set(selectedLines.map((f) => String(f.id)));
      const newFeatures = features.filter((f: Feature) => !idsToRemove.has(String(f.id)));
      newFeatures.push(joined);
      const newFc: FeatureCollection = { type: 'FeatureCollection', features: newFeatures };
      const keepId = String(joined.id!);
      cell.update({ geojson: newFc, ui: { ...ui, selectedFeatureIds: [keepId] } });
      draw?.deleteAll();
      draw?.add(newFc);
      draw?.changeMode('simple_select', { featureIds: [keepId] });
    };

    // Single-selection id (for inline props editor)
    const soloId = selectedIds.length === 1 ? selectedIds[0] : null;

    return m('div#draw-panel', [

      // ── Header ───────────────────────────────────────────────────────────────
      m('div.panel-header', [
        m('h3', `Features (${features.length})`),
        m('div.panel-actions', [
          m('button.btn', {
            title: 'Import GeoJSON',
            onclick: () => {
              const inp = document.createElement('input');
              inp.type = 'file'; inp.accept = '.geojson,.json';
              inp.onchange = () => {
                const file = inp.files?.[0];
                if (!file) return;
                void file.text().then((text) => {
                  const fc = parseGeoJSON(text);
                  if (!fc) { alert('Invalid GeoJSON'); return; }
                  cell.update({ geojson: fc });
                  draw?.deleteAll(); draw?.add(fc);
                });
              };
              inp.click();
            },
          }, '📂'),
          m('button.btn', { title: 'Export GeoJSON', onclick: () => downloadGeoJSON(geojson) }, '💾'),
          features.length > 0 && m('button.btn.btn-danger', {
            title: `Clear all ${features.length} features`,
            onclick: () => {
              if (!confirm(`Delete all ${features.length} feature${features.length === 1 ? '' : 's'}?`)) return;
              const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
              cell.update({ geojson: empty, ui: { ...ui, selectedFeatureIds: [] } });
              draw?.deleteAll();
            },
          }, '🗑 Clear all'),
        ]),
      ]),

      // ── Multi-selection action bar ────────────────────────────────────────────
      multiSelected && m('div.multi-select-bar', [
        m('span', `${selectedIds.length} selected`),
        selectedLines.length >= 2 && m('button.btn.btn-sm', {
          title: 'Join all selected linestrings into one',
          onclick: joinSelected,
        }, '⛓ Join'),
        m('button.btn.btn-sm.btn-danger', {
          title: `Delete ${selectedIds.length} selected features`,
          onclick: () => {
            if (!confirm(`Delete ${selectedIds.length} selected feature${selectedIds.length === 1 ? '' : 's'}?`)) return;
            deleteSelected();
          },
        }, '🗑 Delete selected'),
      ]),

      // ── Feature list ─────────────────────────────────────────────────────────
      m('ul.feature-list',
        features.length === 0
          ? m('li.empty', 'No features yet. Use the draw tools or Trace tab. Drag on the map to box-select multiple.')
          : features.map((f: Feature, i: number) => {
              const fid = String(f.id);
              const isSelected = selectedIds.includes(fid);
              const fprops = (f.properties ?? {}) as Record<string, string>;
              const fname = fprops.name || f.geometry.type;
              const icon = f.geometry.type === 'Polygon' ? '⬡' : f.geometry.type === 'Point' ? '●' : '〜';

              return m('li.feature-item', {
                key: fid,
                class: isSelected ? 'selected' : '',
                onclick: (e: MouseEvent) => selectFeat(f, e),
              }, [
                m('div.feature-row', [
                  m('span.feature-icon', icon),
                  m('span.feature-type', fname),
                  m('div.feature-actions', [
                    f.geometry.type === 'LineString' && m('button.btn-icon', {
                      title: 'Edit vertices',
                      onclick: (e: Event) => {
                        e.stopPropagation();
                        cell.update({ ui: { ...ui, selectedFeatureIds: [fid] } });
                        draw?.changeMode('direct_select', { featureId: fid });
                      },
                    }, '✱'),
                    m('button.btn-icon', {
                      title: 'Delete feature',
                      onclick: (e: Event) => { e.stopPropagation(); deleteFeat(f, i); },
                    }, '🗑'),
                  ]),
                ]),
                soloId === fid && m('div.inline-props', {
                  onclick: (e: Event) => e.stopPropagation(),
                }, [
                  m('input.prop-input', {
                    type: 'text', placeholder: 'Name',
                    value: fprops.name ?? '',
                    oninput: (e: Event) => setProp(cell, fid, 'name', (e.target as HTMLInputElement).value),
                  }),
                  m('input.prop-input', {
                    type: 'text', placeholder: 'Type (e.g. phase-line, boundary)',
                    value: fprops.type ?? '',
                    list: 'feature-type-list',
                    oninput: (e: Event) => setProp(cell, fid, 'type', (e.target as HTMLInputElement).value),
                  }),
                  m('datalist#feature-type-list', [
                    'phase-line', 'axis-of-advance', 'boundary', 'engagement-area',
                    'assault-position', 'fire-support-area', 'obstacle', 'route',
                  ].map((t) => m('option', { value: t }))),
                  m('textarea.prop-input', {
                    placeholder: 'Description', rows: 2,
                    value: fprops.desc ?? '',
                    oninput: (e: Event) => setProp(cell, fid, 'desc', (e.target as HTMLTextAreaElement).value),
                  }),
                  f.geometry.type === 'LineString' && m('button.btn.btn-sm', {
                    onclick: () => draw?.changeMode('direct_select', { featureId: fid }),
                  }, '✱ Edit vertices'),
                ]),
              ]);
            }),
      ),
    ]);
  },
};
