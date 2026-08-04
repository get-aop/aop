import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ChatRuntimeActionSelection } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import { createTemplateContext, resolveTemplate } from "../orchestrator/sync/template-resolver.ts";
import { createTemplateLoader } from "../prompts/template-loader.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { getStepBlock } from "../workflow-engine/step-library.ts";
import {
  delegationOutcomeFor,
  finishDelegationRun,
  relayDelegationProgress,
  startDelegationRun,
} from "./delegation-runs.ts";
import { RUNTIME_DELEGATION_EXECUTION_CONTRACT } from "./runtime-delegation-contract.ts";
import {
  type CreateProviderFn,
  createSessionRunLogPath,
  type RuntimeRunResult,
  runSessionPrompt,
  type SessionRunRegistration,
} from "./runtime-engine.ts";

const BLOCK_BY_INTENT = {
  implement: "implement",
  review: "nuclear_review",
  audit: "audit",
  test: "run-tests",
  security: "security-review",
} as const;

interface RuntimeActionPlanInput {
  ctx: LocalServerContext;
  session: ChatSession;
  request: string;
  repoPath: string;
  actions: ChatRuntimeActionSelection[];
  createProviderFn?: CreateProviderFn;
  chatRun?: ChatRun;
  registration?: SessionRunRegistration;
  consolidate: (
    main: RuntimeRunResult,
    reports: RuntimeActionReport[],
  ) => Promise<RuntimeRunResult>;
}

export interface RuntimeActionReport {
  action: ChatRuntimeActionSelection;
  result: RuntimeRunResult;
}

export const runRuntimeActionPlan = async (
  input: RuntimeActionPlanInput,
): Promise<RuntimeRunResult> => {
  const baseline = await gitOutput(input.repoPath, ["rev-parse", "HEAD"]);
  const branch = await gitOutput(input.repoPath, ["branch", "--show-current"]);
  const plan = { ...input, baseline, branch };
  const writer = input.actions.find((action) => action.phase === "writer");
  const main = writer ? await runAction(plan, writer, "") : completedAction();
  if (main.failed || main.interrupted) return main;

  const reports = await Promise.all(
    input.actions
      .filter((action) => action.phase === "post-work")
      .map(async (action) => ({ action, result: await runAction(plan, action, main.text) })),
  );
  return input.consolidate(main, reports);
};

