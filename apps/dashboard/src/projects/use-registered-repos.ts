import { useCallback, useEffect, useRef, useState } from "react";
import { getRepos, type RegisteredRepo } from "../api/client";
import { onRepoAttached } from "../shell/dialog-store";

/**
 * The repositories AOP knows (null until loaded), reloaded when one is registered from the
 * attach dialog. `onAttached` then hears the new repository's id once the list has it.
 */
export const useRegisteredRepos = (
  onAttached?: (repoId: string) => void,
): RegisteredRepo[] | null => {
  const [repos, setRepos] = useState<RegisteredRepo[] | null>(null);
  const onAttachedRef = useRef(onAttached);
  onAttachedRef.current = onAttached;

  const load = useCallback(async () => {
    setRepos(await getRepos().catch(() => []));
  }, []);

  useEffect(() => {
    void load();
    return onRepoAttached((repoId) => {
      void load().then(() => onAttachedRef.current?.(repoId));
    });
  }, [load]);

  return repos;
};
