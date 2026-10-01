import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import type { ChatRunStatus, Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { type AgentCliRunRepository, createAgentCliRunRepository } from "./run-repository.ts";

describe("createAgentCliRunRepository", () => {
  let db: Kysely<Database>;
  let runs: AgentCliRunRepository;
  let dir: string;

  const addRun = async (
    id: string,
    input: { runtime?: string; status: ChatRunStatus; cliVersion?: string; updatedAt?: string },
  ) => {
    // A session runs one turn at a time, so each run gets a session of its own.
    const sessionId = `s_${id}`;
    await db
      .insertInto("chat_sessions")
      .values({ id: sessionId, title: "Chat", runtime: input.runtime ?? "claude-code" })
      .execute();
    await db
      .insertInto("chat_messages")
      .values({ id: `${id}_u`, session_id: sessionId, role: "user", content: "Hi" })
      .execute();
    await db
      .insertInto("chat_runs")
      .values({
        id,
        session_id: sessionId,
        user_message_id: `${id}_u`,
        assistant_message_id: `${id}_a`,
        runtime: input.runtime ?? "claude-code",
        log_file_path: join(dir, `${id}.jsonl`),
        status: input.status,
        runtime_session_id: null,
        resume_session_id: null,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: null,
        workspace_path: null,
        timeout_policy: null,
        retry_of_run_id: null,
        runtime_session_state: null,
        error_message: null,
        pid: null,
        cli_version: input.cliVersion ?? null,
        ...(input.updatedAt ? { updated_at: input.updatedAt } : {}),
      })
      .execute();
  };

  beforeEach(async () => {
    db = await createTestDb();
    runs = createAgentCliRunRepository(db);
    dir = mkdtempSync(join(tmpdir(), "aop-cli-runs-"));
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  test("lists only the running runs of that runtime", async () => {
    await addRun("r1", { status: "running" });
    await addRun("r2", { status: "completed" });
    await addRun("r3", { status: "running", runtime: "codex-cli" });

    expect(await runs.activeRuns("claude-code")).toEqual([{ logFilePath: join(dir, "r1.jsonl") }]);
  });

  test("names the version the most recent finished run reported", async () => {
    expect(await runs.lastRunVersion("claude-code")).toBeNull();
    await addRun("r1", {
      status: "completed",
      cliVersion: "2.1.285",
      updatedAt: "2026-10-01 10:00:00",
    });
    await addRun("r2", {
      status: "completed",
      cliVersion: "2.1.286",
      updatedAt: "2026-10-01 11:00:00",
    });
    await addRun("r3", { status: "running", updatedAt: "2026-10-01 12:00:00" });
    expect(await runs.lastRunVersion("claude-code")).toBe("2.1.286");
  });

  test("reads the versions runs in flight started on from their logs, once each", async () => {
    const init = (version: string) =>
      `${JSON.stringify({ type: "system", subtype: "init", claude_code_version: version })}\n`;
    writeFileSync(join(dir, "a.jsonl"), init("2.1.285"));
    writeFileSync(join(dir, "b.jsonl"), init("2.1.285"));
    writeFileSync(join(dir, "c.jsonl"), init("2.1.286"));
    const versions = await runs.activeRunVersions(
      ["a", "b", "c", "missing"].map((name) => ({ logFilePath: join(dir, `${name}.jsonl`) })),
      "claude_code_version",
    );
    expect(versions).toEqual(["2.1.285", "2.1.286"]);
  });
});
