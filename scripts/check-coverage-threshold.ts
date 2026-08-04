import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getLogger } from "@aop/infra";

export interface CoverageSummary {
  functions: number;
  lines: number;
}

export interface CoverageThresholds {
  functions: number;
  lines: number;
}

const DEFAULT_THRESHOLDS: CoverageThresholds = { functions: 0, lines: 0.7 };

export const parseLcovSummary = (content: string): CoverageSummary => {
  const totals = { foundFunctions: 0, hitFunctions: 0, foundLines: 0, hitLines: 0 };

  for (const line of content.split("\n")) {
    addLcovLine(totals, line);
  }

  return {
    functions: ratio(totals.hitFunctions, totals.foundFunctions),
    lines: ratio(totals.hitLines, totals.foundLines),
  };
};

export const checkCoverageThresholds = (
  summary: CoverageSummary,
  thresholds: CoverageThresholds = DEFAULT_THRESHOLDS,
): string[] => {
  const failures: string[] = [];
  if (summary.lines < thresholds.lines) {
    failures.push(
      `Line coverage ${formatPercent(summary.lines)} is below threshold ${formatPercent(thresholds.lines)}`,
    );
  }
  if (summary.functions < thresholds.functions) {
    failures.push(
      `Function coverage ${formatPercent(summary.functions)} is below threshold ${formatPercent(thresholds.functions)}`,
    );
  }
  return failures;
};

export const runCoverageThresholdCheck = (
  coveragePath = resolve(process.cwd(), "coverage", "lcov.info"),
  thresholds: CoverageThresholds = DEFAULT_THRESHOLDS,
): string[] => {
  const summary = parseLcovSummary(readFileSync(coveragePath, "utf8"));
  return checkCoverageThresholds(summary, thresholds);
};

const ratio = (hit: number, found: number): number => (found === 0 ? 1 : hit / found);

const formatPercent = (value: number): string => `${(value * 100).toFixed(2)}%`;

const addLcovLine = (
  totals: { foundFunctions: number; hitFunctions: number; foundLines: number; hitLines: number },
  line: string,
): void => {
  const [key, rawValue] = line.split(":");
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;

  if (key === "FNF") totals.foundFunctions += value;
  if (key === "FNH") totals.hitFunctions += value;
  if (key === "LF") totals.foundLines += value;
  if (key === "LH") totals.hitLines += value;
};

if (import.meta.main) {
  const logger = getLogger("scripts", "coverage-check");
  const failures = runCoverageThresholdCheck();
  for (const failure of failures) logger.error(failure);
  process.exit(failures.length > 0 ? 1 : 0);
}
