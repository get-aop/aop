import { z } from "zod";
import {
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import { listPlatformRepos } from "./platform-query.ts";
import { defineTool, McpToolError, textResult } from "./registry.ts";

/** Tools for a plain chat session, one that belongs to no project. */

export const listReposTool = defineTool({
  name: "aop_list_repos",
  description: "List registered repositories.",
  input: z.object({}),
  handler: async (_args, { ctx }) => textResult({ repos: await listPlatformRepos(ctx) }),
});

export const setChatWorkspaceTool = defineTool({
  name: "aop_set_chat_workspace",
  description:
    "Bind a chat session to a Git worktree path. Use after creating or switching to a Git worktree.",
  input: z.object({
    sessionId: z.string().trim().min(1),
    absolutePath: z.string().trim().min(1),
  }),
  handler: async (args, { ctx }) => {
    try {
      const session = await setSessionWorkspaceBinding(ctx, args.sessionId, args.absolutePath);
      if (!session) throw new McpToolError("Chat session not found", "SESSION_NOT_FOUND");
      return textResult({ sessionId: session.id, workspacePath: session.workspace_path });
    } catch (error) {
      if (error instanceof WorkspaceBindingError) {
        throw new McpToolError(error.message, "INVALID_WORKSPACE");
      }
      throw error;
    }
  },
});
