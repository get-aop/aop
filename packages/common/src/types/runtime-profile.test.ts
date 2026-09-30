import { describe, expect, test } from "bun:test";
import { RuntimeProfileInputSchema, RuntimeProfilePatchSchema } from "./runtime-profile.ts";

const claudeProfile = {
  name: "Work Claude",
  baseProvider: "claude-code",
  command: "cpe",
  model: "claude-opus-5",
  reasoning: "extra-high",
  fastMode: true,
} as const;

describe("runtime profiles", () => {
  test("normalizes a valid Claude profile", () => {
    expect(RuntimeProfileInputSchema.parse({ ...claudeProfile, name: "  Work Claude  " })).toEqual(
      claudeProfile,
    );
  });

  test("rejects shell commands", () => {
    expect(
      RuntimeProfileInputSchema.safeParse({
        ...claudeProfile,
        command: "claude --dangerously-skip-permissions",
      }).success,
    ).toBe(false);
  });

  test("rejects fast mode on a model without it", () => {
    expect(
      RuntimeProfileInputSchema.safeParse({ ...claudeProfile, model: "claude-opus-4-8" }).success,
    ).toBe(false);
    expect(
      RuntimeProfileInputSchema.safeParse({
        ...claudeProfile,
        model: "claude-opus-4-8",
        fastMode: false,
      }).success,
    ).toBe(true);
  });

  test("rejects a provider outside the catalog", () => {
    for (const baseProvider of ["codex-cli", "pi", "grok-build", "opencode"]) {
      expect(
        RuntimeProfileInputSchema.safeParse({ ...claudeProfile, baseProvider, fastMode: false })
          .success,
      ).toBe(false);
    }
  });

  test("accepts partial profile patches", () => {
    expect(RuntimeProfilePatchSchema.parse({ model: "claude-opus-5" })).toEqual({
      model: "claude-opus-5",
    });
    expect(RuntimeProfilePatchSchema.safeParse({}).success).toBe(false);
  });
});
