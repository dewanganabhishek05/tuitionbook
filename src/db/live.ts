// A tiny "live query" layer: mutations bump a version, and any screen using useLive() re-runs its query.
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

let version = 0;
const listeners = new Set<() => void>();

let paused = 0;
let pendingWhilePaused = false;

export function notifyChange() {
  if (paused) {
    pendingWhilePaused = true;
    return;
  }
  version += 1;
  listeners.forEach((l) => l());
}

/** Runs a bulk job and refreshes screens once at the end instead of after every write. */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  paused += 1;
  try {
    return await fn();
  } finally {
    paused -= 1;
    if (!paused && pendingWhilePaused) {
      pendingWhilePaused = false;
      notifyChange();
    }
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDataVersion() {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function useDb() {
  return useSQLiteContext();
}

/**
 * Runs `query` now, whenever `deps` change, and whenever any data changes.
 * Returns `undefined` until the first result arrives.
 */
export function useLive<T>(query: (db: SQLiteDatabase) => Promise<T>, deps: unknown[] = []) {
  const db = useSQLiteContext();
  const v = useDataVersion();
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const q = useRef(query);
  useEffect(() => {
    q.current = query;
  });
  const key = JSON.stringify(deps);

  useEffect(() => {
    let alive = true;
    q.current(db)
      .then((r) => {
        if (alive) { setData(r); setError(null); }
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      alive = false;
    };
  }, [db, v, key]);

  return { data, error, loading: data === undefined && !error };
}
