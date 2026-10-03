#!/usr/bin/env bun
/**
 * Seeds the baseline every feature file assumes, into a started verify stack:
 * a fixture git repo registered as `repo`.
 *
 *   bun .claude/skills/verify/scripts/seed.ts [--name <run>] [--fake-runtime]
 *
 * Prints the ids as JSON and records them in the run's state.json under
 * `seed`. Re-running returns the recorded ids.
 *
 * `--fake-runtime` also registers the fake CLI
 * (packages/llm-provider/test-fixtures/fake-cli.ts) as the default runtime
 * configuration, so new chat sessions spawn it instead of the user's real
 * `claude`. Chat then costs nothing; script a reply with `[fake: ...]` in the
 * message (see that directory's README). Recorded under `fakeRuntime`.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const repoPath = await createFixtureRepo();
  const { repoId } = await call<{ repoId: string }>("POST", "/api/repos", { path: repoPath });
  return { repoId, repoPath };
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
  // New projects (and plain chats) start on the host's default runtime.
  await call("PUT", `${base}/default`, { runtimeId: provider.id });
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
