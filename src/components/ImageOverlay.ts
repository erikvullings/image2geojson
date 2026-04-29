import m from 'mithril';
import maplibregl from 'maplibre-gl';
import type { AppState, ImageTransform } from '../state/types';
import type { MeiosisCell } from '../state';
import { computeOverlayCorners } from '../services/imageOverlayGeometry';
import { getMap } from './MapView';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

// ── Module-level drag state ───────────────────────────────────────────────────
type Handle = 'move' | 'tl' | 'tr' | 'br' | 'bl' | 'tm' | 'bm' | 'lm' | 'rm' | 'rotate' | 'rtl' | 'rtr' | 'rbr' | 'rbl';
let activeHandle: Handle | null = null;
let startX = 0;
let startY = 0;
let startTransform: ImageTransform | null = null;
let activeCell: MeiosisCell<AppState> | null = null;
let showRotation = false;

function onGlobalMouseMove(ev: MouseEvent) {
  if (!activeHandle || !startTransform || !activeCell) return;
  const dx = ev.clientX - startX;
  const dy = ev.clientY - startY;
  const dt = startTransform;
  const img = activeCell.state.image;
  const nw = img.naturalWidth || 800;
  const nh = img.naturalHeight || 600;
  let newT: ImageTransform = { ...dt };

  switch (activeHandle) {
    case 'move':
      newT = { ...dt, translateX: dt.translateX + dx, translateY: dt.translateY + dy };
      break;
    case 'br': {
      const dScaleX = dx / nw;
      const dScaleY = dy / nh;
      const newScaleX = Math.max(0.05, dt.scaleX + dScaleX);
      const newScaleY = Math.max(0.05, dt.scaleY + dScaleY);
      const shiftX = (nw / 2) * (newScaleX - dt.scaleX);
      const shiftY = (nh / 2) * (newScaleY - dt.scaleY);
      newT = { ...dt, scaleX: newScaleX, scaleY: newScaleY, translateX: dt.translateX + shiftX, translateY: dt.translateY + shiftY };
      break;
    }
    case 'bl': {
      const dScaleX = -dx / nw;
      const dScaleY = dy / nh;
      const newScaleX = Math.max(0.05, dt.scaleX + dScaleX);
      const newScaleY = Math.max(0.05, dt.scaleY + dScaleY);
      const shiftX = (nw / 2) * (newScaleX - dt.scaleX);
      const shiftY = (nh / 2) * (newScaleY - dt.scaleY);
      newT = { ...dt, scaleX: newScaleX, scaleY: newScaleY, translateX: dt.translateX - shiftX, translateY: dt.translateY + shiftY };
      break;
    }
    case 'tr': {
      const dScaleX = dx / nw;
      const dScaleY = -dy / nh;
      const newScaleX = Math.max(0.05, dt.scaleX + dScaleX);
      const newScaleY = Math.max(0.05, dt.scaleY + dScaleY);
      const shiftX = (nw / 2) * (newScaleX - dt.scaleX);
      const shiftY = (nh / 2) * (newScaleY - dt.scaleY);
      newT = { ...dt, scaleX: newScaleX, scaleY: newScaleY, translateX: dt.translateX + shiftX, translateY: dt.translateY - shiftY };
      break;
    }
    case 'tl': {
      const dScaleX = -dx / nw;
      const dScaleY = -dy / nh;
      const newScaleX = Math.max(0.05, dt.scaleX + dScaleX);
      const newScaleY = Math.max(0.05, dt.scaleY + dScaleY);
      const shiftX = (nw / 2) * (newScaleX - dt.scaleX);
      const shiftY = (nh / 2) * (newScaleY - dt.scaleY);
      newT = { ...dt, scaleX: newScaleX, scaleY: newScaleY, translateX: dt.translateX - shiftX, translateY: dt.translateY - shiftY };
      break;
    }
    case 'tm': {
      const dScaleY = -dy / nh;
      const newScaleY = Math.max(0.05, dt.scaleY + dScaleY);
      const shiftY = (nh / 2) * (newScaleY - dt.scaleY);
      newT = { ...dt, scaleY: newScaleY, translateY: dt.translateY - shiftY };
      break;
    }
    case 'bm': {
      const dScaleY = dy / nh;
      const newScaleY = Math.max(0.05, dt.scaleY + dScaleY);
      const shiftY = (nh / 2) * (newScaleY - dt.scaleY);
      newT = { ...dt, scaleY: newScaleY, translateY: dt.translateY + shiftY };
      break;
    }
    case 'lm': {
      const dScaleX = -dx / nw;
      const newScaleX = Math.max(0.05, dt.scaleX + dScaleX);
      const shiftX = (nw / 2) * (newScaleX - dt.scaleX);
      newT = { ...dt, scaleX: newScaleX, translateX: dt.translateX - shiftX };
      break;
    }
    case 'rm': {
      const dScaleX = dx / nw;
      const newScaleX = Math.max(0.05, dt.scaleX + dScaleX);
      const shiftX = (nw / 2) * (newScaleX - dt.scaleX);
      newT = { ...dt, scaleX: newScaleX, translateX: dt.translateX + shiftX };
      break;
    }
    case 'rotate':
    case 'rtr':
    case 'rbr':
    case 'rbl':
      newT = { ...dt, rotation: (dt.rotation ?? 0) + dx * 0.3 };
      break;
  }
  activeCell.update({ image: { ...img, transform: newT } });
  m.redraw();
}

