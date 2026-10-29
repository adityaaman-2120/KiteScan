import { useSyncExternalStore } from 'react';

import { getScanSession, subscribeScanSession, type ScanSession } from './session';

/** The scan session, re-rendering whenever any screen changes it. */
export function useScanSession(): ScanSession | null {
  return useSyncExternalStore(subscribeScanSession, getScanSession, getScanSession);
}
