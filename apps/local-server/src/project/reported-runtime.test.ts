import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInitEvent } from "./reported-runtime.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aop-reported-runtime-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const log = async (...lines: unknown[]): Promise<string> => {
  const path = join(dir, "run.jsonl");
  await writeFile(
    path,
    lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"),
  );
  return path;
};

const init = (fields: Record<string, unknown>) => ({ type: "system", subtype: "init", ...fields });

describe("readInitEvent", () => {
  test("reads the model the init event names, and no effort when it names none", async () => {
    const path = await log(
      init({ model: "claude-opus-5-5", session_id: "s1" }),
      { type: "assistant", message: { model: "claude-haiku-4-5" } },
      { type: "result", subtype: "success" },
    );
    expect(await readInitEvent(path)).toEqual({ model: "claude-opus-5-5", effort: null });
  });

  test("reads an effort the init event names, when it is one AOP knows", async () => {
    expect(await readInitEvent(await log(init({ model: "m", effort: "medium" })))).toEqual({
      model: "m",
      effort: "medium",
    });
    expect(await readInitEvent(await log(init({ model: "m", effort: "turbo" })))).toEqual({
      model: "m",
      effort: null,
    });
  });

  test("a log with no init event, a synthetic model, garbage or no file reports nothing", async () => {
    const nothing = { model: null, effort: null };
    expect(await readInitEvent(await log({ type: "result" }, "not json {"))).toEqual(nothing);
    expect(await readInitEvent(await log(init({ model: "<synthetic>" })))).toEqual(nothing);
    expect(await readInitEvent(join(dir, "missing.jsonl"))).toEqual(nothing);
  });
});
