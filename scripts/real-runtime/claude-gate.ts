#!/usr/bin/env bun
/**
 * The runtime command of the real-runtime harness's stack: see gate.ts. AOP runs it as if it were
 * `claude`; it is never used by a default stack, a test or CI.
 */
import { runGate } from "./gate.ts";

process.exit(
  await runGate(process.argv.slice(2), process.env, process.cwd(), (chunk) => {
    process.stdout.write(chunk);
  }),
);
