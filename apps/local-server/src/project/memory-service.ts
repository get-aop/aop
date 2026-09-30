import { z } from "zod";
import type { MemoryFile, MemoryRepository } from "./memory-repository.ts";
import type { ProjectRepository } from "./repository.ts";

/** The index every session reads first; topic files hold the detail. */
export const MEMORY_INDEX_NAME = "MEMORY.md";

const MEMORY_DESCRIPTION_MAX = 300;
const MEMORY_BODY_MAX = 50_000;

export const MemoryFileInputSchema = z.object({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/, {
    error: "Memory file names are letters, digits, . _ - and end in .md",
  }),
  description: z.string().max(MEMORY_DESCRIPTION_MAX).default(""),
  body: z.string().max(MEMORY_BODY_MAX),
});
export type MemoryFileInput = z.input<typeof MemoryFileInputSchema>;

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
}

export const createMemoryService = (deps: {
  projects: ProjectRepository;
  memory: MemoryRepository;
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
  };
};

const indexFirst = (files: MemoryFile[]): MemoryFile[] => [
  ...files.filter((file) => file.name === MEMORY_INDEX_NAME),
  ...files.filter((file) => file.name !== MEMORY_INDEX_NAME),
];
