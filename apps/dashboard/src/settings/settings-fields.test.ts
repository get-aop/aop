import { describe, expect, test } from "bun:test";
import { isSettingVisible, resolveSettingOptions, SETTINGS_GROUPS } from "./settings-fields.tsx";

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

  test("keeps remaining settings visible", () => {
    expect(isSettingVisible("max_concurrent_tasks", {}, [])).toBe(true);
    expect(resolveSettingOptions("max_concurrent_tasks", {}, [])).toBeUndefined();
  });

  test("exposes global chat instructions without a mid-run mode selector", () => {
    const chat = SETTINGS_GROUPS.find((group) => group.label === "Chat");
    expect(chat?.keys).toContain("chat_global_instructions");
    expect(chat?.keys).not.toContain("chat_mid_run_mode");
  });
});
