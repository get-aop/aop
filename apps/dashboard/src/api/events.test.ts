import { beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {}

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const runningActivity = {
  sessionId: "pi-session-1",
  sessionState: "running",
  latestEventKind: "assistant_text",
  latestEventAt: "2026-03-31T00:00:05.000Z",
  latestMessage: "Working on it",
  needsAttention: false,
  blocked: false,
  handoffProduced: false,
  verificationEvidenceRecorded: false,
};

const completedActivity = {
  sessionId: "pi-session-1",
  sessionState: "completed",
  latestEventKind: "session_completed",
  latestEventAt: "2026-03-31T00:10:00.000Z",
  latestMessage: "Done",
  needsAttention: false,
  blocked: false,
  handoffProduced: true,
  verificationEvidenceRecorded: true,
};

describe("api/events", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    globalThis.EventSource = MockEventSource as unknown as typeof EventSource;
  });

  test("preserves server-authored swimlane metadata in init and status events", async () => {
    const handled = mock();
    const { createTaskEventsConnection } = await import("./events");

    const connection = createTaskEventsConnection({ onEvent: handled });
    const source = MockEventSource.instances[0];

    expect(source).toBeDefined();

    source?.emit("init", {
      type: "init",
      status: {
        globalCapacity: { working: 1, max: 3 },
        swimlanes: [
          {
            id: "architect-control",
            title: "Architect Control",
            description: "Plan slices, assign developers, and accept handoffs.",
            ownerRole: "architect",
            order: 0,
          },
        ],
        repos: [
          {
            id: "repo-1",
            name: "aop-mono",
            path: "/repos/aop-mono",
            working: 1,
            max: 3,
            tasks: [
              {
                id: "task-1",
                repoId: "repo-1",
                changePath: "docs/tasks/get-57",
                status: "WORKING",
                baseBranch: null,
                preferredProvider: null,
                preferredWorkflow: null,
                createdAt: "2026-03-31T00:00:00.000Z",
                updatedAt: "2026-03-31T00:00:00.000Z",
                swimlane: {
                  laneId: "architect-control",
                  phaseLabel: "Review",
                  ownerLabel: "architect-1",
                  ownerRole: "architect",
                },
                runtimeActivity: runningActivity,
              },
            ],
          },
        ],
      },
    });

    source?.emit("task-status-changed", {
      type: "task-status-changed",
      taskId: "task-1",
      previousStatus: "WORKING",
      newStatus: "DONE",
      task: {
        id: "task-1",
        repoId: "repo-1",
        changePath: "docs/tasks/get-57",
        status: "DONE",
        baseBranch: null,
        preferredProvider: null,
        preferredWorkflow: null,
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:10:00.000Z",
        swimlane: {
          laneId: "completed",
          phaseLabel: "Completed",
          ownerLabel: "Architect",
          ownerRole: "architect",
        },
        runtimeActivity: completedActivity,
      },
    });

    expect(handled.mock.calls[0]?.[0]).toEqual({
      type: "init",
      data: {
        repos: [{ id: "repo-1", name: "aop-mono", path: "/repos/aop-mono" }],
        swimlanes: [
          {
            id: "architect-control",
            title: "Architect Control",
            description: "Plan slices, assign developers, and accept handoffs.",
            ownerRole: "architect",
            order: 0,
          },
        ],
        tasks: [
          {
            id: "task-1",
            repoId: "repo-1",
            changePath: "docs/tasks/get-57",
            status: "WORKING",
            baseBranch: null,
            preferredProvider: null,
            preferredWorkflow: null,
            createdAt: "2026-03-31T00:00:00.000Z",
            updatedAt: "2026-03-31T00:00:00.000Z",
            repoPath: "/repos/aop-mono",
            swimlane: {
              laneId: "architect-control",
              phaseLabel: "Review",
              ownerLabel: "architect-1",
              ownerRole: "architect",
            },
            runtimeActivity: runningActivity,
          },
        ],
      },
    });

    expect(handled.mock.calls[1]?.[0]).toEqual({
      type: "task-status-changed",
      data: {
        taskId: "task-1",
        status: "DONE",
        updatedAt: "2026-03-31T00:10:00.000Z",
        errorMessage: undefined,
        currentExecutionId: undefined,
        executionStartedAt: undefined,
        executionCompletedAt: undefined,
        taskProgress: undefined,
        swimlane: {
          laneId: "completed",
          phaseLabel: "Completed",
          ownerLabel: "Architect",
          ownerRole: "architect",
        },
        runtimeActivity: completedActivity,
      },
    });

    connection.close();
  });
});
