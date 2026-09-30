import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../..");

/** What the phases hand each other, kept on disk so `scenario` and `finish` can be separate commands. */
export interface HarnessState {
  name: string;
  /** `.work/real-runtime/<name>`: ledger, copied logs, reports. */
  dir: string;
  /** The gate's directory inside `dir`. */
  gateDir: string;
  api: string;
  dashboard: string;
  dbPath: string;
  home: string;
  repoId: string;
  repoPath: string;
  /** The environment-specific git wrapper the stack's PATH shim calls, or null. */
  gitWrapper: string | null;
  projects?: { main: string; edit: string };
  coordinatorSessionId?: string;
  threads?: Record<ThreadLabel, string>;
  /** Filled by the scenario as it goes: what the checks need and the run log cannot show. */
  facts?: ScenarioFacts;
}

export type ThreadLabel = "pr" | "ask" | "browser" | "edit";

export interface ScenarioFacts {
  pullRequestNumber: number | null;
  pullRequestUrl: string | null;
  /** The user message of the second coordinator turn, to find its run. */
  codewordMessageId?: string;
  /** Which scenario ran; the full one when absent. The focused `tools` scenario has its own checks. */
  scenario?: "full" | "tools";
  startedAt: string;
  finishedAt?: string;
  notes: string[];
}

export const harnessDir = (name: string): string => join(ROOT, ".work", "real-runtime", name);

export const verifyDir = (name: string): string => join(ROOT, ".work", "verify", name);

export const loadState = async (name: string): Promise<HarnessState> => {
  const path = join(harnessDir(name), "harness.json");
  if (!existsSync(path)) throw new Error(`No harness "${name}" (${path}). Run up first.`);
  return JSON.parse(await readFile(path, "utf8")) as HarnessState;
};

export const saveState = async (state: HarnessState): Promise<void> => {
  await mkdir(state.dir, { recursive: true });
  await writeFile(join(state.dir, "harness.json"), `${JSON.stringify(state, null, 2)}\n`);
};
