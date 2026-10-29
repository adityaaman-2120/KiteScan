import type { AutoScanResult, Corners, EngineOpName, EnginePayload, EngineResult } from '../engine/types';
import { SMART_LOOK, type Look, type ScannedImage } from '../store/session';
import { cornersToQuad, quadToCorners, rotateQuadCW } from './geometry';
import { PAGE_JPEG_QUALITY, type PreparedImage } from './image';
import { pageId, resolveMode, sameLook } from './pages';

/* Everything that turns photos into pages and edits them. The engine is injected as `run`, so the same code
 * serves the screens and the tests, and no screen has to know which engine op does what. */

export type Run = <K extends EngineOpName>(op: K, payload: EnginePayload<K>, timeoutMs?: number) => Promise<EngineResult<K>>;

export const PAGE_TIMEOUT_MS = 60_000;
export const THUMB_SIDE = 240;

/** The picker's view of a photo, kept so the original can be re-exported later. */
export type PagePick = { uri: string; width: number; height: number };

const lookPayload = (look: Look) => ({ mode: look.mode, ...look.params });
const toImage = (r: { imageBase64: string; width: number; height: number }): PreparedImage => ({
  base64: r.imageBase64,
  width: r.width,
  height: r.height,
});

/** Builds a page from an autoScan result. `prev` (when re-scanning) keeps the page's identity and history. */
export function pageFromScan(prepared: PreparedImage, pick: PagePick, r: AutoScanResult, look: Look, prev?: ScannedImage): ScannedImage {
  const detection = r.detection ?? prev?.detection;
  if (!detection) throw new Error('autoScan returned no detection and there is no earlier one');
  return {
    id: prev?.id ?? pageId(),
    base64: prepared.base64,
    width: prepared.width,
    height: prepared.height,
    originalUri: prev?.originalUri ?? pick.uri,
    originalWidth: prev?.originalWidth ?? pick.width,
    originalHeight: prev?.originalHeight ?? pick.height,
    analysis: r.analysis,
    detection,
    corners: r.corners,
    rotation: prev?.rotation ?? 0,
    warped: toImage(r.warped),
    final: toImage(r.final),
    thumbBase64: r.thumbBase64,
    look,
    appliedMode: r.mode,
    fingerprint: r.fingerprint,
    histograms: r.histograms,
    edited: prev?.edited ?? false,
  };
}

/** Photo -> page in ONE engine call: quality report, page detection, flattening, enhancement, thumbnail, fingerprint. */
export async function scanPhoto(run: Run, prepared: PreparedImage, pick: PagePick, look: Look = SMART_LOOK): Promise<ScannedImage> {
  const r = await run(
    'autoScan',
    { imageBase64: prepared.base64, ...lookPayload(look), quality: PAGE_JPEG_QUALITY, thumbSide: THUMB_SIDE },
    PAGE_TIMEOUT_MS,
  );
  return pageFromScan(prepared, pick, r, look);
}

/** A different look for one page. Reuses the flattened page, so no detection or warping happens again. */
export async function relook(run: Run, page: ScannedImage, look: Look): Promise<ScannedImage> {
  if (sameLook(page.look, look)) return page;
  const mode = resolveMode(look, page.analysis.boardType);
  const r = await run(
    'enhance',
    { imageBase64: page.warped.base64, mode, ...look.params, quality: PAGE_JPEG_QUALITY, thumbSide: THUMB_SIDE, wantHistogram: true },
    PAGE_TIMEOUT_MS,
  );
  return {
    ...page,
    look,
    appliedMode: mode,
    final: toImage(r),
    thumbBase64: r.thumbBase64 ?? page.thumbBase64,
    histograms: { original: page.histograms.original, final: r.histogram ?? page.histograms.final },
    edited: true,
  };
}

/** New corners for a page (after the user adjusted the crop): flatten and enhance again, keeping the look. */
export async function rewarp(run: Run, page: ScannedImage, corners: Corners): Promise<ScannedImage> {
  const r = await run(
    'autoScan',
    { imageBase64: page.base64, corners, ...lookPayload(page.look), quality: PAGE_JPEG_QUALITY, thumbSide: THUMB_SIDE },
    PAGE_TIMEOUT_MS,
  );
  return { ...pageFromScan({ base64: page.base64, width: page.width, height: page.height }, pageToPick(page), r, page.look, page), edited: true };
}

/** Turns the page a quarter turn clockwise: the photo and the corners rotate together, then it is flattened again. */
export async function rotatePage(run: Run, page: ScannedImage): Promise<ScannedImage> {
  const rotated = await run('rotate', { imageBase64: page.base64, degrees: 90, quality: PAGE_JPEG_QUALITY }, PAGE_TIMEOUT_MS);
  // Corners rotate in normalized space (a fixed remap), then are scaled to the rotated photo's size.
  const corners = quadToCorners(rotateQuadCW(cornersToQuad(page.corners, page.width, page.height)), rotated.width, rotated.height);
  const turned: ScannedImage = {
    ...page,
    base64: rotated.imageBase64,
    width: rotated.width,
    height: rotated.height,
    corners,
    rotation: (page.rotation + 90) % 360,
  };
  return rewarp(run, turned, corners);
}

const pageToPick = (p: ScannedImage): PagePick => ({ uri: p.originalUri, width: p.originalWidth, height: p.originalHeight });

export type BatchResult = {
  /** The full list with successfully updated pages swapped in. */
  items: ScannedImage[];
  /** Indexes that could not be updated (their previous version is kept). */
  failed: number[];
  cancelled: boolean;
  /** How many pages were attempted. */
  done: number;
};

/**
 * Applies a look to several pages one after another. A page that fails keeps its previous version and does not
 * stop the others; cancelling stops before the next page.
 */
export async function applyLookToPages(
  run: Run,
  items: ScannedImage[],
  indices: number[],
  look: Look,
  opts: { onProgress?: (done: number, total: number) => void; shouldCancel?: () => boolean } = {},
): Promise<BatchResult> {
  const next = items.slice();
  const failed: number[] = [];
  let done = 0;
  for (const i of indices) {
    if (opts.shouldCancel?.()) return { items: next, failed, cancelled: true, done };
    try {
      next[i] = await relook(run, next[i], look);
    } catch {
      failed.push(i);
    }
    done += 1;
    opts.onProgress?.(done, indices.length);
  }
  return { items: next, failed, cancelled: false, done };
}
