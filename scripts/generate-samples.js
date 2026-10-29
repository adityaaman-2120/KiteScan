// Builds the offline sample images (assets/samples/*.jpg): whiteboard, blackboard, notebook and a
// plain document. They are drawn as skewed, unevenly lit "photos" so detection, perspective warp and
// shadow removal all have real work to do. Run: node scripts/generate-samples.js
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets', 'samples');
const W = 1200;
const H = 900;
fs.mkdirSync(OUT, { recursive: true });

const lerp = (a, b, t) => a + (b - a) * t;
const f1 = (n) => n.toFixed(1);

/** Deterministic PRNG so the samples are identical on every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear map from page space (u, v in 0..1) to a quad [TL, TR, BR, BL]. */
function mapper(q) {
  return (u, v) => {
    const top = [lerp(q[0][0], q[1][0], u), lerp(q[0][1], q[1][1], u)];
    const bot = [lerp(q[3][0], q[2][0], u), lerp(q[3][1], q[2][1], u)];
    return [lerp(top[0], bot[0], v), lerp(top[1], bot[1], v)];
  };
}
const pts = (arr) => arr.map((p) => `${f1(p[0])},${f1(p[1])}`).join(' ');
const poly = (arr, attrs) => `<polygon points="${pts(arr)}" ${attrs}/>`;
const line = (at, uv, stroke, width, extra = '') =>
  `<polyline points="${pts(uv.map(([u, v]) => at(u, v)))}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none" ${extra}/>`;

/** A wobbly hand-drawn stroke from (u0,v) to (u1,v). */
function scribble(at, rand, u0, u1, v, amp, stroke, width) {
  const n = Math.max(6, Math.round((u1 - u0) * 90));
  const uv = [];
  for (let i = 0; i <= n; i++) {
    const u = lerp(u0, u1, i / n);
    uv.push([u, v + Math.sin(i * 1.7 + rand() * 2) * amp * (0.4 + rand() * 0.6)]);
  }
  return line(at, uv, stroke, width);
}

/** Pseudo handwriting: words made of loopy zig-zags along a baseline. */
function handwriting(at, rand, v, u0, u1, size, stroke, width) {
  const parts = [];
  let u = u0;
  while (u < u1 - 0.05) {
    const wordLen = 0.05 + rand() * 0.12;
    const uv = [];
    const steps = Math.round(wordLen * 160);
    for (let i = 0; i <= steps; i++) {
      const x = u + (wordLen * i) / steps;
      uv.push([x, v - Math.abs(Math.sin(i * 0.9 + rand() * 0.6)) * size * (0.4 + rand() * 0.7) + (i % 5 === 0 ? size * 0.4 : 0)]);
    }
    parts.push(line(at, uv, stroke, width));
    u += wordLen + 0.025 + rand() * 0.02;
  }
  return parts.join('\n');
}

const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;

// ------------------------------------------------------------- whiteboard
function whiteboardSvg() {
  const outer = [[130, 110], [1075, 82], [1100, 735], [105, 765]];
  const inner = [[160, 140], [1050, 114], [1072, 706], [136, 735]];
  const at = mapper(inner);
  const rand = rng(11);
  const art = [];
  // title + bullet text in black, a flow diagram in blue/red/green
  art.push(handwriting(at, rand, 0.12, 0.06, 0.55, 0.035, '#1b1d24', 5));
  for (let i = 0; i < 4; i++) art.push(handwriting(at, rand, 0.26 + i * 0.09, 0.09, 0.2 + rand() * 0.3, 0.03, '#1b1d24', 4));
  const box = (u, v, w, h, c) => line(at, [[u, v], [u + w, v], [u + w, v + h], [u, v + h], [u, v]], c, 6);
  art.push(box(0.58, 0.14, 0.16, 0.14, '#1f5fd6'));
  art.push(box(0.82, 0.14, 0.14, 0.14, '#1f5fd6'));
  art.push(box(0.58, 0.5, 0.16, 0.14, '#d12a2a'));
  art.push(box(0.82, 0.5, 0.14, 0.14, '#1a8f3c'));
  art.push(line(at, [[0.74, 0.21], [0.82, 0.21]], '#1f5fd6', 6));
  art.push(line(at, [[0.66, 0.28], [0.66, 0.5]], '#d12a2a', 6));
  art.push(line(at, [[0.74, 0.57], [0.82, 0.57]], '#1a8f3c', 6));
  art.push(line(at, [[0.1, 0.78], [0.3, 0.74], [0.5, 0.82], [0.7, 0.72], [0.9, 0.8]], '#d12a2a', 7));
  const tray = [[outer[3][0] + 10, outer[3][1] - 4], [outer[2][0] - 10, outer[2][1] - 4], [outer[2][0] - 4, outer[2][1] + 22], [outer[3][0] + 4, outer[3][1] + 22]];
  return `${svgOpen}
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9d1d6"/><stop offset="1" stop-color="#9fa9b0"/></linearGradient>
    <linearGradient id="glare" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="shade" x1="0.1" y1="0" x2="1" y2="0.5"><stop offset="0.4" stop-color="#1b2330" stop-opacity="0"/><stop offset="1" stop-color="#1b2330" stop-opacity="0.38"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wall)"/>
  ${poly(outer.map((p) => [p[0] + 10, p[1] + 14]), 'fill="#000" fill-opacity="0.22"')}
  ${poly(outer, 'fill="#8d949b"')}
  ${poly(inner, 'fill="#f3f5f6"')}
  ${art.join('\n  ')}
  ${poly(inner, 'fill="url(#shade)"')}
  ${poly(inner, 'fill="url(#glare)"')}
  ${poly(tray, 'fill="#7a8088"')}
</svg>`;
}

