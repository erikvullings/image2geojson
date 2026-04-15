import type maplibregl from 'maplibre-gl';
import type { ImageTransform, TraceSettings } from '../state/types';
import { traceImageToPixelLines } from './imageTracer';
import type { Feature, LineString, FeatureCollection } from 'geojson';

export interface AlignmentSuggestion {
  transform: ImageTransform;
  offset: [number, number];
  score: number;
  matchedSamples: number;
  totalSamples: number;
  source: 'areas' | 'lines';
  extractedFeatures: GeoJSON.FeatureCollection;
  matchedPixelSamples: Array<[number, number]>;
  pickedColor?: string;
}

export type AlignmentMode = 'fit' | 'refine';

const MAX_OVERLAY_SAMPLES = 900;
const MAX_MAP_SAMPLES = 3600;
const CELL_SIZE = 6;
const DEFAULT_LINE_LAYER_HINTS = ['road', 'water', 'waterway', 'boundary', 'rail', 'transport'];
const DEFAULT_FILL_LAYER_HINTS = ['water', 'park', 'forest', 'wood', 'grass', 'landcover', 'landuse', 'wetland'];
const SCALE_DELTAS_COARSE = [0.75, 0.9, 1, 1.1, 1.25];
const SCALE_DELTAS_FINE = [0.92, 0.97, 1, 1.03, 1.08];
const ROTATION_DELTAS_COARSE = [-8, -4, 0, 4, 8];
const ROTATION_DELTAS_FINE = [-2, -1, 0, 1, 2];

function pixelSamplesToGeoJSON(
  pixelSamples: Array<[number, number]>,
  naturalWidth: number,
  naturalHeight: number,
  transform: ImageTransform,
  map: maplibregl.Map,
): FeatureCollection {
  const width = map.getContainer().clientWidth;
  const height = map.getContainer().clientHeight;
  if (pixelSamples.length === 0) return { type: 'FeatureCollection', features: [] };

  const coords: Array<[number, number]> = [];
  for (const [px, py] of pixelSamples) {
    const screenPt = projectOverlayPoint(px, py, naturalWidth, naturalHeight, transform, width, height);
    const lngLat = map.unproject(screenPt);
    coords.push([lngLat.lng, lngLat.lat]);
  }

  const features: Feature<LineString>[] = [{
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords },
  }];
  return { type: 'FeatureCollection' as const, features };
}

function projectOverlayPoint(
  px: number,
  py: number,
  naturalWidth: number,
  naturalHeight: number,
  transform: ImageTransform,
  mapWidth: number,
  mapHeight: number,
): [number, number] {
  const cx = mapWidth / 2 + transform.translateX;
  const cy = mapHeight / 2 + transform.translateY;

  const lx = px - naturalWidth / 2;
  const ly = py - naturalHeight / 2;

  const sx = transform.skewX * Math.PI / 180;
  const sy = transform.skewY * Math.PI / 180;
  const r = transform.rotation * Math.PI / 180;
  const tanSx = Math.tan(sx);
  const tanSy = Math.tan(sy);
  const cosR = Math.cos(r);
  const sinR = Math.sin(r);

  let x = lx * transform.scaleX;
  let y = ly * transform.scaleY;
  y = y + x * tanSy;
  x = x + y * tanSx;

  return [
    cx + x * cosR - y * sinR,
    cy + x * sinR + y * cosR,
  ];
}

function samplePolyline(
  coords: Array<[number, number]>,
  stride: number,
  limit: number,
): Array<[number, number]> {
  const sampled: Array<[number, number]> = [];
  for (let i = 0; i < coords.length && sampled.length < limit; i += stride) {
    sampled.push(coords[i]);
  }
  if (coords.length > 1 && sampled.length < limit) sampled.push(coords[coords.length - 1]);
  return sampled;
}

function averagePoint(points: Array<[number, number]>): [number, number] {
  if (points.length === 0) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of points) {
    sx += x;
    sy += y;
  }
  return [sx / points.length, sy / points.length];
}

function buildOccupancyGrid(points: Array<[number, number]>, width: number, height: number): Set<string> {
  const cols = Math.ceil(width / CELL_SIZE);
  const rows = Math.ceil(height / CELL_SIZE);
  const occupied = new Set<string>();

  for (const [x, y] of points) {
    const cx = Math.round(x / CELL_SIZE);
    const cy = Math.round(y / CELL_SIZE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = cx + ox;
        const ny = cy + oy;
        if (nx >= 0 && nx <= cols && ny >= 0 && ny <= rows) {
          occupied.add(`${nx}:${ny}`);
        }
      }
    }
  }

  return occupied;
}

