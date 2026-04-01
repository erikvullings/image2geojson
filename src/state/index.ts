import { meiosisSetup } from 'meiosis-setup';
import type { MeiosisCell } from 'meiosis-setup/types';
import type { AppState } from './types';
import { pushHistory } from './history';

export type { MeiosisCell };
export { canUndo, canRedo, undo, redo } from './history';

const STORAGE_KEY = 'image2geojson-state';

export const defaultState: AppState = {
  map: { center: [10, 50], zoom: 5 },
  tileSource: {
    type: 'preset',
    preset: 'openfreemap',
    customUrl: '',
    customType: 'style-url',
  },
  image: {
    src: null,
    naturalWidth: 0,
    naturalHeight: 0,
    transform: {
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      skewX: 0,
      skewY: 0,
    },
    opacity: 0.7,
    pinned: false,
  },
  geojson: { type: 'FeatureCollection', features: [] },
  ui: {
    mode: 'georeference',
    drawMode: 'none',
    selectedFeatureIds: [],
    sidebarOpen: true,
    settingsOpen: false,
    traceSettings: {
      colorMode: 'black',
      threshold: 128,
      simplification: 0.00001,
      blurRadius: 1,
    },
  },
};

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    // Deep merge loaded state over defaults so new fields are always present
    return deepMerge(defaultState, JSON.parse(raw) as Partial<AppState>);
  } catch {
    return defaultState;
  }
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const v = override[key];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && typeof base[key] === 'object') {
      result[key] = deepMerge(base[key] as object, v as object) as T[typeof key];
    } else if (v !== undefined) {
      result[key] = v as T[typeof key];
    }
  }
  return result;
}

function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage quota exceeded — silently ignore
  }
}

const cells = meiosisSetup<AppState>({
  app: { initial: loadState() },
});

// Persist every state change and record history
cells.map((cell) => {
  saveState(cell.state);
  pushHistory(cell.state);
});

export { cells };
