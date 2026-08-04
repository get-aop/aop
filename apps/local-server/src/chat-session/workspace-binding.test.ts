import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveChatWorkspace } from "./workspace-binding.ts";

const paths: string[] = [];

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("resolveChatWorkspace", () => {
  test("returns the repository path without requiring Git validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "aop-workspace-same-root-"));
    paths.push(root);

    expect(await resolveChatWorkspace(root, root)).toBe(await realpath(root));
  });

  test("accepts a linked worktree and rejects an unrelated repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "aop-workspace-root-"));
    const worktree = await mkdtemp(join(tmpdir(), "aop-workspace-linked-"));
    const unrelated = await mkdtemp(join(tmpdir(), "aop-workspace-other-"));
    paths.push(root, worktree, unrelated);
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await git(root, ["config", "user.name", "Test"]);
    await Bun.write(join(root, "README.md"), "test");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "initial"]);
    await rm(worktree, { recursive: true, force: true });
    await git(root, ["worktree", "add", "-b", "linked", worktree]);
    await git(unrelated, ["init"]);

    expect(await resolveChatWorkspace(root, worktree)).toBe(await realpath(worktree));
    await expect(resolveChatWorkspace(root, unrelated)).rejects.toThrow("same Git repository");
  });

  test("fails when a bound workspace disappears instead of falling back", async () => {
    const root = await mkdtemp(join(tmpdir(), "aop-workspace-missing-root-"));
    paths.push(root);
    await git(root, ["init"]);
    await expect(resolveChatWorkspace(root, join(root, "missing"))).rejects.toThrow(
      "does not exist",
    );
  });

  test("reuses common-directory lookups and evicts failed non-git results", async () => {
    const root = await mkdtemp(join(tmpdir(), "aop-workspace-cache-root-"));
    const nested = join(root, "pkg");
    paths.push(root);
    await mkdir(nested, { recursive: true });

    await expect(resolveChatWorkspace(root, nested)).rejects.toThrow();

    await git(root, ["init"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await git(root, ["config", "user.name", "Test"]);
    await Bun.write(join(root, "README.md"), "test");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "initial"]);

    const first = await resolveChatWorkspace(root, nested);
    const second = await resolveChatWorkspace(root, nested);
    expect(first).toBe(second);
    expect(first).toBe(await realpath(nested));
  });

  test("rejects a path recreated as an unrelated repository before TTL expiry", async () => {
    const root = await mkdtemp(join(tmpdir(), "aop-workspace-recreate-root-"));
    const linked = await mkdtemp(join(tmpdir(), "aop-workspace-recreate-link-"));
    const other = await mkdtemp(join(tmpdir(), "aop-workspace-recreate-other-"));
    paths.push(root, linked, other);

    await git(root, ["init"]);
    await git(root, ["config", "user.email", "test@example.com"]);
    await git(root, ["config", "user.name", "Test"]);
    await Bun.write(join(root, "README.md"), "test");
    await git(root, ["add", "README.md"]);
    await git(root, ["commit", "-m", "initial"]);
    await rm(linked, { recursive: true, force: true });
    await git(root, ["worktree", "add", "-b", "linked", linked]);

    expect(await resolveChatWorkspace(root, linked)).toBe(await realpath(linked));

    // Delete the worktree and recreate the same path as an unrelated repo.
    await git(root, ["worktree", "remove", "--force", linked]);
    await mkdir(linked, { recursive: true });
    await git(linked, ["init"]);
    await git(linked, ["config", "user.email", "test@example.com"]);
    await git(linked, ["config", "user.name", "Test"]);
    await Bun.write(join(linked, "other.md"), "other");
    await git(linked, ["add", "other.md"]);
    await git(linked, ["commit", "-m", "other"]);

    await expect(resolveChatWorkspace(root, linked)).rejects.toThrow("same Git repository");
  });
});

const git = async (cwd: string, args: string[]): Promise<void> => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(await new Response(proc.stderr).text());
};
