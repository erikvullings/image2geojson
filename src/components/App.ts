import m from 'mithril';
import type { MeiosisCell } from '../state';
import type { AppState } from '../state/types';
import { canUndo, canRedo, undo, redo } from '../state';
import { Toolbar } from './Toolbar';
import { MapView } from './MapView';
import { ImageOverlay } from './ImageOverlay';
import { DrawPanel } from './DrawPanel';
import { TracePanel } from './TracePanel';
import { SettingsPanel } from './SettingsPanel';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

export function handleImageFile(file: File, cell: MeiosisCell<AppState>) {
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result as string;
    // Measure natural dimensions before storing
    const probe = new Image();
    probe.onload = () => {
      cell.update({
        image: {
          ...cell.state.image,
          src,
          naturalWidth: probe.naturalWidth,
          naturalHeight: probe.naturalHeight,
          pinned: false,
        },
        ui: { ...cell.state.ui, mode: 'georeference' },
      });
      m.redraw();
    };
    probe.src = src;
  };
  reader.readAsDataURL(file);
}

function isImageFile(file: File) {
  return file.type.startsWith('image/');
}

// Track drag-over state outside of component to avoid stale closures
let dragDepth = 0;
let isDraggingOver = false;

export const App: m.Component<Attrs> = {
  oncreate({ attrs: { cell }, dom }) {
    // ── Paste ────────────────────────────────────────────────────────────
    window.addEventListener('paste', (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) handleImageFile(file, cell);
          break;
        }
      }
    });

    // ── Drag-and-drop ────────────────────────────────────────────────────
    const el = dom as HTMLElement;

    el.addEventListener('dragenter', (e: DragEvent) => {
      e.preventDefault();
      dragDepth++;
      if (!isDraggingOver) {
        isDraggingOver = true;
        m.redraw();
      }
    });

    el.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      // signal that we accept the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    el.addEventListener('dragleave', () => {
      dragDepth--;
      if (dragDepth <= 0) {
        dragDepth = 0;
        isDraggingOver = false;
        m.redraw();
      }
    });

    el.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      dragDepth = 0;
      isDraggingOver = false;
      const file = Array.from(e.dataTransfer?.files ?? []).find(isImageFile);
      if (file) handleImageFile(file, cell);
      m.redraw();
    });

    // ── Keyboard shortcuts ───────────────────────────────────────────────
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (canUndo()) { undo(cell); m.redraw(); }
        e.preventDefault(); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (canRedo()) { redo(cell); m.redraw(); }
        e.preventDefault(); return;
      }
      switch (e.key.toLowerCase()) {
        case 'g': cell.update({ ui: { ...cell.state.ui, mode: 'georeference' } }); m.redraw(); break;
        case 'd': cell.update({ ui: { ...cell.state.ui, mode: 'draw' } }); m.redraw(); break;
        case 't': cell.update({ ui: { ...cell.state.ui, mode: 'trace' } }); m.redraw(); break;
      }
    });
  },

  view({ attrs: { cell } }) {
    const state = cell.state;
    const showSidebar = (state.ui.mode === 'draw' || state.ui.mode === 'trace') && state.ui.sidebarOpen;

    return m('div#app', [
      m(Toolbar, { cell }),
      m('div#main', [
        showSidebar &&
          m('div#sidebar', [
            m(DrawPanel, { cell }),
            m(TracePanel, { cell }),
          ]),
        m('div#map-wrapper', [
          m(MapView, { cell }),
          m(ImageOverlay, { cell }),
        ]),
      ]),

      // Upload prompt shown when no image is loaded
      !state.image.src &&
        m('label#upload-prompt', { title: 'Or drag & drop / paste an image (Ctrl+V)' }, [
          '📷 Upload image',
          m('input', {
            type: 'file',
            accept: 'image/*',
            style: 'display:none',
            onchange: (e: Event) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file) handleImageFile(file, cell);
            },
          }),
        ]),

      // Full-screen drop zone overlay (shown while dragging over the window)
      isDraggingOver &&
        m('div#drop-overlay', [
          m('div#drop-target', [
            m('div.drop-icon', '🖼️'),
            m('div.drop-label', 'Drop image here'),
          ]),
        ]),

      m(SettingsPanel, { cell }),
    ]);
  },
};
