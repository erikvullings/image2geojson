import type { FeatureCollection } from 'geojson';

export type DrawMode = 'none' | 'point' | 'line' | 'polygon' | 'select';
export type AppMode = 'georeference' | 'draw' | 'trace';
export type TilePreset = 'openfreemap' | 'osm-raster';
export type CustomTileType = 'style-url' | 'xyz-raster' | 'pmtiles-vector' | 'pmtiles-raster';

export interface ImageTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
}

export interface ImageState {
  src: string | null;
  /** Natural pixel dimensions of the loaded image — set on first load */
  naturalWidth: number;
  naturalHeight: number;
  transform: ImageTransform;
  opacity: number;
  pinned: boolean;
  /** Geographic coords of [TL, TR, BR, BL] corners when pinned */
  geoCorners?: [[number, number], [number, number], [number, number], [number, number]];
}

export interface TileSourceConfig {
  type: 'preset' | 'custom';
  preset: TilePreset;
  customUrl: string;
  customType: CustomTileType;
}

export interface TraceSettings {
  colorMode: 'black' | 'color';
  threshold: number;
  simplification: number;
  blurRadius: number;
  fitSource: 'areas' | 'lines' | 'auto';
}

export interface UIState {
  mode: AppMode;
  drawMode: DrawMode;
  selectedFeatureIds: string[];
  sidebarOpen: boolean;
  settingsOpen: boolean;
  traceSettings: TraceSettings;
}

export interface AppState {
  map: {
    center: [number, number];
    zoom: number;
  };
  tileSource: TileSourceConfig;
  image: ImageState;
  geojson: FeatureCollection;
  ui: UIState;
}
