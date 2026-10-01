import {
  MEMORY_INDEX_NAME,
  MEMORY_REQUEST_MAX_LENGTH,
  type MemoryFile,
  type MemoryFileInputSchema,
  type Message,
} from "@aop/common";
import type { z } from "zod";
import type { MemoryRepository } from "./memory-repository.ts";
import { memoryRequestPrompt } from "./memory-request.ts";
import type { ProjectRepository } from "./repository.ts";
import type { ProjectResult, ProjectService } from "./service.ts";

export type MemoryResult<T> =
  | ({ success: true } & T)
  | { success: false; error: { code: "PROJECT_NOT_FOUND" } | { code: "MEMORY_FILE_NOT_FOUND" } };

export interface MemoryService {
  /** The index first, then topic files by name. */
  list: (projectId: string) => Promise<MemoryResult<{ files: MemoryFile[] }>>;
  read: (projectId: string, name: string) => Promise<MemoryResult<{ file: MemoryFile }>>;
  write: (
    projectId: string,
    input: z.output<typeof MemoryFileInputSchema>,
  ) => Promise<MemoryResult<{ file: MemoryFile }>>;
  remove: (projectId: string, name: string) => Promise<MemoryResult<Record<never, never>>>;
  /**
   * Hands the person's words to the coordinator, which changes the files with its memory tools.
   * The message is the request as the chat shows it; the coordinator's reply answers it.
   */
  requestChange: (
    projectId: string,
    request: string,
  ) => Promise<ProjectResult<{ message: Message }>>;
}

export const createMemoryService = (deps: {
  projects: ProjectRepository;
  memory: MemoryRepository;
  coordinator: Pick<ProjectService, "sendToCoordinator">;
}): MemoryService => {
  const withProject = async <T>(
    projectId: string,
    run: () => Promise<MemoryResult<T>>,
  ): Promise<MemoryResult<T>> =>
    (await deps.projects.getById(projectId))
      ? run()
      : { success: false, error: { code: "PROJECT_NOT_FOUND" } };

  return {
    list: (projectId) =>
      withProject(projectId, async () => ({
        success: true,
        files: indexFirst(await deps.memory.list(projectId)),
      })),

    read: (projectId, name) =>
      withProject(projectId, async () => {
        const file = await deps.memory.get(projectId, name);
        return file
          ? { success: true, file }
          : { success: false, error: { code: "MEMORY_FILE_NOT_FOUND" } };
      }),

    write: (projectId, input) =>
      withProject(projectId, async () => ({
        success: true,
        file: await deps.memory.save(projectId, input),
      })),

    remove: (projectId, name) =>
      withProject(projectId, async () =>
        (await deps.memory.remove(projectId, name))
          ? { success: true }
          : { success: false, error: { code: "MEMORY_FILE_NOT_FOUND" } },
      ),

    requestChange: async (projectId, request) => {
      const words = request.trim();
      if (!words || words.length > MEMORY_REQUEST_MAX_LENGTH) {
        const message = words
          ? `A memory request is at most ${MEMORY_REQUEST_MAX_LENGTH} characters`
          : "Say what to change or remove";
        return { success: false, error: { code: "INVALID_MESSAGE", message } };
      }
      return deps.coordinator.sendToCoordinator(projectId, memoryRequestPrompt(words), {
        type: "memory-request",
        request: words,
      });
    },
  };
};

const indexFirst = (files: MemoryFile[]): MemoryFile[] => [
  ...files.filter((file) => file.name === MEMORY_INDEX_NAME),
  ...files.filter((file) => file.name !== MEMORY_INDEX_NAME),
];
