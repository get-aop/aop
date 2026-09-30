import { describe, expect, test } from "bun:test";
import { createKeyedQueue } from "./keyed-queue.ts";

describe("a keyed queue", () => {
  test("runs the tasks of one key in order, each after the one before has finished", async () => {
    const queue = createKeyedQueue();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`${name} start`);
      await Bun.sleep(ms);
      events.push(`${name} end`);
      return name;
    };

    const results = await Promise.all([
      queue("a", task("first", 30)),
      queue("a", task("second", 1)),
    ]);

    expect(results).toEqual(["first", "second"]);
    expect(events).toEqual(["first start", "first end", "second start", "second end"]);
  });

  test("lets different keys run together", async () => {
    const queue = createKeyedQueue();
    const events: string[] = [];

    await Promise.all([
      queue("a", async () => {
        events.push("a start");
        await Bun.sleep(30);
        events.push("a end");
      }),
      queue("b", async () => {
        events.push("b start");
      }),
    ]);

    expect(events).toEqual(["a start", "b start", "a end"]);
  });

  test("a task that throws fails only its own caller", async () => {
    const queue = createKeyedQueue();

    const failing = queue("a", async () => {
      throw new Error("boom");
    });
    const next = queue("a", async () => "still runs");

    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("still runs");
  });
});
