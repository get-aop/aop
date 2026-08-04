import type { TaskExecutionModel } from "@aop/common";
import type { RunUsage } from "@aop/llm-provider";
import type { StepExecution, Task } from "../db/schema.ts";
import type { TaskRepositoryScope } from "../task/execution-model.ts";

export type StepWithTask = StepExecution & { task_id: string };

export interface ExecuteResult {
  exitCode: number;
  sessionId?: string;
  status: "success" | "failure" | "timeout";
  signal?: string;
  pauseContext?: string;
  assistantOutput: string;
  usage?: RunUsage;
  durationMs?: number;
}

export interface ExecutorContext {
  task: Task;
  repoId: string;
  repoPath: string;
  changePath: string;
  worktreePath: string;
  logsDir: string;
  timeoutSecs: number;
  fastMode: boolean;
  repositories?: TaskRepositoryScope[];
  executionModel?: TaskExecutionModel | null;
}
