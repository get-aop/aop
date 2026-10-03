import { type SessionRole, toolNamesFor } from "./availability.ts";
import {
  describeIssues,
  jsonSchemaOf,
  type McpTool,
  type McpToolCall,
  McpToolError,
  type McpToolResult,
} from "./registry.ts";
import { artifactCreateTool, artifactUpdateTool } from "./tools-artifact.ts";
import { askPersonTool } from "./tools-ask-person.ts";
import {
  projectSettingsGetTool,
  projectSettingsSetTool,
  proposeThreadsTool,
  threadListTool,
  threadMergePrTool,
  threadOpenPrTool,
  threadReportTool,
  threadResolveTool,
  threadSpawnTool,
  threadSteerTool,
  threadStopTool,
} from "./tools-coordinator.ts";
import { libraryListTool, libraryReadTool, librarySaveTool } from "./tools-library.ts";
import { memoryDeleteTool, memoryReadTool, memoryWriteTool } from "./tools-memory.ts";
import { listReposTool, setChatWorkspaceTool } from "./tools-platform.ts";
import {
  proposeRoutineTool,
  routineCreateTool,
  routineDeleteTool,
  routineListTool,
  routinePauseTool,
  routineRunNowTool,
  routineUpdateTool,
} from "./tools-routine.ts";
import { askUserTool, openPullRequestTool, reportStatusTool } from "./tools-thread.ts";

export { McpToolError } from "./registry.ts";

const TOOLS: readonly McpTool[] = [
  listReposTool,
  setChatWorkspaceTool,
  threadSpawnTool,
  threadSteerTool,
  threadStopTool,
  threadListTool,
  threadReportTool,
  threadOpenPrTool,
  threadMergePrTool,
  threadResolveTool,
  proposeThreadsTool,
  askPersonTool,
  projectSettingsGetTool,
  projectSettingsSetTool,
  routineCreateTool,
  routineListTool,
  routineUpdateTool,
  routinePauseTool,
  routineDeleteTool,
  routineRunNowTool,
  askUserTool,
  reportStatusTool,
  openPullRequestTool,
  proposeRoutineTool,
  memoryReadTool,
  memoryWriteTool,
  memoryDeleteTool,
  librarySaveTool,
  libraryListTool,
  libraryReadTool,
  artifactCreateTool,
  artifactUpdateTool,
];

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The tools a session of this role is offered, in the order the role's tool list gives them. */
export const listMcpTools = (role: SessionRole): McpToolDefinition[] =>
  availableTools(role).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: jsonSchemaOf(tool),
  }));

export const isMcpToolAvailable = (role: SessionRole, name: string): boolean =>
  availableTools(role).some((tool) => tool.name === name);

/**
 * Runs one tool. Bad arguments and refused actions throw `McpToolError`, which the endpoint
 * returns as an `isError` result so the model can correct itself; a tool the session is not
 * offered is not a tool result at all, and the endpoint answers it as an unknown tool.
 */
export const callMcpTool = async (
  role: SessionRole,
  name: string,
  args: unknown,
  call: McpToolCall,
): Promise<McpToolResult> => {
  const tool = availableTools(role).find((candidate) => candidate.name === name);
  if (!tool) throw new McpToolError(`Unknown tool: ${name}`, "UNKNOWN_TOOL");
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) throw new McpToolError(describeIssues(parsed.error), "INVALID_INPUT");
  return tool.handler(parsed.data as never, call);
};

const availableTools = (role: SessionRole): McpTool[] =>
  toolNamesFor(role).flatMap((name) => TOOLS.filter((tool) => tool.name === name));

/** Every tool the registry defines, for the check that availability.ts and the registry agree. */
export const allMcpToolNames = (): string[] => TOOLS.map((tool) => tool.name);
