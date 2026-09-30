import { describe, expect, test } from "bun:test";
import {
  CreateProjectInputSchema,
  NotificationLevelSchema,
  PROJECT_GOAL_MAX_LENGTH,
  PROJECT_INSTRUCTIONS_MAX_LENGTH,
  ProjectPatchSchema,
  ProjectSchema,
  ProjectSettingsSchema,
  ThreadAccessSchema,
} from "./project.ts";
import { makeProject, rejectedPaths } from "./test-utils.ts";

describe("ProjectSchema", () => {
  test("accepts a project, keeping null model and effort as use-default", () => {
    const useDefaults = { provider: "claude-code" as const, model: null, effort: null };
    const project = ProjectSchema.parse(makeProject({ coordinator: useDefaults }));
    expect(project.coordinator).toEqual(useDefaults);
    expect(project.thread.model).toBe("claude-opus-5");
  });

  test("keeps the limits in one place", () => {
    expect(PROJECT_GOAL_MAX_LENGTH).toBe(8000);
    expect(PROJECT_INSTRUCTIONS_MAX_LENGTH).toBe(16000);
  });

  test("accepts a goal of exactly 8000 characters and rejects 8001", () => {
    expect(ProjectSchema.safeParse(makeProject({ goal: "g".repeat(8000) })).success).toBe(true);
    expect(rejectedPaths(ProjectSchema, makeProject({ goal: "g".repeat(8001) }))).toEqual(["goal"]);
  });

  test("accepts instructions of exactly 16000 characters and rejects 16001", () => {
    const at = makeProject({ instructions: "i".repeat(16000) });
    const over = makeProject({ instructions: "i".repeat(16001) });
    expect(ProjectSchema.safeParse(at).success).toBe(true);
    expect(rejectedPaths(ProjectSchema, over)).toEqual(["instructions"]);
  });

  test("allows an empty goal and empty instructions", () => {
    expect(ProjectSchema.safeParse(makeProject({ goal: "", instructions: "" })).success).toBe(true);
  });

  test("keeps instruction whitespace as the person typed it", () => {
    const instructions = "## Invariants\n\n    indented code\n";
    expect(ProjectSchema.parse(makeProject({ instructions })).instructions).toBe(instructions);
  });

  test("trims the name and rejects a blank or over-long one", () => {
    expect(ProjectSchema.parse(makeProject({ name: "  checkout  " })).name).toBe("checkout");
    expect(rejectedPaths(ProjectSchema, makeProject({ name: "   " }))).toEqual(["name"]);
    expect(rejectedPaths(ProjectSchema, makeProject({ name: "n".repeat(101) }))).toEqual(["name"]);
  });

  test.each(["active", "paused", "archived"])("accepts status %s", (status) => {
    expect(ProjectSchema.parse(makeProject({ status })).status).toBe(status);
  });

  test("rejects a status outside active, paused, and archived", () => {
    expect(rejectedPaths(ProjectSchema, makeProject({ status: "deleted" }))).toEqual(["status"]);
  });

  test("rejects a coordinator or thread runtime on a provider AOP does not drive", () => {
    for (const provider of ["codex-cli", "pi", "grok-build", "opencode"]) {
      const coordinator = { provider, model: null, effort: null };
      expect(rejectedPaths(ProjectSchema, makeProject({ coordinator }))).toEqual([
        "coordinator.provider",
      ]);
    }
    const thread = { provider: "claude-code", model: null, effort: "turbo" };
    expect(rejectedPaths(ProjectSchema, makeProject({ thread }))).toEqual(["thread.effort"]);
  });

  test("rejects attaching the same repo twice", () => {
    expect(rejectedPaths(ProjectSchema, makeProject({ repoIds: ["repo_1", "repo_1"] }))).toEqual([
      "repoIds",
    ]);
  });

  test("a project needs its server-assigned fields", () => {
    const { id: _id, createdAt: _createdAt, ...missing } = makeProject();
    expect(rejectedPaths(ProjectSchema, missing).sort()).toEqual(["createdAt", "id"]);
  });
});

describe("NotificationLevelSchema", () => {
  test.each(["coordinator", "every-turn", "off"])("accepts %s", (level) => {
    expect(NotificationLevelSchema.parse(level)).toBe(level);
  });

  test("rejects an unknown level", () => {
    expect(NotificationLevelSchema.safeParse("loud").success).toBe(false);
  });
});

describe("ProjectSettingsSchema", () => {
  test("is what creating a project takes: no id, status, or timestamps", () => {
    const { id: _id, status: _status, createdAt: _c, updatedAt: _u, ...settings } = makeProject();
    expect(ProjectSettingsSchema.safeParse(settings).success).toBe(true);
  });
});

describe("CreateProjectInputSchema", () => {
  test("takes just a name and fills in Claude Projects' defaults", () => {
    expect(CreateProjectInputSchema.parse({ name: "  checkout  " })).toEqual({
      name: "checkout",
      goal: "",
      instructions: "",
      coordinator: { provider: "claude-code", model: null, effort: "low" },
      thread: { provider: "claude-code", model: null, effort: "high" },
      notificationLevel: "coordinator",
      threadAccess: "auto-accept-edits",
      repoIds: [],
    });
  });

  test("keeps what the client sent over the defaults", () => {
    const input = { name: "checkout", goal: "Ship", threadAccess: "full-access", repoIds: ["r1"] };
    expect(CreateProjectInputSchema.parse(input)).toMatchObject(input);
  });

  test("still needs a name and applies the settings limits", () => {
    expect(rejectedPaths(CreateProjectInputSchema, {})).toEqual(["name"]);
    expect(rejectedPaths(CreateProjectInputSchema, { name: "x", goal: "g".repeat(8001) })).toEqual([
      "goal",
    ]);
  });
});

describe("ThreadAccessSchema", () => {
  test.each(["auto-accept-edits", "full-access"])("accepts %s", (access) => {
    expect(ThreadAccessSchema.parse(access)).toBe(access);
  });

  test("rejects a mode that would prompt or bypass differently", () => {
    for (const access of ["auto", "approval-required", "root"]) {
      expect(ThreadAccessSchema.safeParse(access).success).toBe(false);
    }
  });

  test("a project without threadAccess is not a project", () => {
    const { threadAccess: _threadAccess, ...missing } = makeProject();
    expect(rejectedPaths(ProjectSchema, missing)).toEqual(["threadAccess"]);
  });
});

describe("ProjectPatchSchema", () => {
  test("accepts a single field", () => {
    expect(ProjectPatchSchema.parse({ goal: "Ship 2.0" })).toEqual({ goal: "Ship 2.0" });
  });

  test("rejects an empty patch", () => {
    expect(ProjectPatchSchema.safeParse({}).success).toBe(false);
  });

  test("applies the same limits as a full project", () => {
    expect(rejectedPaths(ProjectPatchSchema, { goal: "g".repeat(8001) })).toEqual(["goal"]);
    expect(rejectedPaths(ProjectPatchSchema, { instructions: "i".repeat(16001) })).toEqual([
      "instructions",
    ]);
  });

  test("drops status, which only pause and archive change", () => {
    expect(ProjectPatchSchema.parse({ goal: "Ship 2.0", status: "archived" })).toEqual({
      goal: "Ship 2.0",
    });
    expect(ProjectPatchSchema.safeParse({ status: "archived" }).success).toBe(false);
  });
});
