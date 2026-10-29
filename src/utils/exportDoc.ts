import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { pageUri, type Doc } from '../store/docs';
import { A4_HEIGHT_PT, A4_WIDTH_PT, buildPdfHtml, sanitizeFileName, type PdfImage } from './pdfHtml';

/** Everything here is local: pages are read from disk, the PDF is rendered on the phone. */

export type ExportProgress =
  | { phase: 'preparing'; current: number; total: number }
  | { phase: 'creating' }
  | { phase: 'sharing' };

export type ExportOutcome = { ok: true } | { ok: false; message: string; cancelled?: boolean };

/** Above this estimated HTML size the PDF step may be slow or run out of memory on older phones. */
export const BIG_EXPORT_BYTES = 40 * 1024 * 1024;

const FRIENDLY_PDF = 'The PDF could not be created. Try again, or export fewer pages.';
const FRIENDLY_SHARE = 'The share sheet could not be opened. Please try again.';
const NO_SHARING = 'Sharing is not available on this device.';

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function exportDir(): string {
  const base = FileSystem.cacheDirectory;
  if (!base) throw new Error('No cache directory');
  return `${base}exports/`;
}

/** Starts from an empty export folder. The previous file is only needed while its share sheet is open. */
async function freshExportDir(): Promise<string> {
  const dir = exportDir();
  await FileSystem.deleteAsync(dir, { idempotent: true });
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

/** Estimated size of the PDF's HTML (base64 grows data by about 37%). */
export async function estimateExportBytes(doc: Doc): Promise<number> {
  let total = 0;
  for (const page of doc.pages) {
    const info = await FileSystem.getInfoAsync(pageUri(doc.id, page));
    if (info.exists && typeof info.size === 'number') total += info.size;
  }
  return Math.round(total * 1.37);
}

/**
 * Builds an A4 PDF (one page per scanned page) and opens the share sheet.
 * Progress is reported while pages are read; `shouldCancel` is honoured until the PDF render starts.
 */
export async function exportPdf(
  doc: Doc,
  opts: { onProgress: (p: ExportProgress) => void; shouldCancel: () => boolean },
): Promise<ExportOutcome> {
  const cancelled: ExportOutcome = { ok: false, message: 'Export cancelled.', cancelled: true };
  let pdfPath = '';
  try {
    if (!(await Sharing.isAvailableAsync())) return { ok: false, message: NO_SHARING };
    const dir = await freshExportDir();

    const images: PdfImage[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      if (opts.shouldCancel()) return cancelled;
      opts.onProgress({ phase: 'preparing', current: i + 1, total: doc.pages.length });
      const b64 = await FileSystem.readAsStringAsync(pageUri(doc.id, doc.pages[i]), {
        encoding: FileSystem.EncodingType.Base64,
      });
      images.push({ src: `data:image/jpeg;base64,${b64}` });
      await yieldToUi(); // let the progress bar repaint between pages
    }
    if (opts.shouldCancel()) return cancelled;

    opts.onProgress({ phase: 'creating' });
    await yieldToUi();
    const printed = await Print.printToFileAsync({
      html: buildPdfHtml(images),
      width: A4_WIDTH_PT,
      height: A4_HEIGHT_PT,
      margins: { top: 0, right: 0, bottom: 0, left: 0 }, // iOS only; Android has none and uses @page
      base64: false,
    });
    images.length = 0; // release the big strings before sharing

    // expo-print picks a random name; the file gets the document's name instead.
    const target = `${dir}${sanitizeFileName(doc.name)}.pdf`;
    await FileSystem.moveAsync({ from: printed.uri, to: target });
    pdfPath = target;
    if (opts.shouldCancel()) return cancelled;

    opts.onProgress({ phase: 'sharing' });
  } catch {
    return { ok: false, message: FRIENDLY_PDF };
  }

  // The PDF exists at this point: a failure now is about the share sheet, not about the PDF.
  try {
    await Sharing.shareAsync(pdfPath, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: doc.name });
    return { ok: true };
  } catch {
    return { ok: false, message: FRIENDLY_SHARE };
  }
}

/** Shares one page as a JPEG, named after the document ("Scan 29 Oct, 7-41 PM - page 2.jpg"). */
export async function shareImage(doc: Doc, pageIndex: number): Promise<ExportOutcome> {
  const page = doc.pages[pageIndex];
  if (!page) return { ok: false, message: 'That page no longer exists.' };
  try {
    if (!(await Sharing.isAvailableAsync())) return { ok: false, message: NO_SHARING };
    const dir = await freshExportDir();
    const base = sanitizeFileName(doc.name);
    const target = `${dir}${doc.pages.length > 1 ? `${base} - page ${pageIndex + 1}` : base}.jpg`;
    await FileSystem.copyAsync({ from: pageUri(doc.id, page), to: target });
    await Sharing.shareAsync(target, { mimeType: 'image/jpeg', UTI: 'public.jpeg', dialogTitle: doc.name });
    return { ok: true };
  } catch {
    return { ok: false, message: FRIENDLY_SHARE };
  }
}