function getVisibleVectorLineLayerIds(map: maplibregl.Map): string[] {
  const style = map.getStyle();
  if (!style?.layers || !style.sources) return [];

  return style.layers
    .filter((layer) => {
      if (layer.type !== 'line') return false;
      if (!('source' in layer) || !layer.source) return false;
      const source = style.sources[layer.source];
      if (!source || source.type !== 'vector') return false;
      if (layer.id.startsWith('gl-draw-')) return false;
      if (layer.source === 'overlay-image' || layer.source === 'trace-preview') return false;
      return DEFAULT_LINE_LAYER_HINTS.some((hint) => layer.id.includes(hint));
    })
    .map((layer) => layer.id);
}

function getVisibleVectorFillLayerIds(map: maplibregl.Map): string[] {
  const style = map.getStyle();
  if (!style?.layers || !style.sources) return [];

  return style.layers
    .filter((layer) => {
      if (layer.type !== 'fill') return false;
      if (!('source' in layer) || !layer.source) return false;
      const source = style.sources[layer.source];
      if (!source || source.type !== 'vector') return false;
      if (layer.source === 'overlay-image' || layer.source === 'trace-preview') return false;
      return DEFAULT_FILL_LAYER_HINTS.some((hint) => layer.id.includes(hint));
    })
    .map((layer) => layer.id);
}

function scoreOffset(
  overlayPoints: Array<[number, number]>,
  occupied: Set<string>,
  dx: number,
  dy: number,
  width: number,
  height: number,
): number {
  let hits = 0;
  let considered = 0;

  for (const [x, y] of overlayPoints) {
    const tx = x + dx;
    const ty = y + dy;
    if (tx < 0 || tx > width || ty < 0 || ty > height) continue;
    considered++;
    if (occupied.has(`${Math.round(tx / CELL_SIZE)}:${Math.round(ty / CELL_SIZE)}`)) hits++;
  }

  return considered > 0 ? hits / considered : 0;
}

function searchBestOffset(
  overlayPoints: Array<[number, number]>,
  mapPoints: Array<[number, number]>,
  width: number,
  height: number,
): { dx: number; dy: number; score: number } | null {
  if (overlayPoints.length === 0 || mapPoints.length === 0) return null;

  const occupied = buildOccupancyGrid(mapPoints, width, height);
  const overlayCenter = averagePoint(overlayPoints);
  const mapCenter = averagePoint(mapPoints);
  let best = {
    dx: Math.round(mapCenter[0] - overlayCenter[0]),
    dy: Math.round(mapCenter[1] - overlayCenter[1]),
    score: 0,
  };
  const passes = [
    { step: 24, radiusX: 120, radiusY: 120 },
    { step: 8, radiusX: 64, radiusY: 64 },
    { step: 2, radiusX: 16, radiusY: 16 },
  ];

  for (const pass of passes) {
    let localBest = best;
    const minDx = best.dx - pass.radiusX;
    const maxDx = best.dx + pass.radiusX;
    const minDy = best.dy - pass.radiusY;
    const maxDy = best.dy + pass.radiusY;

    for (let dy = minDy; dy <= maxDy; dy += pass.step) {
      for (let dx = minDx; dx <= maxDx; dx += pass.step) {
        const score = scoreOffset(overlayPoints, occupied, dx, dy, width, height);
        if (score > localBest.score) localBest = { dx, dy, score };
      }
    }

    best = localBest;
  }

  return best.score > 0 ? best : null;
}

function projectOverlayPoints(
  pixelPoints: Array<[number, number]>,
  naturalWidth: number,
  naturalHeight: number,
  transform: ImageTransform,
  mapWidth: number,
  mapHeight: number,
): Array<[number, number]> {
  return pixelPoints.map(([px, py]) =>
    projectOverlayPoint(px, py, naturalWidth, naturalHeight, transform, mapWidth, mapHeight),
  );
}

function geometryToLines(geometry: GeoJSON.Geometry): Array<Array<[number, number]>> {
  switch (geometry.type) {
    case 'LineString':
      return [geometry.coordinates as Array<[number, number]>];
    case 'MultiLineString':
      return geometry.coordinates as Array<Array<[number, number]>>;
    case 'Polygon':
      return geometry.coordinates as Array<Array<[number, number]>>;
    case 'MultiPolygon':
      return geometry.coordinates.flat() as Array<Array<[number, number]>>;
    default:
      return [];
  }
}

