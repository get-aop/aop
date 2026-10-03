import type { InputLines } from "./input-lines";

/**
 * What a launch's stdin holds, sorted the way Claude Code sorts it: user messages, which wait in
 * line for the turn to take them (after the step it is on) or for a turn of their own, and
 * control requests. Of those only `interrupt` is imitated: it stops the step the turn is on.
 */
export interface Inbox {
  /** The messages that arrived and wait, oldest first, without waiting for more. */
  take(): string[];
  /** The `uuid`s of the messages waiting, as the answer to an interrupt lists them. */
  waitingUuids(): string[];
  /** The `request_id` of an interrupt that arrived since the last call, or null. */
  takeInterrupt(): string | null;
  /** The next message, waiting for one; null once the input has ended. */
  next(): Promise<string | null>;
}

export const createInbox = (input: InputLines): Inbox => {
  const messages: string[] = [];
  let interrupt: string | null = null;
  const sort = (line: string) => {
    const control = readControl(line);
    if (control === null) messages.push(line);
    else if (control.interrupt) interrupt = control.requestId;
  };
  const drain = () => {
    for (const line of input.take()) sort(line);
  };
  return {
    take: () => {
      drain();
      return messages.splice(0);
    },
    waitingUuids: () => {
      drain();
      return messages.flatMap((line) => uuidOf(line) ?? []);
    },
    takeInterrupt: () => {
      drain();
      const requestId = interrupt;
      interrupt = null;
      return requestId;
    },
    next: async () => {
      drain();
      while (messages.length === 0) {
        const line = await input.next();
        if (line === null) return null;
        sort(line);
      }
      // An interrupt with no turn running has nothing to stop.
      interrupt = null;
      return messages.shift() ?? null;
    },
  };
};

const parse = (line: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
};

// Null for a line that is no control request: a message, or something the turn will refuse.
const readControl = (line: string): { interrupt: boolean; requestId: string } | null => {
  const parsed = parse(line);
  if (parsed?.type !== "control_request") return null;
  const request = parsed.request as { subtype?: unknown } | null | undefined;
  return {
    interrupt: request?.subtype === "interrupt",
    requestId: typeof parsed.request_id === "string" ? parsed.request_id : "",
  };
};

const uuidOf = (line: string): string | null => {
  const uuid = parse(line)?.uuid;
  return typeof uuid === "string" ? uuid : null;
};
