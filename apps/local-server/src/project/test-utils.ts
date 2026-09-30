import type { ProjectSettings } from "@aop/common";
import type { Insertable, Kysely } from "kysely";
import type { ChatSessionKind, ChatSessionsTable, Database } from "../db/schema.ts";

export const projectSettings = (overrides: Partial<ProjectSettings> = {}): ProjectSettings => ({
  name: "Checkout revamp",
  goal: "Ship the new checkout",
  instructions: "Keep pull requests small.",
  coordinator: { provider: "claude-code", model: null, effort: "low" },
  thread: { provider: "claude-code", model: "claude-opus-4-8", effort: "high" },
  notificationLevel: "coordinator",
  repoIds: [],
  ...overrides,
});

/** Inserts a bare project row, bypassing the repository, for tests of the schema itself. */
export const insertProjectRow = async (db: Kysely<Database>, id: string): Promise<void> => {
  await db
    .insertInto("projects")
    .values({
      id,
      name: id,
      coordinator_provider: "claude-code",
      coordinator_model: null,
      coordinator_effort: null,
      thread_provider: "claude-code",
      thread_model: null,
      thread_effort: null,
    })
    .execute();
};

type SessionColumns = Partial<Insertable<ChatSessionsTable>>;

/**
 * Inserts a chat_sessions row that belongs to a project. A thread starts `working`; a
 * coordinator has no state. `columns` overrides any column, valid or not.
 */
export const insertProjectSession = async (
  db: Kysely<Database>,
  session: { id: string; projectId: string; kind: ChatSessionKind },
  columns: SessionColumns = {},
): Promise<void> => {
  await db
    .insertInto("chat_sessions")
    .values({
      id: session.id,
      repo_id: null,
      title: session.id,
      runtime: "claude-code",
      runtime_configuration_id: null,
      model: "claude-opus-4-8",
      reasoning_effort: "medium",
      runtime_alias: null,
      runtime_session_id: null,
      workspace_path: null,
      created_at: "2026-09-30T09:00:00.000Z",
      updated_at: "2026-09-30T09:00:00.000Z",
      project_id: session.projectId,
      kind: session.kind,
      state: session.kind === "thread" ? "working" : null,
      last_activity_at: "2026-09-30T09:00:00.000Z",
      ...columns,
    })
    .execute();
};
