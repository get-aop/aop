import { useCallback, useSyncExternalStore } from "react";

const isomorphicLocalStorage: Storage =
  typeof window !== "undefined"
    ? window.localStorage
    : ({
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
        clear: () => undefined,
        key: () => null,
        length: 0,
      } as Storage);

const listeners = new Map<string, Set<() => void>>();

const notify = (key: string) => {
  for (const listener of listeners.get(key) ?? []) listener();
};

export const getLocalStorageItem = <T>(key: string, _schema?: unknown): T | null => {
  const raw = isomorphicLocalStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
};

export const setLocalStorageItem = (key: string, value: unknown, _schema?: unknown): void => {
  isomorphicLocalStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  notify(key);
};

export const removeLocalStorageItem = (key: string): void => {
  isomorphicLocalStorage.removeItem(key);
  notify(key);
};

const subscribe = (key: string) => (listener: () => void) => {
  const existing = listeners.get(key) ?? new Set<() => void>();
  existing.add(listener);
  listeners.set(key, existing);
  return () => {
    existing.delete(listener);
  };
};

export const useLocalStorage = <T>(
  key: string,
  initialValue: T,
): [T, (value: T | ((current: T) => T)) => void] => {
  const snapshot = useSyncExternalStore(subscribe(key), () => isomorphicLocalStorage.getItem(key));
  const value =
    snapshot === null
      ? initialValue
      : (() => {
          try {
            return JSON.parse(snapshot) as T;
          } catch {
            return snapshot as unknown as T;
          }
        })();
  const setValue = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      setLocalStorageItem(key, resolved);
    },
    [key, value],
  );
  return [value, setValue];
};
