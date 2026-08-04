import { aopPaths, generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { scaffoldTaskFromBrainstorm, toTaskSlug } from "../task-docs/scaffold.ts";

export interface RunTaskInput {
  changeName: string;
  cwd: string;
}

export interface RunTaskSuccess {
  status: "success";
  changeName: string;
  warning?: string;
}

export interface RunTaskError {
  status: "error";
  error: string;
  code: "internal";
}

export type RunTaskResponse = RunTaskSuccess | RunTaskError;

interface RunTaskService {
  run: (input: RunTaskInput) => Promise<RunTaskResponse>;
}

interface RunTaskServiceDeps {
  backgroundTimeoutMs?: number;
}

export const createRunTaskService = (
  ctx: LocalServerContext,
  _deps: RunTaskServiceDeps = {},
): RunTaskService => {
  return {
    run: async (input: RunTaskInput): Promise<RunTaskResponse> => {
      const changeName = toTaskSlug(input.changeName);

      try {
        const repo = await ctx.repoRepository.getByPath(input.cwd);
        const result = await scaffoldTaskFromBrainstorm(repo?.id ?? null, input.cwd, changeName, {
          title: input.changeName,
          description: input.changeName,
          requirements: [input.changeName],
          acceptanceCriteria: [`Complete ${input.changeName}`],
        });

        if (repo) {
          await ctx.taskRepository.createIdempotent({
            id: generateTypeId("task"),
            repo_id: repo.id,
            change_path: `${aopPaths.relativeTaskDocs()}/${result.taskName}`,
            status: "DRAFT",
            worktree_path: null,
            ready_at: null,
          });
        }

        return {
          status: "success",
          changeName: result.taskName,
        };
      } catch (error) {
        return {
          status: "error",
          code: "internal",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
};
