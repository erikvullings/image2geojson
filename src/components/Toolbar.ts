import m from 'mithril';
import type { MeiosisCell } from '../state';
import type { AppState } from '../state/types';
import { canUndo, canRedo, undo, redo } from '../state';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

const MILITARY_SCALES: Array<{ label: string; zoom: number }> = [
  { label: '1:25k', zoom: 14 },
  { label: '1:50k', zoom: 13 },
  { label: '1:100k', zoom: 12 },
  { label: '1:250k', zoom: 10 },
  { label: '1:500k', zoom: 9 },
  { label: '1:1M', zoom: 7 },
];

export const Toolbar: m.Component<Attrs> = {
  view({ attrs: { cell } }) {
    const { mode, sidebarOpen } = cell.state.ui;

    const setMode = (next: typeof mode) =>
      cell.update({ ui: { ...cell.state.ui, mode: next } });

    return m('div.toolbar', [
      // Sidebar toggle (only in draw/trace mode)
      (mode === 'draw' || mode === 'trace') && m('button.btn.icon-btn', {
        title: sidebarOpen ? 'Hide sidebar' : 'Show sidebar',
        onclick: () => cell.update({ ui: { ...cell.state.ui, sidebarOpen: !sidebarOpen } }),
      }, sidebarOpen ? '◀' : '▶'),

      m('div.toolbar-group', [
        m('button.btn', { class: mode === 'georeference' ? 'active' : '', title: 'Georeference image (G)', onclick: () => setMode('georeference') }, '📍 Georeference'),
        m('button.btn', { class: mode === 'trace' ? 'active' : '', title: 'Trace image lines (T)', onclick: () => setMode('trace') }, '🔍 Trace'),
        m('button.btn', { class: mode === 'draw' ? 'active' : '', title: 'Draw GeoJSON features (D)', onclick: () => setMode('draw') }, '✏️ Draw'),
      ]),

      m('div.toolbar-group', [
        m('span.label', 'Scale:'),
        ...MILITARY_SCALES.map(({ label, zoom }) =>
          m('button.btn.scale-btn', {
            title: `Zoom to ${label}`,
            onclick: () => cell.update({ map: { ...cell.state.map, zoom } }),
          }, label),
        ),
      ]),

      m('div.toolbar-group.right', [
        m('button.btn.icon-btn', {
          title: 'Undo (Ctrl+Z)',
          disabled: !canUndo(),
          onclick: () => { undo(cell); m.redraw(); },
        }, '↩'),
        m('button.btn.icon-btn', {
          title: 'Redo (Ctrl+Y)',
          disabled: !canRedo(),
          onclick: () => { redo(cell); m.redraw(); },
        }, '↪'),
        m('button.btn', {
          title: 'Tile source settings',
          onclick: () => cell.update({ ui: { ...cell.state.ui, settingsOpen: !cell.state.ui.settingsOpen } }),
        }, '⚙️'),
      ]),
    ]);
  },
};
