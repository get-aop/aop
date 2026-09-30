import type { Thread, ThreadActivity, ThreadTurnActivity } from "@aop/common";
import { useEffect, useMemo, useState } from "react";
import { getThreadActivity } from "../../api/threads";

const POLL_MS = 2_500;
const NONE: ThreadActivity = { turns: [] };

export interface TurnActivity {
  /** The tool calls of each finished turn, by the id of the reply it wrote. */
  finished: ReadonlyMap<string, ThreadTurnActivity>;
  /** The turn being written now, once it has done anything to show. */
  running: ThreadTurnActivity | undefined;
}

/**
 * The thread's tool calls per turn, which its messages do not carry. They are read when the
 * thread opens, whenever a reply arrives (`repliesSeen`) or the thread changes status, and,
 * while a turn runs, every couple of seconds: the running turn's calls are not on the stream.
 * A host that cannot answer leaves the transcript as text alone.
 */
export const useThreadActivity = (
  thread: Pick<Thread, "id" | "status">,
  repliesSeen: number,
): TurnActivity => {
  const [activity, setActivity] = useState<ThreadActivity>(NONE);
  const working = thread.status === "working";

  useEffect(() => {
    void repliesSeen;
    void thread.status;
    let cancelled = false;
    const read = () =>
      getThreadActivity(thread.id)
        .then((next) => {
          if (!cancelled) setActivity(next);
        })
        .catch(() => {});
    void read();
    const timer = working ? setInterval(() => void read(), POLL_MS) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [thread.id, thread.status, repliesSeen, working]);

  return useMemo(
    () => ({
      finished: new Map(
        activity.turns.filter((turn) => !turn.running).map((turn) => [turn.messageId, turn]),
      ),
      running: activity.turns.find((turn) => turn.running),
    }),
    [activity],
  );
};
