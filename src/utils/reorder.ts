/*
 * Pure logic for the drag-to-reorder page grid. A "slot" is a grid position (0 = top-left, then
 * left to right, top to bottom). `slotOf` maps each page file to its slot; it is always a permutation
 * of 0..n-1. Everything here is marked 'worklet' because it runs on the UI thread during a drag.
 */

export const GRID_COLS = 2;

export type SlotMap = Record<string, number>;

export function slotX(slot: number, cellW: number, gap: number): number {
  'worklet';
  return (slot % GRID_COLS) * (cellW + gap);
}

export function slotY(slot: number, cellH: number, gap: number): number {
  'worklet';
  return Math.floor(slot / GRID_COLS) * (cellH + gap);
}

/** The slot under a point (in grid coordinates), clamped to a real slot. */
export function slotAtPoint(x: number, y: number, cellW: number, cellH: number, gap: number, count: number): number {
  'worklet';
  const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(x / (cellW + gap))));
  const rows = Math.max(1, Math.ceil(count / GRID_COLS));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(y / (cellH + gap))));
  return Math.max(0, Math.min(count - 1, row * GRID_COLS + col));
}

/** Moves `key` to slot `to`; everything in between shifts by one. Returns the same object if nothing changes. */
export function moveSlot(slotOf: SlotMap, key: string, to: number): SlotMap {
  'worklet';
  const from = slotOf[key];
  if (from === undefined || from === to) return slotOf;
  const next: SlotMap = {};
  for (const k of Object.keys(slotOf)) {
    const s = slotOf[k];
    if (k === key) next[k] = to;
    else if (from < to && s > from && s <= to) next[k] = s - 1;
    else if (from > to && s >= to && s < from) next[k] = s + 1;
    else next[k] = s;
  }
  return next;
}

export function slotsFromKeys(keys: string[]): SlotMap {
  const out: SlotMap = {};
  keys.forEach((k, i) => {
    out[k] = i;
  });
  return out;
}

/** Page files in slot order. */
export function keysFromSlots(slotOf: SlotMap): string[] {
  'worklet';
  return Object.keys(slotOf).sort((a, b) => slotOf[a] - slotOf[b]);
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Total height of the grid for n cells. */
export function gridHeight(count: number, cellH: number, gap: number): number {
  const rows = Math.ceil(count / GRID_COLS);
  return rows === 0 ? 0 : rows * cellH + (rows - 1) * gap;
}
