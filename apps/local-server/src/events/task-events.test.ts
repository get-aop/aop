import { describe, expect, test } from "bun:test";
import { createTaskEventEmitter, type TaskEvent } from "./task-events.ts";

describe("events/task-events", () => {
  test("delivers emitted events to every subscriber", () => {
    const emitter = createTaskEventEmitter();
    const first: TaskEvent[] = [];
    const second: TaskEvent[] = [];
    emitter.subscribe((event) => first.push(event));
    emitter.subscribe((event) => second.push(event));

    emitter.emit({ type: "repo-removed", repoId: "repo-1" });

    expect(first).toEqual([{ type: "repo-removed", repoId: "repo-1" }]);
    expect(second).toEqual(first);
  });

  test("unsubscribe stops receiving events", () => {
    const emitter = createTaskEventEmitter();
    const events: TaskEvent[] = [];
    const unsubscribe = emitter.subscribe((event) => events.push(event));

    emitter.emit({ type: "data-reset" });
    unsubscribe();
    emitter.emit({ type: "data-reset" });

    expect(events).toEqual([{ type: "data-reset" }]);
  });

  test("listenerCount returns correct count", () => {
    const emitter = createTaskEventEmitter();

    expect(emitter.listenerCount()).toBe(0);

    const unsubscribe1 = emitter.subscribe(() => {});
    expect(emitter.listenerCount()).toBe(1);

    const unsubscribe2 = emitter.subscribe(() => {});
    expect(emitter.listenerCount()).toBe(2);

    unsubscribe1();
    expect(emitter.listenerCount()).toBe(1);

    unsubscribe2();
    expect(emitter.listenerCount()).toBe(0);
  });
});
