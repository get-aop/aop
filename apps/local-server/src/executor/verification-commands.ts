import type { StepCommand } from "@aop/common/protocol";
import type { ExecHost } from "@aop/infra";
import { resolveExecHost } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { createExecHostsService } from "../exec-hosts/service.ts";
import { recordVerificationEvidence } from "../runtime-events/verification-evidence.ts";
import { assertSafeVerifyCommands } from "../workflow/verification-command-safety.ts";
import type { ExecuteResult, ExecutorContext } from "./types.ts";

interface ApplyVerificationCommandsInput {
  ctx: LocalServerContext;
  executorCtx: ExecutorContext;
  executionId: string;
  stepId: string;
  stepCommand: StepCommand;
  result: ExecuteResult;
}

interface VerificationCommandResult {
  command: string;
  exitCode: number;
  startedAt: string;
  endedAt: string;
}

export const applyVerificationCommands = async (
  input: ApplyVerificationCommandsInput,
): Promise<ExecuteResult> => {
  const commands = assertSafeVerifyCommands(input.stepCommand.verifyCommands) ?? [];
  if (input.result.status !== "success" || commands.length === 0) {
    return input.result;
  }

  const host = await resolveVerificationHost(input.ctx, input.stepCommand, input.executorCtx);

  for (const command of commands) {
    const commandResult = await runVerificationCommand(
      command,
      input.executorCtx.worktreePath,
      host,
    );
    const passed = commandResult.exitCode === 0;
    const summary = buildVerificationSummary(commandResult);

    await recordVerificationEvidence(input.ctx, {
      taskId: input.executorCtx.task.id,
      executionId: input.executionId,
      stepExecutionId: input.stepId,
      evidence: {
        kind: classifyEvidenceKind(command, input.stepCommand.type),
        command,
        status: passed ? "passed" : "failed",
        exitCode: commandResult.exitCode,
        startedAt: commandResult.startedAt,
        endedAt: commandResult.endedAt,
        summary,
      },
    });

    if (!passed) {
      return {
        ...input.result,
        exitCode: commandResult.exitCode,
        status: "failure",
        signal: undefined,
        assistantOutput: appendVerificationFailure(input.result.assistantOutput, summary),
      };
    }
  }

  return input.result;
};

/** Remote steps verify on their bound host; local steps on the platform host. */
const resolveVerificationHost = async (
  ctx: LocalServerContext,
  stepCommand: StepCommand,
  executorCtx: ExecutorContext,
): Promise<ExecHost> => {
  const resolved = await createExecHostsService(ctx).resolveStepExecHost(
    stepCommand.agent?.execHostId,
    { worktreePath: executorCtx.worktreePath, taskId: executorCtx.task.id },
  );
  return resolved?.host ?? resolveExecHost();
};

const runVerificationCommand = async (
  command: string,
  cwd: string,
  host: ExecHost,
): Promise<VerificationCommandResult> => {
  const startedAt = new Date().toISOString();
  const proc = host.shell(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  await Promise.all([readStream(proc.stdout), readStream(proc.stderr)]);
  return {
    command,
    exitCode,
    startedAt,
    endedAt: new Date().toISOString(),
  };
};

const readStream = async (
  stream: ReadableStream<Uint8Array> | number | null | undefined,
): Promise<string> => {
  if (!(stream instanceof ReadableStream)) return "";
  return new Response(stream).text();
};

const classifyEvidenceKind = (
  command: string,
  stepType: string,
): "test_command" | "typecheck_command" | "lint_command" | "build_command" => {
  if (/\btype-?check\b/i.test(command)) return "typecheck_command";
  if (/\blint\b|\bbiome\b/i.test(command)) return "lint_command";
  if (/\bbuild\b/i.test(command)) return "build_command";
  if (stepType === "test" || /\btest\b/i.test(command)) return "test_command";
  return "test_command";
};

const buildVerificationSummary = (result: VerificationCommandResult): string =>
  result.exitCode === 0
    ? `Verification command passed: ${result.command}`
    : `Verification command failed (${result.exitCode}): ${result.command}`;

const appendVerificationFailure = (assistantOutput: string, summary: string): string => {
  const trimmed = assistantOutput.trim();
  return trimmed ? `${trimmed}\n\n${summary}` : summary;
};
