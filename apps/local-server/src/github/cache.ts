/** How a cached read is asked for. */
export interface CacheOptions<T> {
  /** How long a value answers for after it was loaded; a function lets a failure expire sooner. */
  ttlMs: number | ((value: T) => number);
  /** Load again even when the cached value is still fresh (a person's Refresh). */
  force?: boolean;
  /** Whether a loaded value is kept; a failed read usually is not, so the next ask tries again. */
  keep?: (value: T) => boolean;
}

export interface KeyedCache {
  /**
   * The value under `key`: the cached one while fresh, else what `load` returns. Callers asking
   * for the same key while a load runs share it, so a burst of devices costs GitHub one call.
   */
  get: <T>(key: string, load: () => Promise<T>, options: CacheOptions<T>) => Promise<T>;
  /** When the value under `key` was loaded, or null when there is none. */
  loadedAt: (key: string) => number | null;
  clear: () => void;
}

const MAX_ENTRIES = 500;

export const createKeyedCache = (now: () => number = Date.now): KeyedCache => {
  const entries = new Map<string, { value: unknown; at: number }>();
  const inFlight = new Map<string, Promise<unknown>>();

  const store = (key: string, value: unknown) => {
    entries.delete(key);
    entries.set(key, { value, at: now() });
    // Oldest first: a Map iterates in insertion order, and a store re-inserts.
    if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  };

  const get: KeyedCache["get"] = async <T>(
    key: string,
    load: () => Promise<T>,
    { ttlMs, force = false, keep = () => true }: CacheOptions<T>,
  ) => {
    const cached = entries.get(key);
    if (!force && cached && now() - cached.at < ttlOf(ttlMs, cached.value as T)) {
      return cached.value as T;
    }
    const running = inFlight.get(key);
    if (running) return running as Promise<T>;
    const loading = load()
      .then((value) => {
        if (keep(value)) store(key, value);
        return value;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, loading);
    return loading;
  };

  return {
    get,
    loadedAt: (key) => entries.get(key)?.at ?? null,
    clear: () => {
      entries.clear();
      inFlight.clear();
    },
  };
};

const ttlOf = <T>(ttlMs: CacheOptions<T>["ttlMs"], value: T): number =>
  typeof ttlMs === "number" ? ttlMs : ttlMs(value);
