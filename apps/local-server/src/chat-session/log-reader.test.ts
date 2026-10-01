import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogReader } from "./log-reader.ts";

describe("createLogReader", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aop-log-reader-"));
    path = join(dir, "run.jsonl");
    await writeFile(path, "");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reads only what the log gained since the last read", async () => {
    const reader = createLogReader(path);
    await appendFile(path, "one\n");
    expect(await reader.read()).toBe("one\n");
    expect(await reader.read()).toBe("");
    await appendFile(path, "two\n");
    expect(await reader.read()).toBe("two\n");
  });

  test("a character whose bytes are split between two writes arrives whole, not garbled", async () => {
    const reader = createLogReader(path);
    const text = Buffer.from('{"text":"café 🚀"}\n', "utf8");
    const inEmoji = text.indexOf(Buffer.from("🚀", "utf8")) + 2;
    const inE = text.indexOf(Buffer.from("é", "utf8")) + 1;

    await appendFile(path, text.subarray(0, inE));
    const first = await reader.read();
    await appendFile(path, text.subarray(inE, inEmoji));
    const second = await reader.read();
    await appendFile(path, text.subarray(inEmoji));
    const third = await reader.read();

    expect(first + second + third).toBe('{"text":"café 🚀"}\n');
    expect(`${first}${second}${third}`).not.toContain("�");
  });

  test("a missing log reads as nothing, and an unfinished character is given up at the end", async () => {
    const missing = createLogReader(join(dir, "none.jsonl"));
    expect(await missing.read()).toBe("");

    const reader = createLogReader(path);
    await appendFile(path, Buffer.from("é", "utf8").subarray(0, 1));
    expect(await reader.read()).toBe("");
    expect(reader.end()).toBe("�");
  });
});
