import { mkdir } from "node:fs/promises";
import { aopPaths, resolveExecHost } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { sessionDtoFor } from "./session-dto.ts";
import type { UpdateChatWorkspaceResult, WorkspaceBindingFailure } from "./session-types.ts";
import {
  resolveSessionWorkspaceBinding,
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "./workspace-binding.ts";

export const updateChatWorkspace = async (
  ctx: LocalServerContext,
  sessionId: string,
  path: unknown,
): Promise<UpdateChatWorkspaceResult> => {
  ctx.sessionMutationLock.assertAllowed("workspace", { sessionId });
  try {
    const updated = await setSessionWorkspaceBinding(ctx, sessionId, normalizeWorkspacePath(path));
    if (!updated) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
    return { success: true, session: await sessionDtoFor(ctx, updated) };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return { success: false, error: workspaceBindingFailure(error) };
    }
    throw error;
  }
};

const normalizeWorkspacePath = (path: unknown): string | null => {
  if (path === null) return null;
  if (typeof path === "string" && path.trim()) return path.trim();
  throw new WorkspaceBindingError("An absolute workspace path is required");
};

export const resolveSessionWorkspaceResult = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<
  { success: true; workspace: string | null } | { success: false; error: WorkspaceBindingFailure }
> => {
  try {
    return { success: true, workspace: await resolveSessionWorkspaceBinding(ctx, session) };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return { success: false, error: workspaceBindingFailure(error) };
    }
    throw error;
  }
};

const workspaceBindingFailure = (error: WorkspaceBindingError): WorkspaceBindingFailure => ({
  code: "WORKSPACE_BINDING_ERROR",
  message: error.message,
  path: error.path,
  resettable: error.resettable,
});

export const readSessionGitLocation = async (
  workspacePath: string,
): Promise<{ worktreePath: string; branch: string | null }> => {
  if (!workspacePath) return { worktreePath: "", branch: null };

  try {
    const proc = resolveExecHost().spawn({
      cmd: ["git", "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
      cwd: workspacePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const outputPromise =
      proc.stdout instanceof ReadableStream
        ? new Response(proc.stdout).text()
        : Promise.resolve("");
    const [exitCode, output] = await Promise.all([proc.exited, outputPromise]);
    if (exitCode !== 0) return { worktreePath: workspacePath, branch: null };

    const [worktreePath, branch] = output.trim().split(/\r?\n/);
    return {
      worktreePath: worktreePath?.trim() || workspacePath,
      branch: branch?.trim() || null,
    };
  } catch {
    return { worktreePath: workspacePath, branch: null };
  }
};

export const ensureGeneralChatWorkspace = async (): Promise<string> => {
  const workspace = aopPaths.generalChatWorkspace();
  await mkdir(workspace, { recursive: true });
  return workspace;
};
