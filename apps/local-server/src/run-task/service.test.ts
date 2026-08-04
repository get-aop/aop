import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { createRunTaskService } from "./service.ts";
import { createMockContext } from "./test-utils.ts";

describe("run-task/service", () => {
  let cleanupAopHome: (() => void) | undefined;
  let ctx: LocalServerContext;
  let repoRoot: string;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
    ctx = createMockContext();
    repoRoot = join(tmpdir(), `aop-run-task-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
    ctx.repoRepository.getByPath = async (path) =>
      path === repoRoot
        ? ({
            id: "repo-1",
            path: repoRoot,
            name: "repo-1",
            remote_origin: null,
            max_concurrent_tasks: 1,
          } as Awaited<ReturnType<LocalServerContext["repoRepository"]["getByPath"]>>)
        : null;
  });

  afterEach(() => {
    cleanupAopHome?.();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("creates a canonical .aop task scaffold", async () => {
    const service = createRunTaskService(ctx);

    const result = await service.run({ changeName: "My Feature", cwd: repoRoot });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    expect(result.changeName).toBe("my-feature");
    expect(
      await Bun.file(join(aopPaths.repoTask("repo-1", "my-feature"), "task.md")).exists(),
    ).toBe(true);
    expect(await Bun.file(join(aopPaths.repoTask("repo-1", "my-feature"), "prd.md")).exists()).toBe(
      false,
    );
    expect(
      await Bun.file(join(aopPaths.repoTask("repo-1", "my-feature"), "issues.md")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(join(aopPaths.repoTask("repo-1", "my-feature"), "plan.md")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(aopPaths.repoTask("repo-1", "my-feature"), "001-my-feature.md")).exists(),
    ).toBe(false);
    expect(
      await Bun.file(join(repoRoot, aopPaths.relativeTaskDocs(), "my-feature", "task.md")).exists(),
    ).toBe(false);
  });

  test("returns an error when the task root cannot be created", async () => {
    const service = createRunTaskService(ctx);
    const impossiblePath = join(repoRoot, "missing", "child");

    await Bun.write(join(repoRoot, "missing"), "not a directory");
    const result = await service.run({ changeName: "My Feature", cwd: impossiblePath });

    expect(result.status).toBe("error");
  });
});
