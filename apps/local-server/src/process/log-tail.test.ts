import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLogReadState,
  getFileSize,
  readAllLogLines,
  readLogLineCount,
  readLogLines,
} from "./log-tail.ts";

describe("log-tail", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `log-tailer-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const writeJsonl = (filename: string, entries: Record<string, unknown>[]): string => {
    const path = join(testDir, filename);
    writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`);
    return path;
  };

  describe("readAllLogLines", () => {
    it("returns empty for non-existent file", async () => {
      expect(await readAllLogLines("/nonexistent/file.jsonl")).toEqual([]);
    });

    it("returns raw JSON lines from file", async () => {
      const entry = {
        type: "assistant",
        message: { content: [{ type: "text", text: "Hello world" }] },
      };
      const logFile = writeJsonl("test.jsonl", [entry]);

      const lines = await readAllLogLines(logFile);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(JSON.stringify(entry));
    });

    it("filters out empty lines", async () => {
      const path = join(testDir, "sparse.jsonl");
      writeFileSync(path, '{"type":"assistant"}\n\n{"type":"result"}\n');

      const lines = await readAllLogLines(path);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('{"type":"assistant"}');
      expect(lines[1]).toBe('{"type":"result"}');
    });

    it("counts complete lines", async () => {
      const path = join(testDir, "counted.jsonl");
      writeFileSync(path, '{"a":1}\n{"a":2}\n');
      expect(await readLogLineCount(path)).toBe(2);
    });
  });

  describe("readLogLines (incremental)", () => {
    it("returns empty for non-existent file", async () => {
      const state = createLogReadState();
      const result = await readLogLines("/nonexistent/file.jsonl", state);
      expect(result.lines).toEqual([]);
      expect(result.lineCount).toBe(0);
    });

    it("reads only newly appended bytes across calls", async () => {
      const path = join(testDir, "append.jsonl");
      writeFileSync(path, '{"type":"assistant"}\n');

      const state = createLogReadState();
      const first = await readLogLines(path, state);
      expect(first.lines).toHaveLength(1);
      expect(state.lineCount).toBe(1);

      appendFileSync(path, '{"type":"result"}\n');
      const second = await readLogLines(path, state);
      expect(second.lines).toHaveLength(1);
      expect(second.lines[0]).toBe('{"type":"result"}');
      expect(state.lineCount).toBe(2);

      // Nothing new to read.
      const third = await readLogLines(path, state);
      expect(third.lines).toHaveLength(0);
      expect(state.lineCount).toBe(2);
    });

    it("holds back a trailing partial line until a newline arrives", async () => {
      const path = join(testDir, "partial.jsonl");
      writeFileSync(path, '{"type":"assistant"}\n{"type":"res');

      const state = createLogReadState();
      const first = await readLogLines(path, state);
      expect(first.lines).toHaveLength(1);
      expect(state.lineCount).toBe(1);

      appendFileSync(path, 'ult"}\n');
      const second = await readLogLines(path, state);
      expect(second.lines).toHaveLength(1);
      expect(second.lines[0]).toBe('{"type":"result"}');
      expect(state.lineCount).toBe(2);
    });

    it("includePartial consumes the trailing partial line", async () => {
      const path = join(testDir, "final.jsonl");
      writeFileSync(path, '{"type":"assistant"}\n{"type":"res');

      const state = createLogReadState();
      const result = await readLogLines(path, state, true);
      expect(result.lines).toHaveLength(2);
      expect(result.lines[1]).toBe('{"type":"res');
      expect(state.lineCount).toBe(2);
      expect(state.byteOffset).toBe(getFileSize(path));
    });

    it("does not re-read when the file has not grown", async () => {
      const path = join(testDir, "static.jsonl");
      writeFileSync(path, '{"type":"assistant"}\n');

      const state = createLogReadState();
      await readLogLines(path, state);
      expect(state.byteOffset).toBe(getFileSize(path));

      const again = await readLogLines(path, state);
      expect(again.lines).toHaveLength(0);
      expect(state.byteOffset).toBe(getFileSize(path));
    });
  });

  describe("getFileSize", () => {
    it("returns 0 for non-existent file", () => {
      expect(getFileSize("/nonexistent/file.jsonl")).toBe(0);
    });

    it("returns file size for existing file", () => {
      const path = join(testDir, "sized.jsonl");
      writeFileSync(path, "hello\n");
      expect(getFileSize(path)).toBe(6);
    });
  });
});
