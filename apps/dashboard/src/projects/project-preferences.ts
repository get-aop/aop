import { useCallback } from "react";
import { useLocalStorage } from "../hooks/use-local-storage";

const PINNED_STORAGE_KEY = "aop:pinned-projects:v1";
const NONE: readonly string[] = [];

/**
 * Which projects this device pins to the top of the project switcher and the projects page. It is a per-device choice kept
 * in local storage: the host stores no pin, so pinning here does not follow you to another computer.
 */
export const usePinnedProjects = (): {
  pinnedIds: readonly string[];
  toggle: (projectId: string) => void;
} => {
  const [stored, setStored] = useLocalStorage<string[]>(PINNED_STORAGE_KEY, NONE as string[]);
  const pinnedIds = Array.isArray(stored) ? stored : NONE;

  const toggle = useCallback(
    (projectId: string) =>
      setStored((current) => {
        const ids = Array.isArray(current) ? current : [];
        return ids.includes(projectId) ? ids.filter((id) => id !== projectId) : [...ids, projectId];
      }),
    [setStored],
  );

  return { pinnedIds, toggle };
};
