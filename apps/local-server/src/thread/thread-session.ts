import type { Project } from "@aop/common";
import type { Kysely } from "kysely";
import { createChatSessionRepository } from "../chat-session/repository.ts";
import type { Database, Repo } from "../db/schema.ts";
import type { SessionRuntime } from "../project/runtime.ts";

/** Inserts the chat session a new thread is: `working`, on the project's thread runtime and access. */
export const insertThreadSession = async (
  db: Kysely<Database>,
  input: {
    id: string;
    project: Project;
    title: string;
    repo: Repo | null;
    workspace: string;
    runtime: SessionRuntime;
  },
): Promise<void> => {
  const now = new Date().toISOString();
  await createChatSessionRepository(db).create({
    id: input.id,
    repo_id: input.repo?.id ?? null,
    title: input.title,
    named: true,
    runtime: input.runtime.runtime,
    runtime_configuration_id: input.runtime.runtimeConfigurationId,
    model: input.runtime.model,
    reasoning_effort: input.runtime.reasoningEffort,
    runtime_alias: input.runtime.runtimeAlias,
    runtime_session_id: null,
    workspace_path: input.workspace,
    runtime_access_mode: input.project.threadAccess,
    created_at: now,
    updated_at: now,
    project_id: input.project.id,
    kind: "thread",
    state: "working",
    last_activity_at: now,
  });
};
