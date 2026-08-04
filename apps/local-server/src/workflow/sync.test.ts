import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import type { WorkflowDefinition } from "../workflow-engine/types.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./repository.ts";
import { syncWorkflows } from "./sync.ts";

const createWorkflowDefinition = (name: string): WorkflowDefinition => ({
  version: 1,
  name,
  initialStep: "implement",
  steps: {
    implement: {
      id: "implement",
      type: "implement",
      promptTemplate: "implement.md.hbs",
      maxAttempts: 1,
      transitions: [
        { condition: "success", target: "__done__" },
        { condition: "failure", target: "__blocked__" },
      ],
    },
  },
  terminalStates: ["__done__", "__blocked__"],
});

describe("syncWorkflows", () => {
  let db: Kysely<Database>;
  let repository: WorkflowRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createWorkflowRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("inserts new workflows", async () => {
    const workflows = [createWorkflowDefinition("simple"), createWorkflowDefinition("advanced")];

    const result = await syncWorkflows(repository, workflows);

    expect(result).toEqual({ inserted: 2, updated: 0, deactivated: 0 });
    expect(await repository.listNames()).toEqual(["advanced", "simple"]);
  });

  test("updates existing built-in workflows", async () => {
    await repository.create({
      id: "existing-id",
      name: "simple",
      definition: JSON.stringify({ version: 1, name: "simple", steps: {} }),
      source: "builtin",
    });

    const result = await syncWorkflows(repository, [createWorkflowDefinition("simple")]);
    const simple = await repository.findByName("simple");

    expect(result).toEqual({ inserted: 0, updated: 1, deactivated: 0 });
    expect(simple?.id).toBe("existing-id");
    expect(simple?.version).toBe(2);
  });

  test("does not overwrite user workflow overrides that share a built-in name", async () => {
    const userOverride = createWorkflowDefinition("simple");
    const implementStep = userOverride.steps.implement;
    if (!implementStep) {
      throw new Error("test workflow should include implement step");
    }
    implementStep.maxAttempts = 4;
    await repository.create({
      id: "user-override-id",
      name: "simple",
      definition: JSON.stringify(userOverride),
      source: "user",
    });

    const result = await syncWorkflows(repository, [createWorkflowDefinition("simple")]);
    const simple = await repository.findByName("simple");
    const definition = simple ? JSON.parse(simple.definition) : null;

    expect(result).toEqual({ inserted: 0, updated: 0, deactivated: 0 });
    expect(simple?.id).toBe("user-override-id");
    expect(simple?.source).toBe("user");
    expect(simple?.version).toBe(1);
    expect(definition.steps.implement.maxAttempts).toBe(4);
  });

  test("deactivates stale built-in workflows not present in the catalog", async () => {
    await repository.create({
      id: "stale-id",
      name: "stale-workflow",
      definition: JSON.stringify({ version: 1, name: "stale-workflow", steps: {} }),
      source: "builtin",
    });

    const result = await syncWorkflows(repository, [createWorkflowDefinition("simple")]);
    const stale = await repository.findByName("stale-workflow");

    expect(result).toEqual({ inserted: 1, updated: 0, deactivated: 1 });
    expect(stale?.active).toBe(false);
    expect(await repository.listNames()).toEqual(["simple"]);
  });

  test("keeps user-created workflows active when syncing built-ins", async () => {
    await repository.create({
      id: "user-id",
      name: "my-custom-workflow",
      definition: JSON.stringify(createWorkflowDefinition("my-custom-workflow")),
      source: "user",
    });

    const result = await syncWorkflows(repository, [createWorkflowDefinition("simple")]);
    const userWorkflow = await repository.findByName("my-custom-workflow");

    expect(result).toEqual({ inserted: 1, updated: 0, deactivated: 0 });
    expect(userWorkflow?.active).toBe(true);
    expect(await repository.listNames()).toEqual(["my-custom-workflow", "simple"]);
  });
});
