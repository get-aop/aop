/**
 * The CLI's stdin as lines, the way `--input-format stream-json` reads it: one message per line,
 * taken as it arrives, while the turn goes on.
 */
export interface InputLines {
  /** The next line, waiting for it; null once the input has ended. */
  next(): Promise<string | null>;
  /** The lines that have arrived and not been taken yet, without waiting. */
  take(): string[];
}

/** Lines from a byte stream that keeps arriving: the real process's stdin. */
export const linesOf = (stream: ReadableStream<Uint8Array>): InputLines => {
  const queue = createLineQueue();
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) queue.push(line);
    }
    queue.push(buffer + decoder.decode());
    queue.end();
  })();
  return queue;
};

/** A queue a test or a stream fills: blank lines are skipped, as the CLI skips them. */
export const createLineQueue = () => {
  const lines: string[] = [];
  let ended = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push(line: string): void {
      if (line.trim()) lines.push(line);
      notify();
    },
    end(): void {
      ended = true;
      notify();
    },
    async next(): Promise<string | null> {
      while (lines.length === 0 && !ended) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      return lines.shift() ?? null;
    },
    take(): string[] {
      return lines.splice(0);
    },
  };
};
