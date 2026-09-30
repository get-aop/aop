import type { CheckResult, CheckStatus } from "./check-types.ts";
import type { Observed } from "./observe.ts";

const ORDER: CheckStatus[] = ["fail", "warn", "skipped", "info", "pass"];

export interface ReportInput {
  name: string;
  generatedAt: string;
  observed: Observed;
  checks: CheckResult[];
  /** True when a git wrapper sat first on the stack's PATH because plain git cannot reach GitHub here. */
  gitShim: boolean;
}

export const countByStatus = (checks: readonly CheckResult[]): Record<CheckStatus, number> => {
  const counts = { pass: 0, warn: 0, fail: 0, info: 0, skipped: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
};

/** The pass/fail report: a table first, then each check's evidence, then what the run spent. */
export const renderReport = (input: ReportInput): string => {
  const { observed, checks } = input;
  const counts = countByStatus(checks);
  const lines = [
    `# Real-runtime harness report: ${input.name}`,
    "",
    `Generated ${input.generatedAt}. Runtime: the real \`claude\` (Sonnet, medium effort) behind the harness gate, on an isolated stack.`,
    "",
    `Result: ${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail, ${counts.info} info, ${counts.skipped} skipped.`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
    ...checks.map(
      (check) => `| ${check.title} | ${check.status.toUpperCase()} | ${cell(check.summary)} |`,
    ),
    "",
    "## Spend",
    "",
    `- Real claude runs started: ${observed.ledger.runs}`,
    `- CLI turns (sum of each result's num_turns): ${observed.ledger.cliTurns}`,
    `- Reported cost: $${observed.ledger.costUsd.toFixed(3)}`,
    `- Runs killed by the wall-clock limit: ${observed.ledger.timedOut}`,
    "",
    "## Environment",
    "",
    input.gitShim
      ? "- A `git` shim sat first on the stack's PATH and exec'd this machine's git wrapper (pinned address plus gh credentials), because this machine's shell cannot resolve github.com for plain git. This is specific to this environment, not a product requirement."
      : "- Plain git reached GitHub; no shim was used.",
    `- GitHub: the private scratch repository; pull request ${observed.facts.pullRequestUrl ?? "none"}.`,
    "",
    ...ordered(checks).flatMap(section),
    ...notes(observed),
  ];
  return `${lines.join("\n")}\n`;
};

const ordered = (checks: readonly CheckResult[]): CheckResult[] =>
  [...checks].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

const section = (check: CheckResult): string[] => [
  `## ${check.status.toUpperCase()}: ${check.title}`,
  "",
  check.summary,
  "",
  ...check.details.map((detail) => `- ${detail.replace(/\n/g, " ")}`),
  "",
];

const notes = (observed: Observed): string[] => [
  ...(observed.facts.notes.length > 0
    ? [
        "## Scenario steps that did not finish",
        "",
        ...observed.facts.notes.map((note) => `- ${note}`),
        "",
      ]
    : []),
  ...(observed.gaps.length > 0
    ? ["## Observations that could not be read", "", ...observed.gaps.map((gap) => `- ${gap}`), ""]
    : []),
];

const cell = (text: string): string => text.replace(/\|/g, "/").replace(/\n/g, " ");