function onGlobalMouseUp() {
  activeHandle = null;
  startTransform = null;
  activeCell = null;
}

window.addEventListener('mousemove', onGlobalMouseMove);
window.addEventListener('mouseup', onGlobalMouseUp);

// ── CSS transform for the frame ───────────────────────────────────────────────
function frameTransform(t: ImageTransform): string {
  return [
    `rotate(${t.rotation}deg)`,
    `skewX(${t.skewX}deg)`,
    `skewY(${t.skewY}deg)`,
    `scaleX(${t.scaleX})`,
    `scaleY(${t.scaleY})`,
  ].join(' ');
}

function deriveTransformFromProjectedCorners(
  corners: [[number, number], [number, number], [number, number], [number, number]],
  mapWidth: number,
  mapHeight: number,
  naturalWidth: number,
  naturalHeight: number,
): ImageTransform {
  const [tl, tr, br, bl] = corners;
  const centerX = (tl[0] + tr[0] + br[0] + bl[0]) / 4;
  const centerY = (tl[1] + tr[1] + br[1] + bl[1]) / 4;
  const halfWidthVector: [number, number] = [
    (tr[0] - tl[0] + br[0] - bl[0]) / 4,
    (tr[1] - tl[1] + br[1] - bl[1]) / 4,
  ];
  const halfHeightVector: [number, number] = [
    (bl[0] - tl[0] + br[0] - tr[0]) / 4,
    (bl[1] - tl[1] + br[1] - tr[1]) / 4,
  ];

  const a = (2 * halfWidthVector[0]) / naturalWidth;
  const b = (2 * halfWidthVector[1]) / naturalWidth;
  const c = (2 * halfHeightVector[0]) / naturalHeight;
  const d = (2 * halfHeightVector[1]) / naturalHeight;

  const scaleX = Math.max(0.05, Math.hypot(a, b));
  const rotation = Math.atan2(b, a);
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const skewColumn = cosR * c + sinR * d;
  const scaleY = Math.max(0.05, -sinR * c + cosR * d);

  return {
    translateX: centerX - mapWidth / 2,
    translateY: centerY - mapHeight / 2,
    scaleX,
    scaleY,
    rotation: rotation * 180 / Math.PI,
    skewX: Math.atan2(skewColumn, scaleY) * 180 / Math.PI,
    skewY: 0,
  };
}

function removePinnedOverlay(map: maplibregl.Map | null): void {
  if (!map) return;
  if (map.getLayer('overlay-image-layer')) map.removeLayer('overlay-image-layer');
  if (map.getSource('overlay-image')) map.removeSource('overlay-image');
}

