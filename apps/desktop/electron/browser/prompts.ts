import type { BrowserAsk, BrowserPrompt } from "@aop/common";

interface Pending {
  prompt: BrowserPrompt;
  settle: (allow: boolean) => void;
}

export interface PromptRegistry {
  /** Waits on the person, unless they already allowed this for the origin while the app runs. */
  ask: (
    request: Omit<BrowserPrompt, "id">,
    settle: (allow: boolean) => void,
  ) => BrowserPrompt | null;
  /** The person's answer. Unknown or already settled ids are ignored. */
  answer: (id: string, allow: boolean) => BrowserPrompt | null;
  /** The page navigated or closed: what it was asking is refused. Returns the ids it settled. */
  cancelFor: (webContentsId: number) => string[];
  granted: (origin: string, ask: BrowserAsk) => boolean;
}

/**
 * Requests waiting on the person, and what they allowed. An "Allow" lasts while the app runs, per
 * origin and kind, so a page that asks for the camera on every call asks once; "Block" is never
 * remembered, so a mistaken click is undone by reloading. Opening another app is asked every time.
 */
export const createPromptRegistry = (newId: () => string): PromptRegistry => {
  const pending = new Map<string, Pending>();
  const grants = new Set<string>();
  const grantKey = (origin: string, ask: BrowserAsk) => `${ask} ${origin}`;

  return {
    ask: (request, settle) => {
      if (request.ask !== "open-external" && grants.has(grantKey(request.origin, request.ask))) {
        settle(true);
        return null;
      }
      const prompt: BrowserPrompt = { ...request, id: newId() };
      pending.set(prompt.id, { prompt, settle });
      return prompt;
    },
    answer: (id, allow) => {
      const entry = pending.get(id);
      if (!entry) return null;
      pending.delete(id);
      const { prompt } = entry;
      if (allow && prompt.ask !== "open-external") grants.add(grantKey(prompt.origin, prompt.ask));
      entry.settle(allow);
      return prompt;
    },
    cancelFor: (webContentsId) => {
      const settled: string[] = [];
      for (const [id, entry] of pending) {
        if (entry.prompt.webContentsId !== webContentsId) continue;
        pending.delete(id);
        entry.settle(false);
        settled.push(id);
      }
      return settled;
    },
    granted: (origin, ask) => grants.has(grantKey(origin, ask)),
  };
};
