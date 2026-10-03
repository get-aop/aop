import { describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

// The field renderers load Radix, which decides once, at import, whether a document exists:
// importing them without one would leave every later test file in the process without layout effects.
setupDashboardDom();

const { resolveSettingOptions, SETTINGS_GROUPS } = await import("./settings-fields.tsx");

describe("settings fields", () => {
  test("does not expose Quick-fix or control runtime settings", () => {
    const keys = SETTINGS_GROUPS.flatMap((group) => group.keys);
    expect(keys.some((key) => key.startsWith("quick_fix_"))).toBe(false);
    expect(keys.some((key) => key.startsWith("control_"))).toBe(false);
    expect(SETTINGS_GROUPS.some((group) => group.label === "Computer and Browser Control")).toBe(
      false,
    );
  });

  test("does not expose legacy docs/tasks discovery in Settings UI", () => {
    const keys = SETTINGS_GROUPS.flatMap((group) => group.keys);
    expect(keys).not.toContain("discover_legacy_repo_tasks");
    expect(SETTINGS_GROUPS.some((group) => group.label === "Task discovery")).toBe(false);
  });

  test("does not expose legacy tasks/workers settings in Settings UI", () => {
    const keys = SETTINGS_GROUPS.flatMap((group) => group.keys);
    expect(keys).not.toContain("max_concurrent_tasks");
    expect(keys).not.toContain("agent_timeout_secs");
    expect(keys).not.toContain("watcher_poll_interval_secs");
    expect(keys).not.toContain("queue_poll_interval_secs");
    expect(SETTINGS_GROUPS.some((group) => group.label === "Agent configuration")).toBe(false);
    expect(SETTINGS_GROUPS.some((group) => group.label === "Polling")).toBe(false);
  });

  test("leaves the update settings to AOP settings › Updates", () => {
    const keys = SETTINGS_GROUPS.flatMap((group) => group.keys);
    for (const key of [
      "update_check",
      "update_install",
      "agent_cli_auto_update",
      "host_management",
    ]) {
      expect(keys).not.toContain(key);
    }
  });

  test("keeps remaining settings visible", () => {
    expect(resolveSettingOptions("chat_global_instructions", {}, [])).toBeUndefined();
  });

  test("exposes global chat instructions without a mid-run mode selector", () => {
    const chat = SETTINGS_GROUPS.find((group) => group.label === "Chat");
    expect(chat?.keys).toContain("chat_global_instructions");
    expect(chat?.keys).not.toContain("chat_mid_run_mode");
  });
});