function collectMapLineSamples(map: maplibregl.Map): Array<[number, number]> {
  const layerIds = getVisibleVectorLineLayerIds(map);
  if (layerIds.length === 0) return [];

  const features = map.queryRenderedFeatures(undefined, { layers: layerIds });
  const points: Array<[number, number]> = [];
  const seen = new Set<string>();

  for (const feature of features) {
    if (!feature.geometry) continue;
    const lines = geometryToLines(feature.geometry);
    for (const line of lines) {
      const stride = Math.max(1, Math.floor(line.length / 30));
      for (const coord of samplePolyline(line, stride, Math.max(6, Math.floor(MAX_MAP_SAMPLES / 24)))) {
        const key = `${coord[0].toFixed(6)}:${coord[1].toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pt = map.project(coord as [number, number]);
        points.push([pt.x, pt.y]);
        if (points.length >= MAX_MAP_SAMPLES) return points;
      }
    }
  }

  return points;
}

function collectMapAreaSamples(map: maplibregl.Map): Array<[number, number]> {
  const layerIds = getVisibleVectorFillLayerIds(map);
  if (layerIds.length === 0) return [];

  const features = map.queryRenderedFeatures(undefined, { layers: layerIds });
  const points: Array<[number, number]> = [];
  const seen = new Set<string>();

  for (const feature of features) {
    if (!feature.geometry) continue;
    const lines = geometryToLines(feature.geometry);
    for (const line of lines) {
      const stride = Math.max(1, Math.floor(line.length / 28));
      for (const coord of samplePolyline(line, stride, Math.max(6, Math.floor(MAX_MAP_SAMPLES / 24)))) {
        const key = `${coord[0].toFixed(6)}:${coord[1].toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const pt = map.project(coord as [number, number]);
        points.push([pt.x, pt.y]);
        if (points.length >= MAX_MAP_SAMPLES) return points;
      }
    }
  }

  return points;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return [0, 0, l];

  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  switch (max) {
    case rn: h = ((gn - bn) / d) % 6; break;
    case gn: h = (bn - rn) / d + 2; break;
    default: h = (rn - gn) / d + 4; break;
  }
  h *= 60;
  if (h < 0) h += 360;
  return [h, s, l];
}

function isBlueish(r: number, g: number, b: number): boolean {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 170 && h <= 260 && s >= 0.12 && l >= 0.18 && l <= 0.9;
}

function isGreenish(r: number, g: number, b: number): boolean {
  const [h, s, l] = rgbToHsl(r, g, b);
  return h >= 70 && h <= 165 && s >= 0.12 && l >= 0.15 && l <= 0.85;
}

function collectBoundaryPixels(
  mask: Uint8Array,
  width: number,
  height: number,
  scale: number,
  limit: number,
): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / Math.max(limit, 1))));

  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) {
      if (!mask[y * width + x]) continue;
      let boundary = false;
      for (let oy = -1; oy <= 1 && !boundary; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          if (!mask[(y + oy) * width + (x + ox)]) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) {
        points.push([x / scale, y / scale]);
        if (points.length >= limit) return points;
      }
    }
  }

  return points;
}

async function collectOverlayAreaSamples(
  imageSrc: string,
  maxSamples: number,
): Promise<Array<[number, number]>> {
  const img = await loadImage(imageSrc);
  const MAX_DIM = 1200;
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.drawImage(img, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const blueMask = new Uint8Array(width * height);
  const greenMask = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    if (isBlueish(r, g, b)) blueMask[i] = 1;
    if (isGreenish(r, g, b)) greenMask[i] = 1;
  }

  const half = Math.max(80, Math.floor(maxSamples / 2));
  const bluePoints = collectBoundaryPixels(blueMask, width, height, scale, half);
  const greenPoints = collectBoundaryPixels(greenMask, width, height, scale, half);
  return [...bluePoints, ...greenPoints].slice(0, maxSamples);
}

function buildSuggestion(
  transform: ImageTransform,
  offset: { dx: number; dy: number; score: number },
  totalSamples: number,
  source: 'areas' | 'lines',
  pixelSamples: Array<[number, number]>,
): AlignmentSuggestion {
  return {
    transform: {
      ...transform,
      translateX: transform.translateX + offset.dx,
      translateY: transform.translateY + offset.dy,
    },
    offset: [offset.dx, offset.dy],
    score: offset.score,
    matchedSamples: Math.round(offset.score * totalSamples),
    totalSamples,
    source,
    extractedFeatures: { type: 'FeatureCollection', features: [] },
    matchedPixelSamples: pixelSamples,
  };
}

