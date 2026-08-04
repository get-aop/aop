#!/usr/bin/env bun
/**
 * Runs this worktree's CLI against the dev stack.
 *
 * Same env as `bun dev` (isolated `~/.aop-dev` home, dev ports), so a released
 * `aop` install keeps its own `~/.aop` state.
 *
 * Usage:
 *   bun run dev:aop -- <aop args>
 */
import { join } from "node:path";
import { prepareDevEnv, ROOT_DIR } from "./dev-env.ts";

const aopHome = await prepareDevEnv();
const cliEntry = join(ROOT_DIR, "apps", "cli", "src", "main.ts");

const proc = Bun.spawn(["bun", "run", cliEntry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: { ...process.env, AOP_HOME: aopHome },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

process.exit(await proc.exited);
