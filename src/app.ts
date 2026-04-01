import m from 'mithril';
import { cells } from './state';
import { App } from './components/App';
import 'maplibre-gl/dist/maplibre-gl.css';
import 'maplibre-gl-draw/dist/mapbox-gl-draw.css';
import './assets/style.css';

// Trigger Mithril redraws on every state update
cells.map(() => m.redraw());

m.mount(document.getElementById('app')!, {
  view: () => m(App, { cell: cells() }),
});
