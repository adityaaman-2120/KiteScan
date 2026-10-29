import { ENGINE_SCRIPT } from './engineScript';

/** Keep in sync with the installed @techstark/opencv-js (see scripts/sync-engine.js). */
export const OPENCV_VERSION = '5.0.0-release.1';

const HEAD = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  function post(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  window.addEventListener('error', function (e) {
    post({ type: 'log', message: 'page error: ' + e.message });
  });
</script>
</head>
<body>
`;

const SCRIPT_FILE = `<script src="opencv.js" onerror="post({ type: 'boot-error', message: 'opencv.js could not be loaded' })"></script>\n`;

const TAIL = '<script>' + ENGINE_SCRIPT + '</script>\n</body>\n</html>\n';

/** engine.html that loads opencv.js from the same folder with <script src>. */
export function buildEngineHtml(): string {
  return HEAD + SCRIPT_FILE + TAIL;
}

/** Fallback: the whole opencv.js inlined into the page (no file access needed). */
export function buildInlineEngineHtml(openCvSource: string): string {
  return HEAD + '<script>' + openCvSource + '</script>\n' + TAIL;
}

/** Changes whenever opencv or the page changes, so the cached copy is refreshed. */
export const ENGINE_VERSION = `${OPENCV_VERSION}-${hash(buildEngineHtml())}`;

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
