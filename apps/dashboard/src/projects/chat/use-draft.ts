import { useEffect, useState } from "react";

const draftKey = (projectId: string): string => `aop:coordinator-draft:v1:${projectId}`;

/**
 * What the person has typed and not yet sent, kept in this browser so a reload, or a walk to
 * another tab, does not lose it. Mount it once per project (key the component by the project).
 */
export const useDraft = (
  projectId: string,
): [string, (draft: string | ((current: string) => string)) => void] => {
  const [draft, setDraft] = useState(() => read(projectId));

  useEffect(() => {
    write(projectId, draft);
  }, [projectId, draft]);

  return [draft, setDraft];
};

const read = (projectId: string): string => {
  try {
    return window.localStorage.getItem(draftKey(projectId)) ?? "";
  } catch {
    return "";
  }
};

const write = (projectId: string, draft: string): void => {
  try {
    if (draft === "") window.localStorage.removeItem(draftKey(projectId));
    else window.localStorage.setItem(draftKey(projectId), draft);
  } catch {
    // Storage full or blocked: the draft lives for this visit only.
  }
};
