import { describe, expect, test } from "bun:test";
import {
  clearPiFastModeCommand,
  consumePiFastModePromptPrefix,
  queuePiFastModeCommand,
  resetPiFastModeCommands,
} from "./pi-fast-mode.ts";

describe("pi-fast-mode", () => {
  test("queues a one-shot /fast prefix when PI fast mode toggles", () => {
    resetPiFastModeCommands();
    queuePiFastModeCommand("sess_1", "pi", false, true);
    expect(consumePiFastModePromptPrefix("sess_1", "pi")).toBe("/fast");
    expect(consumePiFastModePromptPrefix("sess_1", "pi")).toBeNull();
  });

  test("ignores non-PI runtimes and no-op toggles", () => {
    resetPiFastModeCommands();
    queuePiFastModeCommand("sess_1", "codex-cli", false, true);
    queuePiFastModeCommand("sess_2", "pi", true, true);
    expect(consumePiFastModePromptPrefix("sess_1", "codex-cli")).toBeNull();
    expect(consumePiFastModePromptPrefix("sess_2", "pi")).toBeNull();
  });

  test("clear drops a pending command", () => {
    resetPiFastModeCommands();
    queuePiFastModeCommand("sess_1", "pi", true, false);
    clearPiFastModeCommand("sess_1");
    expect(consumePiFastModePromptPrefix("sess_1", "pi")).toBeNull();
  });
});
