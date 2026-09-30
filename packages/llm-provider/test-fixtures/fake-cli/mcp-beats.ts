import { DEFAULT_ASK_TOOL } from "./directives";
import type { Beat, McpCall, McpConnection, McpResult, PlannedBeat } from "./types";
import { AOP_MCP_SERVER } from "./types";

const NOT_CONNECTED = `MCP server ${AOP_MCP_SERVER} is not connected`;

/**
 * Makes a planned beat happen. An MCP call goes to the `aop` server for real; without one the
 * model gets an error result, as Claude would for a server that failed to connect. A question
 * to the default tool is that same call to `aop_ask_user` when the server is there, and stays a
 * scripted event otherwise.
 */
export const carryOut = async (
  beat: PlannedBeat,
  aop: McpConnection | undefined,
): Promise<Beat> => {
  if (beat.kind === "call") return mcpBeat(beat.call, aop);
  if (beat.kind === "ask" && aop && beat.ask.tool === DEFAULT_ASK_TOOL) {
    const { question, options } = beat.ask;
    return mcpBeat({ name: DEFAULT_ASK_TOOL, arguments: { question, options } }, aop);
  }
  return beat;
};

const mcpBeat = async (call: McpCall, aop: McpConnection | undefined): Promise<Beat> => {
  const result: McpResult = aop
    ? await aop.callTool(call.name, call.arguments)
    : { text: NOT_CONNECTED, isError: true };
  return { kind: "mcp", call, result };
};
