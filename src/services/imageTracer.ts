import type { Feature, FeatureCollection, LineString } from 'geojson';
import { simplify } from '@turf/turf';
import type { TraceSettings } from '../state/types';

type GeoCorners = [[number, number], [number, number], [number, number], [number, number]];

// ── Bilinear geo interpolation ────────────────────────────────────────────────

function pixelToGeo(
  px: number,
  py: number,
  w: number,
  h: number,
  corners: GeoCorners,
): [number, number] {
  const tx = Math.max(0, Math.min(1, px / w));
  const ty = Math.max(0, Math.min(1, py / h));
  const [tl, tr, br, bl] = corners;
  return [
    tl[0] * (1 - tx) * (1 - ty) + tr[0] * tx * (1 - ty) + br[0] * tx * ty + bl[0] * (1 - tx) * ty,
    tl[1] * (1 - tx) * (1 - ty) + tr[1] * tx * (1 - ty) + br[1] * tx * ty + bl[1] * (1 - tx) * ty,
  ];
}

// ── Zhang-Suen thinning ───────────────────────────────────────────────────────
// Iteratively erodes thick foreground regions down to 1-pixel-wide skeletons.
// Input/output: Uint8Array of 0/1 values, width×height.

function zhangSuenThin(data: Uint8Array, w: number, h: number): void {
  const toRemove: number[] = [];
  let changed = true;

  while (changed) {
    changed = false;

    for (let pass = 0; pass < 2; pass++) {
      toRemove.length = 0;

      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          if (!data[y * w + x]) continue;

          const p2 = data[(y - 1) * w + x    ];
          const p3 = data[(y - 1) * w + x + 1];
          const p4 = data[ y      * w + x + 1];
          const p5 = data[(y + 1) * w + x + 1];
          const p6 = data[(y + 1) * w + x    ];
          const p7 = data[(y + 1) * w + x - 1];
          const p8 = data[ y      * w + x - 1];
          const p9 = data[(y - 1) * w + x - 1];

          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;

          // Count 0→1 transitions in circular order
          const ns = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) if (!ns[i] && ns[i + 1]) A++;
          if (A !== 1) continue;

          if (pass === 0) {
            if (p2 * p4 * p6 !== 0) continue;
            if (p4 * p6 * p8 !== 0) continue;
          } else {
            if (p2 * p4 * p8 !== 0) continue;
            if (p2 * p6 * p8 !== 0) continue;
          }

          toRemove.push(y * w + x);
        }
      }

      if (toRemove.length > 0) {
        changed = true;
        for (const i of toRemove) data[i] = 0;
      }
    }
  }
}

// ── Skeleton walking ──────────────────────────────────────────────────────────
// Follows 8-connected chains through thinned skeleton pixels.
// Prefers directions aligned with the current travel direction to maintain
// smooth polylines through junctions.

const DX8 = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY8 = [-1, -1, -1, 0, 0, 1, 1, 1];

function walkSkeleton(
  pixels: Uint8Array,
  w: number,
  h: number,
  minPixels: number,
): Array<Array<[number, number]>> {
  const visited = new Uint8Array(pixels.length);
  const lines: Array<Array<[number, number]>> = [];

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx;
      if (!pixels[si] || visited[si]) continue;

      const chain: Array<[number, number]> = [[sx, sy]];
      visited[si] = 1;
      let cx = sx, cy = sy;
      let dirX = 0, dirY = 0; // current travel direction

      while (true) {
        // Collect unvisited 8-connected foreground neighbours
        const candidates: Array<[number, number]> = [];
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX8[d], ny = cy + DY8[d];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && pixels[ny * w + nx] && !visited[ny * w + nx]) {
            candidates.push([nx, ny]);
          }
        }
        if (candidates.length === 0) break;

        // Prefer the candidate most aligned with the current direction
        let best = candidates[0];
        if (dirX !== 0 || dirY !== 0) {
          let bestDot = -Infinity;
          for (const [nx, ny] of candidates) {
            const dot = (nx - cx) * dirX + (ny - cy) * dirY;
            if (dot > bestDot) { bestDot = dot; best = [nx, ny]; }
          }
        }

        dirX = best[0] - cx;
        dirY = best[1] - cy;
        cx = best[0]; cy = best[1];
        visited[cy * w + cx] = 1;
        chain.push([cx, cy]);
      }

      if (chain.length >= minPixels) lines.push(chain);
    }
  }

  return lines;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function traceImageToPixelLines(
  imageSrc: string,
  settings: TraceSettings,
): Promise<any> {
  const img = await loadImage(imageSrc);
  const MAX_DIM = 1500;
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (settings.blurRadius > 0) ctx.filter = `blur(${settings.blurRadius}px)`;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  const imageData = ctx.getImageData(0, 0, w, h);
  const rgba = imageData.data;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const brightness = (r + g + b) / 3;
    const threshold = settings.threshold;
    binary[i] = brightness < threshold ? 1 : 0;
  }

  const minPixels = Math.max(5, Math.round(Math.min(w, h) * 0.01));
  return walkSkeleton(binary, w, h, minPixels).map((line) =>
    line.map(([px, py]) => [px / scale, py / scale] as [number, number]),
  );
}

export async function traceImageToGeoJSON(
  imageSrc: string,
  geoCorners: GeoCorners,
  settings: TraceSettings,
): Promise<FeatureCollection> {
  // 1. Draw image onto an offscreen canvas (downscale very large images for speed)
  const img = await loadImage(imageSrc);
  const MAX_DIM = 1500;
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth  * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  if (settings.blurRadius > 0) ctx.filter = `blur(${settings.blurRadius}px)`;
  ctx.drawImage(img, 0, 0, w, h);
  ctx.filter = 'none';

  // 2. Threshold → binary Uint8Array (1 = dark/foreground)
  const imageData = ctx.getImageData(0, 0, w, h);
  const rgba = imageData.data;
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const gray = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    binary[i] = gray < settings.threshold ? 1 : 0;
  }

  // 3. Clear a border margin (5px) to suppress image-edge artefacts, then thin
  const BORDER = 5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < BORDER || x >= w - BORDER || y < BORDER || y >= h - BORDER) {
        binary[y * w + x] = 0;
      }
    }
  }

  // 4. Zhang-Suen morphological thinning → 1-pixel skeleton
  zhangSuenThin(binary, w, h);

  // 5. Walk skeleton → pixel-space polylines
  // minPixels ≈ 1% of shorter image dimension, at least 5
  const minPixels = Math.max(5, Math.round(Math.min(w, h) * 0.01));
  const pixelLines = walkSkeleton(binary, w, h, minPixels);

  // 6. Convert pixel coords → geographic coords
  const features: Feature[] = pixelLines.map((seg) => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: seg.map(([px, py]) => pixelToGeo(px / scale, py / scale, img.naturalWidth, img.naturalHeight, geoCorners)),
    } as LineString,
  }));

  // 7. Simplify with Turf (per-feature so one failure can't abort the rest)
  const simplified: Feature[] = [];
  for (const feat of features) {
    try {
      const result = simplify(feat as Parameters<typeof simplify>[0], {
        tolerance: settings.simplification,
        highQuality: true,
      }) as Feature;
      const pts = (result.geometry as LineString).coordinates;
      if (pts && pts.length >= 2) simplified.push(result);
    } catch {
      // discard geometries that Turf rejects
    }
  }

  return { type: 'FeatureCollection', features: simplified };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
