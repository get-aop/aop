import { AOP_MCP_SERVER, type McpConnection, type McpResult } from "./types";

const PROTOCOL_VERSION = "2024-11-05";
const HEADERS = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type Handshake = { tools: Set<string> } | { failure: string };

/**
 * A strict MCP client over HTTP JSON-RPC, as Claude Code would be for the `aop` server: it
 * initializes, lists tools once, refuses to call a tool the server did not list, and rejects a
 * `tools/call` result whose `content` is not an array of text blocks. The URL is used as
 * given; it already carries the session and access token as query parameters.
 */
export const createMcpConnection = (url: string, fetchFn: Fetch = fetch): McpConnection => {
  let nextId = 1;
  let handshake: Promise<Handshake> | undefined;

  const post = async (body: Record<string, unknown>): Promise<Response> => {
    const response = await fetchFn(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  };

  const request = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const response = await post({ jsonrpc: "2.0", id: nextId++, method, params });
    return response.json();
  };

  const connect = async (): Promise<Handshake> => {
    try {
      const init = asRecord(await request("initialize", initializeParams()));
      if (init.error !== undefined) throw new Error(errorMessage(init.error));
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      const listed = asRecord(await request("tools/list", {}));
      if (listed.error !== undefined) throw new Error(errorMessage(listed.error));
      return { tools: toolNames(listed.result) };
    } catch (error) {
      return { failure: reason(error) };
    }
  };

  return {
    callTool: async (name, args) => {
      handshake ??= connect();
      const state = await handshake;
      if ("failure" in state) return unreachable(state.failure);
      if (!state.tools.has(name)) return failed(`No such tool available: ${qualified(name)}`);
      try {
        return toResult(asRecord(await request("tools/call", { name, arguments: args })));
      } catch (error) {
        return unreachable(reason(error));
      }
    },
  };
};

const initializeParams = (): Record<string, unknown> => ({
  protocolVersion: PROTOCOL_VERSION,
  capabilities: {},
  clientInfo: { name: "fake-claude", version: "0.0.0" },
});

const qualified = (tool: string): string => `mcp__${AOP_MCP_SERVER}__${tool}`;

const toolNames = (result: unknown): Set<string> => {
  const tools = asRecord(result).tools;
  if (!Array.isArray(tools)) throw new Error("tools/list returned no tools array");
  return new Set(
    tools.flatMap((tool) =>
      typeof asRecord(tool).name === "string" ? [String(asRecord(tool).name)] : [],
    ),
  );
};

const toResult = (response: Record<string, unknown>): McpResult => {
  if (response.error !== undefined) return failed(errorMessage(response.error));
  const result = asRecord(response.result);
  const text = joinTextBlocks(result.content);
  if (text === null) return failed("invalid MCP tool result");
  return { text, isError: result.isError === true };
};

/** `content` must be an array of `{type: "text", text}` blocks; anything else is not MCP. */
const joinTextBlocks = (content: unknown): string | null => {
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const block of content) {
    const record = asRecord(block);
    if (record.type !== "text" || typeof record.text !== "string") return null;
    texts.push(record.text);
  }
  return texts.join("\n");
};

const errorMessage = (error: unknown): string => {
  const message = asRecord(error).message;
  return typeof message === "string" ? message : JSON.stringify(error);
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const failed = (text: string): McpResult => ({ text, isError: true });

const unreachable = (why: string): McpResult =>
  failed(`MCP server ${AOP_MCP_SERVER} unreachable: ${why}`);
