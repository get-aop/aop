import { describe, expect, test } from "bun:test";
import type { ChatSession } from "../db/schema.ts";
import { NO_PROJECT_COLUMNS } from "./test-utils.ts";
import { buildUpdatePatch } from "./update-patch.ts";

const base: ChatSession = {
  id: "s1",
  repo_id: "r1",
  title: "t",
  named: false,
  runtime: "claude-code",
  runtime_configuration_id: null,
  model: "m",
  reasoning_effort: "medium",
  runtime_alias: null,
  runtime_session_id: null,
  workspace_path: null,
  fast_mode: false,
  runtime_access_mode: "full-access",
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: "now",
  updated_at: "now",
  ...NO_PROJECT_COLUMNS,
};

describe("buildUpdatePatch", () => {
  test("persists the runtime access mode", () => {
    const result = buildUpdatePatch(base, { runtimeAccessMode: "auto" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.patch.runtime_access_mode).toBe("auto");
  });

  test("ignores free-form runtimeAlias patches (executables come from Runtime configuration)", () => {
    const result = buildUpdatePatch(
      { ...base, runtime_configuration_id: "claude-code", runtime_alias: "claude" },
      { runtimeAlias: "cpe" },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.patch.runtime_alias).toBeUndefined();
    expect(result.patch.runtime_configuration_id).toBeUndefined();
  });
});
