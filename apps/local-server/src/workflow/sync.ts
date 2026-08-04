import { randomUUID } from "node:crypto";
import { getLogger } from "@aop/infra";
import type { WorkflowDefinition } from "../workflow-engine/types.ts";
import { parseWorkflow } from "../workflow-engine/workflow-parser.ts";
import type { WorkflowRepository } from "./repository.ts";

const logger = getLogger("local-workflow-sync");

export const syncWorkflows = async (
  repository: WorkflowRepository,
  workflows: WorkflowDefinition[],
): Promise<{ inserted: number; updated: number; deactivated: number }> => {
  const log = logger.with({ count: workflows.length });
  log.info("Starting workflow sync with {count} workflows");

  let inserted = 0;
  let updated = 0;
  const fileNames = new Set(workflows.map((workflow) => workflow.name));

  for (const workflow of workflows) {
    const existing = await repository.findByName(workflow.name);
    if (existing?.source === "user" && isValidWorkflowDefinition(existing.definition)) {
      log.info("Keeping user override for workflow {name}", { name: workflow.name });
      continue;
    }

    await repository.upsert({
      id: existing?.id ?? randomUUID(),
      name: workflow.name,
      definition: JSON.stringify(workflow),
      source: "builtin",
    });

    if (existing) {
      updated++;
      log.info("Updated workflow {name}", { name: workflow.name });
      continue;
    }

    inserted++;
    log.info("Inserted workflow {name}", { name: workflow.name });
  }

  const dbNames = await repository.listActiveBuiltinNames();
  const staleNames = dbNames.filter((name) => !fileNames.has(name));
  let deactivated = 0;

  for (const name of staleNames) {
    const wasDeactivated = await repository.deactivateByName(name);
    if (!wasDeactivated) {
      continue;
    }

    deactivated++;
    log.info("Deactivated stale workflow {name}", { name });
  }

  log.info(
    "Workflow sync complete: {inserted} inserted, {updated} updated, {deactivated} deactivated",
    { inserted, updated, deactivated },
  );

  return { inserted, updated, deactivated };
};

const isValidWorkflowDefinition = (definition: string): boolean => {
  try {
    parseWorkflow(definition);
    return true;
  } catch {
    return false;
  }
};
