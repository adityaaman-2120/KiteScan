import type { PreparedImage } from '../utils/image';

/** A photo handed to the Pipeline Lab from elsewhere (e.g. "see every step" on a scanned page). Taken once. */
export type LabSource = PreparedImage & { name: string };

let pending: LabSource | null = null;

export const setLabSource = (source: LabSource): void => {
  pending = source;
};

export const takeLabSource = (): LabSource | null => {
  const s = pending;
  pending = null;
  return s;
};
