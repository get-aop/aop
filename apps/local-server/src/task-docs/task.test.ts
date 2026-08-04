import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import {
  parseTaskDoc,
  parseTaskExecutionModel,
  readTaskExecutionModel,
  writeTaskDoc,
} from "./task.ts";

describe("task-docs/task", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-task-doc-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("round-trips Linear source metadata and dependency mirror metadata", async () => {
    const taskDir = join(tempDir, "task");
    const taskFilePath = join(taskDir, "task.md");
    await mkdir(taskDir, { recursive: true });

    await writeTaskDoc(
      taskFilePath,
      {
        id: "task-linear-1",
        title: "Imported issue",
        status: TaskStatus.DRAFT,
        created: "2026-03-12T12:00:00.000Z",
        source: {
          provider: "linear",
          id: "lin_123",
          ref: "ABC-123",
          url: "https://linear.app/acme/issue/ABC-123/imported-issue",
        },
        dependencySources: [
          {
            provider: "linear",
            id: "lin_120",
            ref: "ABC-120",
          },
        ],
        dependencyImported: true,
      },
      [
        "",
        "## Description",
        "Imported from Linear",
        "",
        "## Requirements",
        "- Review the Linear issue",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the ticket intent",
        "",
      ].join("\n"),
    );

    const doc = await parseTaskDoc(taskFilePath);

    expect(doc.source).toEqual({
      provider: "linear",
      id: "lin_123",
      ref: "ABC-123",
      url: "https://linear.app/acme/issue/ABC-123/imported-issue",
    });
    expect(doc.dependencySources).toEqual([
      {
        provider: "linear",
        id: "lin_120",
        ref: "ABC-120",
      },
    ]);
    expect(doc.dependencyImported).toBe(true);
  });

  test("round-trips Jira source metadata and dependency mirror metadata", async () => {
    const taskDir = join(tempDir, "jira-task");
    const taskFilePath = join(taskDir, "task.md");
    await mkdir(taskDir, { recursive: true });

    await writeTaskDoc(
      taskFilePath,
      {
        id: "task-jira-1",
        title: "Imported Jira issue",
        status: TaskStatus.DRAFT,
        created: "2026-03-12T12:00:00.000Z",
        source: {
          provider: "jira",
          id: "10042",
          ref: "GET-50",
          url: "https://acme.atlassian.net/browse/GET-50",
        },
        dependencySources: [
          {
            provider: "jira",
            id: "10041",
            ref: "GET-49",
          },
        ],
        dependencyImported: true,
      },
      [
        "",
        "## Description",
        "Imported from Jira",
        "",
        "## Requirements",
        "- Review the Jira issue",
        "",
        "## Acceptance Criteria",
        "- [ ] Match the ticket intent",
        "",
      ].join("\n"),
    );

    const doc = await parseTaskDoc(taskFilePath);

    expect(doc.source).toEqual({
      provider: "jira",
      id: "10042",
      ref: "GET-50",
      url: "https://acme.atlassian.net/browse/GET-50",
    });
    expect(doc.dependencySources).toEqual([
      {
        provider: "jira",
        id: "10041",
        ref: "GET-49",
      },
    ]);
  });

  test("round-trips execution metadata for architect and developer repository scopes", async () => {
    const taskDir = join(tempDir, "task");
    const taskFilePath = join(taskDir, "task.md");
    await mkdir(taskDir, { recursive: true });

    await writeTaskDoc(
      taskFilePath,
      {
        id: "task-execution-1",
        title: "Execution-aware task",
        status: TaskStatus.DRAFT,
        created: "2026-03-31T00:00:00.000Z",
        execution: {
          version: 1,
          coordinationMode: "multi-repository",
          coordinationPhase: "developers-assigned",
          architect: {
            agentId: "architect-1",
            role: "architect",
            repositories: [{ repoId: "aop-mono", assignment: "control-plane" }],
          },
          developers: [
            {
              agentId: "developer-1",
              role: "developer",
              sliceId: "slice-runtime",
              lifecycle: "assigned",
              repositories: [
                { repoId: "aop-mono", assignment: "primary" },
                { repoId: "shared-ui", assignment: "supporting" },
              ],
            },
          ],
          guardrails: {
            maxTotalAgents: 6,
            maxDeveloperAgents: 5,
            maxDeveloperAssignmentsPerTask: 1,
            requireSinglePrimaryRepository: true,
            allowSupportingRepositories: true,
            architectRunsInControlPlane: true,
          },
        },
      },
      [
        "",
        "## Description",
        "Execution metadata should survive parse/write.",
        "",
        "## Requirements",
        "- Preserve repository scopes",
        "",
        "## Acceptance Criteria",
        "- [ ] Metadata parses cleanly",
        "",
      ].join("\n"),
    );

    const doc = await parseTaskDoc(taskFilePath);

    expect(doc.execution?.coordinationMode).toBe("multi-repository");
    expect(doc.execution?.developers[0]?.repositories).toEqual([
      { repoId: "aop-mono", assignment: "primary" },
      { repoId: "shared-ui", assignment: "supporting" },
    ]);
  });

  test("reports execution validation errors without crashing task doc parsing", async () => {
    const taskDir = join(tempDir, "task");
    const taskFilePath = join(taskDir, "task.md");
    await mkdir(taskDir, { recursive: true });

    await Bun.write(
      taskFilePath,
      [
        "---",
        "title: Invalid execution task",
        "status: DRAFT",
        "execution:",
        "  version: 1",
        "  coordinationMode: multi-repository",
        "  coordinationPhase: developers-assigned",
        "  architect:",
        "    agentId: architect-1",
        "    role: architect",
        "    repositories:",
        "      - repoId: aop-mono",
        "        assignment: control-plane",
        "  developers:",
        "    - agentId: developer-1",
        "      role: developer",
        "      sliceId: slice-runtime",
        "      lifecycle: assigned",
        "      repositories:",
        "        - repoId: shared-ui",
        "          assignment: supporting",
        "  guardrails:",
        "    maxTotalAgents: 6",
        "    maxDeveloperAgents: 5",
        "    maxDeveloperAssignmentsPerTask: 1",
        "    requireSinglePrimaryRepository: true",
        "    allowSupportingRepositories: true",
        "    architectRunsInControlPlane: true",
        "---",
        "",
        "## Description",
        "Invalid execution metadata",
        "",
      ].join("\n"),
    );

    const doc = await parseTaskDoc(taskFilePath);
    const execution = await readTaskExecutionModel(taskFilePath);

    expect(doc.execution).toBeNull();
    expect(execution.model).toBeNull();
    expect(execution.error).toContain("exactly one primary repository");
  });

  test("normalizes legacy architect-planning phase to developers-assigned", () => {
    const result = parseTaskExecutionModel({
      version: 1,
      coordinationMode: "single-repository",
      coordinationPhase: "architect-planning",
      architect: {
        agentId: "architect-1",
        role: "architect",
        repositories: [{ repoId: "repo-1", assignment: "control-plane" }],
      },
      developers: [
        {
          agentId: "developer-1",
          role: "developer",
          sliceId: "slice-1",
          lifecycle: "assigned",
          repositories: [{ repoId: "repo-1", assignment: "primary" }],
        },
      ],
      guardrails: {
        maxTotalAgents: 6,
        maxDeveloperAgents: 5,
        maxDeveloperAssignmentsPerTask: 1,
        requireSinglePrimaryRepository: true,
        allowSupportingRepositories: true,
        architectRunsInControlPlane: true,
      },
    });

    expect(result.error).toBeNull();
    expect(result.model?.coordinationPhase).toBe("developers-assigned");
  });
});
