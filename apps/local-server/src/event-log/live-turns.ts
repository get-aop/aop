import type { EventLogEntry, MessageDelta } from "@aop/common";

/**
 * The text so far of every assistant turn that is being written, per project. It exists so a
 * client that connects mid-turn gets a baseline for the deltas that follow, which only carry
 * what was appended. Nothing here is durable: a restart forgets turns whose process died with
 * the server anyway.
 */
export interface LiveTurns {
  apply: (delta: MessageDelta) => void;
  /** Forgets whatever the entry makes obsolete: a reply that arrived, a thread or project that is gone. */
  settle: (entry: EventLogEntry) => void;
  /** Every running turn of the project, each as a delta that replaces what a client holds. */
  list: (projectId: string) => MessageDelta[];
}

export const createLiveTurns = (): LiveTurns => {
  const byProject = new Map<string, Map<string, MessageDelta>>();

  const forget = (projectId: string, keep: (turn: MessageDelta) => boolean) => {
    const turns = byProject.get(projectId);
    if (!turns) return;
    for (const [messageId, turn] of turns) {
      if (!keep(turn)) turns.delete(messageId);
    }
    if (turns.size === 0) byProject.delete(projectId);
  };

  return {
    apply: (delta) => {
      const turns = byProject.get(delta.projectId) ?? new Map<string, MessageDelta>();
      const text = delta.replace
        ? delta.text
        : `${turns.get(delta.messageId)?.text ?? ""}${delta.text}`;
      if (text === "") {
        turns.delete(delta.messageId);
      } else {
        turns.set(delta.messageId, { ...delta, text, replace: true });
      }
      if (turns.size === 0) byProject.delete(delta.projectId);
      else byProject.set(delta.projectId, turns);
    },

    settle: (entry) => {
      if (entry.type === "message.created" && entry.payload.message.role === "assistant") {
        const finished = entry.payload.message.id;
        forget(entry.projectId, (turn) => turn.messageId !== finished);
      } else if (entry.type === "thread.removed") {
        forget(entry.projectId, (turn) => turn.threadId !== entry.payload.threadId);
      } else if (entry.type === "project.removed") {
        byProject.delete(entry.projectId);
      }
    },

    list: (projectId) => [...(byProject.get(projectId)?.values() ?? [])],
  };
};

/**
 * Folds a delta into the one already waiting to be sent for the same message, so a slow
 * client costs one pending frame per running turn, not one per chunk. A replacement wins
 * outright; an append extends the waiting text and keeps its `replace` flag, so a baseline
 * that is still waiting stays a baseline.
 */
export const mergeDelta = (waiting: MessageDelta | undefined, next: MessageDelta): MessageDelta =>
  waiting && !next.replace ? { ...waiting, text: `${waiting.text}${next.text}` } : next;
