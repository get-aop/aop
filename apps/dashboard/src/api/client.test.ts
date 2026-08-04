import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type * as SessionsApi from "./sessions";
import type * as SettingsApi from "./settings";
import type * as TasksApi from "./tasks";
import type * as WorkflowsApi from "./workflows";

// Import from the domain modules directly (query-string instances) so
// mock.module registrations for the hub in other test files can never leak
// into these unit tests (bun's mock.module is process-wide).
// No query instance for request: ApiError identity must match the module the
// domain functions throw (request.ts is never mock.module'd by other files).
const { ApiError } = await import("./request");
const { abortChatSession, resetChatSessionRuntime } = (await import(
  "./sessions" + "?dashboard-client-test"
)) as typeof SessionsApi;
const {
  assignTaskAgent,
  archiveWorkerAgent,
  blockTask,
  createAgent,
  duplicateAgent,
  fetchExecutions,
  fetchRuntimeEvents,
  getAgents,
  getChannelMessages,
  getFactoryChannel,
  getMetrics,
  markReady,
  moveTaskToBoardColumn,
  removeTask,
  runRepoBulkAction,
  searchAgentMemory,
  sendChannelMessage,
  updateWorkerAgent,
} = (await import("./tasks" + "?dashboard-client-test")) as typeof TasksApi;
const {
  getFactoryHealth,
  getPauseContext,
  getSettings,
  getStatus,
  listDirectories,
  registerRepo,
  resumeTask,
  updateSettings,
} = (await import("./settings" + "?dashboard-client-test")) as typeof SettingsApi;
const {
  deleteWorkflow,
  getStepLibrary,
  getWorkflowDetails,
  getWorkflows,
  saveSkillBlock,
  saveWorkflow,
} = (await import("./workflows" + "?dashboard-client-test")) as typeof WorkflowsApi;

const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response()));

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
});

afterEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = originalFetch;
});

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("ApiError", () => {
  test("creates error with status, code, and message", () => {
    const error = new ApiError(404, "NOT_FOUND", "Resource not found");
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource not found");
    expect(error.name).toBe("ApiError");
  });
});

describe("abortChatSession", () => {
  test("posts to the active session abort endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ aborted: true }));

    await expect(abortChatSession("session-1")).resolves.toEqual({ aborted: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chat-sessions/session-1/abort",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("resetChatSessionRuntime", () => {
  test("posts to the reset-runtime endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ reset: true, clearedBinding: true, cancelledRun: false }),
    );

    await expect(resetChatSessionRuntime("session-1")).resolves.toEqual({
      reset: true,
      clearedBinding: true,
      cancelledRun: false,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chat-sessions/session-1/reset-runtime",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("runRepoBulkAction", () => {
  test("posts to the repo bulk action endpoint and returns the result", async () => {
    const result = {
      action: "git-pull" as const,
      total: 1,
      started: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(result));

    await expect(runRepoBulkAction("repo-1", "git-pull")).resolves.toEqual(result);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/bulk/git-pull",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("getStatus", () => {
  test("fetches and transforms status data", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ready: true,
        globalCapacity: { working: 1, max: 3 },
        swimlanes: [
          {
            id: "architect-control",
            title: "Architect Control",
            description: "Plan slices, assign developers, and accept handoffs.",
            ownerRole: "architect",
            order: 0,
          },
          {
            id: "developer-execution",
            title: "Developer Execution",
            description: "Implement, verify, and hand off active developer slices.",
            ownerRole: "developer",
            order: 1,
          },
        ],
        repos: [
          {
            id: "repo-1",
            name: "my-repo",
            path: "/path/to/repo",
            tasks: [
              {
                id: "task-1",
                repoId: "repo-1",
                status: "DRAFT",
                changePath: "changes/feat-1",
                baseBranch: null,
                preferredProvider: null,
                preferredWorkflow: null,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
                dependencyState: "waiting",
                blockedByTaskIds: ["task-0"],
                blockedByRefs: ["ABC-120"],
                swimlane: {
                  laneId: "architect-control",
                  phaseLabel: "Planning",
                  ownerLabel: "Architect",
                  ownerRole: "architect",
                },
              },
              {
                id: "task-2",
                repoId: "repo-1",
                status: "WORKING",
                changePath: "changes/feat-2",
                baseBranch: null,
                preferredProvider: null,
                preferredWorkflow: null,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
                swimlane: {
                  laneId: "developer-execution",
                  phaseLabel: "Implementing",
                  ownerLabel: "developer-1",
                  ownerRole: "developer",
                },
              },
            ],
          },
        ],
      }),
    );

    const result = await getStatus();

    expect(result.ready).toBe(true);
    expect(result.repos).toEqual([{ id: "repo-1", name: "my-repo", path: "/path/to/repo" }]);
    expect(result.swimlanes).toEqual([
      {
        id: "architect-control",
        title: "Architect Control",
        description: "Plan slices, assign developers, and accept handoffs.",
        ownerRole: "architect",
        order: 0,
      },
      {
        id: "developer-execution",
        title: "Developer Execution",
        description: "Implement, verify, and hand off active developer slices.",
        ownerRole: "developer",
        order: 1,
      },
    ]);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]).toEqual({
      id: "task-1",
      repoId: "repo-1",
      status: "DRAFT",
      changePath: "changes/feat-1",
      baseBranch: null,
      preferredProvider: null,
      preferredWorkflow: null,
      repoPath: "/path/to/repo",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      dependencyState: "waiting",
      blockedByTaskIds: ["task-0"],
      blockedByRefs: ["ABC-120"],
      swimlane: {
        laneId: "architect-control",
        phaseLabel: "Planning",
        ownerLabel: "Architect",
        ownerRole: "architect",
      },
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/status", expect.any(Object));
  });

  test("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));

    await expect(getStatus()).rejects.toThrow(ApiError);
    await expect(
      getStatus().catch((e) => {
        expect(e.status).toBe(500);
        expect(e.code).toBe("Server error");
        throw e;
      }),
    ).rejects.toThrow();
  });

  test("handles unknown error code", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      getStatus().catch((e) => {
        expect(e.code).toBe("UNKNOWN");
        throw e;
      }),
    ).rejects.toThrow();
  });
});

