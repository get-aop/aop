import type { Project, ThreadTarget } from "@aop/common";
import type { Kysely } from "kysely";
import { createChatSessionRepository } from "../chat-session/repository.ts";
import { READ_ONLY_ACCESS } from "../chat-session/run-profile.ts";
import type { Database, Repo } from "../db/schema.ts";
import type { SessionRuntime } from "../project/runtime.ts";

const HOST_TARGET: ThreadTarget = { kind: "host" };

/**
 * Inserts the chat session a new thread is: `working`, on the project's thread runtime and access.
 * A read-only thread runs `approval-required` instead: a headless run with no permission-skipping
 * flag, so edits and commands that were not pre-approved (see chat-session/run-profile.ts) are
 * denied, and a later change to the project's thread access leaves it as it is.
 */
export const insertThreadSession = async (
  db: Kysely<Database>,
  input: {
    id: string;
    project: Project;
    title: string;
    repo: Repo | null;
    workspace: string;
    /** The thread's own branch; null for a thread with no repo. */
    branch: string | null;
    runtime: SessionRuntime;
    readOnly: boolean;
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
    branch: input.branch,
    target_json: JSON.stringify(HOST_TARGET),
    runtime_access_mode: input.readOnly ? READ_ONLY_ACCESS : input.project.threadAccess,
    created_at: now,
    updated_at: now,
    project_id: input.project.id,
    kind: "thread",
    state: "working",
    last_activity_at: now,
  });
};
