import type { ImageTransform } from '../state/types';

export function computeOverlayCorners(
  img: { naturalWidth: number; naturalHeight: number; transform: ImageTransform },
  mapRect: DOMRect,
): [[number, number], [number, number], [number, number], [number, number]] {
  const nw = img.naturalWidth || 800;
  const nh = img.naturalHeight || 600;
  const t = img.transform;
  const cx = mapRect.left + mapRect.width / 2 + t.translateX;
  const cy = mapRect.top + mapRect.height / 2 + t.translateY;

  const r = t.rotation * Math.PI / 180;
  const sx = t.skewX * Math.PI / 180;
  const sy = t.skewY * Math.PI / 180;
  const cosR = Math.cos(r);
  const sinR = Math.sin(r);
  const tanSx = Math.tan(sx);
  const tanSy = Math.tan(sy);

  function xform(lx: number, ly: number): [number, number] {
    let x = lx * t.scaleX;
    let y = ly * t.scaleY;
    y = y + x * tanSy;
    x = x + y * tanSx;
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;
    return [cx + rx - mapRect.left, cy + ry - mapRect.top];
  }

  return [
    xform(-nw / 2, -nh / 2),
    xform(+nw / 2, -nh / 2),
    xform(+nw / 2, +nh / 2),
    xform(-nw / 2, +nh / 2),
  ];
}
