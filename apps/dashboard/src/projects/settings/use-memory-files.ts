import { MEMORY_INDEX_NAME, type MemoryFile, type MemoryFileInput } from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import { deleteMemoryFile, listMemory, saveMemoryFile } from "../../api/memory";
import { useRefreshOnActivity } from "./use-refresh-on-activity";

export interface MemoryFiles {
  /** The index first, then topic files by name; null until the first load. */
  files: MemoryFile[] | null;
  /** Why the last load failed. */
  error: string | null;
  /** Rejects with the host's message. */
  save: (input: MemoryFileInput) => Promise<MemoryFile>;
  remove: (name: string) => Promise<void>;
  /** Loads the list again, as when the coordinator has just changed it. */
  refresh: () => void;
}

/** A project's memory files. Agents write them too, so the list is reloaded as the project stirs. */
export const useMemoryFiles = (projectId: string): MemoryFiles => {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A response for a project the person has already left must not replace the current list.
  const currentProject = useRef(projectId);
  currentProject.current = projectId;

  const refresh = useCallback(() => {
    listMemory(projectId).then(
      (loaded) => {
        if (currentProject.current !== projectId) return;
        setFiles(loaded);
        setError(null);
      },
      (cause: unknown) => {
        if (currentProject.current !== projectId) return;
        setError(cause instanceof Error ? cause.message : "Could not load memory");
        setFiles((current) => current ?? []);
      },
    );
  }, [projectId]);

  useEffect(() => {
    setFiles(null);
    refresh();
  }, [refresh]);
  useRefreshOnActivity(projectId, refresh);

  const save = useCallback(
    async (input: MemoryFileInput): Promise<MemoryFile> => {
      const saved = await saveMemoryFile(projectId, input);
      setFiles((current) => withFile(current ?? [], saved));
      return saved;
    },
    [projectId],
  );

  const remove = useCallback(
    async (name: string) => {
      await deleteMemoryFile(projectId, name);
      setFiles((current) => (current ?? []).filter((file) => file.name !== name));
    },
    [projectId],
  );

  return { files, error, save, remove, refresh };
};

const withFile = (files: MemoryFile[], saved: MemoryFile): MemoryFile[] =>
  [...files.filter((file) => file.name !== saved.name), saved].sort(byIndexThenName);

// The order the host lists them in, so a save does not reshuffle the list before the next load.
const byIndexThenName = (a: MemoryFile, b: MemoryFile): number =>
  Number(b.name === MEMORY_INDEX_NAME) - Number(a.name === MEMORY_INDEX_NAME) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
