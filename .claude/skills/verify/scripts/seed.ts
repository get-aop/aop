#!/usr/bin/env bun
/**
 * Seeds the baseline every feature file assumes, into a started verify stack:
 * a fixture git repo, the `aop-default-gpt` workflow, one worker, and one
 * assigned DRAFT task (`backlog-test`, which creates hello.txt).
 *
 *   bun .claude/skills/verify/scripts/seed.ts [--name <run>] [--fake-runtime]
 *
 * Prints the ids as JSON and records them in the run's state.json under
 * `seed`. Re-running returns the recorded ids. Task packages have no HTTP
 * creation path outside the runtime's MCP tools, so the package is written
 * into `$AOP_HOME/repos/<repoId>/tasks/` and picked up by /api/refresh.
 *
 * `--fake-runtime` also registers the fake CLI
 * (packages/llm-provider/test-fixtures/fake-cli.ts) as the first runtime
 * configuration, so new chat sessions spawn it instead of the user's real
 * `claude`. Chat then costs nothing; script a reply with `[fake: ...]` in the
 * message (see that directory's README). Recorded under `fakeRuntime`.
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
const nameFlag = process.argv.indexOf("--name");
const runName = nameFlag === -1 ? "default" : (process.argv[nameFlag + 1] ?? "default");
const statePath = join(ROOT, ".work", "verify", runName, "state.json");
const withFakeRuntime = process.argv.includes("--fake-runtime");
const FAKE_CLI_PATH = join(ROOT, "packages/llm-provider/test-fixtures/fake-cli.ts");

interface Seed {
  repoId: string;
  repoPath: string;
  taskId: string;
  agentId: string;
  workflow: string;
}

interface FakeRuntime {
  providerId: string;
  command: string;
}

const state = JSON.parse(await readFile(statePath, "utf8")) as {
  dir: string;
  home: string;
  env: Record<string, string>;
  seed?: Seed;
  fakeRuntime?: FakeRuntime;
};
const api = state.env.AOP_LOCAL_SERVER_URL as string;

state.seed ??= await seedBaseline();
if (withFakeRuntime) state.fakeRuntime ??= await seedFakeRuntime();
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ ...state.seed, fakeRuntime: state.fakeRuntime }, null, 2)}\n`,
);

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

async function seedFakeRuntime(): Promise<FakeRuntime> {
  const base = "/api/runtime-configuration";
  const { provider } = await call<{ provider: { id: string } }>("POST", `${base}/providers`, {
    name: "Fake CLI",
    command: FAKE_CLI_PATH,
    driver: "claude-code",
  });
  await call("POST", `${base}/providers/${provider.id}/models`, {
    description: "Fake model",
    model: "fake-model",
    thinkingLevels: [],
  });
  // New sessions take the first runtime configuration in this order.
  const { providers } = await call<{ providers: { id: string }[] }>("GET", base);
  const others = providers.map(({ id }) => id).filter((id) => id !== provider.id);
  await call("PUT", `${base}/providers/order`, { providerIds: [provider.id, ...others] });
  return { providerId: provider.id, command: FAKE_CLI_PATH };
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
