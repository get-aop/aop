import { describe, expect, test } from "bun:test";
import type { ChatSession } from "../db/schema.ts";
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
  default_worker_id: null,
  default_workflow_id: null,
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: "now",
  updated_at: "now",
};

describe("buildUpdatePatch context chips", () => {
  test("persists default worker and workflow ids", () => {
    const result = buildUpdatePatch(base, {
      defaultWorkerId: "w1",
      defaultWorkflowId: "aop-default-gpt",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.patch.default_worker_id).toBe("w1");
    expect(result.patch.default_workflow_id).toBe("aop-default-gpt");
  });

  test("clears chips with null or empty string", () => {
    const result = buildUpdatePatch(
      { ...base, default_worker_id: "w1", default_workflow_id: "wf" },
      { defaultWorkerId: null, defaultWorkflowId: "  " },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.patch.default_worker_id).toBeNull();
    expect(result.patch.default_workflow_id).toBeNull();
  });

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
