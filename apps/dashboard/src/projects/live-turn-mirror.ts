import { applyLiveOps, type MessageDelta, type TurnPart } from "@aop/common";
import type { ProjectStreamEvent } from "./live-projects";

type HeldTurn = Omit<MessageDelta, "ops"> & { parts: TurnPart[] };

export interface LiveTurnMirror {
  hear: (event: ProjectStreamEvent) => void;
  /** Every turn being written, each as a baseline: what a conversation that opens mid-turn starts from. */
  baselines: () => MessageDelta[];
}

/**
 * The turns of one project being written, as its stream has told them so far. The stream sends
 * each turn's baseline once per connection, so a conversation that starts listening later (a
 * thread opened while it works) would otherwise hold nothing to apply the next change to.
 */
export const createLiveTurnMirror = (): LiveTurnMirror => {
  let turns = new Map<string, HeldTurn>();

  const apply = (delta: MessageDelta) => {
    const held = turns.get(delta.messageId);
    const parts = applyLiveOps(held?.parts ?? [], delta.ops);
    if (!parts?.length) {
      turns.delete(delta.messageId);
      return;
    }
    const { ops: _ops, ...turn } = delta;
    turns.set(delta.messageId, { ...turn, inReplyTo: delta.inReplyTo ?? held?.inReplyTo, parts });
  };

  return {
    hear: (event) => {
      if (event.kind === "delta") apply(event.delta);
      else if (event.kind === "live") {
        turns = new Map();
        for (const delta of event.snapshot.turns) apply(delta);
      } else if (event.kind === "entry") forgetSettled(turns, event.entry);
    },
    baselines: () =>
      [...turns.values()].map(({ parts, ...turn }) => ({ ...turn, ops: [{ op: "reset", parts }] })),
  };
};

// A reply that arrived ends its turn; a thread that went takes its turns with it.
const forgetSettled = (
  turns: Map<string, HeldTurn>,
  entry: Extract<ProjectStreamEvent, { kind: "entry" }>["entry"],
): void => {
  if (entry.type === "message.created") turns.delete(entry.payload.message.id);
  if (entry.type !== "thread.removed") return;
  for (const [id, turn] of turns) {
    if (turn.threadId === entry.payload.threadId) turns.delete(id);
  }
};
