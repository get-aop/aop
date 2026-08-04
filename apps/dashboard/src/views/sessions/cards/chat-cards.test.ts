import { describe, expect, test } from "bun:test";
import type { ChatActionPayload } from "@aop/common";
import {
  asApproval,
  asTaskAssignment,
  asTaskBatchAssignment,
  isTypedChatCard,
  unknownCardFallbackText,
} from "./chat-cards";

describe("chat-cards helpers", () => {
  test("detects typed cards and degrades unknown types", () => {
    const assignment: ChatActionPayload = {
      type: "task-assignment",
      label: "Start",
      sub: "t",
      meta: "m",
      proposal: { taskIds: ["t1"], title: "T", repoId: "r1" },
    };
    expect(isTypedChatCard(assignment)).toBe(true);
    expect(isTypedChatCard({ type: "task", label: "x", sub: "y", meta: "z" })).toBe(false);
    expect(asTaskAssignment(assignment)?.title).toBe("T");
    expect(asTaskAssignment({ type: "task", label: "x", sub: "y", meta: "z" })).toBeNull();
  });

  test("recognizes persisted workflow and runtime-action history cards", () => {
    const workflow = {
      type: "workflow-run",
      label: "Workflow",
      sub: "aop-default-gpt",
      meta: "6 steps",
      status: "proposed",
      proposal: { workflowId: "wf-1", workflowName: "aop-default-gpt", stepCount: 6 },
    } as ChatActionPayload;
    const runtimeActions = {
      type: "runtime-actions",
      label: "Runtime actions",
      sub: "Codex review",
      meta: "1 action",
      status: "live",
      proposal: {
        actions: [
          {
            id: "review-1",
            intent: "review",
            runtimeConfigurationId: "codex-default",
            provider: "codex-cli",
            model: "gpt-5.5",
            reasoning: "high",
            fastMode: false,
            phase: "post-work",
          },
        ],
      },
    } as ChatActionPayload;

    expect(isTypedChatCard(workflow)).toBe(true);
    expect(isTypedChatCard(runtimeActions)).toBe(true);
  });

  test("preserves workflow context on assignment proposals", () => {
    const assignment = {
      type: "task-assignment",
      label: "Assign task",
      sub: "Backlog",
      meta: "Choose a worker",
      proposal: {
        taskIds: ["task-1"],
        repoId: "repo-1",
        workflowId: "wf-1",
        workflowName: "aop-default-gpt",
      },
    } as ChatActionPayload;

    expect(asTaskAssignment(assignment)).toMatchObject({
      workflowId: "wf-1",
      workflowName: "aop-default-gpt",
    });
  });

  test("parses multi-select assignment proposals with empty taskIds", () => {
    const assignment: ChatActionPayload = {
      type: "task-assignment",
      label: "Assign tasks",
      sub: "Backlog",
      meta: "Choose a worker",
      proposal: {
        taskIds: [],
        repoId: "r1",
        workerId: null,
        candidates: [{ id: "t1", title: "docs/tasks/a" }],
      },
    };
    expect(asTaskAssignment(assignment)?.candidates).toEqual([{ id: "t1", title: "docs/tasks/a" }]);
    expect(
      asTaskAssignment({
        type: "task-assignment",
        label: "x",
        sub: "y",
        meta: "z",
        proposal: { taskIds: [], repoId: "r1" },
      }),
    ).toBeNull();
  });

  test("recognizes and parses batch routing cards", () => {
    const batch: ChatActionPayload = {
      type: "task-batch-assignment",
      label: "2 tasks created",
      sub: "First +1 more",
      meta: "Backlog",
      status: "live",
      proposal: {
        repoId: "r1",
        items: [
          { taskId: "task_a", title: "First", workerId: "w1" },
          { taskId: "task_b", title: "Second" },
        ],
      },
    };
    expect(isTypedChatCard(batch)).toBe(true);
    expect(asTaskBatchAssignment(batch)).toEqual({
      repoId: "r1",
      items: [
        {
          taskId: "task_a",
          title: "First",
          workerId: "w1",
          workflowId: null,
          workflowName: null,
        },
        { taskId: "task_b", title: "Second", workerId: null, workflowId: null, workflowName: null },
      ],
    });

    const routed: ChatActionPayload = {
      ...batch,
      proposal: {
        repoId: "r1",
        items: [
          {
            taskId: "task_a",
            title: "First",
            workerId: "w1",
            routedOutcome: "started",
            routedWorkerId: "w1",
          },
          { taskId: "task_b", title: "Second", routedOutcome: "backlog" },
        ],
      },
    };
    expect(asTaskBatchAssignment(routed)?.items).toEqual([
      {
        taskId: "task_a",
        title: "First",
        workerId: "w1",
        workflowId: null,
        workflowName: null,
        routedOutcome: "started",
        routedWorkerId: "w1",
      },
      {
        taskId: "task_b",
        title: "Second",
        workerId: null,
        workflowId: null,
        workflowName: null,
        routedOutcome: "backlog",
        routedWorkerId: null,
      },
    ]);
  });

  test("drops malformed batch items and rejects empty or wrong-shape payloads", () => {
    const withInvalid: ChatActionPayload = {
      type: "task-batch-assignment",
      label: "3 tasks created",
      sub: "s",
      meta: "m",
      proposal: {
        repoId: "r1",
        items: [
          { taskId: "task_ok", title: "Valid" },
          { taskId: 42, title: "Bad id" },
          { title: "Missing id" },
          "not-an-object",
        ],
      },
    };
    expect(asTaskBatchAssignment(withInvalid)?.items).toEqual([
      { taskId: "task_ok", title: "Valid", workerId: null, workflowId: null, workflowName: null },
    ]);

    expect(
      asTaskBatchAssignment({
        type: "task-batch-assignment",
        label: "x",
        sub: "y",
        meta: "z",
        proposal: { repoId: "r1", items: [] },
      }),
    ).toBeNull();
    expect(
      asTaskBatchAssignment({
        type: "task-batch-assignment",
        label: "x",
        sub: "y",
        meta: "z",
        proposal: { repoId: "r1", items: [{ title: "no id" }] },
      }),
    ).toBeNull();
    expect(
      asTaskBatchAssignment({
        type: "task-batch-assignment",
        label: "x",
        sub: "y",
        meta: "z",
        proposal: { items: [{ taskId: "task_a", title: "t" }] },
      }),
    ).toBeNull();
    expect(
      asTaskBatchAssignment({
        type: "task-assignment",
        label: "x",
        sub: "y",
        meta: "z",
        proposal: { repoId: "r1", items: [{ taskId: "task_a", title: "t" }] },
      }),
    ).toBeNull();
  });

  test("parses approval cards and unknown fallback text", () => {
    const approval: ChatActionPayload = {
      type: "approval",
      label: "Approve",
      sub: "handoff",
      meta: "w",
      proposal: { handoffId: "h1", taskId: "t1", title: "Ship" },
    };
    expect(asApproval(approval)?.handoffId).toBe("h1");
    expect(unknownCardFallbackText(approval)).toContain("Approve");
  });
});
