import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  buildClaudeInterruptRequest,
  buildClaudeUserMessage,
  prepareStdinPrompt,
  takesStdinPrompt,
} from "./claude-code-input";

const bytesOf: Record<string, Buffer> = {
  "/a.png": Buffer.from("png bytes"),
  "/b.jpg": Buffer.from("jpeg bytes"),
};
const readImage = (path: string): Buffer => {
  const bytes = bytesOf[path];
  if (!bytes) throw new Error(`no such file: ${path}`);
  return bytes;
};

describe("buildClaudeInterruptRequest", () => {
  test("is one control_request line asking for an interrupt, under the id it was given", () => {
    const line = buildClaudeInterruptRequest("req-1");

    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      type: "control_request",
      request_id: "req-1",
      request: { subtype: "interrupt" },
    });
  });

  test("gets an id of its own when given none", () => {
    const ids = [buildClaudeInterruptRequest(), buildClaudeInterruptRequest()].map(
      (line) => JSON.parse(line).request_id,
    );
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("buildClaudeUserMessage", () => {
  test("is one stream-json user line: the images in order as base64 blocks, then the text", () => {
    const line = buildClaudeUserMessage(
      "What is in #image1 and #image2?",
      [
        { path: "/a.png", mimeType: "image/png" },
        { path: "/b.jpg", mimeType: "image/jpeg" },
      ],
      readImage,
    );

    expect(line.endsWith("\n")).toBe(true);
    expect(line.trim().includes("\n")).toBe(false);
    expect(JSON.parse(line)).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: Buffer.from("png bytes").toString("base64"),
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: Buffer.from("jpeg bytes").toString("base64"),
            },
          },
          { type: "text", text: "What is in #image1 and #image2?" },
        ],
      },
    });
  });

  test("keeps a prompt with newlines and quotes intact", () => {
    const prompt = 'line one\nline "two"';
    const line = buildClaudeUserMessage(
      prompt,
      [{ path: "/a.png", mimeType: "image/png" }],
      readImage,
    );

    expect(JSON.parse(line).message.content.at(-1)).toEqual({ type: "text", text: prompt });
  });
});

describe("prepareStdinPrompt", () => {
  test("a prompt without images stays an argument: no file", () => {
    expect(takesStdinPrompt({})).toBe(false);
    expect(takesStdinPrompt({ images: [] })).toBe(false);
    expect(prepareStdinPrompt({ prompt: "hi", images: [] })).toBeNull();
  });

  test("writes the message for stdin, and remove deletes it", () => {
    const prepared = prepareStdinPrompt({
      prompt: "look",
      images: [{ path: import.meta.path, mimeType: "image/png" }],
    });
    if (!prepared) throw new Error("expected a stdin prompt");

    const message = JSON.parse(readFileSync(prepared.path, "utf8"));
    expect(message.message.content.map((block: { type: string }) => block.type)).toEqual([
      "image",
      "text",
    ]);
    prepared.remove();
    expect(existsSync(prepared.path)).toBe(false);
    prepared.remove();
  });
});
