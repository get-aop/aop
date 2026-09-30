import { describe, expect, test } from "bun:test";
import { CreateProjectInputSchema, ProjectSchema } from "./project.ts";
import { buildProject, buildProjectSettings } from "./test-utils.ts";

describe("buildProjectSettings", () => {
  test("starts every setting at the create-time default and keeps an override", () => {
    expect(buildProjectSettings()).toEqual(
      CreateProjectInputSchema.parse({ name: "checkout-service" }),
    );
    expect(buildProjectSettings({ threadAccess: "full-access" }).threadAccess).toBe("full-access");
  });
});

describe("buildProject", () => {
  test("is a complete project the schema accepts, with a stable identity", () => {
    const project = buildProject();

    expect(ProjectSchema.parse(project)).toEqual(project);
    expect(project).toMatchObject({ id: "prj_1", status: "active" });
  });

  test("carries every setting the schema defines, so none is left out of a fixture", () => {
    const settingKeys = Object.keys(CreateProjectInputSchema.shape).sort();

    expect(Object.keys(buildProject()).sort()).toEqual(
      [...settingKeys, "id", "status", "createdAt", "updatedAt"].sort(),
    );
  });

  test("applies overrides over the defaults", () => {
    const project = buildProject({ id: "prj_9", status: "paused", notificationLevel: "off" });

    expect(project).toMatchObject({ id: "prj_9", status: "paused", notificationLevel: "off" });
  });
});
