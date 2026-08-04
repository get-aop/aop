const E2E_WORKFLOW_NAME = "aop-default-gpt";
const E2E_WORKFLOW_STEP_IDS = ["implement", "run-tests", "code_review"];

/** The retired built-in catalog no longer ships workflows; seed one for the worker. */
export const seedE2EWorkflow = async (localServerUrl: string): Promise<void> => {
  const createResponse = await fetch(`${localServerUrl}/api/workflows`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: E2E_WORKFLOW_NAME, stepIds: E2E_WORKFLOW_STEP_IDS }),
  });
  if (!createResponse.ok) {
    throw new Error(
      `Failed to seed E2E workflow: ${createResponse.status} ${await createResponse.text()}`,
    );
  }
};

export const createAndAssignE2EWorker = async (
  localServerUrl: string,
  repoId: string,
  taskId: string,
): Promise<string> => {
  const workflowsResponse = await fetch(`${localServerUrl}/api/workflows`);
  if (!workflowsResponse.ok) {
    throw new Error(`Failed to synchronize E2E workflows (${workflowsResponse.status})`);
  }
  const workflowsBody = (await workflowsResponse.json()) as { workflows?: string[] };
  if (!workflowsBody.workflows?.includes(E2E_WORKFLOW_NAME)) {
    await seedE2EWorkflow(localServerUrl);
  }

  const createResponse = await fetch(`${localServerUrl}/api/agents/workers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `E2E Worker ${taskId}`,
      role: "developer",
      workflowId: "aop-default-gpt",
      repoIds: [repoId],
      planningDisabled: true,
    }),
  });
  const createBody = (await createResponse.json()) as {
    agent?: { id: string };
    error?: string;
  };
  if (!createResponse.ok || !createBody.agent) {
    throw new Error(`Failed to create E2E worker: ${createBody.error ?? createResponse.status}`);
  }

  const assignResponse = await fetch(
    `${localServerUrl}/api/repos/${repoId}/tasks/${taskId}/assignment`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: createBody.agent.id }),
    },
  );
  if (!assignResponse.ok) {
    throw new Error(`Failed to assign E2E worker (${assignResponse.status})`);
  }

  return createBody.agent.id;
};
