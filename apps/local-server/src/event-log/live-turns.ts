import {
  applyLiveOps,
  compactLiveOps,
  type EventLogEntry,
  type MessageDelta,
  type TurnPart,
} from "@aop/common";

/**
 * The parts so far of every assistant turn that is being written, per project. It exists so a
 * client that connects mid-turn gets a baseline for the deltas that follow, which only carry
 * what changed. Nothing here is durable: a restart forgets turns whose process died with the
 * server anyway, and recovery writes the ones still running again.
 */
export interface LiveTurns {
  apply: (delta: MessageDelta) => void;
  /** Forgets whatever the entry makes obsolete: a reply that arrived, a thread or project that is gone. */
  settle: (entry: EventLogEntry) => void;
  /** Every running turn of the project, each as a delta that replaces what a client holds. */
  list: (projectId: string) => MessageDelta[];
  /** One running turn's parts so far; empty when it is not running. */
  parts: (projectId: string, messageId: string) => readonly TurnPart[];
}

type HeldTurn = Omit<MessageDelta, "ops"> & { parts: TurnPart[] };

export const createLiveTurns = (): LiveTurns => {
  const byProject = new Map<string, Map<string, HeldTurn>>();

  const forget = (projectId: string, keep: (turn: HeldTurn) => boolean) => {
    const turns = byProject.get(projectId);
    if (!turns) return;
    for (const [messageId, turn] of turns) {
      if (!keep(turn)) turns.delete(messageId);
    }
    if (turns.size === 0) byProject.delete(projectId);
  };

  return {
    apply: (delta) => {
      const turns = byProject.get(delta.projectId) ?? new Map<string, HeldTurn>();
      const held = turns.get(delta.messageId);
      const parts = applyLiveOps(held?.parts ?? [], delta.ops);
      if (parts === null || parts.length === 0) {
        turns.delete(delta.messageId);
      } else {
        const { ops: _ops, ...turn } = delta;
        turns.set(delta.messageId, {
          ...turn,
          inReplyTo: delta.inReplyTo ?? held?.inReplyTo,
          parts,
        });
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

    parts: (projectId, messageId) => byProject.get(projectId)?.get(messageId)?.parts ?? [],

    list: (projectId) =>
      [...(byProject.get(projectId)?.values() ?? [])].map(({ parts, ...turn }) => ({
        ...turn,
        ops: [{ op: "reset", parts }],
      })),
  };
};

/**
 * Folds a delta into the one already waiting to be sent for the same message, so a slow
 * client costs one pending frame per running turn, not one per change: their ops in order,
 * without what a later baseline or end makes obsolete. A baseline that is still waiting stays
 * a baseline, with what came after it.
 */
export const mergeDelta = (waiting: MessageDelta | undefined, next: MessageDelta): MessageDelta =>
  waiting
    ? {
        ...waiting,
        inReplyTo: next.inReplyTo ?? waiting.inReplyTo,
        ops: compactLiveOps([...waiting.ops, ...next.ops]),
      }
    : next;
