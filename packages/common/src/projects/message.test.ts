import { describe, expect, test } from "bun:test";
import { AssistantMessageSchema, MessageSchema } from "./message.ts";
import {
  makeAssistantMessage,
  makeThreadReportMessage,
  makeUserMessage,
  parsed,
  rejectedPaths,
} from "./test-utils.ts";

describe("MessageSchema", () => {
  test("accepts a reply that says which message it answers", () => {
    const reply = makeAssistantMessage({ inReplyTo: "smsg_1" });

    expect(parsed(MessageSchema, reply)).toEqual(reply);
  });

  test("accepts a user message in the coordinator chat", () => {
    expect(parsed(MessageSchema, makeUserMessage())).toEqual(makeUserMessage());
  });

  test("accepts the coordinator's reply: routing receipt, prose with an inline chip, and cards", () => {
    const message = makeAssistantMessage({
      blocks: [
        { type: "routing-receipt", threadIds: ["thr_1", "thr_2"] },
        { type: "text", text: "Sent your note to " },
        { type: "thread-chip", threadId: "thr_1" },
        { type: "text", text: ". Two threads now:" },
        { type: "thread-card", threadId: "thr_1", variant: "live" },
        { type: "thread-card", threadId: "thr_2", variant: "needs-call" },
      ],
    });
    expect(parsed(MessageSchema, message)).toEqual(message);
  });

  test("accepts a relay into a thread: forwarded quote, then the brief", () => {
    const message = makeAssistantMessage({
      threadId: "thr_1",
      blocks: [
        { type: "quote-forwarded", text: "release moved to Monday" },
        { type: "text", text: "Redate the draft and confirm here." },
      ],
    });
    expect(parsed(MessageSchema, message)).toEqual(message);
  });

  test("accepts a thread report, which lives in the coordinator chat", () => {
    for (const outcome of ["finished", "needs-you", "failed"]) {
      const report = makeThreadReportMessage({ outcome });
      expect(parsed(MessageSchema, report)).toEqual(report);
    }
  });

  test("rejects a thread report inside a thread, without a subject, or with an unknown outcome", () => {
    expect(rejectedPaths(MessageSchema, makeThreadReportMessage({ threadId: "thr_1" }))).toEqual([
      "threadId",
    ]);
    expect(rejectedPaths(MessageSchema, makeThreadReportMessage({ reportedThreadId: "" }))).toEqual(
      ["reportedThreadId"],
    );
    expect(rejectedPaths(MessageSchema, makeThreadReportMessage({ outcome: "done" }))).toEqual([
      "outcome",
    ]);
  });

  test("rejects a role that is not user, assistant, or thread-report", () => {
    expect(rejectedPaths(MessageSchema, makeUserMessage({ role: "system" }))).toEqual(["role"]);
  });

  test("rejects an assistant message with no blocks", () => {
    expect(rejectedPaths(MessageSchema, makeAssistantMessage({ blocks: [] }))).toEqual(["blocks"]);
  });

  test("rejects an invalid block inside an assistant message, naming its position", () => {
    const message = makeAssistantMessage({
      blocks: [
        { type: "text", text: "ok" },
        { type: "thread-card", threadId: "thr_1", variant: "gone" },
      ],
    });
    expect(rejectedPaths(MessageSchema, message)).toEqual(["blocks.1.variant"]);
  });

  test("rejects a user message that carries blocks instead of text", () => {
    const { text: _text, ...withoutText } = makeUserMessage();
    const message = { ...withoutText, blocks: [{ type: "text", text: "hi" }] };
    expect(rejectedPaths(MessageSchema, message)).toEqual(["text"]);
  });

  test("rejects an assistant message that carries text instead of blocks", () => {
    const { blocks: _blocks, ...withoutBlocks } = makeAssistantMessage();
    expect(rejectedPaths(MessageSchema, { ...withoutBlocks, text: "hi" })).toEqual(["blocks"]);
  });

  test("rejects a message with no conversation or an empty user text", () => {
    const { threadId: _threadId, ...withoutThread } = makeUserMessage();
    expect(rejectedPaths(MessageSchema, withoutThread)).toEqual(["threadId"]);
    expect(rejectedPaths(MessageSchema, makeUserMessage({ text: "" }))).toEqual(["text"]);
  });

  test("AssistantMessageSchema refuses a user message", () => {
    expect(AssistantMessageSchema.safeParse(makeUserMessage()).success).toBe(false);
  });
});
