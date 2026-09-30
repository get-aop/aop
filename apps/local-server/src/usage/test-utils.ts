import type { Kysely } from "kysely";
import { seedBareChatRuns } from "../chat-session/test-utils.ts";
import type { Database } from "../db/schema.ts";
import { insertProjectRow, insertProjectSession } from "../project/test-utils.ts";
import type { RunUsageEntry } from "./types.ts";

/** A stream-json log: one event per line, as Claude Code writes it. */
export const claudeLog = (...events: object[]): string =>
  `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;

export const initEvent = (model = "claude-opus-5-5") => ({
  type: "system",
  subtype: "init",
  model,
  session_id: "sess-1",
});

export const assistantEvent = (
  id: string,
  usage: Record<string, unknown>,
  model = "claude-opus-5-5",
) => ({
  type: "assistant",
  message: { id, model, role: "assistant", content: [{ type: "text", text: "..." }], usage },
  session_id: "sess-1",
});

export const resultEvent = (fields: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: "sess-1",
  ...fields,
});

export const entry = (overrides: Partial<RunUsageEntry> = {}): RunUsageEntry => ({
  model: "claude-opus-5-5",
  inputTokens: 10,
  outputTokens: 5,
  cacheWriteTokens: 200,
  cacheReadTokens: 4000,
  costUsd: 0.5,
  ...overrides,
});

/**
 * Two projects and the sessions that the usage queries have to tell apart:
 * `prj_1` has a coordinator (`crd_1`) and two threads (`thr_1`, `thr_2`), `prj_2` has
 * `thr_other`, and `plain_1` belongs to no project. Every run id in `runs` is a completed
 * run of the session it maps to.
 */
export const seedUsageWorld = async (
  db: Kysely<Database>,
  runs: Record<string, string[]>,
): Promise<void> => {
  await insertProjectRow(db, "prj_1");
  await insertProjectRow(db, "prj_2");
  await insertProjectSession(db, { id: "crd_1", projectId: "prj_1", kind: "coordinator" });
  await insertProjectSession(db, { id: "thr_1", projectId: "prj_1", kind: "thread" });
  await insertProjectSession(db, { id: "thr_2", projectId: "prj_1", kind: "thread" });
  await insertProjectSession(db, { id: "thr_other", projectId: "prj_2", kind: "thread" });
  await seedBareChatRuns(db, [], "plain_1");
  for (const [sessionId, runIds] of Object.entries(runs)) {
    await seedBareChatRuns(db, runIds, sessionId);
  }
};
