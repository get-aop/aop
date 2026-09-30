import type { RunObservation, SessionObservation } from "./observe.ts";

/**
 * pass: the assumption held. warn: it held in effect but differs from what the code or docs say.
 * fail: it did not hold. info: a real shape was recorded and there is nothing to judge.
 * skipped: the part of the scenario it needs did not run.
 */
export type CheckStatus = "pass" | "warn" | "fail" | "info" | "skipped";

export interface CheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  details: string[];
}

export const result = (
  id: string,
  title: string,
  status: CheckStatus,
  summary: string,
  details: string[] = [],
): CheckResult => ({ id, title, status, summary, details });

/** `fail` when any problem was found, else `pass`; the problems become the summary. */
export const verdict = (
  id: string,
  title: string,
  problems: readonly string[],
  passSummary: string,
  details: string[] = [],
): CheckResult =>
  problems.length > 0
    ? result(id, title, "fail", problems.join("; "), details)
    : result(id, title, "pass", passSummary, details);

export const firstRun = (session: SessionObservation): RunObservation | undefined =>
  session.runs[0];

/** The value that follows `flag` in a run's argv: the real CLI's own variadic flags end at the next flag. */
export const valuesAfter = (argv: readonly string[], flag: string): string[] => {
  const at = argv.indexOf(flag);
  if (at === -1) return [];
  const values: string[] = [];
  for (const arg of argv.slice(at + 1)) {
    if (arg.startsWith("--")) break;
    values.push(arg);
  }
  return values;
};

export const clip = (text: string, max = 240): string =>
  text.length <= max ? text : `${text.slice(0, max)}...`;
