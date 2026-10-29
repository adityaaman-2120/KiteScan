import type { BoardType, EnhanceMode } from '../engine/types';
import type { Look, ScanSession, ScannedImage } from '../store/session';
import { autoModeFor } from './enhanceModes';

/* Pure logic for multi-page scans: how good a page is, which pages are duplicates, and how the list of
 * pages changes. Nothing here touches the engine, the file system or React, so it is easy to test. */

// ------------------------------------------------------------------ looks

/** The concrete mode a look turns into for a page: 'auto' follows what the page turned out to be. */
export function resolveMode(look: Look, boardType: BoardType): EnhanceMode {
  return look.mode === 'auto' ? autoModeFor(boardType) : look.mode;
}

export function sameLook(a: Look, b: Look): boolean {
  return a.mode === b.mode && JSON.stringify(a.params) === JSON.stringify(b.params);
}

// ------------------------------------------------------------- duplicates

/** Pages whose 256-bit fingerprints differ in at most this many bits are treated as the same page. */
export const DUPLICATE_MAX_DISTANCE = 24;

/** Number of differing bits between two equal-length hex strings (Infinity if they cannot be compared). */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    const na = parseInt(a[i], 16);
    const nb = parseInt(b[i], 16);
    // NaN ^ n is 0 in JavaScript, so a non-hex character must be rejected before the XOR.
    if (Number.isNaN(na) || Number.isNaN(nb)) return Infinity;
    const x = na ^ nb;
    bits += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1);
  }
  return bits;
}

export type DuplicatePair = {
  /** The later page (the one to offer removing). */
  index: number;
  /** The earlier page it matches. */
  of: number;
  distance: number;
};

/** For every page, the first EARLIER page it duplicates (if any). */
export function findDuplicates(fingerprints: string[], maxDistance = DUPLICATE_MAX_DISTANCE): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  for (let j = 1; j < fingerprints.length; j++) {
    for (let i = 0; i < j; i++) {
      const distance = hammingHex(fingerprints[i], fingerprints[j]);
      if (distance <= maxDistance) {
        out.push({ index: j, of: i, distance });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- quality

export type QualityIssue = 'blurry' | 'dark' | 'overexposed' | 'weak_edges' | 'no_page' | 'small';
export type PageQuality = {
  /** 0 to 100. */
  score: number;
  grade: 'great' | 'good' | 'check';
  issues: { id: QualityIssue; label: string }[];
};

type QualityInput = Pick<ScannedImage, 'analysis' | 'detection' | 'edited'>;

const LABELS: Record<QualityIssue, string> = {
  blurry: 'Blurry',
  dark: 'Too dark',
  overexposed: 'Overexposed',
  weak_edges: 'Edges unsure',
  no_page: 'No page found',
  small: 'Page is small',
};

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/**
 * A transparent quality report built only from measurements the engine already made: sharpness (variance of
 * the Laplacian), exposure (mean brightness and clipping) and how sure the page detection was. Pages whose
 * corners the user adjusted count as confirmed.
 */
export function pageQuality({ analysis, detection, edited }: QualityInput): PageQuality {
  const a = analysis;
  const sharp = clamp(a.blurScore / (Math.max(1, a.blurThreshold) * 3));

  // Exposure: a comfortable mean brightness, no large blown-out or crushed areas.
  const mean = a.brightness;
  let exposure = mean >= 90 && mean <= 210 ? 1 : mean < 90 ? clamp((mean - 30) / 60) : clamp((245 - mean) / 35);
  if (a.clipHigh > 0.4) exposure *= clamp(1 - (a.clipHigh - 0.4) / 0.4, 0.2, 1);
  if (a.clipLow > 0.4) exposure *= clamp(1 - (a.clipLow - 0.4) / 0.4, 0.2, 1);

  const found = detection.found;
  const edges = edited ? 1 : found ? clamp((detection.score - 0.5) / 0.3) : 0;
  const size = !found || edited ? 1 : clamp(detection.areaFraction / 0.2, 0.3, 1);

  const score = Math.round(100 * (0.4 * sharp + 0.25 * exposure + 0.25 * edges + 0.1 * size));

  const ids: QualityIssue[] = [];
  if (a.isBlurry) ids.push('blurry');
  if (mean < 70) ids.push('dark');
  if (mean > 215 || a.clipHigh > 0.5) ids.push('overexposed');
  if (!edited && !found) ids.push('no_page');
  else if (!edited && detection.score < 0.7) ids.push('weak_edges');
  if (!edited && found && detection.areaFraction < 0.12) ids.push('small');

  // "Great" means nothing to flag: a page with any issue badge tops out at "good".
  const grade = a.isBlurry || (!edited && !found) ? 'check' : score >= 80 && ids.length === 0 ? 'great' : score >= 60 ? 'good' : 'check';
  return { score, grade, issues: ids.map((id) => ({ id, label: LABELS[id] })) };
}

// -------------------------------------------------- list changes (pure)

/** The session after removing page `index`; null when that was the last page. */
export function removePage(s: ScanSession, index: number): ScanSession | null {
  if (index < 0 || index >= s.items.length) return s;
  const items = s.items.filter((_, i) => i !== index);
  if (items.length === 0) return null;
  // Stay on the same position, or the new last page if the last one was removed.
  const next = index < s.index ? s.index - 1 : Math.min(s.index === index ? index : s.index, items.length - 1);
  return { ...s, items, index: Math.max(0, next) };
}

export function replacePage(s: ScanSession, index: number, page: ScannedImage): ScanSession {
  if (index < 0 || index >= s.items.length) return s;
  const items = s.items.slice();
  items[index] = page;
  return { ...s, items };
}

/** New pages go to the end; the view jumps to the first of them. */
export function appendPages(s: ScanSession, pages: ScannedImage[]): ScanSession {
  if (pages.length === 0) return s;
  return { ...s, items: [...s.items, ...pages], index: s.items.length };
}

export function pageId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
