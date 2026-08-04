import { describe, expect, test } from "bun:test";
import { createTerminalProgress, silentTerminalProgress } from "./terminal-progress";

describe("createTerminalProgress", () => {
  test("runs steps without output when disabled", async () => {
    const writes: string[] = [];
    const progress = createTerminalProgress({
      enabled: false,
      write: (chunk) => writes.push(chunk),
    });

    progress.banner("Installing AOP");
    const value = await progress.runStep("Installing dependencies", async () => 42);

    expect(value).toBe(42);
    expect(writes).toEqual([]);
  });

  test("renders a banner and quiet step completion", async () => {
    const writes: string[] = [];
    const progress = createTerminalProgress({
      enabled: true,
      minStepMs: 0,
      now: () => 2_000,
      write: (chunk) => writes.push(chunk),
    });

    progress.banner("Installing AOP from source…");
    await progress.runStep("Starting local server", async () => undefined);

    expect(writes.some((line) => line.includes("Installing AOP from source"))).toBe(true);
    expect(writes.some((line) => line.includes("✓ Starting local server"))).toBe(true);
  });

  test("renders verbose steps with begin and success markers", async () => {
    const writes: string[] = [];
    const progress = createTerminalProgress({
      enabled: true,
      minStepMs: 0,
      now: () => 5_000,
      write: (chunk) => writes.push(chunk),
    });

    await progress.runStep("Building AOP", async () => undefined, { verbose: true });

    expect(writes.some((line) => line.includes("▸ Building AOP"))).toBe(true);
    expect(writes.some((line) => line.includes("✓ Building AOP"))).toBe(true);
  });

  test("suppresses nested step output while an outer step is active", async () => {
    const writes: string[] = [];
    const progress = createTerminalProgress({
      enabled: true,
      minStepMs: 0,
      now: () => 1_000,
      write: (chunk) => writes.push(chunk),
    });

    await progress.runStep("Refreshing previous install", async () => {
      await progress.runStep("Stopping local server", async () => undefined);
      await progress.runStep("Removing logs", async () => undefined);
    });

    expect(writes.some((line) => line.includes("Stopping local server"))).toBe(false);
    expect(writes.some((line) => line.includes("Removing logs"))).toBe(false);
    expect(writes.some((line) => line.includes("Refreshing previous install"))).toBe(true);
  });

  test("keeps each step visible for at least minStepMs", async () => {
    const slept: number[] = [];
    const progress = createTerminalProgress({
      enabled: true,
      minStepMs: 120,
      now: () => 0,
      sleep: async (ms) => {
        slept.push(ms);
      },
      write: () => undefined,
    });

    await progress.runStep("Preparing log directory", async () => undefined);

    expect(slept).toEqual([120]);
  });

  test("does not render uninstall sub-steps when refresh uses silent progress", async () => {
    const writes: string[] = [];
    const progress = createTerminalProgress({
      enabled: true,
      minStepMs: 0,
      now: () => 1_000,
      write: (chunk) => writes.push(chunk),
    });

    await progress.runStep("Refreshing previous install", async () => {
      await silentTerminalProgress.runStep("Stopping local server", async () => undefined);
      await silentTerminalProgress.runStep("Removing logs", async () => undefined);
    });

    expect(writes.some((line) => line.includes("Stopping local server"))).toBe(false);
    expect(writes.some((line) => line.includes("Removing logs"))).toBe(false);
    expect(writes.some((line) => line.includes("Refreshing previous install"))).toBe(true);
  });
});
