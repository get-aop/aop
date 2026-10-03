import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Kysely, sql } from "kysely";
import { parseMessageOrigin } from "../chat-session/message-origin.ts";
import { createDatabase } from "./connection.ts";
import { applyMigrations, runMigrations } from "./migrations.ts";
import type { Database } from "./schema.ts";
import { migrationsThrough } from "./test-utils.ts";

const RELAY = '{"type":"coordinator-relay","quote":null}';
const QUOTED = '{"type":"coordinator-relay","quote":"ship it friday"}';

describe("migration v26 on a database that ran versions 1 to 25", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await applyMigrations(db, migrationsThrough(25));
    await sql`
      INSERT INTO projects (id, name, coordinator_provider, thread_provider)
      VALUES ('prj_1', 'Checkout', 'claude-code', 'claude-code')
    `.execute(db);
    for (const id of ["thr_a", "thr_b", "thr_routine", "thr_person"]) {
      await sql`INSERT INTO chat_sessions (id, title, runtime) VALUES (${id}, ${id}, 'claude-code')`.execute(
        db,
      );
    }
  });

  afterEach(async () => {
    await db.destroy();
  });

  const message = (
    id: string,
    session: string,
    turn: number,
    content: string,
    origin: string | null,
  ) =>
    sql`
      INSERT INTO chat_messages (id, session_id, role, content, turn_index, created_at, origin_json)
      VALUES (${id}, ${session}, 'user', ${content}, ${turn}, ${`2026-10-0${turn + 1}T00:00:00.000Z`}, ${origin})
    `.execute(db);

  const originOf = async (id: string) =>
    parseMessageOrigin(
      (
        await db
          .selectFrom("chat_messages")
          .select("origin_json")
          .where("id", "=", id)
          .executeTakeFirstOrThrow()
      ).origin_json,
    );

  test("marks the coordinator's first message in a thread as its brief, and no later steer", async () => {
    await message("m_brief", "thr_a", 0, "Fix the login redirect.", QUOTED);
    await message("m_steer", "thr_a", 1, "Also check the logout.", RELAY);
    await message("m_person", "thr_a", 2, "And the docs.", null);

    await runMigrations(db);

    expect(await originOf("m_brief")).toEqual({
      type: "coordinator-relay",
      quote: "ship it friday",
      brief: true,
    });
    expect(await originOf("m_steer")).toEqual({ type: "coordinator-relay", quote: null });
    expect(await originOf("m_person")).toBeNull();
  });

  test("leaves a thread whose first message is not the coordinator's without a brief", async () => {
    await message("m_first", "thr_person", 0, "Started by hand.", null);
    await message("m_relay", "thr_person", 1, "A steer.", RELAY);

    await runMigrations(db);

    expect(await originOf("m_first")).toBeNull();
    expect(await originOf("m_relay")).toEqual({ type: "coordinator-relay", quote: null });
  });

  test("gives the brief a routine's run wrote to the routine, with the routine's words", async () => {
    await sql`
      INSERT INTO routines (id, project_id, name, prompt, schedule_json, target, created_by)
      VALUES ('rtn_1', 'prj_1', 'Weekly deps', 'Check the deps.', '{"kind":"daily","time":"09:00"}', 'thread', 'person')
    `.execute(db);
    await sql`
      INSERT INTO routine_runs (id, routine_id, occurrence_key, occurrence, trigger, state, thread_id)
      VALUES ('run_1', 'rtn_1', 'k1', '2026-10-01T09:00:00.000Z', 'schedule', 'started', 'thr_routine')
    `.execute(db);
    await message(
      "m_routine",
      "thr_routine",
      0,
      'This thread was started by the routine "Weekly deps" for its run of Thu, 1 Oct 2026.\n\nCheck the deps.\n\nThen report.',
      RELAY,
    );
    await message("m_later", "thr_routine", 1, "A steer.", RELAY);
    await message("m_other", "thr_b", 0, "Unrelated brief.", RELAY);

    await runMigrations(db);

    expect(await originOf("m_routine")).toEqual({
      type: "routine",
      routineId: "rtn_1",
      name: "Weekly deps",
      prompt: "Check the deps.\n\nThen report.",
    });
    expect(await originOf("m_later")).toEqual({ type: "coordinator-relay", quote: null });
    expect(await originOf("m_other")).toEqual({
      type: "coordinator-relay",
      quote: null,
      brief: true,
    });
  });
});