function suggestFromSamples(
  mapPoints: Array<[number, number]>,
  overlayPixelPoints: Array<[number, number]>,
  naturalWidth: number,
  naturalHeight: number,
  transform: ImageTransform,
  width: number,
  height: number,
  mode: AlignmentMode,
  source: 'areas' | 'lines',
): AlignmentSuggestion | null {
  if (mapPoints.length < 50 || overlayPixelPoints.length < 50) return null;

  let bestSuggestion: AlignmentSuggestion | null = null;

  const evaluateCandidate = (
    scaleXFactor: number,
    scaleYFactor: number,
    rotationDelta: number,
    skewXDelta: number,
    skewYDelta: number,
  ): AlignmentSuggestion | null => {
    const candidateTransform: ImageTransform = {
      ...transform,
      scaleX: Math.max(0.05, transform.scaleX * scaleXFactor),
      scaleY: Math.max(0.05, transform.scaleY * scaleYFactor),
      rotation: transform.rotation + rotationDelta,
      skewX: transform.skewX + skewXDelta,
      skewY: transform.skewY + skewYDelta,
    };
    const projected = projectOverlayPoints(
      overlayPixelPoints,
      naturalWidth,
      naturalHeight,
      candidateTransform,
      width,
      height,
    );
    const offset = searchBestOffset(projected, mapPoints, width, height);
    if (!offset) return null;
    return buildSuggestion(candidateTransform, offset, projected.length, source, overlayPixelPoints);
  };

  if (mode === 'fit') {
    for (const scaleXFactor of SCALE_DELTAS_COARSE) {
      for (const scaleYFactor of SCALE_DELTAS_COARSE) {
        const candidate = evaluateCandidate(scaleXFactor, scaleYFactor, 0, 0, 0);
        if (candidate && (!bestSuggestion || candidate.score > bestSuggestion.score)) bestSuggestion = candidate;
      }
    }
    if (!bestSuggestion) return null;

    const base = bestSuggestion.transform;
    const refinedInput: ImageTransform = {
      ...transform,
      scaleX: base.scaleX,
      scaleY: base.scaleY,
    };
    for (const scaleXFactor of SCALE_DELTAS_FINE) {
      for (const scaleYFactor of SCALE_DELTAS_FINE) {
        const candidate = evaluateCandidate(
          (refinedInput.scaleX / transform.scaleX) * scaleXFactor,
          (refinedInput.scaleY / transform.scaleY) * scaleYFactor,
          0,
          0,
          0,
        );
        if (candidate && candidate.score > bestSuggestion.score) bestSuggestion = candidate;
      }
    }
  } else {
    const skewDeltas = [-6, -3, 0, 3, 6];
    for (const rotationDelta of ROTATION_DELTAS_COARSE) {
      for (const skewXDelta of skewDeltas) {
        for (const skewYDelta of skewDeltas) {
          const candidate = evaluateCandidate(1, 1, rotationDelta, skewXDelta, skewYDelta);
          if (candidate && (!bestSuggestion || candidate.score > bestSuggestion.score)) bestSuggestion = candidate;
        }
      }
    }
    if (!bestSuggestion) return null;

    const baseRotation = bestSuggestion.transform.rotation;
    const baseSkewX = bestSuggestion.transform.skewX;
    const baseSkewY = bestSuggestion.transform.skewY;
    const fineSkewDeltas = [-2, -1, 0, 1, 2];
    for (const rotationDelta of ROTATION_DELTAS_FINE) {
      for (const skewXDelta of fineSkewDeltas) {
        for (const skewYDelta of fineSkewDeltas) {
          const candidateTransform: ImageTransform = {
            ...transform,
            rotation: baseRotation + rotationDelta,
            skewX: baseSkewX + skewXDelta,
            skewY: baseSkewY + skewYDelta,
          };
          const projected = projectOverlayPoints(
            overlayPixelPoints,
            naturalWidth,
            naturalHeight,
            candidateTransform,
            width,
            height,
          );
          const offset = searchBestOffset(projected, mapPoints, width, height);
          if (!offset) continue;
          const candidate = buildSuggestion(candidateTransform, offset, projected.length, source, overlayPixelPoints);
          if (candidate.score > bestSuggestion.score) bestSuggestion = candidate;
        }
      }
    }
  }

  return bestSuggestion && bestSuggestion.score >= 0.1 ? bestSuggestion : null;
}

