import type { MemoryFile, MemoryFileInput, Message } from "@aop/common";
import { request } from "./request";

const memoryPath = (projectId: string, name?: string): string =>
  `/projects/${encodeURIComponent(projectId)}/memory${name ? `/${encodeURIComponent(name)}` : ""}`;

/** The index first, then topic files by name, each with its body. */
export const listMemory = async (projectId: string): Promise<MemoryFile[]> =>
  (await request<{ files: MemoryFile[] }>(memoryPath(projectId))).files;

/** Creates the file, or replaces the description and body of the one with that name. */
export const saveMemoryFile = async (
  projectId: string,
  { name, description, body }: MemoryFileInput,
): Promise<MemoryFile> =>
  (
    await request<{ file: MemoryFile }>(memoryPath(projectId, name), {
      method: "PUT",
      body: JSON.stringify({ description, body }),
    })
  ).file;

export const deleteMemoryFile = async (projectId: string, name: string): Promise<void> => {
  await request<unknown>(memoryPath(projectId, name), { method: "DELETE" });
};

/**
 * Asks the coordinator to change memory, in the person's words. Resolves with the request as the
 * coordinator chat shows it; the coordinator's reply to it says what changed.
 */
export const requestMemoryChange = async (projectId: string, text: string): Promise<Message> =>
  (
    await request<{ message: Message }>(`${memoryPath(projectId)}/requests`, {
      method: "POST",
      body: JSON.stringify({ text }),
    })
  ).message;
