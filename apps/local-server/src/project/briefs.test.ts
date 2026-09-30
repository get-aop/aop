import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import {
  buildCoordinatorBrief,
  buildThreadBrief,
  MEMORY_INDEX_MAX_CHARS,
  THREAD_DIGEST_MAX,
} from "./briefs.ts";

const project = {
  name: "Checkout",
  goal: "Keep checkout fast",
  instructions: "Never touch the payments schema without asking.",
};
const repos = [
  { id: "repo_web", name: "web", path: "/work/web" },
  { id: "repo_api", name: "api", path: "/work/api" },
];

const thread = (overrides: Partial<Thread> & Pick<Thread, "id" | "status">): Thread =>
  ({
    projectId: "proj_1",
    title: "Fix cold start",
    runtime: { provider: "claude-code", model: "m", effort: "high" },
    target: { kind: "host" },
    repoId: "repo_web",
    branch: null,
    steps: [],
    liveStatusLine: null,
    artifacts: [],
    repliesCount: 0,
    unread: false,
    lastActivityAt: "2026-09-30T10:00:00.000Z",
    createdAt: "2026-09-30T10:00:00.000Z",
    ...overrides,
  }) as Thread;

describe("the coordinator brief", () => {
  test("tells the coordinator its role, the goal, the instructions, the repos and the memory index", () => {
    const brief = buildCoordinatorBrief({
      project,
      repos,
      memoryIndex: "- Payments rules: payments.md",
      threads: [],
    }).join("\n");

    expect(brief).toContain('coordinator of the AOP project "Checkout"');
    expect(brief).toContain("Project goal: Keep checkout fast");
    expect(brief).toContain("Never touch the payments schema without asking.");
    expect(brief).toContain("- repo_web: web (/work/web)");
    expect(brief).toContain("- repo_api: api (/work/api)");
    expect(brief).toContain("- Payments rules: payments.md");
    expect(brief).toContain("No threads yet.");
    expect(brief).toContain("thread_spawn");
    expect(brief).toContain("Thread report:");
  });

  test("lists threads with status, progress and their one-line status", () => {
    const brief = buildCoordinatorBrief({
      project,
      repos,
      memoryIndex: null,
      threads: [
        thread({
          id: "isess_1",
          status: "working",
          steps: [
            { label: "a", state: "done" },
            { label: "b", state: "active" },
          ],
          liveStatusLine: "Bisecting · 7 commits left",
        }),
        thread({ id: "isess_2", status: "idle", title: "Docs" }),
      ],
    }).join("\n");

    expect(brief).toContain(
      '- isess_1 "Fix cold start" [working] 1/2 · Bisecting · 7 commits left',
    );
    expect(brief).toContain('- isess_2 "Docs" [idle]');
  });

  test("caps the thread digest and points at thread_list for the rest", () => {
    const threads = Array.from({ length: THREAD_DIGEST_MAX + 3 }, (_, index) =>
      thread({ id: `isess_${index}`, status: "idle" }),
    );

    const brief = buildCoordinatorBrief({ project, repos, memoryIndex: null, threads }).join("\n");

    expect(brief).toContain(`isess_${THREAD_DIGEST_MAX - 1} `);
    expect(brief).not.toContain(`isess_${THREAD_DIGEST_MAX} `);
    expect(brief).toContain("(3 older threads not shown; use thread_list)");
  });

  test("leaves out empty instructions and clips an oversized memory index", () => {
    const brief = buildCoordinatorBrief({
      project: { ...project, goal: "", instructions: "  " },
      repos: [],
      memoryIndex: "m".repeat(MEMORY_INDEX_MAX_CHARS * 2),
      threads: [],
    }).join("\n");

    expect(brief).toContain("Project goal: (not set)");
    expect(brief).not.toContain("Project instructions");
    expect(brief).toContain("This project has no repositories.");
    expect(brief.match(/m+…/)?.[0]).toHaveLength(MEMORY_INDEX_MAX_CHARS);
  });
});

describe("the thread brief", () => {
  test("names the workspace, the other repos it may only read, and the tools it reports through", () => {
    const brief = buildThreadBrief({
      project,
      repos,
      memoryIndex: null,
      thread: { id: "isess_1", title: "Fix cold start", repoId: "repo_web" },
      workspace: "/work/web",
    }).join("\n");

    expect(brief).toContain('a thread of the AOP project "Checkout", titled "Fix cold start"');
    expect(brief).toContain("Your workspace is /work/web.");
    expect(brief).toContain("read but not change");
    expect(brief).toContain("api (/work/api)");
    expect(brief).not.toContain("web (/work/web)");
    expect(brief).toContain("aop_report_status");
    expect(brief).toContain("aop_ask_user");
    expect(brief).toContain("end your turn");
    expect(brief).toContain("Never touch the payments schema without asking.");
  });

  test("a thread in a project with one repo has no other repos to mention", () => {
    const brief = buildThreadBrief({
      project,
      repos: repos.slice(0, 1),
      memoryIndex: null,
      thread: { id: "isess_1", title: "Fix", repoId: "repo_web" },
      workspace: "/work/web",
    }).join("\n");

    expect(brief).not.toContain("read but not change");
  });
});