export async function suggestImageAlignment(
  map: maplibregl.Map,
  imageSrc: string,
  naturalWidth: number,
  naturalHeight: number,
  transform: ImageTransform,
  settings: TraceSettings,
  mode: AlignmentMode,
  pickPoint?: { x: number; y: number; tolerance: number },
): Promise<AlignmentSuggestion | null> {
  const width = map.getContainer().clientWidth;
  const height = map.getContainer().clientHeight;
  const pixelLines = await traceImageToPixelLines(imageSrc, settings);

  if (mode === 'fit') {
    const [overlayAreaPoints, mapAreaPoints, overlayLinePoints] = await Promise.all([
      collectOverlayAreaSamples(imageSrc, MAX_OVERLAY_SAMPLES),
      Promise.resolve(collectMapAreaSamples(map)),
      Promise.resolve((() => {
        const pts: Array<[number, number]> = [];
        for (const line of pixelLines) {
          const stride = Math.max(1, Math.floor(line.length / 30));
          for (const point of samplePolyline(line, stride, Math.max(6, Math.floor(MAX_OVERLAY_SAMPLES / 24)))) {
            pts.push(point);
            if (pts.length >= MAX_OVERLAY_SAMPLES) break;
          }
          if (pts.length >= MAX_OVERLAY_SAMPLES) break;
        }
        return pts;
      })()),
    ]);

    let overlaySamples = overlayAreaPoints;
    let mapSamples = mapAreaPoints;
    let source: 'areas' | 'lines' = 'areas';

    if (pickPoint) {
      const canvas = document.createElement('canvas');
      const MAX_DIM = 800;
      const sc = Math.min(1, MAX_DIM / Math.max(naturalWidth, naturalHeight));
      const w = Math.round(naturalWidth * sc);
      const h = Math.round(naturalHeight * sc);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      
      const img2 = new Image();
      img2.src = imageSrc;
      await new Promise(r => { img2.onload = r; img2.onerror = r; });
      ctx.drawImage(img2, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      
      // Use raw pixel coordinates from click - scale to match canvas size
      const tPx = Math.round(pickPoint.x * sc);
      const tPy = Math.round(pickPoint.y * sc);
      console.log('Click at canvas pixel:', tPx, tPy, 'image dims:', w, h, 'natural:', naturalWidth, naturalHeight, 'scale:', sc);
      
      if (tPx < 0 || tPx >= w || tPy < 0 || tPy >= h) {
        console.log('Click outside canvas bounds');
        return null;
      }
      
      const tR = rgba[(tPy * w + tPx) * 4];
      const tG = rgba[(tPy * w + tPx) * 4 + 1];
      const tB = rgba[(tPy * w + tPx) * 4 + 2];
      const colorHex = '#' + [tR, tG, tB].map(x => x.toString(16).padStart(2, '0')).join('');
      console.log('Picked color:', colorHex, 'tolerance:', pickPoint.tolerance);
      
      // Tolerance - use directly (not multiplied)
      const tolerance = pickPoint.tolerance;
      const tolSq = tolerance * tolerance;
      
      // Global color matching: scan ALL pixels and collect those matching the color
      const matched = new Set<string>();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const key = `${x},${y}`;
          const idx = (y * w + x) * 4;
          const dist = Math.pow(rgba[idx] - tR, 2) + Math.pow(rgba[idx + 1] - tG, 2) + Math.pow(rgba[idx + 2] - tB, 2);
          if (dist <= tolSq) {
            matched.add(key);
          }
        }
      }
      
      console.log('Global color match found:', matched.size, 'pixels (tolerance:', tolerance, 'tolSq:', tolSq, ')');
      
      // Extract contour pixels only (pixels that have at least one non-matching neighbor)
      const edgeMargin = 10;
      const contour = new Set<string>();
      for (const key of matched) {
        const [x, y] = key.split(',').map(Number);
        let isInterior = true;
        for (let oy = -1; oy <= 1 && isInterior; oy++) {
          for (let ox = -1; ox <= 1 && isInterior; ox++) {
            if (ox === 0 && oy === 0) continue;
            if (!matched.has(`${x + ox},${y + oy}`)) {
              isInterior = false;
            }
          }
        }
        if (!isInterior) {
          // Only include if not near image edge
          if (x >= edgeMargin && x < w - edgeMargin && y >= edgeMargin && y < h - edgeMargin) {
            contour.add(key);
          }
        }
      }
      
      console.log('Contour pixels:', contour.size);
      
      const mapWidth = map.getContainer().clientWidth;
      const mapHeight = map.getContainer().clientHeight;
      
      // Raw pixel coordinates in overlay image (not geo converted)
      const overlayPixelPoints: Array<[number, number]> = [];
      
      // Geo coordinates for display on map
      const pixelCoords: Array<[number, number]> = [];
      
      // Sample from contour pixels
      const step = Math.max(1, Math.floor(contour.size / 500));
      let i = 0;
      for (const key of contour) {
        if (i++ % step !== 0) continue;
        const [x, y] = key.split(',').map(Number);
        const px = x / sc;
        const py = y / sc;
        overlayPixelPoints.push([px, py]);
        const screenPt = projectOverlayPoint(px, py, naturalWidth, naturalHeight, transform, mapWidth, mapHeight);
        const lngLat = map.unproject(screenPt);
        pixelCoords.push([lngLat.lng, lngLat.lat]);
      }
      
      console.log('Projected points:', pixelCoords.length);
      
      if (pixelCoords.length < 10) return null;
      
      // Always show the contour on the map
      const fc: FeatureCollection = { type: 'FeatureCollection', features: [{
        type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: pixelCoords }
      }]};
      
      // Match contour points against map area samples (already in screen pixels)
      const mapScreenPoints = collectMapAreaSamples(map);
      console.log('Map area samples:', mapScreenPoints.length);
      
      if (mapScreenPoints.length >= 50) {
        const suggestion = suggestFromSamples(
          mapScreenPoints,
          overlayPixelPoints,
          naturalWidth,
          naturalHeight,
          transform,
          mapWidth,
          mapHeight,
          'fit',
          'areas',
        );
        
        if (suggestion) {
          suggestion.pickedColor = colorHex;
          // Always show the contour, not the re-projected suggestion points
          suggestion.extractedFeatures = fc;
          suggestion.matchedPixelSamples = pixelCoords;
          return suggestion;
        }
      }
      
      return {
        transform, offset: [0, 0], score: 0.5, matchedSamples: pixelCoords.length, totalSamples: pixelCoords.length,
        source: 'areas', extractedFeatures: fc, matchedPixelSamples: pixelCoords, pickedColor: colorHex
      };
    }

    const suggestion = suggestFromSamples(mapSamples, overlaySamples, naturalWidth, naturalHeight, transform, width, height, 'fit', source);
    if (suggestion) {
      suggestion.extractedFeatures = pixelSamplesToGeoJSON(suggestion.matchedPixelSamples, naturalWidth, naturalHeight, suggestion.transform, map);
      if (suggestion.score >= 0.14) return suggestion;
    }

    const lineSuggestion = suggestFromSamples(collectMapLineSamples(map), overlayLinePoints, naturalWidth, naturalHeight, transform, width, height, 'fit', 'lines');
    if (lineSuggestion) {
      lineSuggestion.extractedFeatures = pixelSamplesToGeoJSON(lineSuggestion.matchedPixelSamples, naturalWidth, naturalHeight, lineSuggestion.transform, map);
      if (!pickPoint) return lineSuggestion;
    }

    return pickPoint ? null : lineSuggestion;
  }

  const mapLinePoints = collectMapLineSamples(map);
  if (mapLinePoints.length < 50) return null;
  const overlayLinePoints: Array<[number, number]> = [];
  for (const line of pixelLines) {
    const stride = Math.max(1, Math.floor(line.length / 30));
    for (const point of samplePolyline(line, stride, Math.max(6, Math.floor(MAX_OVERLAY_SAMPLES / 24)))) {
      overlayLinePoints.push(point);
      if (overlayLinePoints.length >= MAX_OVERLAY_SAMPLES) break;
    }
    if (overlayLinePoints.length >= MAX_OVERLAY_SAMPLES) break;
  }

  const result = suggestFromSamples(mapLinePoints, overlayLinePoints, naturalWidth, naturalHeight, transform, width, height, 'refine', 'lines');
  if (result) {
    result.extractedFeatures = pixelSamplesToGeoJSON(result.matchedPixelSamples, naturalWidth, naturalHeight, result.transform, map);
  }
  return result;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
