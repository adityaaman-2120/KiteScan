import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import { ENGINE_VERSION, buildEngineHtml } from './engineHtml';

// Metro treats .txt as an asset (see metro.config.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OPENCV_ASSET: number = require('../../assets/engine/opencv.js.txt');

export type EngineFiles = {
  /** file:// uri of engine.html */
  htmlUri: string;
  /** file:// uri of the copied opencv.js */
  openCvUri: string;
};

/**
 * Copies opencv.js and engine.html into documentDirectory/engine/ so the WebView
 * can load them from disk. Skipped when the stored version already matches.
 */
export async function prepareEngineFiles(): Promise<EngineFiles> {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('No writable document directory');

  const dir = `${root}engine/`;
  const htmlUri = `${dir}engine.html`;
  const openCvUri = `${dir}opencv.js`;
  const versionUri = `${dir}version.txt`;

  const upToDate = await isUpToDate(dir, versionUri, [htmlUri, openCvUri]);
  if (upToDate) return { htmlUri, openCvUri };

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const asset = Asset.fromModule(OPENCV_ASSET);
  await asset.downloadAsync();
  const source = asset.localUri ?? asset.uri;

  // Delete any stale copy first: copyAsync refuses to overwrite.
  await FileSystem.deleteAsync(openCvUri, { idempotent: true });
  await FileSystem.copyAsync({ from: source, to: openCvUri });
  await FileSystem.writeAsStringAsync(htmlUri, buildEngineHtml());
  // Written last: a half-finished copy is never mistaken for a valid one.
  await FileSystem.writeAsStringAsync(versionUri, ENGINE_VERSION);

  return { htmlUri, openCvUri };
}

async function isUpToDate(dir: string, versionUri: string, files: string[]): Promise<boolean> {
  try {
    const infos = await Promise.all(files.map((f) => FileSystem.getInfoAsync(f)));
    if (!infos.every((i) => i.exists)) return false;
    const stored = await FileSystem.readAsStringAsync(versionUri);
    return stored === ENGINE_VERSION;
  } catch {
    return false;
  }
}
