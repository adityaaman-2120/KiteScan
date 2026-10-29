import type { Corners, Point } from '../engine/types';

/*
 * Crop geometry. A quad is a flat array of 8 numbers [x0,y0, x1,y1, x2,y2, x3,y3] ordered
 * TL, TR, BR, BL. In the crop editor the values are NORMALIZED (0..1 of the image), so layout
 * changes and rotations never need unit conversions. Functions marked 'worklet' also run on the
 * UI thread inside gesture and animated-style callbacks.
 */

export const FULL_FRAME: number[] = [0, 0, 1, 0, 1, 1, 0, 1];

/** Corners closer than this (in pixels) or a quad smaller than MIN_AREA is rejected. */
export const MIN_EDGE_PX = 24;
export const MIN_AREA = 0.02;

export function clamp01(v: number): number {
  'worklet';
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** SVG path of the quad in a w x h box. */
export function quadPath(p: number[], w: number, h: number): string {
  'worklet';
  return `M${p[0] * w} ${p[1] * h} L${p[2] * w} ${p[3] * h} L${p[4] * w} ${p[5] * h} L${p[6] * w} ${p[7] * h} Z`;
}

/** Rectangle with the quad cut out (use with fill-rule evenodd) to dim everything outside the page. */
export function dimPath(p: number[], w: number, h: number): string {
  'worklet';
  return `M0 0 H${w} V${h} H0 Z ${quadPath(p, w, h)}`;
}

/** Length in pixels of the edge starting at corner i (0 = top edge ... 3 = left edge). */
export function edgeLength(p: number[], i: number, w: number, h: number): number {
  'worklet';
  const j = (i + 1) % 4;
  const dx = (p[j * 2] - p[i * 2]) * w;
  const dy = (p[j * 2 + 1] - p[i * 2 + 1]) * h;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Convex, correctly wound (no crossed corners), not tiny. w/h are the pixel size of the box. */
export function quadValid(p: number[], w: number, h: number): boolean {
  'worklet';
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const k = (i + 2) % 4;
    // cross product of consecutive edges in pixels: must stay positive for a clockwise convex quad
    const ax = (p[j * 2] - p[i * 2]) * w;
    const ay = (p[j * 2 + 1] - p[i * 2 + 1]) * h;
    const bx = (p[k * 2] - p[j * 2]) * w;
    const by = (p[k * 2 + 1] - p[j * 2 + 1]) * h;
    if (ax * by - ay * bx <= 20) return false;
    if (edgeLength(p, i, w, h) < MIN_EDGE_PX) return false;
    area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return Math.abs(area) / 2 >= MIN_AREA;
}

/** Rotates the whole quad 90 degrees clockwise (image rotated the same way) and re-orders to TL,TR,BR,BL. */
export function rotateQuadCW(p: number[]): number[] {
  'worklet';
  // (u, v) -> (1 - v, u). The old BL becomes the new TL, old TL -> TR, old TR -> BR, old BR -> BL.
  const r = (i: number) => [1 - p[i * 2 + 1], p[i * 2]];
  const [a, b, c, d] = [r(3), r(0), r(1), r(2)];
  return [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]];
}

export function cornersToQuad(c: readonly Point[], w: number, h: number): number[] {
  return [c[0].x / w, c[0].y / h, c[1].x / w, c[1].y / h, c[2].x / w, c[2].y / h, c[3].x / w, c[3].y / h].map(clamp01);
}

export function quadToCorners(p: number[], w: number, h: number): Corners {
  return [
    { x: p[0] * w, y: p[1] * h },
    { x: p[2] * w, y: p[3] * h },
    { x: p[4] * w, y: p[5] * h },
    { x: p[6] * w, y: p[7] * h },
  ];
}
