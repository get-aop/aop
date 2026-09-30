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
    case "NO_REPOSITORY":
      return "The thread has no repository, so it has no branch to publish";
    case "WORKTREE_FAILED":
      return `The thread's git worktree failed: ${error.message}`;
    case "NOTHING_TO_PUBLISH":
      return "The thread has no changes to open a pull request for";
    case "NO_PULL_REQUEST":
      return "The thread has no pull request";
    case "PULL_REQUEST_FAILED":
      return error.message;
    case "PULL_REQUEST_CLOSED":
      return "The thread's pull request was closed without merging; start a new thread for further work";
    case "PULL_REQUEST_MERGED":
      return "The thread's pull request already merged; start a new thread for further work";
    case "UNPUBLISHED_WORK":
      return "The thread has work its pull request does not include; open the pull request again to push it, then merge";
    case "INVALID_PATH":
      return "The path must be a file inside the thread's worktree";
    case "FILE_NOT_FOUND":
      return "The thread has no change to that file";
    case "THREAD_BUSY":
      return "The thread is busy: a turn is running, queued or waiting on a usage limit, or its pull request is landing; stop it or wait for it first";
  }
};
