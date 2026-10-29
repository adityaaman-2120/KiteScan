import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { deleteDoc, listDocs, renameDoc, type Doc } from './docs';

/** Library state for screens: loads on focus, supports pull-to-refresh, rename and delete. */
export function useDocs() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listDocs();
    if (res.ok) {
      setDocs(res.value);
      setError(null);
    } else {
      setError(res.message);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /** Returns an error message, or null on success. */
  const rename = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      const res = await renameDoc(id, name);
      if (!res.ok) return res.message;
      await load();
      return null;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string): Promise<string | null> => {
      const res = await deleteDoc(id);
      if (!res.ok) return res.message;
      await load();
      return null;
    },
    [load],
  );

  return { docs, loading, refreshing, error, refresh, rename, remove };
}