describe("agent and chat helpers", () => {
  test("fetches agents", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        agents: [
          {
            id: "agent-1",
            name: "Atlas",
            role: "architect",
            runtimeProvider: "hermes",
            model: "gpt-5.4",
            workflowId: "aop-plan",
            repoIds: ["repo-1"],
            status: "active",
            privateChannelId: "channel-1",
          },
        ],
      }),
    );

    const result = await getAgents();

    expect(result).toEqual([
      {
        id: "agent-1",
        name: "Atlas",
        role: "architect",
        runtimeProvider: "hermes",
        model: "gpt-5.4",
        workflowId: "aop-plan",
        repoIds: ["repo-1"],
        status: "active",
        privateChannelId: "channel-1",
      },
    ]);
    expect(mockFetch).toHaveBeenCalledWith("/api/agents", expect.any(Object));
  });

  test("registers a worker profile through the worker endpoint without runtime options", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        agent: {
          id: "agent-1",
          name: "K1",
          role: "developer",
          runtimeProvider: "codex-cli",
          provider: "codex-cli",
          model: "workflow-defined",
          workflowId: "workflow-db-2",
          repoIds: ["repo-1"],
          status: "active",
          privateChannelId: "channel-1",
          sourceKind: "codex-cli-worker-profile",
          sourceRef: null,
        },
      }),
    );

    const result = await createAgent({
      integrationMode: "worker",
      name: "K1",
      role: "developer",
      workflowId: "aop-implement",
      repoIds: ["repo-1"],
    });

    expect(result).toEqual({
      id: "agent-1",
      name: "K1",
      role: "developer",
      runtimeProvider: "codex-cli",
      provider: "codex-cli",
      model: "workflow-defined",
      workflowId: "workflow-db-2",
      repoIds: ["repo-1"],
      status: "active",
      privateChannelId: "channel-1",
      sourceKind: "codex-cli-worker-profile",
      sourceRef: null,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents/workers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "K1",
          role: "developer",
          workflowId: "aop-implement",
          repoIds: ["repo-1"],
        }),
      }),
    );
  });

  test("updates a worker profile and syncs repo memberships", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          agent: {
            id: "agent-1",
            name: "K1",
            role: "architect",
            runtimeProvider: "codex-cli",
            model: "workflow-defined",
            workflowId: "frontend-polish",
            repoIds: [],
            status: "active",
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ repoIds: ["repo-1", "repo-2"] }));

    const result = await updateWorkerAgent("agent-1", {
      role: "architect",
      workflowId: "frontend-polish",
      repoIds: ["repo-1", "repo-2"],
    });

    expect(result.repoIds).toEqual(["repo-1", "repo-2"]);
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      "/api/agents/agent-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          role: "architect",
          workflowId: "frontend-polish",
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/agents/agent-1/repos",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ repoIds: ["repo-1", "repo-2"] }),
      }),
    );
  });

  test("duplicates a worker profile through the worker create endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        agent: {
          id: "agent-copy",
          name: "K1 copy",
          role: "developer",
          runtimeProvider: "codex-cli",
          model: "workflow-defined",
          workflowId: "aop-implement",
          repoIds: ["repo-1", "repo-2"],
          status: "active",
        },
      }),
    );

    await duplicateAgent(
      {
        id: "agent-1",
        name: "K1",
        role: "developer",
        runtimeProvider: "codex-cli",
        model: "workflow-defined",
        workflowId: "aop-implement",
        repoIds: ["repo-1", "repo-2"],
        status: "active",
        autoDistributeDisabled: true,
      },
      "K1 copy",
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents/workers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "K1 copy",
          role: "developer",
          workflowId: "aop-implement",
          repoIds: ["repo-1", "repo-2"],
          autoDistributeDisabled: true,
        }),
      }),
    );
  });

  test("archives a worker profile", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        agent: {
          id: "agent-1",
          name: "K1",
          role: "developer",
          runtimeProvider: "codex-cli",
          model: "workflow-defined",
          workflowId: "aop-default-gpt",
          repoIds: ["repo-1"],
          status: "archived",
        },
      }),
    );

    const result = await archiveWorkerAgent("agent-1");

    expect(result.status).toBe("archived");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agents/agent-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "archived" }),
      }),
    );
  });

  test("fetches the factory group channel", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        channel: {
          id: "channel-factory",
          name: "Factory floor",
          kind: "group",
          repoId: null,
        },
      }),
    );

    const result = await getFactoryChannel();

    expect(result).toEqual({
      id: "channel-factory",
      name: "Factory floor",
      kind: "group",
      repoId: null,
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/channels/factory", expect.any(Object));
  });

  test("fetches channel messages", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        messages: [
          {
            id: "message-1",
            channelId: "channel-1",
            authorType: "agent",
            authorAgentId: "agent-1",
            content: "Ready to work.",
            createdAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      }),
    );

    const result = await getChannelMessages("channel-1");

    expect(result[0]?.content).toBe("Ready to work.");
    expect(mockFetch).toHaveBeenCalledWith("/api/channels/channel-1/messages", expect.any(Object));
  });

  test("sends a channel message", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        message: {
          id: "message-2",
          channelId: "channel-1",
          authorType: "user",
          authorAgentId: null,
          content: "Please handle the READY cards.",
          createdAt: "2026-04-01T00:01:00.000Z",
        },
      }),
    );

    await sendChannelMessage("channel-1", "Please handle the READY cards.");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/channels/channel-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "Please handle the READY cards." }),
      }),
    );
  });

  test("assigns a task to an agent", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, taskId: "task-1", assignedAgentId: "agent-1" }),
    );

    const result = await assignTaskAgent("repo-1", "task-1", "agent-1");

    expect(result).toEqual({ taskId: "task-1", assignedAgentId: "agent-1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/assignment",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ agentId: "agent-1" }),
      }),
    );
  });

  test("moves a task to a persisted board column and target worker", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        taskId: "task-1",
        boardColumn: "READY",
        status: "READY",
        assignedAgentId: "agent-1",
      }),
    );

    const result = await moveTaskToBoardColumn("repo-1", "task-1", "READY", "agent-1");

    expect(result).toEqual({
      taskId: "task-1",
      boardColumn: "READY",
      status: "READY",
      assignedAgentId: "agent-1",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/board-column",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ column: "READY", agentId: "agent-1" }),
      }),
    );
  });

  test("searches agent memory", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        enabled: true,
        results: [
          {
            agentId: "agent-atlas",
            agentName: "Atlas",
            repoId: "repo-1",
            repoName: "aop-mono",
            snippet: "Atlas remembers the menu change.",
          },
        ],
      }),
    );

    const result = await searchAgentMemory({
      repoId: "repo-1",
      agentId: "agent-atlas",
      query: "chat replacement",
    });

    expect(result.enabled).toBe(true);
    expect(result.results[0]?.snippet).toBe("Atlas remembers the menu change.");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/agent-memory/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          repoId: "repo-1",
          agentId: "agent-atlas",
          query: "chat replacement",
        }),
      }),
    );
  });
});

