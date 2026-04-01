import m from 'mithril';
import maplibregl from 'maplibre-gl';
import type { MeiosisCell } from '../state';
import type { AppState, ImageTransform } from '../state/types';
import { getMap } from './MapView';

interface Attrs {
  cell: MeiosisCell<AppState>;
}

// ── Module-level drag state ───────────────────────────────────────────────────
type Handle = 'move' | 'tl' | 'tr' | 'br' | 'bl' | 'rotate';
let activeHandle: Handle | null = null;
let startX = 0;
let startY = 0;
let startTransform: ImageTransform | null = null;
let activeCell: MeiosisCell<AppState> | null = null;

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
    case 'br':
      newT = { ...dt, scaleX: Math.max(0.05, dt.scaleX + dx / nw), scaleY: Math.max(0.05, dt.scaleY + dy / nh) };
      break;
    case 'bl':
      newT = { ...dt, scaleX: Math.max(0.05, dt.scaleX - dx / nw), scaleY: Math.max(0.05, dt.scaleY + dy / nh) };
      break;
    case 'tr':
      newT = { ...dt, scaleX: Math.max(0.05, dt.scaleX + dx / nw), scaleY: Math.max(0.05, dt.scaleY - dy / nh) };
      break;
    case 'tl':
      newT = { ...dt, scaleX: Math.max(0.05, dt.scaleX - dx / nw), scaleY: Math.max(0.05, dt.scaleY - dy / nh) };
      break;
    case 'rotate':
      newT = { ...dt, rotation: dt.rotation + dx * 0.5 };
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

/**
 * Compute the 4 actual viewport pixel coordinates of the image corners,
 * applying the same CSS transform as the .img-frame element.
 *
 * CSS transform order: rotate(r) skewX(sx) skewY(sy) scaleX(mx) scaleY(my)
 * Matrix application order (right-to-left): scale → skewY → skewX → rotate
 *
 * Returns coordinates relative to the MAP CONTAINER top-left (for map.unproject).
 */
function computeCorners(
  img: { naturalWidth: number; naturalHeight: number; transform: ImageTransform },
  mapRect: DOMRect,
): [[number, number], [number, number], [number, number], [number, number]] {
  const nw = img.naturalWidth || 800;
  const nh = img.naturalHeight || 600;
  const t = img.transform;

  // Center of the image in viewport coordinates.
  // #image-overlay is inset:0 over the map container, so overlay center == map center.
  const cx = mapRect.left + mapRect.width  / 2 + t.translateX;
  const cy = mapRect.top  + mapRect.height / 2 + t.translateY;

  const r  = t.rotation * Math.PI / 180;
  const sx = t.skewX    * Math.PI / 180;
  const sy = t.skewY    * Math.PI / 180;
  const cosR = Math.cos(r), sinR = Math.sin(r);
  const tanSx = Math.tan(sx), tanSy = Math.tan(sy);

  function xform(lx: number, ly: number): [number, number] {
    // 1. scale
    let x = lx * t.scaleX;
    let y = ly * t.scaleY;
    // 2. skewY: x'=x, y'=y+x·tan(sy)
    y = y + x * tanSy;
    // 3. skewX: x'=x+y·tan(sx), y'=y
    x = x + y * tanSx;
    // 4. rotate
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;
    // Convert from viewport coords to map-container-relative coords
    return [cx + rx - mapRect.left, cy + ry - mapRect.top];
  }

  return [
    xform(-nw / 2, -nh / 2), // TL
    xform(+nw / 2, -nh / 2), // TR
    xform(+nw / 2, +nh / 2), // BR
    xform(-nw / 2, +nh / 2), // BL
  ];
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
            if (map2?.getLayer('overlay-image-layer')) map2.removeLayer('overlay-image-layer');
            if (map2?.getSource('overlay-image')) map2.removeSource('overlay-image');
            cell.update({ image: { ...img, pinned: false } });
          },
        }, '📌 Unpin'),
        m('button.btn', {
          onclick: () => {
            const map2 = getMap();
            if (map2?.getLayer('overlay-image-layer')) map2.removeLayer('overlay-image-layer');
            if (map2?.getSource('overlay-image')) map2.removeSource('overlay-image');
            cell.update({ image: { ...img, src: null, pinned: false } });
          },
        }, '🗑 Remove'),
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
          cursor: 'move',
        },
        onmousedown: md('move'),
      }, [
        m('img', { src: img.src, draggable: false }),
        m('div.handle.handle-tl', { onmousedown: md('tl'), title: 'Drag to scale' }),
        m('div.handle.handle-tr', { onmousedown: md('tr'), title: 'Drag to scale' }),
        m('div.handle.handle-br', { onmousedown: md('br'), title: 'Drag to scale' }),
        m('div.handle.handle-bl', { onmousedown: md('bl'), title: 'Drag to scale' }),
        m('div.handle.handle-rotate', { onmousedown: md('rotate'), title: 'Drag to rotate' }),
      ]),

      // Controls bar
      m('div#overlay-controls', { onmousedown: (e: MouseEvent) => e.stopPropagation() }, [
        m('label', ['Size',
          m('input', {
            type: 'range', min: 0.05, max: 5, step: 0.01,
            value: (t.scaleX + t.scaleY) / 2,
            oninput: (e: Event) => {
              const v = parseFloat((e.target as HTMLInputElement).value);
              setT({ scaleX: v, scaleY: v });
            },
          }),
          m('span', `${((t.scaleX + t.scaleY) / 2).toFixed(2)}×`),
        ]),
        m('label', ['Opacity',
          m('input', {
            type: 'range', min: 0, max: 1, step: 0.05, value: img.opacity,
            oninput: (e: Event) =>
              cell.update({ image: { ...img, opacity: parseFloat((e.target as HTMLInputElement).value) } }),
          }),
          m('span', Math.round(img.opacity * 100) + '%'),
        ]),
        m('label', ['Scale X',
          m('input', {
            type: 'range', min: 0.05, max: 5, step: 0.01, value: t.scaleX,
            oninput: (e: Event) => setT({ scaleX: parseFloat((e.target as HTMLInputElement).value) }),
          }),
          m('span', t.scaleX.toFixed(2) + '×'),
        ]),
        m('label', ['Scale Y',
          m('input', {
            type: 'range', min: 0.05, max: 5, step: 0.01, value: t.scaleY,
            oninput: (e: Event) => setT({ scaleY: parseFloat((e.target as HTMLInputElement).value) }),
          }),
          m('span', t.scaleY.toFixed(2) + '×'),
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
        m('button.btn.btn-primary', {
          onclick: () => {
            const map2 = getMap();
            if (!map2) return;
            const mapEl = map2.getContainer();
            const mapRect = mapEl.getBoundingClientRect();
            const pixelCorners = computeCorners(img, mapRect);
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
        }, '📌 Pin to map'),
        m('button.btn', {
          onclick: () => cell.update({ image: { ...img, src: null, pinned: false } }),
        }, '🗑 Remove'),
      ]),
    ]);
  },
};
