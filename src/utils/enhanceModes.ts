import type { BoardType, EnhanceMode, EnhanceParams } from '../engine/types';

export const ENHANCE_MODES: { mode: EnhanceMode; label: string }[] = [
  { mode: 'original', label: 'Original' },
  { mode: 'magic', label: 'Magic Color' },
  { mode: 'whiteboard', label: 'Whiteboard' },
  { mode: 'document_bw', label: 'B&W Document' },
  { mode: 'blackboard', label: 'Blackboard' },
];

export const modeLabel = (mode: EnhanceMode): string => ENHANCE_MODES.find((m) => m.mode === mode)?.label ?? mode;

/** Blackboard when analyze said so, Whiteboard for whiteboards, B&W Document for paper. */
export function autoModeFor(board: BoardType): EnhanceMode {
  if (board === 'blackboard') return 'blackboard';
  if (board === 'whiteboard') return 'whiteboard';
  return 'document_bw';
}

export type TuneKey = 'strength' | 'blockSize' | 'C';

/** Which fine-tune controls actually change the output of a mode (no dead sliders). */
export function tunableKeys(mode: EnhanceMode): TuneKey[] {
  switch (mode) {
    case 'magic':
    case 'whiteboard':
      return ['strength'];
    case 'document_bw':
      return ['blockSize', 'C'];
    default:
      return [];
  }
}

export const DEFAULT_TUNE: Record<EnhanceMode, EnhanceParams> = {
  original: {},
  magic: { strength: 1 },
  whiteboard: { strength: 1 },
  document_bw: { blockSize: 31, C: 10 },
  blackboard: {},
};

export const TUNE_RANGES: Record<TuneKey, { min: number; max: number; step: number; label: string }> = {
  strength: { min: 0, max: 2, step: 0.1, label: 'Strength' },
  // Below ~11 the ink itself becomes the local average and vanishes; C <= 1 turns flat paper dark or speckled.
  blockSize: { min: 11, max: 101, step: 2, label: 'Block size' },
  C: { min: 2, max: 40, step: 1, label: 'C (threshold offset)' },
};

/** Only the parameters that matter for the mode, so unrelated changes never invalidate a cached result. */
export function relevantParams(mode: EnhanceMode, params: EnhanceParams): EnhanceParams {
  const out: EnhanceParams = {};
  for (const k of tunableKeys(mode)) {
    const v = params[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function cacheKey(epoch: number, mode: EnhanceMode, params: EnhanceParams): string {
  const rel = relevantParams(mode, params);
  const parts = tunableKeys(mode).map((k) => `${k}=${rel[k]}`);
  return `${epoch}|${mode}|${parts.join(',')}`;
}

export type CacheOutcome<T> = { value: T; fromCache: boolean; isLatest: boolean };

/**
 * Remembers each (mode, params) result so switching chips is instant, and tells the caller whether
 * a finished request is still the one the user is waiting for. reset() starts a new epoch (the source
 * image changed): in-flight results from the old epoch are dropped instead of cached.
 */
export class EnhanceCache<T> {
  private map = new Map<string, T>();
  private latestKey = '';
  private epoch = 0;

  get currentEpoch(): number {
    return this.epoch;
  }

  reset(): number {
    this.map.clear();
    this.latestKey = '';
    return ++this.epoch;
  }

  peek(key: string): T | undefined {
    return this.map.get(key);
  }

  get size(): number {
    return this.map.size;
  }

  async request(key: string, compute: () => Promise<T>): Promise<CacheOutcome<T>> {
    this.latestKey = key;
    const hit = this.map.get(key);
    if (hit !== undefined) return { value: hit, fromCache: true, isLatest: true };

    const startedEpoch = this.epoch;
    const value = await compute();
    if (startedEpoch !== this.epoch) return { value, fromCache: false, isLatest: false }; // image changed meanwhile
    this.map.set(key, value);
    return { value, fromCache: false, isLatest: this.latestKey === key };
  }
}
