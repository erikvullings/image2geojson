import m from 'mithril';
import { PMTiles, FileSource } from 'pmtiles';
import type { MeiosisCell } from '../state';
import type { AppState, TileSourceConfig } from '../state/types';
import { pmProtocol } from './MapView';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

export const SettingsPanel: m.Component<Attrs> = {
  view({ attrs: { cell } }) {
    if (!cell.state.ui.settingsOpen) return null;

    const cfg = cell.state.tileSource;
    const set = (partial: Partial<TileSourceConfig>) =>
      cell.update({ tileSource: { ...cfg, ...partial } });

    return m('div.settings-panel', [
      m('div.settings-header', [
        m('h3', 'Tile Source'),
        m('button.btn-close', {
          onclick: () => cell.update({ ui: { ...cell.state.ui, settingsOpen: false } }),
        }, '✕'),
      ]),
      m('div.settings-body', [
        m('label', [
          m('input', { type: 'radio', name: 'tile-type', checked: cfg.type === 'preset',
            onchange: () => set({ type: 'preset' }) }),
          ' Use preset',
        ]),
        cfg.type === 'preset' && m('select.select', {
          value: cfg.preset,
          onchange: (e: Event) =>
            set({ preset: (e.target as HTMLSelectElement).value as TileSourceConfig['preset'] }),
        }, [
          m('option', { value: 'openfreemap' }, 'OpenFreeMap (default)'),
          m('option', { value: 'osm-raster' }, 'OSM Raster'),
        ]),
        m('label', [
          m('input', { type: 'radio', name: 'tile-type', checked: cfg.type === 'custom',
            onchange: () => set({ type: 'custom' }) }),
          ' Custom source',
        ]),
        cfg.type === 'custom' && [
          m('select.select', {
            value: cfg.customType,
            onchange: (e: Event) =>
              set({ customType: (e.target as HTMLSelectElement).value as TileSourceConfig['customType'] }),
          }, [
            m('option', { value: 'style-url' }, 'MapLibre Style URL'),
            m('option', { value: 'xyz-raster' }, 'XYZ Raster ({z}/{x}/{y})'),
            m('option', { value: 'pmtiles-vector' }, 'PMTiles – Vector'),
            m('option', { value: 'pmtiles-raster' }, 'PMTiles – Raster'),
          ]),
          m('input.input', {
            type: 'text',
            placeholder: cfg.customType === 'style-url'
              ? 'https://…/style.json'
              : cfg.customType === 'xyz-raster'
              ? 'https://…/{z}/{x}/{y}.png'
              : 'https://…/tiles.pmtiles  (or pick a local file below)',
            value: cfg.customUrl,
            oninput: (e: Event) => set({ customUrl: (e.target as HTMLInputElement).value }),
          }),
          cfg.customType.startsWith('pmtiles') && m('div.hint', [
            m('label', [
              m('input', {
                type: 'file',
                accept: '.pmtiles',
                onchange: (e: Event) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  // Use FileSource so the PMTiles library uses file.slice() for range reads.
                  // Blob URLs from createObjectURL() do not support HTTP Range requests,
                  // which causes "Wrong magic number" errors for large files.
                  const p = new PMTiles(new FileSource(file));
                  pmProtocol.add(p); // register under file.name as the key
                  set({ customUrl: file.name });
                },
              }),
              ' or pick a local .pmtiles file',
            ]),
            cfg.customUrl && !cfg.customUrl.startsWith('http') &&
              m('span.hint-note', `Using local file: ${cfg.customUrl}`),
          ]),
        ],
      ]),
    ]);
  },
};
