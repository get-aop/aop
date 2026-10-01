import { describe, expect, test } from "bun:test";
import type { ThreadStatus } from "@aop/common";
import { greetingOf } from "./greeting";
import { makeThread } from "./test-utils";

const threadsIn = (...statuses: ThreadStatus[]) =>
  statuses.map((status, index) => makeThread({ id: `t${index}`, status }));

describe("greetingOf", () => {
  test("welcomes the person by first name while no thread has finished anything", () => {
    expect(greetingOf("Marcelo Ribeiro Mendes", [])).toBe("Welcome, Marcelo.");
    expect(greetingOf("Marcelo", threadsIn("working", "idle", "queued", "waiting-on-you"))).toBe(
      "Welcome, Marcelo.",
    );
  });

  test("welcomes them back once a thread is ready for review, landing or resolved", () => {
    for (const status of ["ready-for-review", "landing", "resolved"] as const) {
      expect(greetingOf("Marcelo", threadsIn("idle", status))).toBe("Welcome back, Marcelo.");
    }
  });

  test("says a plain welcome back when no name is set, or the name is only spaces", () => {
    expect(greetingOf("", [])).toBe("Welcome back.");
    expect(greetingOf("   ", threadsIn("resolved"))).toBe("Welcome back.");
  });

  test("ignores spaces around the name", () => {
    expect(greetingOf("  Ada   Lovelace ", [])).toBe("Welcome, Ada.");
  });
});
