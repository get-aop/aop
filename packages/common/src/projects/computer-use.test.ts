import { describe, expect, test } from "bun:test";
import { ComputerUseInputSchema, ComputerUseSchema } from "./computer-use.ts";
import { ProjectSchema } from "./project.ts";
import { buildProject } from "./test-utils.ts";

describe("computer use", () => {
  test("a project holds the model's default or CUA, and nothing that is not available yet", () => {
    expect(ComputerUseSchema.options).toEqual(["model-default", "cua"]);
    expect(ComputerUseSchema.safeParse("codex").success).toBe(false);
    expect(ComputerUseSchema.safeParse("claude").success).toBe(false);
  });

  test("the input names every option, so the host can say why it refuses one", () => {
    expect(ComputerUseInputSchema.parse({ computerUse: "codex" })).toEqual({
      computerUse: "codex",
    });
    expect(ComputerUseInputSchema.safeParse({ computerUse: "selenium" }).success).toBe(false);
  });

  test("a project stored before the setting existed reads as the model's default", () => {
    const { computerUse: _, ...older } = buildProject();
    expect(ProjectSchema.parse(older).computerUse).toBe("model-default");
  });
});
