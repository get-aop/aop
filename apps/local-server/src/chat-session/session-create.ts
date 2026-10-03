import {
  type CliProvider,
  getDefaultRuntimeConfigurationModel,
  getRuntimeModelOptions,
  isCliProvider,
  type ReasoningEffort,
  type RuntimeConfigurationProvider,
  resolveRuntimeConfigurationReasoning,
} from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Repo } from "../db/schema.ts";
import { readDefaultRuntimeId } from "../runtime-configuration/default-runtime.ts";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { DEFAULT_EFFORT } from "./runtime-configuration-patch.ts";
import { toSessionDto } from "./session-dto.ts";
import type { CreateChatSessionInput, CreateChatSessionResult } from "./session-types.ts";
import { ensureGeneralChatWorkspace } from "./session-workspace.ts";
import { resolveChatWorkspace } from "./workspace-binding.ts";

const DEFAULT_RUNTIME: CliProvider = "claude-code";

const DEFAULT_TITLE = "New session";
const DEFAULT_GENERAL_TITLE = "New task";

export const createChatSession = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  input: CreateChatSessionInput,
): Promise<CreateChatSessionResult> => {
  const target = await resolveCreateSessionTarget(ctx, input);
  if (!target.success) return target;
  ctx.sessionMutationLock.assertAllowed("create", { repoId: target.repo?.id ?? null });

  const defaults = await resolveCreateSessionRuntimeDefaults(
    runtimeConfigurations,
    await readDefaultRuntimeId(ctx, runtimeConfigurations),
  );
  const now = new Date().toISOString();
  const workspacePath = target.repo
    ? await resolveChatWorkspace(target.repo.path, null)
    : await ensureGeneralChatWorkspace();
  const session = await ctx.chatSessionRepository.create({
    id: generateTypeId("isess"),
    repo_id: target.repo?.id ?? null,
    title: target.title,
    named: false,
    runtime: defaults.runtime,
    runtime_configuration_id: defaults.runtimeConfigurationId,
    model: defaults.model,
    reasoning_effort: defaults.reasoningEffort,
    runtime_alias: defaults.runtimeAlias,
    runtime_session_id: null,
    workspace_path: workspacePath,
    fast_mode: defaults.fastMode,
    runtime_access_mode: "full-access",
    pinned: false,
    settled_override: null,
    settled_at: null,
    created_at: now,
    updated_at: now,
  });

  return {
    success: true,
    session: toSessionDto(session, {
      repo_name: target.repo?.name ?? null,
      repo_path: target.repo?.path ?? null,
      last_message_content: null,
      last_message_at: null,
    }),
  };
};

type CreateSessionTargetResult =
  | { success: true; repo: Repo | null; title: string }
  | { success: false; error: { code: "INVALID_REPO" } | { code: "REPO_NOT_FOUND" } };

const resolveCreateSessionTarget = async (
  ctx: LocalServerContext,
  input: CreateChatSessionInput,
): Promise<CreateSessionTargetResult> => {
  if (input.scope === "general") {
    await ensureGeneralChatWorkspace();
    return { success: true, repo: null, title: DEFAULT_GENERAL_TITLE };
  }
  if (typeof input.repoId !== "string" || !input.repoId.trim()) {
    return { success: false, error: { code: "INVALID_REPO" } };
  }
  const repo = await ctx.repoRepository.getById(input.repoId.trim());
  if (!repo) return { success: false, error: { code: "REPO_NOT_FOUND" } };
  return { success: true, repo, title: DEFAULT_TITLE };
};

const firstModelFor = (runtime: CliProvider): string =>
  getRuntimeModelOptions(runtime)[0] ?? "default";

/**
 * Prefer the host's default runtime, then the first ordered runtime configuration that can run;
 * fall back to Claude Code catalog defaults.
 */
const resolveCreateSessionRuntimeDefaults = async (
  runtimeConfigurations: RuntimeConfigurationRepository,
  defaultRuntimeId: string,
): Promise<{
  runtime: CliProvider;
  runtimeConfigurationId: string | null;
  model: string;
  reasoningEffort: ReasoningEffort;
  runtimeAlias: string | null;
  fastMode: boolean;
}> => {
  const configurations = await runtimeConfigurations.list();
  const preferred = firstPreferredRuntimeConfiguration([
    ...configurations.filter((configuration) => configuration.id === defaultRuntimeId),
    ...configurations,
  ]);
  if (!preferred) {
    return {
      runtime: DEFAULT_RUNTIME,
      runtimeConfigurationId: null,
      model: firstModelFor(DEFAULT_RUNTIME),
      reasoningEffort: DEFAULT_EFFORT,
      runtimeAlias: null,
      fastMode: false,
    };
  }

  const model = getDefaultRuntimeConfigurationModel(preferred.models);
  const runtime = preferred.driver;
  return {
    runtime,
    runtimeConfigurationId: preferred.id,
    model: model?.model ?? firstModelFor(runtime),
    reasoningEffort: resolveRuntimeConfigurationReasoning(
      model?.thinkingLevels ?? [],
      null,
      model?.defaultThinkingLevel ?? null,
    ),
    runtimeAlias: preferred.command,
    fastMode: false,
  };
};

const firstPreferredRuntimeConfiguration = (
  configurations: RuntimeConfigurationProvider[],
): (RuntimeConfigurationProvider & { driver: CliProvider }) | undefined => {
  for (const configuration of configurations) {
    if (!isCliProvider(configuration.driver) || configuration.models.length === 0) {
      continue;
    }
    return { ...configuration, driver: configuration.driver };
  }
  return undefined;
};
