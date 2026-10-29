import type { AnalyzeResult, Corners, DetectResult, EnhanceMode, EnhanceParams } from '../engine/types';
import type { CaptureSource, RawPick } from '../utils/capture';
import type { PreparedImage } from '../utils/image';

/* In-memory state of the scan in progress. Images are far too large for route params, and the review
 * screen, crop screen and fine-tune screen all edit the same set of pages, so it lives here. */

/** How a page is enhanced: a concrete mode, or 'auto' (chosen per page from what the page turned out to be). */
export type Look = { mode: EnhanceMode | 'auto'; params: EnhanceParams };
export const SMART_LOOK: Look = { mode: 'auto', params: {} };

/** One scanned page: the source photo, the flattened page, the enhanced result and everything measured about it. */
export type ScannedImage = PreparedImage & {
  /** Stable key for lists (indexes change when pages are removed or reordered). */
  id: string;
  /** The full-resolution photo as picked (kept for a later high-quality export). */
  originalUri: string;
  originalWidth: number;
  originalHeight: number;
  analysis: Omit<AnalyzeResult, 'ms'>;
  /** The automatic page detection (kept after manual edits so confidence can still be shown). */
  detection: Omit<DetectResult, 'ms' | 'imageWidth' | 'imageHeight'>;
  /** The page corners as they stand now (image pixels, TL,TR,BR,BL). */
  corners: Corners;
  /** Clockwise degrees applied so far (0, 90, 180 or 270). */
  rotation: number;
  /** Perspective-corrected page, before enhancement. */
  warped: PreparedImage;
  /** The enhanced page that gets saved. */
  final: PreparedImage;
  /** Small preview for lists. */
  thumbBase64: string;
  /** What the user asked for... */
  look: Look;
  /** ...and what actually ran ('auto' resolved). */
  appliedMode: EnhanceMode;
  /** 256-bit difference hash of the flattened page, for spotting duplicate pages. */
  fingerprint: string;
  histograms: { original: number[]; final: number[] };
  /** True once the user changed the crop, rotation or look by hand. */
  edited: boolean;
};

/** Where the photos of a capture batch end up. */
export type CaptureTarget =
  | { kind: 'new' } // start a fresh scan (from Home)
  | { kind: 'append' } // add pages to the scan in progress
  | { kind: 'replace'; index: number }; // retake one page

/** Photos picked and waiting to be scanned by the processing screen. */
export type CaptureBatch = {
  source: CaptureSource;
  picks: RawPick[];
  target: CaptureTarget;
  /** Set when the pages will be appended to an existing saved document. */
  docId?: string;
};

let batch: CaptureBatch | null = null;
export const setCaptureBatch = (b: CaptureBatch): void => {
  batch = b;
};
export const takeCaptureBatch = (): CaptureBatch | null => {
  const b = batch;
  batch = null;
  return b;
};

/** Everything the review, crop and fine-tune screens share. */
export type ScanSession = {
  source: CaptureSource;
  /** The pages, in reading order. */
  items: ScannedImage[];
  /** The page being looked at / edited. */
  index: number;
  /** The saved document these pages will be appended to (undefined: a new document is created). */
  docId?: string;
  /** Whether look changes apply to the current page or to every page. */
  scope: 'one' | 'all';
};

let session: ScanSession | null = null;
const listeners = new Set<() => void>();

export const getScanSession = (): ScanSession | null => session;

export const setScanSession = (s: ScanSession): void => {
  session = s;
  listeners.forEach((l) => l());
};

export const clearScanSession = (): void => {
  session = null;
  listeners.forEach((l) => l());
};

/** Applies an immutable update to the current session (a no-op if there is none). */
export const updateScanSession = (fn: (s: ScanSession) => ScanSession): void => {
  if (!session) return;
  const next = fn(session);
  if (next === session) return;
  session = next;
  listeners.forEach((l) => l());
};

export const subscribeScanSession = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
