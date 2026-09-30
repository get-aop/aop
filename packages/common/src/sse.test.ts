import { describe, expect, test } from "bun:test";
import { createSseParser, readSseBody, type SseMessage } from "./sse.ts";

const parseAll = (chunks: string[]): SseMessage[] => {
  const parser = createSseParser();
  return chunks.flatMap((chunk) => parser.push(chunk));
};

describe("createSseParser", () => {
  test("reads named events with an id and a JSON payload", () => {
    expect(parseAll(['id: 7\nevent: entry\ndata: {"a":1}\n\n'])).toEqual([
      { event: "entry", data: '{"a":1}', id: "7" },
    ]);
  });

  test("names an event with no `event:` field `message`, and gives it no id", () => {
    expect(parseAll(["data: hi\n\n"])).toEqual([{ event: "message", data: "hi", id: null }]);
  });

  test("joins several data lines with a newline", () => {
    expect(parseAll(["data: one\ndata: two\n\n"])[0]?.data).toBe("one\ntwo");
  });

  test("keeps events whole when the bytes arrive in arbitrary pieces", () => {
    const wire = "id: 1\nevent: entry\ndata: {}\n\nevent: heartbeat\ndata: {}\n\n";
    const oneByOne = parseAll(wire.split(""));

    expect(oneByOne).toEqual(parseAll([wire]));
    expect(oneByOne.map((message) => message.event)).toEqual(["entry", "heartbeat"]);
  });

  test("treats CRLF and lone CR as line ends, even when CRLF is split across chunks", () => {
    expect(parseAll(["event: a\r\ndata: 1\r\n\r\n"])).toEqual([
      { event: "a", data: "1", id: null },
    ]);
    expect(parseAll(["event: a\rdata: 1\r\r"])).toEqual([{ event: "a", data: "1", id: null }]);
    expect(parseAll(["event: a\r", "\ndata: 1\r", "\n\r", "\n"])).toEqual([
      { event: "a", data: "1", id: null },
    ]);
  });

  test("ignores comments, unknown fields and an empty event", () => {
    expect(parseAll([": keep-alive\nretry: 3000\nfoo: bar\n\n"])).toEqual([]);
  });

  test("does not deliver an event until its blank line arrives", () => {
    const parser = createSseParser();

    expect(parser.push("event: entry\ndata: {}\n")).toEqual([]);
    expect(parser.push("\n")).toHaveLength(1);
  });

  test("removes one leading space from a value and a byte order mark from the start", () => {
    expect(parseAll(["﻿data:  two spaces\n\n"])[0]?.data).toBe(" two spaces");
    expect(parseAll(["data:none\n\n"])[0]?.data).toBe("none");
  });

  test("an id belongs to one event only", () => {
    const [first, second] = parseAll(["id: 3\ndata: a\n\ndata: b\n\n"]);

    expect(first?.id).toBe("3");
    expect(second?.id).toBeNull();
  });
});

describe("readSseBody", () => {
  test("decodes a byte stream, including a multi-byte character split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: entry\ndata: {"t":"é"}\n\n');
    const split = bytes.indexOf(0xc3) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const seen: SseMessage[] = [];

    await readSseBody(body, (message) => seen.push(message));

    expect(seen).toEqual([{ event: "entry", data: '{"t":"é"}', id: null }]);
  });

  test("rejects when the connection breaks, so a cut stream is not mistaken for a finished one", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
        controller.error(new Error("connection reset"));
      },
    });
    const seen: SseMessage[] = [];

    await expect(readSseBody(body, (message) => seen.push(message))).rejects.toThrow(
      "connection reset",
    );
  });
});
