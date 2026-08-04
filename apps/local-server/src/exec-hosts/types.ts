import type { ExecHostConfig } from "@aop/common";

export type { ExecHostConfig };

export interface ExecHostCliProbe {
  id: string;
  installed: boolean;
  version: string | null;
  authenticated: boolean;
}

export interface ExecHostTestResult {
  reachable: boolean;
  latencyMs: number | null;
  rsync: boolean;
  git: boolean;
  clis: ExecHostCliProbe[];
  error?: string;
}

export interface CreateSshExecHostForTaskInput {
  worktreePath: string;
  taskId: string;
}