describe("workflow helpers", () => {
  test("fetches workflow details for the builder", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        workflows: [
          {
            id: "workflow-1",
            name: "aop-default-gpt",
            version: 1,
            active: true,
            source: "builtin",
            stepCount: 2,
            steps: [
              {
                id: "implement",
                type: "implement",
                promptTemplate: "implement.md.hbs",
                signals: [{ name: "ALL_TASKS_DONE", description: "done" }],
                transitions: [{ condition: "ALL_TASKS_DONE", target: "run-tests" }],
              },
              {
                id: "run-tests",
                type: "test",
                promptTemplate: "run-tests.md.hbs",
                signals: [{ name: "TESTS_PASS", description: "tests pass" }],
                transitions: [{ condition: "TESTS_PASS", target: "__done__" }],
              },
            ],
          },
        ],
      }),
    );

    const result = await getWorkflowDetails();

    expect(result[0]?.source).toBe("builtin");
    expect(mockFetch).toHaveBeenCalledWith("/api/workflows/details", expect.any(Object));
  });

  test("fetches step library blocks", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        steps: [
          {
            id: "implement_frontend",
            type: "implement",
            category: "frontend",
            description: "Build UI",
            signals: [{ name: "TASK_COMPLETE", description: "done" }],
            promptTemplate: "implement-frontend.md.hbs",
            promptContent: "You are implementing frontend code for a task.",
            defaults: { maxAttempts: 15 },
          },
        ],
      }),
    );

    const result = await getStepLibrary();

    expect(result[0]?.id).toBe("implement_frontend");
    expect(result[0]?.promptContent).toContain("frontend code");
    expect(mockFetch).toHaveBeenCalledWith("/api/workflows/step-library", expect.any(Object));
  });

  test("saves a workflow from configured step instances", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        workflow: {
          id: "workflow-2",
          name: "frontend-polish",
          version: 1,
          active: true,
          source: "user",
          stepCount: 2,
          steps: [],
        },
      }),
    );

    const result = await saveWorkflow({
      sourceWorkflowId: "workflow-1",
      name: "frontend-polish",
      steps: [
        {
          id: "research",
          skillId: "codebase_research",
          maxAttempts: 4,
          transitions: [
            { condition: "RESEARCH_COMPLETE", target: "implement_frontend" },
            { condition: "failure", target: "__blocked__" },
          ],
          agent: {
            provider: "codex-cli",
            model: "gpt-5.5",
            reasoning: "high",
            fastMode: true,
          },
        },
        {
          skillId: "implement_frontend",
          maxAttempts: 15,
          agent: {
            provider: "opencode",
            model: "opencode-go/kimi-k2.7-code",
            reasoning: "medium",
            fastMode: false,
          },
        },
      ],
    });

    expect(result.name).toBe("frontend-polish");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workflows",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceWorkflowId: "workflow-1",
          name: "frontend-polish",
          steps: [
            {
              id: "research",
              skillId: "codebase_research",
              maxAttempts: 4,
              transitions: [
                { condition: "RESEARCH_COMPLETE", target: "implement_frontend" },
                { condition: "failure", target: "__blocked__" },
              ],
              agent: {
                provider: "codex-cli",
                model: "gpt-5.5",
                reasoning: "high",
                fastMode: true,
              },
            },
            {
              skillId: "implement_frontend",
              maxAttempts: 15,
              agent: {
                provider: "opencode",
                model: "opencode-go/kimi-k2.7-code",
                reasoning: "medium",
                fastMode: false,
              },
            },
          ],
        }),
      }),
    );
  });

  test("saves custom workflow step blocks without runtime settings", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        step: {
          id: "quick_ui_review",
          type: "review",
          category: "frontend",
          description: "Review UI",
          signals: [{ name: "REVIEW_DONE", description: "done" }],
          promptTemplate: "Review the UI",
          defaults: { maxAttempts: 2 },
          source: "user",
        },
      }),
    );

    const result = await saveSkillBlock({
      id: "quick_ui_review",
      type: "review",
      category: "frontend",
      description: "Review UI",
      signals: [{ name: "REVIEW_DONE", description: "done" }],
      promptTemplate: "Review the UI",
      defaults: { maxAttempts: 2 },
    });

    expect(result.id).toBe("quick_ui_review");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workflows/step-library",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          id: "quick_ui_review",
          type: "review",
          category: "frontend",
          description: "Review UI",
          signals: [{ name: "REVIEW_DONE", description: "done" }],
          promptTemplate: "Review the UI",
          defaults: { maxAttempts: 2 },
        }),
      }),
    );
  });
});

