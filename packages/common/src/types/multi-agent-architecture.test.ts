import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  INITIAL_MULTI_AGENT_ARCHITECTURE,
  MultiAgentArchitectureSchema,
  MultiAgentTeamSchema,
  renderMultiAgentArchitectureMarkdown,
} from "./multi-agent-architecture.ts";

describe("multi-agent architecture", () => {
  test("accepts the initial Pi-first control-plane contract", () => {
    const result = MultiAgentArchitectureSchema.safeParse(INITIAL_MULTI_AGENT_ARCHITECTURE);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limits.maxTotalAgents).toBe(6);
      expect(result.data.limits.architectAgents).toBe(1);
      expect(result.data.limits.developerAgents).toBe(5);
      expect(result.data.runtimeBoundary.aopOwns).toContain(
        "Task intake, assignment, workflow selection, status projection, and operator controls",
      );
      expect(result.data.runtimeBoundary.piOwns).toContain(
        "Agent sessions, memory, tools, subagents, model execution, and inter-agent coordination",
      );
      expect(result.data.developer.lifecycle).toEqual([
        "queued",
        "assigned",
        "implementing",
        "verifying",
        "handoff",
        "completed",
      ]);
    }
  });

  test("accepts a valid one-architect team spanning multiple repositories", () => {
    const result = MultiAgentTeamSchema.safeParse([
      {
        id: "architect-1",
        role: "architect",
        repositories: [
          { repoId: "platform", assignment: "control-plane" },
          { repoId: "dashboard", assignment: "review" },
        ],
      },
      {
        id: "developer-1",
        role: "developer",
        repositories: [{ repoId: "dashboard", assignment: "primary" }],
      },
      {
        id: "developer-2",
        role: "developer",
        repositories: [
          { repoId: "cli", assignment: "primary" },
          { repoId: "common", assignment: "supporting" },
        ],
      },
    ]);

    expect(result.success).toBe(true);
  });

  test("rejects teams with more than one architect", () => {
    const result = MultiAgentTeamSchema.safeParse([
      {
        id: "architect-1",
        role: "architect",
        repositories: [{ repoId: "platform", assignment: "control-plane" }],
      },
      {
        id: "architect-2",
        role: "architect",
        repositories: [{ repoId: "dashboard", assignment: "review" }],
      },
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("exactly one architect");
    }
  });

  test("rejects duplicate repository scopes for the same agent", () => {
    const result = MultiAgentTeamSchema.safeParse([
      {
        id: "architect-1",
        role: "architect",
        repositories: [{ repoId: "platform", assignment: "control-plane" }],
      },
      {
        id: "developer-1",
        role: "developer",
        repositories: [
          { repoId: "dashboard", assignment: "primary" },
          { repoId: "dashboard", assignment: "supporting" },
        ],
      },
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("must not repeat the same repoId");
    }
  });

  test("rejects teams with more than five developers", () => {
    const result = MultiAgentTeamSchema.safeParse([
      {
        id: "architect-1",
        role: "architect",
        repositories: [{ repoId: "platform", assignment: "control-plane" }],
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `developer-${index + 1}`,
        role: "developer" as const,
        repositories: [{ repoId: `repo-${index + 1}`, assignment: "primary" as const }],
      })),
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("up to five developers");
    }
  });

  test("renders Pi-first implementation guidance for downstream tickets", () => {
    const markdown = renderMultiAgentArchitectureMarkdown(INITIAL_MULTI_AGENT_ARCHITECTURE);

    expect(markdown).toContain("# AOP Control Plane Over Pi");
    expect(markdown).toContain("## Runtime Boundary");
    expect(markdown).toContain("### AOP owns");
    expect(markdown).toContain("### Pi owns");
    expect(markdown).toContain("## Pi-Backed Workers");
    expect(markdown).toContain("GET-58");
    expect(markdown).toContain("GET-59");
    expect(markdown).not.toContain("GET-53");
    expect(markdown).not.toContain("GET-54");
  });

  test("keeps the merged architecture document aligned with the runtime-neutral factory model", async () => {
    const documentPath = join(import.meta.dir, "../../../../docs/architecture/README.md");

    const markdown = await Bun.file(documentPath).text();

    expect(markdown).toContain("# AOP architecture");
    expect(markdown).toContain("AOP owns product state");
    expect(markdown).toContain("The selected runtime CLI owns model/provider access");
    expect(markdown).toContain("Global concurrent tasks: `max_concurrent_tasks`, default 5");
    expect(markdown).toContain("One worker runs at most one task at a time");
    expect(markdown).toContain("| OpenCode | `opencode` |");
    expect(markdown).toContain("~/.aop/repos/<repo-id>/tasks/<slug>/");
    expect(markdown).not.toContain("## Pi-Backed Workers");
    expect(markdown).not.toContain("GET-");
  });

  test("keeps the legacy architecture URLs as stubs pointing at the merged page", async () => {
    const architectureDir = join(import.meta.dir, "../../../../docs/architecture");
    const stubs = [
      { file: "aop-control-plane-over-pi.md", title: "# AOP Control Plane Over Agent Runtimes" },
      { file: "aop-multi-agent-architecture.md", title: "# AOP Multi-Agent Factory Contract" },
    ];

    for (const stub of stubs) {
      const markdown = await Bun.file(join(architectureDir, stub.file)).text();
      expect(markdown).toContain(stub.title);
      expect(markdown).toContain("merged into the single [Architecture](./README.md)");
      expect(markdown.split("\n").length).toBeLessThan(10);
    }
  });
});
