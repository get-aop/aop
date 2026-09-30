import { useEffect, useState } from "react";

const draftKey = (draftId: string): string => `aop:draft:v1:${draftId}`;

/**
 * What the person has typed and not yet sent, kept in this browser so a reload, or a walk to
 * another tab, does not lose it. Mount it once per conversation (key the component by it).
 */
export const useDraft = (
  draftId: string,
): [string, (draft: string | ((current: string) => string)) => void] => {
  const [draft, setDraft] = useState(() => read(draftId));

  useEffect(() => {
    write(draftId, draft);
  }, [draftId, draft]);

  return [draft, setDraft];
};

const read = (draftId: string): string => {
  try {
    return window.localStorage.getItem(draftKey(draftId)) ?? "";
  } catch {
    return "";
  }
};

const write = (draftId: string, draft: string): void => {
  try {
    if (draft === "") window.localStorage.removeItem(draftKey(draftId));
    else window.localStorage.setItem(draftKey(draftId), draft);
  } catch {
    // Storage full or blocked: the draft lives for this visit only.
  }
};
