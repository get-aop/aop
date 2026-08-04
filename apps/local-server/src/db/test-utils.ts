import { execFileSync } from "node:child_process";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import { serializeFrontmatter } from "../task-docs/frontmatter.ts";
import { getCanonicalTaskDir } from "../task-docs/paths.ts";
import { createDatabase } from "./connection.ts";
import { runMigrations } from "./migrations.ts";
import type { Database, Task } from "./schema.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON responses in tests need flexible typing
export type AnyJson = any;

export const createTestContext = async (): Promise<LocalServerContext> => {
  const db = await createTestDb();
  return createCommandContext(db);
};

export const createTestDb = async (): Promise<Kysely<Database>> => {
  const db = createDatabase(":memory:");
  await runMigrations(db);
  return db;
};

export const createTestRepo = async (
  db: Kysely<Database>,
  id: string,
  path: string,
  options?: { maxConcurrentTasks?: number },
): Promise<void> => {
  const repoPath = path.startsWith(`${tmpdir()}/`) ? path : aopPaths.repoDir(id);
  await rm(aopPaths.repoDir(id), { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
  await mkdir(repoPath, { recursive: true });
  await initializeGitRepo(repoPath);
  await db
    .insertInto("repos")
    .values({
      id,
      path: repoPath,
      name: path.split("/").pop() ?? null,
      remote_origin: null,
      max_concurrent_tasks: options?.maxConcurrentTasks ?? 1,
    })
    .execute();
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

const initializeGitRepo = async (repoPath: string): Promise<void> => {
  execFileSync("git", ["init", "-b", "main", repoPath]);
  execFileSync("git", ["-C", repoPath, "config", "user.email", "aop-tests@example.com"]);
  execFileSync("git", ["-C", repoPath, "config", "user.name", "AOP Tests"]);
  await writeFile(join(repoPath, ".gitkeep"), "");
  execFileSync("git", ["-C", repoPath, "add", ".gitkeep"]);
  execFileSync("git", ["-C", repoPath, "commit", "-m", "init"]);
};

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
