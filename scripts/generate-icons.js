// Renders the KiteScan logo (same geometry JSON the React component uses)
// into the PNGs referenced by app.json. Run: node scripts/generate-icons.js
const path = require('path');
const sharp = require('sharp');
const g = require('../assets/logo/logo-geometry.json');

const OUT = path.join(__dirname, '..', 'assets', 'images');
const SIZE = 1024;
const c = g.colors;
const mid = (g.scan.top + g.scan.bottom) / 2;

// scale = pixels per logo unit; logo centre (50,50) lands on the canvas centre.
function place(scale, inner) {
  const t = SIZE / 2 - 50 * scale;
  return `<g transform="translate(${t} ${t}) scale(${scale})">${inner}</g>`;
}

const defs = `
  <linearGradient id="kiteFill" x1="0.2" y1="0" x2="0.8" y2="1">
    <stop offset="0" stop-color="${c.kiteFrom}"/><stop offset="1" stop-color="${c.kiteTo}"/>
  </linearGradient>`;

const scanLines = `
  <line x1="${g.scan.x1}" x2="${g.scan.x2}" y1="${mid}" y2="${mid}" stroke="${c.scan}" stroke-opacity="0.12" stroke-width="9" stroke-linecap="round"/>
  <line x1="${g.scan.x1}" x2="${g.scan.x2}" y1="${mid}" y2="${mid}" stroke="${c.scan}" stroke-opacity="0.25" stroke-width="5.5" stroke-linecap="round"/>
  <line x1="${g.scan.x1}" x2="${g.scan.x2}" y1="${mid}" y2="${mid}" stroke="${c.scan}" stroke-width="${g.scan.width}" stroke-linecap="round"/>`;

const logo = `
  <path d="${g.tail}" stroke="${c.tail}" stroke-width="${g.tailWidth}" stroke-linecap="round" fill="none"/>
  <path d="${g.kite}" fill="url(#kiteFill)"/>
  <path d="${g.brackets}" stroke="${c.bracket}" stroke-width="${g.bracketWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  ${scanLines}`;

// White silhouette for Android themed icons: brackets + scan line are cut out.
const mono = `
  <mask id="cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
    <rect width="100" height="100" fill="white"/>
    <path d="${g.brackets}" stroke="black" stroke-width="${g.bracketWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <line x1="${g.scan.x1}" x2="${g.scan.x2}" y1="${mid}" y2="${mid}" stroke="black" stroke-width="${g.scan.width}" stroke-linecap="round"/>
  </mask>
  <path d="${g.tail}" stroke="white" stroke-width="${g.tailWidth}" stroke-linecap="round" fill="none"/>
  <path d="${g.kite}" fill="white" mask="url(#cut)"/>`;

function svg(body, background) {
  const bg = background ? `<rect width="${SIZE}" height="${SIZE}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><defs>${defs}</defs>${bg}${body}</svg>`;
}

const jobs = [
  // Full-bleed store/launcher icon.
  ['icon.png', svg(place(6.9, logo), c.iconBackground)],
  // Adaptive foreground: kept inside the 66% safe zone, transparent background.
  ['android-icon-foreground.png', svg(place(5.8, logo))],
  ['android-icon-monochrome.png', svg(place(5.8, mono))],
  // Native splash image, transparent so the splash backgroundColor shows through.
  ['splash-icon.png', svg(place(9, logo))],
];

(async () => {
  for (const [name, markup] of jobs) {
    await sharp(Buffer.from(markup)).png().toFile(path.join(OUT, name));
    console.log('wrote', name);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