describe("markReady", () => {
  test("marks task as ready without retry step", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1" }));

    const result = await markReady("repo-1", "task-1");

    expect(result.taskId).toBe("task-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/ready",
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
  });

  test("marks task as ready with retryFromStep", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1" }));

    await markReady("repo-1", "task-1", "full-review");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/ready",
      expect.objectContaining({
        body: JSON.stringify({ retryFromStep: "full-review" }),
      }),
    );
  });
});

describe("removeTask", () => {
  test("removes task without force", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1", aborted: false }));

    const result = await removeTask("repo-1", "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.aborted).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  test("removes task with force", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, taskId: "task-1", aborted: true }));

    const result = await removeTask("repo-1", "task-1", true);

    expect(result.aborted).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1?force=true",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("getMetrics", () => {
  const createMetrics = (total: number, done: number) => ({
    total,
    byStatus: {
      DRAFT: 0,
      READY: 0,
      RESUMING: 0,
      WORKING: 0,
      PAUSED: 0,
      BLOCKED: 0,
      DONE: done,
      REMOVED: 0,
    },
    successRate: total > 0 ? done / total : 0,
    avgDurationMs: 1000,
    avgFailedDurationMs: 500,
  });

  test("fetches metrics without repoId", async () => {
    const metrics = createMetrics(10, 5);
    mockFetch.mockResolvedValueOnce(jsonResponse(metrics));

    const result = await getMetrics();

    expect(result).toEqual(metrics);
    expect(mockFetch).toHaveBeenCalledWith("/api/metrics", expect.any(Object));
  });

  test("fetches metrics with repoId", async () => {
    const metrics = createMetrics(3, 1);
    mockFetch.mockResolvedValueOnce(jsonResponse(metrics));

    const result = await getMetrics("repo-1");

    expect(result).toEqual(metrics);
    expect(mockFetch).toHaveBeenCalledWith("/api/metrics?repoId=repo-1", expect.any(Object));
  });
});

describe("listDirectories", () => {
  test("lists directories without path", async () => {
    const response = {
      path: "/home/user",
      directories: ["projects", "documents"],
      parent: "/home",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories();

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith("/api/fs/directories", expect.any(Object));
  });

  test("lists directories with path", async () => {
    const response = {
      path: "/home/user/projects",
      directories: ["repo1", "repo2"],
      parent: "/home/user",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories("/home/user/projects");

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fs/directories?path=%2Fhome%2Fuser%2Fprojects",
      expect.any(Object),
    );
  });

  test("lists directories with hidden flag", async () => {
    const response = {
      path: "/home/user",
      directories: [".config", ".local", "projects"],
      parent: "/home",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories("/home/user", true);

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fs/directories?path=%2Fhome%2Fuser&hidden=true",
      expect.any(Object),
    );
  });
});

describe("getFactoryHealth", () => {
  test("fetches the dashboard health snapshot", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        generatedAt: "2026-05-15T20:00:00.000Z",
        severity: "warning",
        summary: { ok: 1, warning: 1, error: 0 },
        services: [],
        integrations: [
          {
            id: "linear",
            label: "Linear",
            severity: "warning",
            message: "Linear is locked.",
            action: "Unlock Linear in Settings.",
          },
        ],
        recentFailures: [],
      }),
    );

    const result = await getFactoryHealth();
    expect(result.severity).toBe("warning");
    expect(result.integrations[0]?.id).toBe("linear");
    expect(mockFetch).toHaveBeenCalledWith("/api/health/details", expect.any(Object));
  });
});

