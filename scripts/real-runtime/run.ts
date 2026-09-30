#!/usr/bin/env bun
/**
 * Opt-in harness that checks Phase 1's assumptions against the real `claude` and a scratch
 * GitHub repository. It spends the person's Claude login, so it needs an explicit flag and is
 * never part of a default test run or of CI.
 *
 *   AOP_REAL_RUNTIME=1 bun scripts/real-runtime/run.ts up       [--name real-runtime]
 *   AOP_REAL_RUNTIME=1 bun scripts/real-runtime/run.ts scenario [--name real-runtime] [--only tools]
 *   AOP_REAL_RUNTIME=1 bun scripts/real-runtime/run.ts report   [--name real-runtime]
 *   bun scripts/real-runtime/run.ts down [--name real-runtime]
 *
 * `up` starts an isolated stack (its own AOP_HOME, database and ports) whose only runtime is the
 * gate, which passes every run to the real CLI and enforces a run cap, a cost cap and a wall-clock
 * limit for each run. `scenario` drives Sonnet at medium effort through a short session and leaves
 * one thread waiting on a question, so a browser can answer it (`--only tools` runs just that
 * thread: two real runs, one before the answer and one after); `report` judges the logs and
 * writes `.work/real-runtime/<name>/report.md`. Run `report` again after the browser test.
 *
 * Environment:
 *   AOP_REAL_RUNTIME_GIT_WRAPPER   a command that stands in for `git` where plain git cannot
 *                                  reach github.com (this machine's resolver); optional.
 *   AOP_REAL_RUNTIME_MAX_RUNS, AOP_REAL_RUNTIME_MAX_COST_USD, AOP_REAL_RUNTIME_RUN_TIMEOUT_MS
 *                                  the caps, read by `up` and enforced by the gate.
 */
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluate } from "./evaluate.ts";
import { assertRealRuntimeEnabled, readLimits } from "./guard.ts";
import { observe } from "./observe.ts";
import { renderReport } from "./report.ts";
import { runScenario } from "./scenario.ts";
import { runToolsScenario } from "./scenario-tools.ts";
import { down, up } from "./stack.ts";
import { loadState, saveState } from "./state.ts";

const [command = "help", ...rest] = process.argv.slice(2);
const nameAt = rest.indexOf("--name");
const name = nameAt === -1 ? "real-runtime" : (rest[nameAt + 1] ?? "real-runtime");
const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const COMMANDS: Record<string, () => Promise<number>> = {
  up: upCommand,
  scenario: scenarioCommand,
  report: reportCommand,
  down: downCommand,
};

process.exit(await (COMMANDS[command] ?? help)());

async function upCommand(): Promise<number> {
  assertRealRuntimeEnabled(process.env);
  const state = await up({
    name,
    limits: readLimits(process.env),
    gitWrapper: process.env.AOP_REAL_RUNTIME_GIT_WRAPPER ?? null,
  });
  say(`ready: dashboard ${state.dashboard}, api ${state.api}, scratch clone ${state.repoPath}`);
  return 0;
}

async function scenarioCommand(): Promise<number> {
  assertRealRuntimeEnabled(process.env);
  const only = rest.indexOf("--only");
  const focus = only === -1 ? null : rest[only + 1];
  const state = await (focus === "tools" ? runToolsScenario : runScenario)(
    await loadState(name),
    say,
  );
  say(`scenario finished; ${state.facts?.notes.length ?? 0} step(s) did not finish`);
  return 0;
}

async function reportCommand(): Promise<number> {
  assertRealRuntimeEnabled(process.env);
  const state = await loadState(name);
  if (!state.facts) {
    // Without a scenario there is nothing observed to judge, and a report of empty checks would read as a pass.
    say(`no scenario ran for "${name}"; run \`scenario\` before \`report\``);
    return 1;
  }
  const observed = await observe(state);
  const checks = evaluate(observed);
  const report = renderReport({
    name,
    generatedAt: new Date().toISOString(),
    observed,
    checks,
    gitShim: state.gitWrapper !== null,
  });
  await mkdir(join(state.dir, "logs"), { recursive: true });
  await writeFile(join(state.dir, "report.md"), report);
  await writeFile(
    join(state.dir, "report.json"),
    `${JSON.stringify({ checks, ledger: observed.ledger }, null, 2)}\n`,
  );
  await keepLogs(state.dir, observed);
  await saveState(state);
  say(`report: ${join(state.dir, "report.md")}`);
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

async function downCommand(): Promise<number> {
  await down(name);
  return 0;
}

// The stack's home is deleted by `down`, and the run logs live in it.
async function keepLogs(dir: string, observed: Awaited<ReturnType<typeof observe>>): Promise<void> {
  const sessions = [
    observed.coordinator,
    observed.editCoordinator,
    ...Object.values(observed.threads),
  ];
  for (const session of sessions) {
    for (const run of session.runs) {
      await cp(
        run.row.log_file_path,
        join(dir, "logs", `${session.label}-${run.row.id}.jsonl`),
      ).catch(() => undefined);
    }
  }
}

function help(): Promise<number> {
  say("Usage: run.ts <up|scenario|report|down> [--name <run>]; see the header of this file.");
  return Promise.resolve(command === "help" ? 0 : 1);
}
