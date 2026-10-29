/** A4 in PostScript points (1/72 inch), the unit expo-print's width/height use. */
export const A4_WIDTH_PT = 595;
export const A4_HEIGHT_PT = 842;

export type PdfImage = {
  /** Complete data URI, e.g. "data:image/jpeg;base64,/9j/...". No network is ever involved. */
  src: string;
};

/**
 * One A4 page per image: the image is scaled to fit and centred on a white page, with no margins.
 * The margin is removed with an @page rule (the only way on Android); the page box is a hair under
 * 297 mm so rounding can never push an empty page onto the end of the PDF.
 */
export function buildPdfHtml(images: PdfImage[]): string {
  const pages = images
    .map((img, i) => `<div class="page"><img src="${img.src}" alt="Page ${i + 1}"></div>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  .page {
    width: 210mm;
    height: 296.5mm;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #ffffff;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

/** Windows/Android/iOS-safe file name (without extension) made from a document name. */
export function sanitizeFileName(name: string, fallback = 'Scan'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 80)
    .replace(/[\s.-]+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}