describe("registerRepo", () => {
  test("registers a new repository", async () => {
    const response = { ok: true, repoId: "repo-123", alreadyExists: false };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await registerRepo("/path/to/repo");

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/path/to/repo" }),
      }),
    );
  });

  test("handles already existing repository", async () => {
    const response = { ok: true, repoId: "repo-123", alreadyExists: true };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await registerRepo("/path/to/repo");

    expect(result.alreadyExists).toBe(true);
  });
});

describe("blockTask", () => {
  test("blocks a task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, taskId: "task-1", agentKilled: true }),
    );

    const result = await blockTask("repo-1", "task-1");

    expect(result.taskId).toBe("task-1");
    expect(result.agentKilled).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/block",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("getSettings", () => {
  test("fetches settings", async () => {
    const settings = [
      { key: "theme", value: "dark" },
      { key: "maxConcurrent", value: "3" },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ settings }));

    const result = await getSettings();

    expect(result).toEqual(settings);
    expect(mockFetch).toHaveBeenCalledWith("/api/settings", expect.any(Object));
  });
});

describe("getWorkflows", () => {
  test("fetches available workflows", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ workflows: ["aop-default-gpt", "simple"] }));

    const result = await getWorkflows();

    expect(result).toEqual(["aop-default-gpt", "simple"]);
    expect(mockFetch).toHaveBeenCalledWith("/api/workflows", expect.any(Object));
  });
});

