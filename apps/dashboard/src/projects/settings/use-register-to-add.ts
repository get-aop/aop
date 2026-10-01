import { useEffect, useRef } from "react";
import { onRepoAttached, openAttachRepoDialog, useDialogs } from "../../shell/dialog-store";

/**
 * "Register another repository…" from a project's Add menu: `open` shows the attach dialog, and
 * the repository it then registers is handed to `add` once the registered list has it (pass
 * `onRegistered` to `useRegisteredRepos`, which calls it after its reload). A repository
 * registered from anywhere else is not added: the claim is taken only while the dialog this
 * opened is up, at the moment it announces the repository, and dropped when it closes.
 */
export const useRegisterToAdd = (add: (repoId: string) => void) => {
  const { attachRepo: dialogOpen } = useDialogs();
  const waiting = useRef(false);
  const claimed = useRef(new Set<string>());
  const addRef = useRef(add);
  addRef.current = add;

  // The dialog announces the repository before it closes, so a close drops only a cancelled wait.
  useEffect(() => {
    if (!dialogOpen) waiting.current = false;
  }, [dialogOpen]);

  useEffect(
    () =>
      onRepoAttached((repoId) => {
        if (!waiting.current) return;
        waiting.current = false;
        claimed.current.add(repoId);
      }),
    [],
  );

  return {
    open: () => {
      waiting.current = true;
      openAttachRepoDialog();
    },
    onRegistered: (repoId: string) => {
      if (claimed.current.delete(repoId)) addRef.current(repoId);
    },
  };
};
