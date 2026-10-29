import type { useRouter } from 'expo-router';

type AppRouter = ReturnType<typeof useRouter>;

/**
 * Pops the scan flow (process, crop, enhance) off the stack: back to the document being extended
 * when there is one, otherwise all the way to Home.
 */
export function popToBase(router: AppRouter, docId?: string): void {
  if (docId) router.dismissTo({ pathname: '/doc/[id]', params: { id: docId } });
  else router.dismissAll();
}
