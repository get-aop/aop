import type { ThreadError } from "../thread/types.ts";
import type { MemoryResult } from "./memory-service.ts";
import type { ProjectError } from "./service.ts";

/** Every way a project, thread or memory service can refuse. Routes and MCP tools both report them. */
export type ServiceError =
  | ProjectError
  | ThreadError
  | Extract<MemoryResult<unknown>, { success: false }>["error"];

export const describeServiceError = (error: ServiceError): string => {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return "Project not found";
    case "THREAD_NOT_FOUND":
      return "Thread not found";
    case "MEMORY_FILE_NOT_FOUND":
      return "Memory file not found";
    case "REPO_NOT_FOUND":
      return `Repository not found: ${error.repoId}`;
    case "REPO_IN_USE":
      return `A thread still works in repository ${error.repoId}; stop and delete it first`;
    case "INVALID_TRANSITION":
      return `Cannot ${error.action} a ${error.status} project`;
    case "PROJECT_NOT_ACTIVE":
      return `The project is ${error.status}`;
    case "SESSION_BUSY":
      return `Session ${error.sessionId} is still running`;
    case "INVALID_MESSAGE":
      return error.message;
    case "REPO_REQUIRED":
      return `This project has several repositories; pick one of: ${error.repoIds.join(", ")}`;
    case "REPO_NOT_IN_PROJECT":
      return `Repository ${error.repoId} is not one of this project's repositories: ${error.repoIds.join(", ") || "(none)"}`;
    case "REPO_UNAVAILABLE":
      return error.message;
    case "NOT_WAITING":
      return "The thread is not waiting on an answer";
    case "NOT_RATE_LIMITED":
      return "The thread is not waiting on a rate limit";
    case "SEND_FAILED":
      return `The message could not be sent (${error.reason})`;
  }
};
