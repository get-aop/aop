import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { aopPaths } from "@aop/infra";
import { E2E_TEST_BASE_DIR, FIXTURES_DIR, TEST_REPO_PREFIX, WORKTREES_DIR } from "./constants";
import { runAopCommand } from "./e2e-server";

export interface TempRepoResult {
  path: string;
  name: string;
  cleanup: (env?: Record<string, string>) => Promise<void>;
}

export const setupE2ETestDir = async (): Promise<void> => {
  await mkdir(E2E_TEST_BASE_DIR, { recursive: true });
};

export const createTempRepo = async (
  testName: string,
  baseDir?: string,
): Promise<TempRepoResult> => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const name = `${TEST_REPO_PREFIX}-${testName}-${timestamp}-${randomSuffix}`;
  const repoPath = join(baseDir ?? E2E_TEST_BASE_DIR, name);

  await mkdir(repoPath, { recursive: true });
  await Bun.$`git init -b main`.cwd(repoPath).quiet();
  await Bun.$`git config user.email "e2e-test@aop.dev"`.cwd(repoPath).quiet();
  await Bun.$`git config user.name "E2E Test"`.cwd(repoPath).quiet();

  await Bun.write(join(repoPath, "README.md"), `# ${name}\n\nE2E test repository.\n`);
  await Bun.$`git add .`.cwd(repoPath).quiet();
  await Bun.$`git commit -m "Initial commit"`.cwd(repoPath).quiet();

  return {
    path: repoPath,
    name,
    cleanup: async (env?: Record<string, string>) => {
      await runAopCommand(["repo:remove", repoPath, "--force"], undefined, env);
      await rm(repoPath, { recursive: true, force: true });
    },
  };
};

export const copyFixture = async (fixtureName: string, repoPath: string): Promise<string> => {
  const sourcePath = join(FIXTURES_DIR, fixtureName);
  const targetPath = join(repoPath, aopPaths.relativeTaskDocs(), fixtureName);

  await mkdir(dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
  await ensurePlanDoc(targetPath);

  return targetPath;
};

const ensurePlanDoc = async (taskDir: string): Promise<void> => {
  const planPath = join(taskDir, "plan.md");
  if (await fileExists(planPath)) {
    return;
  }

  const taskContent = await readOptionalFile(join(taskDir, "task.md"));
  const tasksContent = await readOptionalFile(join(taskDir, "tasks.md"));
  const title = extractTitle(taskContent) ?? basename(taskDir);
  const criteria = extractChecklist(tasksContent);

  await writeFile(
    planPath,
    [
      `# ${title}`,
      "",
      "## Summary",
      `Complete ${title}.`,
      "",
      "## Plan",
      "1. Implement the fixture task exactly as described by its acceptance criteria.",
      "",
      "## Acceptance Criteria",
      ...(criteria.length > 0 ? criteria : [`- [ ] Complete ${title}.`]),
      "",
    ].join("\n"),
  );
};

const readOptionalFile = async (path: string): Promise<string> => {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
};

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path, "utf-8");
    return true;
  } catch {
    return false;
  }
};

const extractTitle = (taskContent: string): string | null => {
  const match = taskContent.match(/^title:\s*(.+)$/m);
  return match?.[1]?.trim() ?? null;
};

const extractChecklist = (content: string): string[] =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^-\s+\[\s\]\s+/.test(line));

export const ensureChangesDir = async (repoPath: string): Promise<string> => {
  const changesDir = join(repoPath, aopPaths.relativeTaskDocs());
  await mkdir(changesDir, { recursive: true });
  return changesDir;
};

export const cleanupTestRepos = async (baseDir?: string): Promise<void> => {
  await rm(baseDir ?? E2E_TEST_BASE_DIR, { recursive: true, force: true });
};

export interface TempWorktreeResult {
  path: string;
  name: string;
  branch: string;
}

export const createTempWorktree = async (
  testName: string,
  worktreesDir?: string,
): Promise<TempWorktreeResult> => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 6);
  const name = `e2e-${testName}-${timestamp}-${randomSuffix}`;
  const targetDir = worktreesDir ?? WORKTREES_DIR;
  const worktreePath = join(targetDir, name);

  await mkdir(targetDir, { recursive: true });

  const branchResult = await Bun.$`git rev-parse --abbrev-ref HEAD`.quiet();
  const currentBranch = branchResult.stdout.toString().trim();

  const newBranch = `e2e/${name}`;
  await Bun.$`git worktree add -b ${newBranch} ${worktreePath} ${currentBranch}`.quiet();

  return {
    path: worktreePath,
    name,
    branch: newBranch,
  };
};
