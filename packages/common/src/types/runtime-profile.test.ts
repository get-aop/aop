import { describe, expect, test } from "bun:test";
import {
  applyRuntimeProfile,
  RuntimeProfileInputSchema,
  RuntimeProfilePatchSchema,
} from "./runtime-profile.ts";

describe("runtime profiles", () => {
  test("normalizes a valid Codex profile", () => {
    expect(
      RuntimeProfileInputSchema.parse({
        name: "  Work Codex  ",
        baseProvider: "codex-cli",
        command: "cdx",
        model: "vendor/custom-model:v2",
        reasoning: "extra-high",
        fastMode: true,
      }),
    ).toEqual({
      name: "Work Codex",
      baseProvider: "codex-cli",
      command: "cdx",
      model: "vendor/custom-model:v2",
      reasoning: "extra-high",
      fastMode: true,
    });
  });

  test("rejects shell commands and fast mode outside Codex", () => {
    expect(
      RuntimeProfileInputSchema.safeParse({
        name: "Unsafe",
        baseProvider: "claude-code",
        command: "claude --dangerously-skip-permissions",
        model: "claude-opus-4-8",
        reasoning: "high",
        fastMode: true,
      }).success,
    ).toBe(false);
  });

  test("accepts partial profile patches", () => {
    expect(RuntimeProfilePatchSchema.parse({ model: "gpt-5.5" })).toEqual({
      model: "gpt-5.5",
    });
    expect(RuntimeProfilePatchSchema.safeParse({}).success).toBe(false);
  });

  test("applies a profile as a full agent preset", () => {
    expect(
      applyRuntimeProfile({
        id: "rprof_test",
        name: "Work Codex",
        baseProvider: "codex-cli",
        command: "cdx",
        model: "vendor/custom-model:v2",
        reasoning: "high",
        fastMode: true,
        createdAt: "now",
        updatedAt: "now",
      }),
    ).toEqual({
      provider: "codex-cli",
      model: "vendor/custom-model:v2",
      reasoning: "high",
      fastMode: true,
      ultracode: false,
      runtimeAlias: "cdx",
    });
  });

  test("accepts optional execHostId and threads it through applyRuntimeProfile", () => {
    expect(
      RuntimeProfileInputSchema.parse({
        name: "Remote Codex",
        baseProvider: "codex-cli",
        command: "codex",
        model: "gpt-5.5",
        reasoning: "high",
        fastMode: false,
        execHostId: "ehost_desktop",
      }),
    ).toMatchObject({ execHostId: "ehost_desktop" });

    expect(
      applyRuntimeProfile({
        id: "rprof_remote",
        name: "Remote Codex",
        baseProvider: "codex-cli",
        command: "codex",
        model: "gpt-5.5",
        reasoning: "high",
        fastMode: false,
        execHostId: "ehost_desktop",
        createdAt: "now",
        updatedAt: "now",
      }),
    ).toMatchObject({
      provider: "codex-cli",
      execHostId: "ehost_desktop",
    });
  });

  test("allows empty execHostId for clearing a host binding", () => {
    expect(
      RuntimeProfilePatchSchema.parse({
        execHostId: "",
      }),
    ).toEqual({ execHostId: "" });
  });
});
