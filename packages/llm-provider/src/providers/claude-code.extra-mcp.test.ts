import { describe, expect, test } from "bun:test";
import type { McpStdioServer } from "../types";
import { ClaudeCodeProvider } from "./claude-code";

const MCP_URL = "http://127.0.0.1:25350/api/mcp";
const AOP_SERVER = { type: "http", url: MCP_URL, alwaysLoad: true };
const CUA: McpStdioServer = {
  type: "stdio",
  command: "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
  args: ["mcp"],
};

const mcpConfigOf = (cmd: string[]): unknown => {
  const at = cmd.indexOf("--mcp-config");
  return at === -1 ? null : JSON.parse(cmd[at + 1] ?? "null");
};

describe("buildCommand with extra MCP servers", () => {
  test("a thread without computer use gets the aop server only", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      prompt: "fix it",
      isolation: "open",
      mcpServerUrl: MCP_URL,
    });

    expect(mcpConfigOf(cmd)).toEqual({ mcpServers: { aop: AOP_SERVER } });
  });

  test("a thread on CUA gets CUA Driver's server beside the aop server, with default loading", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      prompt: "open the app and check the button",
      isolation: "open",
      mcpServerUrl: MCP_URL,
      extraMcpServers: { "cua-driver": CUA },
    });

    expect(mcpConfigOf(cmd)).toEqual({
      mcpServers: { "cua-driver": CUA, aop: AOP_SERVER },
    });
    // One config: the extra server does not add a flag of its own or close the run's other servers.
    expect(cmd.filter((arg) => arg === "--mcp-config")).toHaveLength(1);
    expect(cmd).not.toContain("--strict-mcp-config");
  });

  test("an extra server cannot take the aop server's name", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      prompt: "fix it",
      isolation: "open",
      mcpServerUrl: MCP_URL,
      extraMcpServers: { aop: CUA },
    });

    expect(mcpConfigOf(cmd)).toEqual({ mcpServers: { aop: AOP_SERVER } });
  });

  test("extra servers alone still make an MCP config", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      prompt: "chat",
      isolation: "open",
      extraMcpServers: { "cua-driver": CUA },
    });

    expect(mcpConfigOf(cmd)).toEqual({ mcpServers: { "cua-driver": CUA } });
  });

  test("the config stays after the prompt, with the other variadic flags", () => {
    const cmd = new ClaudeCodeProvider().buildCommand({
      prompt: "the prompt",
      isolation: "open",
      mcpServerUrl: MCP_URL,
      extraMcpServers: { "cua-driver": CUA },
      disallowedTools: ["AskUserQuestion"],
    });

    expect(cmd.indexOf("--mcp-config")).toBeGreaterThan(cmd.indexOf("the prompt"));
    expect(cmd.indexOf("--disallowedTools")).toBeGreaterThan(cmd.indexOf("--mcp-config"));
  });
});
