import { ProjectUsageSchema } from "@aop/common";
import { type CheckResult, clip, result, verdict } from "./check-types.ts";
import {
  asFields,
  type Fields,
  flagValue,
  initOf,
  rateLimitEvents,
  resultOf,
  shapeOf,
} from "./log-shapes.ts";
import type { Observed, RunObservation } from "./observe.ts";

export const allRuns = (observed: Observed): RunObservation[] => [
  ...observed.coordinator.runs,
  ...observed.editCoordinator.runs,
  ...Object.values(observed.threads).flatMap((thread) => thread.runs),
];

/** The user's rule for this ticket: every role runs on Sonnet at medium effort, set through the project settings. */
export const modelAndEffort = (observed: Observed): CheckResult => {
  const id = "model-and-effort";
  const title = "Every run is Sonnet at medium effort, and the runs stay inside the caps";
  // A run the gate refused (past its cap) never reached the real CLI, so the ledger has no
  // command line for it; it is not a run on the wrong model.
  const all = allRuns(observed);
  const runs = all.filter((run) => run.argv.length > 0);
  const refused = all.length - runs.length;
  const problems: string[] = runs.flatMap(modelProblems);
  if (runs.length === 0) problems.push("no run was recorded");
  const models = [...new Set(runs.map((run) => initOf(run.events)?.model ?? "unreported"))];
  const { ledger } = observed;
  const details = [
    `models the CLI reported: ${models.join(", ")}`,
    ...(refused > 0
      ? [`${refused} run(s) never reached the real CLI (refused by the gate's caps)`]
      : []),
    `real claude runs started (gate ledger): ${ledger.runs}; CLI turns (sum of num_turns): ${ledger.cliTurns}; cost $${ledger.costUsd.toFixed(3)}; runs killed by the wall-clock limit: ${ledger.timedOut}`,
  ];
  return verdict(
    id,
    title,
    [...new Set(problems)].slice(0, 6),
    "all runs passed --model sonnet --effort medium",
    details,
  );
};

const modelProblems = (run: RunObservation): string[] => {
  const where = `run ${run.row.id}`;
  const reported = initOf(run.events)?.model ?? "";
  return [
    ...(flagValue(run.argv, "--model") === "sonnet"
      ? []
      : [`${where} did not pass --model sonnet`]),
    ...(flagValue(run.argv, "--effort") === "medium"
      ? []
      : [`${where} did not pass --effort medium`]),
    ...(reported && !/sonnet/i.test(reported) ? [`${where} ran on ${reported}`] : []),
  ];
};

const TOKEN_KEYS = [
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
];
const MODEL_USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "costUSD",
];

/** The `result` event's usage, modelUsage and cost, and the usage numbers the API shows from them. */
export const usageShapes = (observed: Observed): CheckResult => {
  const id = "usage-shapes";
  const title = "usage, modelUsage and total_cost_usd have the shape the usage parser reads";
  const withResult = allRuns(observed).flatMap((run) => {
    const end = resultOf(run.events);
    return end ? [end] : [];
  });
  const sample = withResult[0];
  if (!sample) return result(id, title, "fail", "no run ended with a result event");

  const problems: string[] = [];
  const usage = asFields(sample.usage);
  const missing = TOKEN_KEYS.filter((key) => typeof usage?.[key] !== "number");
  if (missing.length > 0) problems.push(`usage lacks ${missing.join(", ")}`);
  if (typeof sample.total_cost_usd !== "number") problems.push("total_cost_usd is not a number");
  problems.push(...modelUsageProblems(sample));
  problems.push(...apiUsageProblems(observed));

  const details = [
    `result shape: ${clip(JSON.stringify(shapeOf(sample)), 1500)}`,
    `coordinator usage via the API: ${clip(JSON.stringify(observed.coordinator.usage ?? null), 400)}`,
    `project usage via the API: ${clip(JSON.stringify(observed.projectUsage ?? null), 400)}`,
  ];
  return verdict(
    id,
    title,
    problems,
    `${withResult.length} results carry usage, modelUsage and cost; the API reports them`,
    details,
  );
};

const modelUsageProblems = (end: Fields): string[] => {
  const perModel = asFields(end.modelUsage);
  const entries = Object.entries(perModel ?? {});
  if (entries.length === 0) return ["modelUsage is missing or empty"];
  return entries.flatMap(([model, usage]) => {
    const missing = MODEL_USAGE_KEYS.filter((key) => typeof asFields(usage)?.[key] !== "number");
    return missing.length > 0 ? [`modelUsage[${model}] lacks ${missing.join(", ")}`] : [];
  });
};

const apiUsageProblems = (observed: Observed): string[] => {
  const parsed = ProjectUsageSchema.safeParse(observed.projectUsage);
  if (!parsed.success)
    return [
      `the project usage API answered a shape the dashboard cannot read: ${clip(parsed.error.message, 200)}`,
    ];
  const { totals, byModel } = parsed.data;
  const problems: string[] = [];
  if (totals.outputTokens === 0 || totals.cacheReadTokens + totals.inputTokens === 0)
    problems.push("the project usage totals hold no tokens");
  if (!totals.costUsd) problems.push("the project usage totals hold no cost");
  if (!byModel.some((entry) => /sonnet/i.test(entry.model)))
    problems.push("no usage row names a sonnet model");
  return problems;
};

/** A usage-limit hit cannot be provoked on purpose; this records every rate_limit_event the real CLI wrote. */
export const rateLimitShapes = (observed: Observed): CheckResult => {
  const id = "rate-limit-shapes";
  const title = "rate_limit_event and limit results, as the real CLI writes them";
  const runs = allRuns(observed);
  const events = runs.flatMap((run) => rateLimitEvents(run.events));
  const limited = runs.flatMap((run) => {
    const end = resultOf(run.events);
    return end && (typeof end.api_error_status === "number" || end.is_error === true) ? [end] : [];
  });
  const details = [
    `${events.length} rate_limit_event(s) in ${runs.length} run logs`,
    ...[...new Map(events.map((event) => [JSON.stringify(shapeOf(event)), event])).entries()]
      .slice(0, 3)
      .map(
        ([shape, event]) => `shape ${clip(shape, 500)}; sample ${clip(JSON.stringify(event), 400)}`,
      ),
    ...limited.slice(0, 2).map((end) => `error result: ${clip(JSON.stringify(end), 500)}`),
  ];
  if (events.length === 0) {
    return result(
      id,
      title,
      "info",
      "no limit event was written, and no limit was hit; the fake's limit shape stays unverified",
      details,
    );
  }
  const problems = events.flatMap((event) => {
    const info = asFields(event.rate_limit_info);
    if (!info) return ["a rate_limit_event has no rate_limit_info"];
    return ["status", "resetsAt", "rateLimitType"]
      .filter((key) => !(key in info))
      .map((key) => `rate_limit_info lacks ${key}`);
  });
  return verdict(
    id,
    title,
    [...new Set(problems)],
    "every rate_limit_event has status, resetsAt and rateLimitType",
    details,
  );
};
