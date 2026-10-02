import type { ProjectStatus } from "@aop/common";

/** Every way the routine service can refuse. Routes and MCP tools both report them. */
export type RoutineError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "ROUTINE_NOT_FOUND" }
  | { code: "ROUTINE_TOO_FREQUENT"; gapMinutes: number; minIntervalMinutes: number }
  | { code: "ROUTINE_LIMIT"; maxActive: number }
  | { code: "ROUTINE_BUSY" }
  | { code: "INVALID_ROUTINE"; message: string }
  | { code: "REPO_REQUIRED"; repoIds: string[] }
  | { code: "REPO_NOT_IN_PROJECT"; repoId: string; repoIds: string[] }
  | { code: "PROJECT_NOT_ACTIVE"; status: ProjectStatus };

export type RoutineResult<T> = ({ success: true } & T) | { success: false; error: RoutineError };