describe("deleteWorkflow", () => {
  test("deletes a workflow by encoded id", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteWorkflow("workflow/custom");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/workflows/workflow%2Fcustom",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("updateSettings", () => {
  test("updates settings", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const settings = [{ key: "theme", value: "light" }];
    await updateSettings(settings);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ settings }),
      }),
    );
  });
});

describe("getPauseContext", () => {
  test("fetches pause context for a paused task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        pauseContext: "INPUT_REASON: Need API key\nINPUT_TYPE: text",
        signal: "REQUIRES_INPUT",
      }),
    );

    const result = await getPauseContext("repo-1", "task-1");

    expect(result.pauseContext).toBe("INPUT_REASON: Need API key\nINPUT_TYPE: text");
    expect(result.signal).toBe("REQUIRES_INPUT");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/pause-context",
      expect.any(Object),
    );
  });

  test("returns null pauseContext and signal when no context exists", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ pauseContext: null, signal: null }));

    const result = await getPauseContext("repo-1", "task-1");

    expect(result.pauseContext).toBeNull();
    expect(result.signal).toBeNull();
  });

  test("returns signal for review workflow", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ pauseContext: "Plan for implementation...", signal: "PLAN_READY" }),
    );

    const result = await getPauseContext("repo-1", "task-1");

    expect(result.signal).toBe("PLAN_READY");
    expect(result.pauseContext).toBe("Plan for implementation...");
  });
});

describe("resumeTask", () => {
  test("resumes a paused task with input", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ ok: true, taskId: "task-1", message: "Resume initiated" }),
    );

    const result = await resumeTask("repo-1", "task-1", "my-api-key-123");

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/resume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: "my-api-key-123" }),
      }),
    );
  });

  test("throws ApiError when task is not paused", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Task is not paused" }, 409));

    await expect(resumeTask("repo-1", "task-1", "input")).rejects.toThrow(ApiError);
  });
});

describe("fetchExecutions", () => {
  test("fetches executions for a task", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        executions: [
          {
            id: "exec-1",
            taskId: "task-1",
            status: "completed",
            startedAt: "2024-01-01T00:00:00Z",
            finishedAt: "2024-01-01T00:10:00Z",
            steps: [
              {
                id: "step-exec-1",
                stepId: "implement",
                stepType: "implement",
                status: "success",
                startedAt: "2024-01-01T00:00:00Z",
                endedAt: "2024-01-01T00:05:00Z",
              },
              {
                id: "step-exec-2",
                stepId: "full-review",
                stepType: "review",
                status: "failure",
                signal: "REVIEW_FAILED",
                startedAt: "2024-01-01T00:05:00Z",
                endedAt: "2024-01-01T00:10:00Z",
                error: "Review failed",
              },
            ],
          },
        ],
      }),
    );

    const result = await fetchExecutions("repo-1", "task-1");

    expect(result).toHaveLength(1);
    const exec = result[0];
    expect(exec?.id).toBe("exec-1");
    expect(exec?.steps).toHaveLength(2);
    expect(exec?.steps[0]?.stepId).toBe("implement");
    expect(exec?.steps[1]?.stepId).toBe("full-review");
    expect(exec?.steps[1]?.signal).toBe("REVIEW_FAILED");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos/repo-1/tasks/task-1/executions",
      expect.any(Object),
    );
  });

  test("fetches canonical runtime events for an execution", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        events: [
          {
            id: "rte-1",
            taskId: "task-1",
            executionId: "exec-1",
            stepExecutionId: "step-1",
            sessionId: "pi-session-1",
            agentId: null,
            kind: "assistant_text",
            title: "Assistant update",
            message: "Working",
            toolName: null,
            status: null,
            occurredAt: "2026-04-01T00:00:00.000Z",
          },
        ],
      }),
    );

    const result = await fetchRuntimeEvents("exec-1");

    expect(result[0]?.message).toBe("Working");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/executions/exec-1/runtime-events",
      expect.any(Object),
    );
  });

  test("returns empty array when no executions", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ executions: [] }));

    const result = await fetchExecutions("repo-1", "task-1");

    expect(result).toEqual([]);
  });
});