// ------------------------------------------------------------- blackboard
function blackboardSvg() {
  const outer = [[110, 100], [1090, 120], [1070, 760], [135, 745]];
  const inner = [[150, 140], [1052, 156], [1036, 722], [172, 709]];
  const at = mapper(inner);
  const rand = rng(23);
  const chalk = '#efede6';
  const art = [];
  art.push(handwriting(at, rand, 0.12, 0.07, 0.5, 0.04, chalk, 6));
  for (let i = 0; i < 5; i++) art.push(handwriting(at, rand, 0.27 + i * 0.1, 0.08, 0.25 + rand() * 0.45, 0.032, i === 2 ? '#f1d77a' : chalk, 5));
  // a triangle and a circle
  art.push(line(at, [[0.68, 0.7], [0.92, 0.7], [0.8, 0.38], [0.68, 0.7]], chalk, 6));
  const circle = [];
  for (let i = 0; i <= 40; i++) circle.push([0.8 + Math.cos((i / 40) * Math.PI * 2) * 0.05, 0.56 + Math.sin((i / 40) * Math.PI * 2) * 0.09]);
  art.push(line(at, circle, '#f1d77a', 5));
  const smudges = [];
  for (let i = 0; i < 6; i++) {
    const [x, y] = at(rand(), rand());
    smudges.push(`<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="${40 + rand() * 90}" ry="${14 + rand() * 24}" fill="#ffffff" fill-opacity="${(0.04 + rand() * 0.05).toFixed(2)}"/>`);
  }
  return `${svgOpen}
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cdbfa6"/><stop offset="1" stop-color="#a89878"/></linearGradient>
    <radialGradient id="slate" cx="0.3" cy="0.25" r="0.9"><stop offset="0" stop-color="#53665b"/><stop offset="1" stop-color="#27342d"/></radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0.2"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#wall)"/>
  ${poly(outer.map((p) => [p[0] + 12, p[1] + 16]), 'fill="#000" fill-opacity="0.25"')}
  ${poly(outer, 'fill="#6b4a2b"')}
  ${poly(inner, 'fill="url(#slate)"')}
  ${smudges.join('\n  ')}
  ${art.join('\n  ')}
  ${poly(inner, 'fill="url(#shade)"')}
</svg>`;
}

// --------------------------------------------------------------- notebook
function notebookSvg() {
  const page = [[250, 110], [980, 88], [1030, 790], [205, 815]];
  const at = mapper(page);
  const rand = rng(37);
  const ruled = [];
  for (let i = 0; i < 20; i++) ruled.push(line(at, [[0.02, 0.1 + i * 0.044], [0.98, 0.1 + i * 0.044]], '#8fb4e3', 2.2));
  const margin = line(at, [[0.13, 0.02], [0.13, 0.98]], '#e07a7a', 2.6);
  const holes = [];
  for (let i = 0; i < 9; i++) {
    const [x, y] = at(-0.03, 0.08 + i * 0.105);
    holes.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="11" fill="#5b4632"/><circle cx="${f1(x - 18)}" cy="${f1(y)}" r="5" fill="#b9bcc2"/>`);
  }
  const text = [];
  for (let i = 0; i < 15; i++) {
    const v = 0.088 + i * 0.044 + (i === 0 ? 0 : 0);
    if (i === 6 || i === 11) continue;
    text.push(handwriting(at, rand, v, 0.16, 0.45 + rand() * 0.48, 0.022, '#1c2a6b', 3.4));
  }
  text.push(line(at, [[0.16, 0.74], [0.5, 0.74]], '#c0262b', 4));
  return `${svgOpen}
  <defs>
    <linearGradient id="desk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a6a48"/><stop offset="1" stop-color="#5e4630"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0.15" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#2b1d10" stop-opacity="0.45"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#desk)"/>
  ${poly(page.map((p) => [p[0] + 14, p[1] + 20]), 'fill="#000" fill-opacity="0.28"')}
  ${poly(page, 'fill="#f7f4e8"')}
  ${ruled.join('\n  ')}
  ${margin}
  ${holes.join('\n  ')}
  ${text.join('\n  ')}
  ${poly(page, 'fill="url(#shade)"')}
</svg>`;
}

// --------------------------------------------------------- plain document
function docSvg() {
  const PAPER = [[230, 150], [980, 110], [1040, 770], [160, 830]];
  const at = mapper(PAPER);
  const lines = [];
  for (let i = 0; i < 15; i++) {
    const v = 0.1 + i * 0.052;
    const end = i % 5 === 4 ? 0.42 : 0.9 - (i % 3) * 0.04;
    lines.push(line(at, [[0.1, v], [end, v]], '#1a1a20', 5));
  }
  lines.push(line(at, [[0.1, 0.93], [0.55, 0.93]], '#c42626', 6));
  lines.push(line(at, [[0.62, 0.93], [0.85, 0.93]], '#2457c9', 6));
  return `${svgOpen}
  <defs>
    <linearGradient id="desk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a6650"/><stop offset="1" stop-color="#5b4a3a"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#desk)"/>
  ${poly(PAPER.map((p) => [p[0] + 14, p[1] + 18]), 'fill="#000" fill-opacity="0.25"')}
  ${poly(PAPER, 'fill="#f1efe6"')}
  ${lines.join('\n  ')}
  ${poly(PAPER, 'fill="url(#shade)"')}
</svg>`;
}

(async () => {
  const jobs = [
    ['sample-whiteboard.jpg', whiteboardSvg()],
    ['sample-blackboard.jpg', blackboardSvg()],
    ['sample-notebook.jpg', notebookSvg()],
    ['sample-doc.jpg', docSvg()],
  ];
  for (const [name, svg] of jobs) {
    await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(path.join(OUT, name));
    console.log('wrote assets/samples/' + name);
  }
})();
