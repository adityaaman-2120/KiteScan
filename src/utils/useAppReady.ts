import { useEffect, useState } from 'react';

/**
 * Gate for hiding the native splash. Add the async startup work here
 * (fonts, OpenCV engine warm-up) as it comes online.
 */
const startupTasks: Promise<unknown>[] = [];

export function useAppReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all(startupTasks)
      .catch(() => undefined) // a failed task must never block launch
      .then(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  return ready;
}
