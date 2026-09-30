import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "@aop/common";
import { aopPaths, generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import { createChatSessionRepository } from "../chat-session/repository.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession, Database } from "../db/schema.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { resolveSessionRuntime, type SessionRuntime } from "./runtime.ts";

/**
 * A project's coordinator is one long-lived chat session (kind `coordinator`), created with
 * the project. Its workspace is a directory of its own, never a repo: it is given no file tools
 * to use there, and a stable directory keeps Claude's native session resumable across turns.
 */

export const prepareCoordinatorWorkspace = async (projectId: string): Promise<string> => {
  const workspace = join(aopPaths.projectDir(projectId), "coordinator");
  await mkdir(workspace, { recursive: true });
  return realpath(workspace);
};

export const resolveCoordinatorRuntime = (
  ctx: LocalServerContext,
  preference: Project["coordinator"],
): Promise<SessionRuntime> =>
  resolveSessionRuntime(createRuntimeConfigurationRepository(ctx.db), preference);

export const insertCoordinatorSession = async (
  db: Kysely<Database>,
  input: { projectId: string; name: string; runtime: SessionRuntime; workspace: string },
): Promise<ChatSession> => {
  const now = new Date().toISOString();
  return createChatSessionRepository(db).create({
    id: generateTypeId("isess"),
    repo_id: null,
    title: input.name,
    named: true,
    runtime: input.runtime.runtime,
    runtime_configuration_id: input.runtime.runtimeConfigurationId,
    model: input.runtime.model,
    reasoning_effort: input.runtime.reasoningEffort,
    runtime_alias: input.runtime.runtimeAlias,
    runtime_session_id: null,
    workspace_path: input.workspace,
    // Fails closed: no permission-skipping flag, and run-profile.ts pins this for every run.
    runtime_access_mode: "approval-required",
    created_at: now,
    updated_at: now,
    project_id: input.projectId,
    kind: "coordinator",
    last_activity_at: now,
  });
};

/**
 * Points the coordinator's session at the name and runtime the project now asks for. The native
 * session binding stays, so the conversation continues; a run in flight keeps what it started with.
 */
export const syncCoordinatorSession = async (
  ctx: LocalServerContext,
  project: Project,
): Promise<void> => {
  const coordinator = await ctx.chatSessionRepository.getCoordinator(project.id);
  if (!coordinator) return;
  const runtime = await resolveCoordinatorRuntime(ctx, project.coordinator);
  await ctx.chatSessionRepository.update(coordinator.id, {
    title: project.name,
    runtime: runtime.runtime,
    runtime_configuration_id: runtime.runtimeConfigurationId,
    runtime_alias: runtime.runtimeAlias,
    model: runtime.model,
    reasoning_effort: runtime.reasoningEffort,
    updated_at: new Date().toISOString(),
  });
};
