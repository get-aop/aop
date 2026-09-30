import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { ProjectStack } from "../project/test-utils.ts";
import { git } from "./git-test-utils.ts";
import { spawnAndSettle, useThreadWorld } from "./test-utils.ts";

const { setup } = useThreadWorld();

/** Points the stack's only repo at a linked worktree of the checkout it had, as if that were attached. */
const attachLinkedWorktree = async (s: ProjectStack): Promise<{ main: string; linked: string }> => {
  const repo = s.repos[0];
  if (!repo) throw new Error("no repo");
  const linked = join(mkdtempSync(join(tmpdir(), "aop-linked-")), "feature");
  git(repo.path, "worktree", "add", "-b", "feature", linked);
  await s.db.updateTable("repos").set({ path: linked }).where("id", "=", repo.id).execute();
  return { main: repo.path, linked };
};

describe("spawning a thread on a repository that is a linked worktree", () => {
  test("the thread runs in a worktree of its own, cut from the default branch, and leaves the attached worktree alone", async () => {
    const { s, project } = await setup({ settings: { threadAccess: "full-access" } });
    const { main, linked } = await attachLinkedWorktree(s);
    const repoId = s.repos[0]?.id ?? "";

    const thread = await spawnAndSettle(s, project.id, { title: "Fix cold start", prompt: "Go" });

    // The fake CLI answered, so the turn ran to its end.
    expect(thread.status).toBe("idle");
    const worktree = aopPaths.worktree(repoId, thread.id);
    expect(existsSync(join(worktree, ".git"))).toBe(true);
    const branch = git(worktree, "rev-parse", "--abbrev-ref", "HEAD");
    expect(branch).toStartWith("aop/fix-cold-start-");
    expect(git(worktree, "rev-parse", "HEAD")).toBe(git(main, "rev-parse", "main"));
    // One repository, now with three checkouts: the main one, the attached one and the thread's.
    expect(
      realpathSync(git(worktree, "rev-parse", "--git-common-dir", "--path-format=absolute")),
    ).toBe(realpathSync(join(main, ".git")));
    const listed = git(main, "worktree", "list", "--porcelain");
    expect(listed).toContain(`branch refs/heads/${branch}`);
    expect(listed).toContain(`branch refs/heads/feature`);
    // The attached worktree keeps its own branch and stays clean.
    expect(git(linked, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feature");
    expect(git(linked, "status", "--porcelain")).toBe("");
    // The run worked in the thread's worktree, not in the attached one.
    const session = await s.ctx.chatSessionRepository.getById(thread.id);
    expect(session?.workspace_path).toBe(realpathSync(worktree));
  });
});
