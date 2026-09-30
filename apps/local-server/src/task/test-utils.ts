import { mkdir, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import type { Database, Task } from "../db/schema.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { getCanonicalTaskDir } from "../task-docs/paths.ts";

export const createTestTask = async (
  db: Kysely<Database>,
  id: string,
  repoId: string,
  changePath: string,
  status: Task["status"] = "DRAFT",
): Promise<void> => {
  const repo = await db
    .selectFrom("repos")
    .select(["path"])
    .where("id", "=", repoId)
    .executeTakeFirst();
  const repoPath = repo?.path ?? aopPaths.repoDir(repoId);

  const normalizedChangePath = normalizeTestTaskPath(changePath);
  const canonicalTaskDir = getCanonicalTaskDir(repoId, normalizedChangePath);
  await mkdir(canonicalTaskDir, { recursive: true });

  const taskDoc = serializeFrontmatter({
    frontmatter: {
      id,
      title: basename(changePath),
      status,
      created: new Date().toISOString(),
      changePath: normalizedChangePath,
    },
    content: [
      "",
      "## Description",
      basename(changePath),
      "",
      "## Requirements",
      "",
      "## Acceptance Criteria",
      status === TaskStatus.DONE ? "- [x] Completed" : "- [ ] Define acceptance criteria",
      "",
    ].join("\n"),
  });

  await Bun.write(join(canonicalTaskDir, "task.md"), taskDoc);
  await Bun.write(
    join(canonicalTaskDir, "issues.md"),
    buildTestIssuesDoc(basename(changePath), status),
  );

  await linkLegacyRepoTaskDir(repoPath, normalizedChangePath, canonicalTaskDir);
  if (changePath !== normalizedChangePath) {
    await linkLegacyRepoTaskDir(repoPath, changePath, canonicalTaskDir);
  }
};

const buildTestIssuesDoc = (title: string, status: Task["status"]): string =>
  [
    "## Agent Brief",
    "",
    "**Category:** enhancement",
    `**Summary:** Complete ${title}.`,
    "",
    "**Current behavior:**",
    "The test task exists in the local AOP task store.",
    "",
    "**Desired behavior:**",
    "The test task can be exercised by local-server tests using the canonical task-doc contract.",
    "",
    "**Key interfaces:**",
    "- Task docs surfaced through the local-server task APIs.",
    "",
    "**Acceptance criteria:**",
    status === TaskStatus.DONE ? "- [x] Completed" : "- [ ] Define acceptance criteria",
    "",
    "**Out of scope:**",
    "- Exercising product behavior outside the test helper's task fixture.",
    "",
  ].join("\n");

const linkLegacyRepoTaskDir = async (
  repoPath: string,
  changePath: string,
  canonicalTaskDir: string,
): Promise<void> => {
  const legacyTaskDir = join(repoPath, changePath);
  if (legacyTaskDir === canonicalTaskDir) {
    return;
  }

  await mkdir(dirname(legacyTaskDir), { recursive: true });

  try {
    await symlink(canonicalTaskDir, legacyTaskDir, "dir");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
};

const normalizeTestTaskPath = (changePath: string): string => {
  if (changePath === aopPaths.relativeTaskDocs()) {
    return changePath;
  }

  if (changePath.startsWith(`${aopPaths.relativeTaskDocs()}/`)) {
    return changePath;
  }

  return join(aopPaths.relativeTaskDocs(), basename(changePath));
};