// ── Component ─────────────────────────────────────────────────────────────────
export const ImageOverlay: m.Component<Attrs> = {
  view({ attrs: { cell } }) {
    const img = cell.state.image;
    if (!img.src) return null;
    if (cell.state.ui.mode !== 'georeference') return null;

    const t = img.transform;
    const nw = img.naturalWidth || 800;
    const nh = img.naturalHeight || 600;

    // ── Pinned state: show minimal controls to adjust pinned layer ────────────
    if (img.pinned) {
      return m('div#overlay-controls.pinned-controls', { onmousedown: (e: MouseEvent) => e.stopPropagation() }, [
        m('label', ['Opacity',
          m('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: img.opacity,
            oninput: (e: Event) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              cell.update({ image: { ...img, opacity: v } });
              const map2 = getMap();
              if (map2?.getLayer('overlay-image-layer')) {
                map2.setPaintProperty('overlay-image-layer', 'raster-opacity', v);
              }
            },
          }),
          m('span', Math.round(img.opacity * 100) + '%'),
        ]),
        m('button.btn.btn-primary', {
          onclick: () => {
            const map2 = getMap();
            let nextTransform = img.transform;
            if (map2 && img.geoCorners) {
              const projectedCorners = img.geoCorners.map((corner) => {
                const point = map2.project(corner);
                return [point.x, point.y] as [number, number];
              }) as [[number, number], [number, number], [number, number], [number, number]];
              nextTransform = deriveTransformFromProjectedCorners(
                projectedCorners,
                map2.getContainer().clientWidth,
                map2.getContainer().clientHeight,
                img.naturalWidth || 800,
                img.naturalHeight || 600,
              );
            }
            removePinnedOverlay(map2);
            cell.update({ image: { ...img, pinned: false, transform: nextTransform } });
          },
        }, 'Unpin'),
        m('button.btn', {
          onclick: () => {
            removePinnedOverlay(getMap());
            cell.update({ image: { ...img, src: null, pinned: false } });
          },
        }, 'Remove'),
      ]);
    }

    const md = (h: Handle) => (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      activeHandle = h;
      startX = e.clientX;
      startY = e.clientY;
      startTransform = { ...t };
      activeCell = cell;
    };

    const setT = (partial: Partial<ImageTransform>) =>
      cell.update({ image: { ...img, transform: { ...t, ...partial } } });

    return m('div#image-overlay', [
      // Frame: centred at viewport mid + user translation, then rotated/skewed/scaled
      m('div.img-frame', {
        style: {
          width: `${nw}px`,
          height: `${nh}px`,
          marginLeft: `${-nw / 2 + t.translateX}px`,
          marginTop: `${-nh / 2 + t.translateY}px`,
          transform: frameTransform(t),
          opacity: img.opacity,
          cursor: showRotation ? 'grab' : 'move',
        },
        onmousedown: (e: MouseEvent) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') {
            showRotation = !showRotation;
            e.preventDefault();
            e.stopPropagation();
            m.redraw();
          } else {
            md('move')(e);
          }
        },
      }, [
        m('img', { src: img.src, draggable: false, style: { width: '100%', height: '100%' } }),
        ...(showRotation ? [
          m('div.handle.handle-rtl', { onmousedown: md('rbl'), title: 'Drag to rotate' }),
          m('div.handle.handle-rtr', { onmousedown: md('rtr'), title: 'Drag to rotate' }),
          m('div.handle.handle-rbr', { onmousedown: md('rbr'), title: 'Drag to rotate' }),
          m('div.handle.handle-rbl', { onmousedown: md('rbl'), title: 'Drag to rotate' }),
        ] : [
          m('div.handle.handle-tl', { onmousedown: md('tl'), title: 'Drag to scale (opposite corner locked)' }),
          m('div.handle.handle-tr', { onmousedown: md('tr'), title: 'Drag to scale (opposite corner locked)' }),
          m('div.handle.handle-br', { onmousedown: md('br'), title: 'Drag to scale (opposite corner locked)' }),
          m('div.handle.handle-bl', { onmousedown: md('bl'), title: 'Drag to scale (opposite corner locked)' }),
        ]),
        ...(showRotation ? [
          m('div.handle.handle-rtl', { onmousedown: md('rtl'), title: 'Drag to rotate' }),
          m('div.handle.handle-rtr', { onmousedown: md('rtr'), title: 'Drag to rotate' }),
          m('div.handle.handle-rbr', { onmousedown: md('rbr'), title: 'Drag to rotate' }),
          m('div.handle.handle-rbl', { onmousedown: md('rbl'), title: 'Drag to rotate' }),
        ] : [
          m('div.handle.handle-tm', { onmousedown: md('tm'), title: 'Drag to scale vertically (bottom locked)' }),
          m('div.handle.handle-bm', { onmousedown: md('bm'), title: 'Drag to scale vertically (top locked)' }),
          m('div.handle.handle-lm', { onmousedown: md('lm'), title: 'Drag to scale horizontally (right locked)' }),
          m('div.handle.handle-rm', { onmousedown: md('rm'), title: 'Drag to scale horizontally (left locked)' }),
        ]),
      ]),

      // Controls bar
      m('div#overlay-controls', { onmousedown: (e: MouseEvent) => e.stopPropagation() }, [
        m('label', ['Opacity',
          m('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: img.opacity,
            oninput: (e: Event) =>
              cell.update({ image: { ...img, opacity: parseFloat((e.target as HTMLInputElement).value) } }),
          }),
          m('span', Math.round(img.opacity * 100) + '%'),
        ]),
        m('label', ['Skew X',
          m('input', {
            type: 'range', min: -30, max: 30, step: 1, value: t.skewX,
            oninput: (e: Event) => setT({ skewX: parseFloat((e.target as HTMLInputElement).value) }),
          }),
          m('span', t.skewX + '°'),
        ]),
        m('label', ['Skew Y',
          m('input', {
            type: 'range', min: -30, max: 30, step: 1, value: t.skewY,
            oninput: (e: Event) => setT({ skewY: parseFloat((e.target as HTMLInputElement).value) }),
          }),
          m('span', t.skewY + '°'),
        ]),
        m('button.btn', {
          onclick: () => setT({ rotation: 0 }),
        }, 'Reset rotation'),
        m('button.btn', {
          onclick: () => setT({ skewX: 0, skewY: 0 }),
        }, 'Reset skew'),
        m('button.btn.btn-primary', {
          onclick: () => {
            const map2 = getMap();
            if (!map2) return;
            const mapEl = map2.getContainer();
            const mapRect = mapEl.getBoundingClientRect();
            const pixelCorners = computeOverlayCorners(img, mapRect);
            const corners: [[number, number], [number, number], [number, number], [number, number]] = [
              map2.unproject(pixelCorners[0]).toArray() as [number, number],
              map2.unproject(pixelCorners[1]).toArray() as [number, number],
              map2.unproject(pixelCorners[2]).toArray() as [number, number],
              map2.unproject(pixelCorners[3]).toArray() as [number, number],
            ];
            if (map2.getSource('overlay-image')) {
              (map2.getSource('overlay-image') as maplibregl.ImageSource)
                .updateImage({ url: img.src!, coordinates: corners });
            } else {
              map2.addSource('overlay-image', { type: 'image', url: img.src!, coordinates: corners });
              map2.addLayer({
                id: 'overlay-image-layer', type: 'raster', source: 'overlay-image',
                paint: { 'raster-opacity': img.opacity },
              });
            }
            cell.update({ image: { ...img, pinned: true, geoCorners: corners } });
          },
        }, 'Pin to map'),
        m('button.btn', {
          onclick: () => cell.update({ image: { ...img, src: null, pinned: false } }),
        }, 'Remove'),
      ]),
    ]);
  },
};
