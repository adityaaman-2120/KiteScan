// Copies OpenCV.js into assets/engine/opencv.js.txt (".txt" so Metro bundles it as an asset).
// Run: npm run engine:sync  (after installing or upgrading @techstark/opencv-js)
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', '@techstark', 'opencv-js', 'dist', 'opencv.js');
const destDir = path.join(__dirname, '..', 'assets', 'engine');
const dest = path.join(destDir, 'opencv.js.txt');

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

const version = require('@techstark/opencv-js/package.json').version;
console.log(`opencv.js ${version} -> ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
