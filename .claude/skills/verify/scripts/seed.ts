#!/usr/bin/env bun
/**
 * Seeds the baseline every feature file assumes, into a started verify stack:
 * a fixture git repo, the `aop-default-gpt` workflow, one worker, and one
 * assigned DRAFT task (`backlog-test`, which creates hello.txt).
 *
 *   bun .claude/skills/verify/scripts/seed.ts [--name <run>]
 *
 * Prints the ids as JSON and records them in the run's state.json under
 * `seed`. Re-running returns the recorded ids. Task packages have no HTTP
 * creation path outside the runtime's MCP tools, so the package is written
 * into `$AOP_HOME/repos/<repoId>/tasks/` and picked up by /api/refresh.
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
const nameFlag = process.argv.indexOf("--name");
const runName = nameFlag === -1 ? "default" : (process.argv[nameFlag + 1] ?? "default");
const statePath = join(ROOT, ".work", "verify", runName, "state.json");

interface Seed {
  repoId: string;
  repoPath: string;
  taskId: string;
  agentId: string;
  workflow: string;
}

const state = JSON.parse(await readFile(statePath, "utf8")) as {
  dir: string;
  home: string;
  env: Record<string, string>;
  seed?: Seed;
};
const api = state.env.AOP_LOCAL_SERVER_URL as string;

state.seed ??= await seedBaseline();
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(state.seed, null, 2)}\n`);

async function seedBaseline(): Promise<Seed> {
  const workflow = "aop-default-gpt";
  const repoPath = await createFixtureRepo();
  const { repoId } = await call<{ repoId: string }>("POST", "/api/repos", { path: repoPath });
  await call("POST", "/api/workflows", {
    name: workflow,
    stepIds: ["implement", "run-tests", "code_review"],
  });
  const { agent } = await call<{ agent: { id: string } }>("POST", "/api/agents/workers", {
    name: "Verify Worker",
    role: "developer",
    workflowId: workflow,
    repoIds: [repoId],
    planningDisabled: true,
  });
  const taskDir = join(state.home, "repos", repoId, "tasks", "backlog-test");
  await mkdir(taskDir, { recursive: true });
  await cp(join(ROOT, "e2e-tests/fixtures/backlog-test"), taskDir, { recursive: true });
  const taskId = await discoverTask(repoId);
  await call("PUT", `/api/repos/${repoId}/tasks/${taskId}/assignment`, { agentId: agent.id });
  return { repoId, repoPath, taskId, agentId: agent.id, workflow };
}

async function createFixtureRepo(): Promise<string> {
  const repoPath = join(state.dir, "fixtures", "repo");
  await mkdir(repoPath, { recursive: true });
  await writeFile(join(repoPath, "README.md"), "# verify fixture\n");
  const git = (...args: string[]) => Bun.$`git -C ${repoPath} ${args}`.quiet();
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "verify@aop.local");
  await git("config", "user.name", "AOP Verify");
  await git("add", ".");
  await git("commit", "-qm", "init");
  return repoPath;
}

async function discoverTask(repoId: string): Promise<string> {
  await call("POST", "/api/refresh");
  for (let attempt = 0; attempt < 20; attempt++) {
    const status = await call<{
      repos: { id: string; tasks: { id: string; taskDocsPath: string }[] }[];
    }>("GET", "/api/status");
    const task = status.repos
      .find((repo) => repo.id === repoId)
      ?.tasks.find((candidate) => candidate.taskDocsPath.endsWith("backlog-test"));
    if (task) return task.id;
    await Bun.sleep(500);
  }
  throw new Error("backlog-test task was not discovered after /api/refresh");
}

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}
