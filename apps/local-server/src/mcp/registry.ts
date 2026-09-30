import { z } from "zod";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { ProjectServices } from "../project/services.ts";

export class McpToolError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/** One MCP content block. `tools/call` answers with an array of these, never a bare object. */
export interface McpTextBlock {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextBlock[];
  /** The tool ran and failed; the model sees the text and can correct itself. */
  isError?: boolean;
}

/** Who is calling: the session behind the MCP URL, and the services a tool may use. */
export interface McpToolCall {
  ctx: LocalServerContext;
  services: ProjectServices;
  session: ChatSession;
}

export interface McpTool {
  name: string;
  description: string;
  /** Validates the arguments, and is the JSON Schema the model is shown, so the two cannot drift. */
  input: z.ZodType;
  handler: (args: never, call: McpToolCall) => Promise<McpToolResult>;
}

/** Keeps a handler's argument type tied to its schema while the registry stores them all as `McpTool`. */
export const defineTool = <S extends z.ZodType>(tool: {
  name: string;
  description: string;
  input: S;
  handler: (args: z.output<S>, call: McpToolCall) => Promise<McpToolResult>;
}): McpTool => tool as McpTool;

export const textResult = (value: unknown): McpToolResult => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});

export const jsonSchemaOf = (tool: McpTool): Record<string, unknown> => {
  const { $schema: _draft, ...schema } = z.toJSONSchema(tool.input) as Record<string, unknown>;
  return schema;
};

/** The message a model reads when its arguments do not fit the schema. */
export const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`)
    .join("; ");
