import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Nothing larger than this long-side size is ever sent to the engine. */
export const MAX_ENGINE_SIDE = 1600;

/** Smaller than this is not a scannable photo (the engine needs at least ~24 px to find a page). */
export const MIN_SHORT_SIDE = 64;

/** JPEG quality of every page that ends up stored in a document. */
export const PAGE_JPEG_QUALITY = 0.9;

export type PreparedImage = {
  base64: string;
  width: number;
  height: number;
};

export type PrepareResult =
  | { ok: true; image: PreparedImage }
  | { ok: false; message: string };

const TOO_SMALL = `This image is too small to scan. Pick a larger photo (at least ${MIN_SHORT_SIDE} px on the short side).`;
const UNREADABLE = 'This image could not be opened. Try a different photo.';

/**
 * Downscales (never upscales) to MAX_ENGINE_SIDE on the long side and returns JPEG base64.
 *
 * Huge photos (a 100-megapixel camera shot is ~400 MB as a bitmap) are downsampled WHILE DECODING, so the
 * full-size image is never held in memory. Only one dimension is ever passed to a resize, so the aspect
 * ratio cannot be distorted even if the picker reported the un-rotated width and height.
 */
export async function prepareForEngine(uri: string, width: number, height: number): Promise<PrepareResult> {
  // The picker's numbers are enough to refuse the obviously tiny without touching the file.
  if (width > 0 && height > 0 && Math.min(width, height) < MIN_SHORT_SIDE) return { ok: false, message: TOO_SMALL };

  try {
    let ref = await ImageManipulator.manipulate(uri, { maxWidth: MAX_ENGINE_SIDE, maxHeight: MAX_ENGINE_SIDE }).renderAsync();

    // Belt and braces: if the platform decoded larger than asked, shrink the long side explicitly.
    if (Math.max(ref.width, ref.height) > MAX_ENGINE_SIDE) {
      const ctx = ImageManipulator.manipulate(ref);
      if (ref.width >= ref.height) ctx.resize({ width: MAX_ENGINE_SIDE });
      else ctx.resize({ height: MAX_ENGINE_SIDE });
      ref = await ctx.renderAsync();
    }

    // The real decoded size is the truth (EXIF rotation can make the picker's numbers wrong).
    if (Math.min(ref.width, ref.height) < MIN_SHORT_SIDE) return { ok: false, message: TOO_SMALL };

    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: PAGE_JPEG_QUALITY, base64: true });
    if (!saved.base64) return { ok: false, message: UNREADABLE };
    return { ok: true, image: { base64: saved.base64, width: saved.width, height: saved.height } };
  } catch {
    return { ok: false, message: UNREADABLE };
  }
}
