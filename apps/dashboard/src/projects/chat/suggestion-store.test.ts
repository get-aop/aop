import { describe, expect, test } from "bun:test";
import { createSuggestionStore } from "./suggestion-store";

const memoryStorage = (initial: string | null = null) => {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
};

describe("createSuggestionStore", () => {
  test("keeps what was done with each suggestion, and a new store over the same storage reads it back", () => {
    const storage = memoryStorage();
    const store = createSuggestionStore(storage);

    store.set("s1", { state: "started", threadId: "thr_1" });
    store.set("s2", { state: "skipped" });

    expect(createSuggestionStore(storage).getSnapshot()).toEqual({
      s1: { state: "started", threadId: "thr_1" },
      s2: { state: "skipped" },
    });
  });

  test("taking back a skip makes the suggestion wait again", () => {
    const store = createSuggestionStore(memoryStorage());
    store.set("s1", { state: "skipped" });

    store.clear("s1");

    expect(store.getSnapshot()).toEqual({});
  });

  test("tells listeners about each change until they leave", () => {
    const store = createSuggestionStore(memoryStorage());
    let heard = 0;
    const stop = store.subscribe(() => {
      heard += 1;
    });

    store.set("s1", { state: "skipped" });
    stop();
    store.set("s2", { state: "skipped" });

    expect(heard).toBe(1);
  });

  test("starts empty over storage it cannot read", () => {
    expect(createSuggestionStore(memoryStorage("{broken")).getSnapshot()).toEqual({});
    expect(createSuggestionStore(memoryStorage("[1]")).getSnapshot()).toEqual({});
  });

  test("keeps the answer for this visit when storage refuses the write", () => {
    const store = createSuggestionStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });

    store.set("s1", { state: "skipped" });

    expect(store.getSnapshot()).toEqual({ s1: { state: "skipped" } });
  });
});
