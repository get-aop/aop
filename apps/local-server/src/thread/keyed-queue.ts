/**
 * Runs tasks that share a key one after another, in the order they were asked for; tasks with
 * different keys run side by side. A task that throws does not stop the ones behind it.
 */
export type KeyedQueue = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export const createKeyedQueue = (): KeyedQueue => {
  const tails = new Map<string, Promise<void>>();
  return (key, task) => {
    const result = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    // The last task of a key leaves nothing behind.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
};
