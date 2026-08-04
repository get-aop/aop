/**
 * PI enables Codex fast mode via a `/fast` control command rather than CLI flags.
 * When the session fast_mode flag flips, queue a one-shot injection for the next turn.
 */

const pendingPiFastCommands = new Map<string, "toggle">();

export const queuePiFastModeCommand = (
  sessionId: string,
  runtime: string,
  previousFastMode: boolean,
  nextFastMode: boolean,
): void => {
  if (runtime !== "pi") return;
  if (previousFastMode === nextFastMode) return;
  // /fast toggles PI's Codex fast mode on or off.
  pendingPiFastCommands.set(sessionId, "toggle");
};

export const consumePiFastModePromptPrefix = (
  sessionId: string,
  runtime: string,
): string | null => {
  if (runtime !== "pi") return null;
  if (!pendingPiFastCommands.has(sessionId)) return null;
  pendingPiFastCommands.delete(sessionId);
  return "/fast";
};

export const clearPiFastModeCommand = (sessionId: string): void => {
  pendingPiFastCommands.delete(sessionId);
};

/** Test helper. */
export const resetPiFastModeCommands = (): void => {
  pendingPiFastCommands.clear();
};
