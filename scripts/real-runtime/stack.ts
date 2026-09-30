import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createApi } from "./api.ts";
import { type GateLimits, limitEnv } from "./guard.ts";
import { prepareScratch } from "./scratch.ts";
import { shellOk } from "./shell.ts";
import { type HarnessState, harnessDir, ROOT, saveState, verifyDir } from "./state.ts";

/**
 * The isolated stack the harness drives: the verify skill's stack (its own AOP_HOME, database
 * and ports, never `~/.aop` or `~/.aop-dev`) started with the gate as the runtime command.
 */
const VERIFY_STACK = join(ROOT, ".claude/skills/verify/scripts/verify-stack.ts");
const GATE = join(ROOT, "scripts/real-runtime/claude-gate.ts");
const POLL_INTERVAL_MS = "4000";

export interface UpOptions {
  name: string;
  limits: GateLimits;
  /** A git wrapper that can reach github.com where plain git cannot; null uses plain git. */
  gitWrapper: string | null;
}

export const up = async (options: UpOptions): Promise<HarnessState> => {
  const dir = harnessDir(options.name);
  const gateDir = join(dir, "gate");
  const binDir = join(dir, "bin");
  await mkdir(gateDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  if (options.gitWrapper) await writeGitShim(binDir, options.gitWrapper);

  const env = stackEnv(options, gateDir, binDir);
  await shellOk(["bun", VERIFY_STACK, "start", "--name", options.name], { env });

  const verifyState = JSON.parse(
    await readFile(join(verifyDir(options.name), "state.json"), "utf8"),
  ) as { home: string; dir: string; env: Record<string, string> };
  const api = verifyState.env.AOP_LOCAL_SERVER_URL as string;
  const scratchPath = join(verifyState.dir, "fixtures", "scratch");
  await prepareScratch(options.gitWrapper ? [options.gitWrapper] : ["git"], scratchPath);
  const repoId = await registerRepo(api, scratchPath);
  await registerGateRuntime(api);

  const state: HarnessState = {
    name: options.name,
    dir,
    gateDir,
    api,
    dashboard: verifyState.env.AOP_DASHBOARD_URL as string,
    dbPath: verifyState.env.AOP_DB_PATH as string,
    home: verifyState.home,
    repoId,
    repoPath: scratchPath,
    gitWrapper: options.gitWrapper,
  };
  await saveState(state);
  return state;
};

export const down = async (name: string): Promise<void> => {
  await shellOk(["bun", VERIFY_STACK, "stop", "--name", name]);
};

const stackEnv = (options: UpOptions, gateDir: string, binDir: string): Record<string, string> => {
  const path = options.gitWrapper
    ? `${binDir}:${process.env.PATH ?? ""}`
    : (process.env.PATH ?? "");
  return {
    ...(process.env as Record<string, string>),
    PATH: path,
    AOP_REAL_RUNTIME: "1",
    AOP_REAL_RUNTIME_DIR: gateDir,
    AOP_PR_POLL_INTERVAL_MS: POLL_INTERVAL_MS,
    GIT_TERMINAL_PROMPT: "0",
    ...limitEnv(options.limits),
  };
};

// Specific to an environment whose shell cannot resolve github.com for plain git: `git` on the
// stack's PATH becomes the wrapper, with the shim's own directory removed from PATH first so the
// wrapper's `exec git` reaches the real one.
const writeGitShim = async (binDir: string, wrapper: string): Promise<void> => {
  const shim = join(binDir, "git");
  await writeFile(shim, `#!/bin/sh\nPATH=\${PATH#${binDir}:}\nexport PATH\nexec ${wrapper} "$@"\n`);
  await chmod(shim, 0o755);
};

const registerRepo = async (api: string, path: string): Promise<string> => {
  const { repoId } = await createApi(api).post<{ repoId: string }>("/api/repos", { path });
  return repoId;
};

/** The gate becomes the first runtime configuration, with `sonnet` as its model, so projects pick it up. */
const registerGateRuntime = async (api: string): Promise<void> => {
  const http = createApi(api);
  const base = "/api/runtime-configuration";
  const { provider } = await http.post<{ provider: { id: string } }>(`${base}/providers`, {
    name: "Real claude behind the gate",
    command: GATE,
    driver: "claude-code",
  });
  await http.post(`${base}/providers/${provider.id}/models`, {
    description: "Sonnet",
    model: "sonnet",
    thinkingLevels: ["low", "medium", "high"],
  });
  const { providers } = await http.get<{ providers: { id: string }[] }>(base);
  const others = providers.map(({ id }) => id).filter((id) => id !== provider.id);
  await http.put(`${base}/providers/order`, { providerIds: [provider.id, ...others] });
};
