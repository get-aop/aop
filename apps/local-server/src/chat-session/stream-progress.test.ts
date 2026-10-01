import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnPart } from "@aop/common";
import { startLogProgressTail } from "./stream-progress.ts";

/** The turn's reasoning and prose, each as one text, and how many tool calls it made. */
const summary = (parts: TurnPart[]) => ({
  thinking: parts.flatMap((p) => (p.type === "thinking" ? [p.text] : [])).join("\n\n"),
  content: parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n"),
  commands: parts.filter((p) => p.type === "tool").length,
});

describe("startLogProgressTail", () => {
  test("emits cumulative progress as the log grows", async () => {
    const dir = join(tmpdir(), `aop-stream-tail-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");

    const snapshots: Array<{ thinking: string; content: string }> = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (parts) => snapshots.push(summary(parts)),
      minEmitIntervalMs: 0,
      pollIntervalMs: 15,
    });

    await appendFile(logFilePath, `${claudeThought("Think")}\n`);
    await waitFor(() => snapshots.some((s) => s.thinking === "Think"), 2000);

    await appendFile(logFilePath, `${claudeText("Hi")}\n`);
    await waitFor(() => snapshots.some((s) => s.content === "Hi"), 2000);

    await stop();
    expect(snapshots.at(-1)?.thinking).toBe("Think");
    expect(snapshots.at(-1)?.content).toBe("Hi");
  });

  test("batches multiple complete JSONL events from one write into one snapshot", async () => {
    const dir = join(tmpdir(), `aop-stream-batch-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");

    const snapshots: Array<{ thinking: string; content: string; commands: number }> = [];
    const rawLines: string[] = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (parts) => snapshots.push(summary(parts)),
      onLine: (line) => {
        rawLines.push(line);
      },
      minEmitIntervalMs: 0,
      pollIntervalMs: 5,
    });

    await appendFile(
      logFilePath,
      `${[
        claudeThought("Plan"),
        claudeText("Answer"),
        JSON.stringify({
          type: "item.started",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            status: "in_progress",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            exit_code: 0,
            status: "completed",
          },
        }),
        "not-json-noise",
      ].join("\n")}\n`,
    );

    await waitFor(() => snapshots.some((s) => s.content === "Answer"), 2000);
    await stop();

    // One batched snapshot for the multi-event write (plus nothing extra for noise).
    expect(snapshots.filter((s) => s.content === "Answer")).toHaveLength(1);
    expect(snapshots.at(-1)).toMatchObject({
      thinking: "Plan",
      content: "Answer",
      commands: 1,
    });
    expect(rawLines).toContain("not-json-noise");
    expect(rawLines.length).toBeGreaterThanOrEqual(5);
  });

  test("observes unterminated final lines and force-flushes a pending throttled snapshot once", async () => {
    const dir = join(tmpdir(), `aop-stream-flush-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");

    const snapshots: Array<{ content: string }> = [];
    const rawLines: string[] = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (parts) => snapshots.push({ content: summary(parts).content }),
      onLine: (line) => {
        rawLines.push(line);
      },
      // Throttle so the incomplete write stays pending until stop force-flushes.
      minEmitIntervalMs: 60_000,
      pollIntervalMs: 5,
    });

    await appendFile(logFilePath, claudeText("Partial"));
    await Bun.sleep(20);
    expect(snapshots).toHaveLength(0);

    await stop();
    expect(rawLines).toEqual([claudeText("Partial")]);
    expect(snapshots).toEqual([{ content: "Partial" }]);
  });
});

describe("startLogProgressTail with partial messages", () => {
  test("a token whose bytes are split between two writes reaches the turn whole", async () => {
    const dir = join(tmpdir(), `aop-stream-utf8-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");
    const texts: string[] = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (parts) => texts.push(summary(parts).content),
      minEmitIntervalMs: 0,
      pollIntervalMs: 5,
    });
    const stream = (inner: Record<string, unknown>) =>
      `${JSON.stringify({ type: "stream_event", event: inner })}\n`;

    await appendFile(
      logFilePath,
      stream({ type: "content_block_start", index: 0, content_block: { type: "text" } }),
    );
    const line = Buffer.from(
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Café 🚀 ok" },
      }),
      "utf8",
    );
    const cut = line.indexOf(Buffer.from("🚀", "utf8")) + 2;
    await appendFile(logFilePath, line.subarray(0, cut));
    await Bun.sleep(30);
    await appendFile(logFilePath, line.subarray(cut));
    await waitFor(() => texts.includes("Café 🚀 ok"), 2000);
    await stop();

    expect(texts.join("")).not.toContain("\uFFFD");
  });
});

const claudeThought = (thinking: string): string =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "thinking", thinking }] } });

const claudeText = (text: string): string =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } });

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error("waitFor timed out");
};
