import { MEMORY_INDEX_NAME, MemoryFileInputSchema } from "@aop/common";
import { z } from "zod";
import { describeServiceError } from "../project/errors.ts";
import { defineTool, type McpToolCall, McpToolError, textResult } from "./registry.ts";

/** Project memory, shared by the coordinator and every thread: MEMORY.md is the index, topic files hold detail. */

const projectIdOf = ({ session }: McpToolCall): string => {
  if (!session.project_id)
    throw new McpToolError("This session belongs to no project", "NO_PROJECT");
  return session.project_id;
};

export const memoryReadTool = defineTool({
  name: "memory_read",
  description: `Read the project's memory. Without a name it returns ${MEMORY_INDEX_NAME} (the index) and the list of topic files with their descriptions; with a name it returns that file.`,
  input: z.object({
    name: z.string().optional().describe(`A file name such as ${MEMORY_INDEX_NAME} or testing.md.`),
  }),
  handler: async (args, call) => {
    const projectId = projectIdOf(call);
    const { memory } = call.services;
    if (args.name) {
      const read = await memory.read(projectId, args.name);
      if (!read.success) throw new McpToolError(describeServiceError(read.error), read.error.code);
      return textResult(read.file);
    }
    const listed = await memory.list(projectId);
    if (!listed.success)
      throw new McpToolError(describeServiceError(listed.error), listed.error.code);
    const index = listed.files.find((file) => file.name === MEMORY_INDEX_NAME);
    return textResult({
      index: index?.body ?? null,
      files: listed.files.map(({ name, description, updatedAt }) => ({
        name,
        description,
        updatedAt,
      })),
    });
  },
});

export const memoryWriteTool = defineTool({
  name: "memory_write",
  description: `Create or replace a memory file. Keep ${MEMORY_INDEX_NAME} a short index of durable facts (decisions, conventions, where things live) and put detail in topic files with a one-line description. Save what a later thread would need; do not save chatter or anything already in the repository.`,
  input: MemoryFileInputSchema,
  handler: async (args, call) => {
    const written = await call.services.memory.write(projectIdOf(call), args);
    if (!written.success) {
      throw new McpToolError(describeServiceError(written.error), written.error.code);
    }
    return textResult(`Saved ${written.file.name}.`);
  },
});
