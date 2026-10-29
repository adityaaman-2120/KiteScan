const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// opencv.js ships as assets/engine/opencv.js.txt so Metro treats it as an asset, not source.
config.resolver.assetExts.push('txt');

module.exports = config;
