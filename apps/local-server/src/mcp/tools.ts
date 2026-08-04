import type { ChatActionPayload } from "@aop/common";
import {
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import { listPlatformRepos } from "./platform-query.ts";
import { McpToolError } from "./tools-errors.ts";

export { McpToolError } from "./tools-errors.ts";

export type McpToolName = "aop_list_workflows" | "aop_list_repos" | "aop_set_chat_workspace";

export interface McpToolDefinition {
  name: McpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  /** JSON-serializable content returned to the agent. */
  content: unknown;
  /** When set, the host can attach this as assistant message.action. */
  action?: ChatActionPayload;
  /** True when this is a propose tool (never mutates). */
  isProposal: boolean;
}

export interface McpToolCallContext {
  chatSessionId?: string;
}

export const listAopMcpTools = (): McpToolDefinition[] => [
  {
    name: "aop_list_workflows",
    description: "List available workflow ids.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "aop_list_repos",
    description: "List registered repositories.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "aop_set_chat_workspace",
    description:
      "Bind a chat session to a Git worktree path. Use after creating or switching to a Git worktree.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        absolutePath: { type: "string" },
      },
      required: ["sessionId", "absolutePath"],
    },
  },
];

export const isAopMcpTool = (name: string): name is McpToolName =>
  name === "aop_list_workflows" || name === "aop_list_repos" || name === "aop_set_chat_workspace";

export const isProposeTool = (_name: string): boolean => false;

export const callAopMcpTool = async (
  ctx: LocalServerContext,
  name: string,
  args: Record<string, unknown> = {},
  _toolContext: McpToolCallContext = {},
): Promise<McpToolResult> => {
  if (!isAopMcpTool(name)) {
    throw new McpToolError(`Unknown tool: ${name}`, "UNKNOWN_TOOL");
  }

  switch (name) {
    case "aop_list_workflows":
      return { content: await readWorkflows(ctx), isProposal: false };
    case "aop_list_repos":
      return { content: await readRepos(ctx), isProposal: false };
    case "aop_set_chat_workspace":
      return setChatWorkspace(ctx, args);
  }
};

const setChatWorkspace = async (
  ctx: LocalServerContext,
  args: Record<string, unknown>,
): Promise<McpToolResult> => {
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  const absolutePath = typeof args.absolutePath === "string" ? args.absolutePath.trim() : "";
  if (!sessionId || !absolutePath) {
    throw new McpToolError("sessionId and absolutePath are required", "INVALID_INPUT");
  }
  try {
    const session = await setSessionWorkspaceBinding(ctx, sessionId, absolutePath);
    if (!session) throw new McpToolError("Chat session not found", "SESSION_NOT_FOUND");
    return {
      content: { sessionId: session.id, workspacePath: session.workspace_path },
      isProposal: false,
    };
  } catch (error) {
    if (error instanceof McpToolError) throw error;
    if (error instanceof WorkspaceBindingError) {
      throw new McpToolError(error.message, "INVALID_WORKSPACE");
    }
    throw error;
  }
};

const readWorkflows = async (ctx: LocalServerContext) => {
  const workflows = await ctx.workflowService.listWorkflows();
  return { workflows };
};

const readRepos = async (ctx: LocalServerContext) => ({
  repos: await listPlatformRepos(ctx),
});
