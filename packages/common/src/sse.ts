/**
 * A reader for `text/event-stream` bodies, for clients that cannot use `EventSource`: it cannot
 * set an `Authorization` header, so a client that authenticates with a bearer token reads the
 * stream with `fetch` and feeds the bytes here. Follows the parsing rules of the HTML standard.
 */

export interface SseMessage {
  /** `message` when the stream named no event. */
  event: string;
  data: string;
  /** The `id:` field of this message, or null when it had none. */
  id: string | null;
}

export interface SseParser {
  /** Feed the next piece of decoded text; returns the messages it completed, in order. */
  push: (chunk: string) => SseMessage[];
}

export const createSseParser = (): SseParser => {
  const splitLines = createLineSplitter();
  const assemble = createEventAssembler();
  return {
    push: (chunk) =>
      splitLines(chunk)
        .map(assemble)
        .filter((message): message is SseMessage => message !== null),
  };
};

/**
 * Reads a response body to its end, calling `onMessage` for each event. Resolves when the
 * server closes the stream and rejects when the connection breaks or its signal aborts, so a
 * caller can tell a stream that ended from one that was cut.
 */
export const readSseBody = async (
  body: ReadableStream<Uint8Array>,
  onMessage: (message: SseMessage) => void,
): Promise<void> => {
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      for (const message of parser.push(decoder.decode(value, { stream: true }))) {
        onMessage(message);
      }
    }
  } finally {
    reader.releaseLock();
  }
};

// Lines end in CRLF, LF or a lone CR. A chunk can end between the CR and the LF of one CRLF,
// which must not read as two line ends, and the last line of a chunk may be unfinished.
const createLineSplitter = (): ((chunk: string) => string[]) => {
  let unfinished = "";
  let atStart = true;
  let skipLeadingLineFeed = false;

  return (chunk) => {
    if (chunk.length === 0) return [];
    let text = unfinished + chunk;
    if (atStart) {
      atStart = false;
      text = text.replace(/^﻿/, "");
    }
    if (skipLeadingLineFeed && text.startsWith("\n")) text = text.slice(1);
    skipLeadingLineFeed = text.endsWith("\r");

    const lines = text.split(/\r\n|\r|\n/);
    unfinished = lines.pop() ?? "";
    return lines;
  };
};

// A blank line ends an event; every other line sets a field of the event being built.
const createEventAssembler = (): ((line: string) => SseMessage | null) => {
  let event = "";
  let data: string[] = [];
  let id: string | null = null;

  const dispatch = (): SseMessage | null => {
    const message =
      data.length === 0 ? null : { event: event || "message", data: data.join("\n"), id };
    event = "";
    data = [];
    id = null;
    return message;
  };

  const setField = (field: string, value: string): void => {
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id" && !value.includes("\0")) id = value;
  };

  return (line) => {
    if (line === "") return dispatch();
    if (line.startsWith(":")) return null;
    const colon = line.indexOf(":");
    if (colon === -1) setField(line, "");
    else setField(line.slice(0, colon), line.slice(colon + 1).replace(/^ /, ""));
    return null;
  };
};
