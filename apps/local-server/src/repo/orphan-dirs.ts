import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";

/**
 * Startup janitor: remove `~/.aop/repos/<id>` and `~/.aop/worktrees/<id>`
 * directories whose repo id no longer exists in the database (e.g. a crash
 * mid-unregister). Must be awaited at server startup — running it
 * fire-and-forget lets the lazy `aopPaths.home()` lookup race environment
 * changes (test homes) and delete directories out from under another context.
 */
export const cleanupOrphanRepoDirs = async (ctx: LocalServerContext): Promise<void> => {
  const repoIds = new Set((await ctx.repoRepository.getAll()).map((repo) => repo.id));
  const home = aopPaths.home();
  await cleanupOrphanChildren(join(home, "repos"), repoIds);
  await cleanupOrphanChildren(join(home, "worktrees"), repoIds);
};

const cleanupOrphanChildren = async (parentDir: string, validIds: Set<string>): Promise<void> => {
  let entries: Array<{ isDirectory: () => boolean; name: string }>;
  try {
    entries = await readdir(parentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const name = String(entry.name);
    if (!entry.isDirectory() || validIds.has(name)) {
      continue;
    }
    await rm(join(parentDir, name), { recursive: true, force: true });
  }
};