export const formatRuntimeActionReports = (
  main: RuntimeRunResult,
  reports: RuntimeActionReport[],
  hasWriter: boolean,
): string =>
  [
    hasWriter
      ? "The requested writer and Quick Actions have completed."
      : "The requested Quick Actions have completed.",
    hasWriter
      ? "Do not redo the implementation. Summarize the resulting repository state and the labeled reports below."
      : "Do not repeat the Quick Actions. Summarize the labeled reports below.",
    hasWriter ? `MAIN RESULT:\n${main.text}` : "",
    ...reports.map(
      ({ action, result }) =>
        `${action.intent.toUpperCase()} (${action.runtimeConfigurationName ?? action.provider}, ${action.model}, ${action.reasoning}):\n${result.text}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

const runAction = async (
  input: RuntimeActionPlanInput & { baseline: string; branch: string },
  action: ChatRuntimeActionSelection,
  mainResult: string,
): Promise<RuntimeRunResult> => {
  const configurations = await createRuntimeConfigurationRepository(input.ctx.db).list();
  const configuration = configurations.find((item) => item.id === action.runtimeConfigurationId);
  if (!configuration) return failedAction("Runtime configuration is no longer available");
  const block = getStepBlock(BLOCK_BY_INTENT[action.intent]);
  if (!block) return failedAction(`Shared workflow block is missing for ${action.intent}`);
  const template = await createTemplateLoader().load(block.promptTemplate);
  const actionContext = await createActionContext(input, action);
  const resolvedTemplate = resolveTemplate(
    template,
    createTemplateContext({
      worktreePath: input.repoPath,
      worktreeBranch: input.branch,
      taskId: actionContext.id,
      changePath: actionContext.dir,
      docsDir: actionContext.dir,
      repositories: input.session.repo_id
        ? [
            {
              repoId: input.session.repo_id,
              assignment: "primary",
              path: input.repoPath,
              writable: action.phase === "writer",
            },
          ]
        : [],
      stepType: block.type,
      executionId: actionContext.id,
      iteration: 1,
      signals: block.signals,
      input: actionInput(input, action, mainResult),
    }),
  );
  const specialist: ChatSession = {
    ...input.session,
    runtime: action.provider,
    runtime_configuration_id: configuration.id,
    runtime_alias: configuration.command,
    model: action.model,
    reasoning_effort: action.reasoning,
    fast_mode: action.fastMode,
    runtime_session_id: null,
  };
  const actionLogPath = await createSessionRunLogPath(input.session.id);
  const delegationRun = input.chatRun
    ? await startDelegationRun(input.ctx, input.chatRun, {
        kind: "quick-action",
        label: runtimeActionLabel(action.intent),
        runtime: action.provider,
        runtimeAlias: configuration.command,
        runtimeConfigurationId: configuration.id,
        model: action.model,
        reasoning: action.reasoning,
        fastMode: action.fastMode ?? false,
        logFilePath: actionLogPath,
      })
    : null;
  const result = await runSessionPrompt({
    session: specialist,
    repoPath: input.repoPath,
    prompt: actionPrompt(
      action,
      resolvedTemplate,
      input.request,
      mainResult,
      input.baseline,
      input.actions.some((candidate) => candidate.phase === "writer"),
    ),
    registration: input.registration,
    logFilePath: actionLogPath,
    createProviderFn: input.createProviderFn,
    onProgress:
      delegationRun && input.chatRun
        ? relayDelegationProgress(input.ctx, input.chatRun, delegationRun.id)
        : undefined,
  });
  if (delegationRun && input.chatRun) {
    await finishDelegationRun(
      input.ctx,
      input.chatRun.id,
      delegationRun.id,
      delegationOutcomeFor(result),
    );
  }
  return result;
};

const runtimeActionLabel = (intent: ChatRuntimeActionSelection["intent"]): string =>
  `${intent.charAt(0).toUpperCase()}${intent.slice(1)}`;

const actionPrompt = (
  action: ChatRuntimeActionSelection,
  template: string,
  request: string,
  mainResult: string,
  baseline: string,
  hasWriter: boolean,
): string =>
  [
    `Quick Action intent: ${action.intent}. This uses shared Workflow block '${BLOCK_BY_INTENT[action.intent]}'.`,
    RUNTIME_DELEGATION_EXECUTION_CONTRACT,
    action.phase === "post-work"
      ? postWorkInstruction(baseline, hasWriter)
      : "Perform the writer phase for the original request.",
    template,
    `ORIGINAL REQUEST:\n${request}`,
    mainResult ? `WRITER/MAIN RESULT:\n${mainResult}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const postWorkInstruction = (baseline: string, hasWriter: boolean): string =>
  [
    hasWriter
      ? "The writer phase is complete. Inspect its resulting repository state."
      : "No writer action was requested. Inspect the current repository state directly.",
    "Do not implement the original request again. This action must not edit source files. It may write only its isolated report artifacts.",
    `The fixed git baseline captured before the Quick Actions ran is ${baseline}. Review committed and uncommitted changes since that baseline, including git status for untracked files.`,
  ].join(" ");

const createActionContext = async (
  input: RuntimeActionPlanInput,
  action: ChatRuntimeActionSelection,
): Promise<{ id: string; dir: string }> => {
  const id = `${action.intent}-${crypto.randomUUID()}`;
  const dir = join(aopPaths.home(), "chat-actions", input.session.id, id);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    Bun.write(
      join(dir, "task.md"),
      `# Quick Action Task\n\n${input.request}\n\nRuntime action: ${action.intent}\n`,
    ),
    Bun.write(
      join(dir, "prd.md"),
      `# Product Context\n\nComplete the user's chat request without expanding its scope.\n\n## Request\n\n${input.request}\n`,
    ),
    Bun.write(
      join(dir, "issues.md"),
      `# Implementation Brief\n\n- [ ] ${input.request}\n- [ ] Preserve existing behavior outside this request.\n`,
    ),
  ]);
  return { id, dir };
};

const actionInput = (
  input: RuntimeActionPlanInput & { baseline: string },
  action: ChatRuntimeActionSelection,
  mainResult: string,
): string =>
  [
    `Original request: ${input.request}`,
    `Quick Action: ${action.intent}`,
    `Fixed repository baseline: ${input.baseline}`,
    `Diff command: git diff ${input.baseline}`,
    "Also inspect git status --short so untracked changes are included.",
    mainResult ? `Writer/main result: ${mainResult}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

const gitOutput = async (repoPath: string, args: string[]): Promise<string> => {
  const process = Bun.spawn(["git", "-C", repoPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) return "unavailable";
  return stdout.trim() || "unavailable";
};

const failedAction = (text: string): RuntimeRunResult => ({
  text,
  runtimeSessionId: null,
  failed: true,
  aborted: false,
  interrupted: false,
});

const completedAction = (): RuntimeRunResult => ({
  text: "",
  runtimeSessionId: null,
  failed: false,
  aborted: false,
  interrupted: false,
});
