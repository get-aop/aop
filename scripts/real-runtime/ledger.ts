import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The record of every real `claude` run the gate started: one `start` line when it spawns and
 * one `end` line when it exits. It is the source of the run and turn counts in the report, and
 * what the gate checks its caps against.
 */
export type LedgerEntry =
  | { event: "start"; n: number; pid: number; at: string; cwd: string; argv: string[] }
  | {
      event: "end";
      n: number;
      exitCode: number;
      durationMs: number;
      timedOut: boolean;
      costUsd: number | null;
      numTurns: number | null;
      sessionId: string | null;
    };

export interface LedgerSummary {
  runs: number;
  /** Turns the CLI itself reports (`num_turns` of each result): model round trips, tool calls included. */
  cliTurns: number;
  costUsd: number;
  timedOut: number;
}

export const ledgerPath = (dir: string): string => join(dir, "ledger.jsonl");

export const appendLedger = (dir: string, entry: LedgerEntry): void => {
  appendFileSync(ledgerPath(dir), `${JSON.stringify(entry)}\n`);
};

export const readLedger = (dir: string): LedgerEntry[] => {
  const path = ledgerPath(dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as LedgerEntry);
};

export const summarizeLedger = (entries: readonly LedgerEntry[]): LedgerSummary => {
  const summary: LedgerSummary = { runs: 0, cliTurns: 0, costUsd: 0, timedOut: 0 };
  for (const entry of entries) {
    if (entry.event === "start") {
      summary.runs += 1;
      continue;
    }
    summary.cliTurns += entry.numTurns ?? 0;
    summary.costUsd += entry.costUsd ?? 0;
    if (entry.timedOut) summary.timedOut += 1;
  }
  return summary;
};

export const nextRunNumber = (entries: readonly LedgerEntry[]): number =>
  entries.filter((entry) => entry.event === "start").length + 1;
