import { describe, expect, test } from "bun:test";
import { createKeyedCache } from "./cache.ts";

describe("the keyed cache", () => {
  const clock = () => {
    let at = 1_000;
    return { now: () => at, advance: (ms: number) => (at += ms) };
  };

  test("answers from the cache while fresh, and loads again after", async () => {
    const time = clock();
    const cache = createKeyedCache(time.now);
    let loads = 0;
    const load = async () => ++loads;

    expect(await cache.get("k", load, { ttlMs: 100 })).toBe(1);
    time.advance(99);
    expect(await cache.get("k", load, { ttlMs: 100 })).toBe(1);
    time.advance(1);
    expect(await cache.get("k", load, { ttlMs: 100 })).toBe(2);
    expect(cache.loadedAt("k")).toBe(1_100);
  });

  test("force loads again however fresh the value is", async () => {
    const cache = createKeyedCache(clock().now);
    let loads = 0;
    await cache.get("k", async () => ++loads, { ttlMs: 60_000 });

    expect(await cache.get("k", async () => ++loads, { ttlMs: 60_000, force: true })).toBe(2);
  });

  test("callers asking while a load runs share it", async () => {
    const cache = createKeyedCache(clock().now);
    let loads = 0;
    let release: () => void = () => {};
    const load = () =>
      new Promise<number>((resolve) => {
        loads += 1;
        release = () => resolve(loads);
      });

    const first = cache.get("k", load, { ttlMs: 100 });
    const second = cache.get("k", load, { ttlMs: 100, force: true });
    release();

    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(loads).toBe(1);
  });

  test("a value `keep` refuses is not cached", async () => {
    const cache = createKeyedCache(clock().now);
    let loads = 0;
    const options = { ttlMs: 60_000, keep: (value: number) => value > 1 };

    expect(await cache.get("k", async () => ++loads, options)).toBe(1);
    expect(await cache.get("k", async () => ++loads, options)).toBe(2);
    expect(await cache.get("k", async () => ++loads, options)).toBe(2);
    expect(cache.loadedAt("missing")).toBeNull();
  });

  test("a ttl function lets a value expire by what it is", async () => {
    const time = clock();
    const cache = createKeyedCache(time.now);
    let value = "failed";
    const options = { ttlMs: (current: string) => (current === "failed" ? 10 : 1_000) };

    await cache.get("k", async () => value, options);
    value = "ok";
    time.advance(10);
    expect(await cache.get("k", async () => value, options)).toBe("ok");
    time.advance(500);
    value = "newer";
    expect(await cache.get("k", async () => value, options)).toBe("ok");
  });

  test("clear forgets everything", async () => {
    const cache = createKeyedCache(clock().now);
    await cache.get("k", async () => 1, { ttlMs: 60_000 });
    cache.clear();

    expect(await cache.get("k", async () => 2, { ttlMs: 60_000 })).toBe(2);
  });
});
