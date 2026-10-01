import { describe, expect, test } from "bun:test";
import { closeSpawnGate, isSpawnGateClosed, waitForSpawnGate } from "./spawn-gate.ts";

describe("spawn gate", () => {
  test("an open gate lets a launch through at once", async () => {
    expect(isSpawnGateClosed("gate-open")).toBe(false);
    await waitForSpawnGate("gate-open");
  });

  test("a closed gate holds launches of that CLI until it opens, and no other CLI's", async () => {
    const open = closeSpawnGate("gate-held");
    let through = false;
    const waiting = waitForSpawnGate("gate-held").then(() => {
      through = true;
    });
    await waitForSpawnGate("gate-other");
    await Bun.sleep(5);
    expect(through).toBe(false);

    open();
    await waiting;
    expect(through).toBe(true);
    expect(isSpawnGateClosed("gate-held")).toBe(false);
  });

  test("a launch stops waiting after the longest an update may take", async () => {
    const open = closeSpawnGate("gate-slow");
    const started = Date.now();
    await waitForSpawnGate("gate-slow", 20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    open();
  });

  test("opening twice is harmless", async () => {
    const open = closeSpawnGate("gate-twice");
    open();
    open();
    await waitForSpawnGate("gate-twice");
    expect(isSpawnGateClosed("gate-twice")).toBe(false);
  });
});
