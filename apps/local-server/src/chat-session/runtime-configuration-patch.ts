import {
  getDefaultRuntimeConfigurationModel,
  type ReasoningEffort,
  runtimeConfigurationSupportsFastMode,
  type UpdateChatSessionInput,
} from "@aop/common";
import type { ChatSession } from "../db/schema.ts";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import type { RuntimeProfileRepository } from "../runtime-profile/repository.ts";
import { buildUpdatePatch } from "./update-patch.ts";

export const DEFAULT_EFFORT: ReasoningEffort = "medium";

export const resolveSessionUpdatePatch = async (
  runtimeProfiles: RuntimeProfileRepository,
  runtimeConfigurations: RuntimeConfigurationRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
) => {
  // Explicit provider switch clears any configuration binding via buildUpdatePatch.
  if (input.runtime !== undefined) return buildUpdatePatch(existing, input);
  if (input.runtimeProfileId) return resolveRuntimeProfilePatch(runtimeProfiles, existing, input);

  const runtimeConfigurationId = resolveUpdateRuntimeConfigurationId(existing, input);
  if (!runtimeConfigurationId) return buildUpdatePatch(existing, input);

  return mergeConfigurationSessionPatch(
    runtimeConfigurations,
    existing,
    input,
    runtimeConfigurationId,
  );
};

const mergeConfigurationSessionPatch = async (
  runtimeConfigurations: RuntimeConfigurationRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
  runtimeConfigurationId: string,
) => {
  const configPatch = await resolveRuntimeConfigurationPatch(
    runtimeConfigurations,
    existing,
    {
      ...input,
      runtimeConfigurationId,
      model:
        input.model ??
        (input.runtimeConfigurationId === undefined ? (existing.model ?? undefined) : undefined),
    },
    {
      // User-facing PATCH must reject invalid model/effort; re-apply may fall back.
      strictModel: input.model !== undefined,
      strictEffort: input.reasoningEffort !== undefined,
    },
  );
  if (!configPatch.success) {
    const reapplyingLegacyBinding =
      input.runtimeConfigurationId === undefined &&
      configPatch.error.code === "RUNTIME_CONFIGURATION_NOT_FOUND";
    if (!reapplyingLegacyBinding) return configPatch;

    const legacyPatch = buildUpdatePatch(existing, input);
    if (!legacyPatch.success) return legacyPatch;
    return {
      success: true as const,
      patch: { ...legacyPatch.patch, runtime_configuration_id: null },
    };
  }

  const nonRuntime = buildUpdatePatch(existing, nonRuntimeUpdateInput(input));
  if (!nonRuntime.success) return nonRuntime;

  return {
    success: true as const,
    patch: {
      ...nonRuntime.patch,
      ...configPatch.patch,
    },
  };
};

/** Only re-apply a bound configuration when selecting one or editing runtime fields. */
const resolveUpdateRuntimeConfigurationId = (
  existing: ChatSession,
  input: UpdateChatSessionInput,
): string | undefined => {
  if (input.runtimeConfigurationId) return input.runtimeConfigurationId;
  if (!existing.runtime_configuration_id) return undefined;
  const editsBoundRuntime =
    input.model !== undefined ||
    input.reasoningEffort !== undefined ||
    input.fastMode !== undefined;
  return editsBoundRuntime ? existing.runtime_configuration_id : undefined;
};

const nonRuntimeUpdateInput = (input: UpdateChatSessionInput): UpdateChatSessionInput => ({
  title: input.title,
  named: input.named,
  pinned: input.pinned,
  settledOverride: input.settledOverride,
  runtimeAccessMode: input.runtimeAccessMode,
});

const resolveRuntimeProfilePatch = async (
  runtimeProfiles: RuntimeProfileRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
) => {
  const profile = await runtimeProfiles.get(input.runtimeProfileId ?? "");
  if (!profile) {
    return { success: false as const, error: { code: "RUNTIME_PROFILE_NOT_FOUND" as const } };
  }

  const nonRuntime = buildUpdatePatch(existing, nonRuntimeUpdateInput(input));
  if (!nonRuntime.success) return nonRuntime;

  return {
    success: true as const,
    patch: {
      ...nonRuntime.patch,
      runtime: profile.baseProvider,
      runtime_configuration_id: null,
      model: profile.model,
      reasoning_effort: profile.reasoning,
      runtime_alias: profile.command,
      runtime_session_id: null,
      fast_mode: profile.fastMode,
    },
  };
};

export const resolveRuntimeConfigurationPatch = async (
  runtimeConfigurations: RuntimeConfigurationRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
  options: { strictModel?: boolean; strictEffort?: boolean } = {},
) => {
  const configuration = await runtimeConfigurations.get(input.runtimeConfigurationId ?? "");
  if (!configuration) {
    return { success: false as const, error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" as const } };
  }

  const model = pickRuntimeConfigurationModel(
    configuration.models,
    input.model,
    options.strictModel,
  );
  if (!model) {
    return { success: false as const, error: { code: "INVALID_MODEL" as const } };
  }
  const follows = followsCliDefaults(existing, input);
  // Prefer configured default thinking when the bound runtime or model actually changes.
  const modelChanged =
    (!follows.model && model.model !== existing.model) ||
    (input.runtimeConfigurationId !== undefined &&
      input.runtimeConfigurationId !== existing.runtime_configuration_id);
  const effort = follows.effort
    ? { success: true as const, effort: null }
    : resolveRuntimeConfigurationEffort(
        model.thinkingLevels,
        existing.reasoning_effort,
        input.reasoningEffort,
        options.strictEffort === true,
        model.defaultThinkingLevel,
        modelChanged,
      );
  if (!effort.success) return effort;

  return {
    success: true as const,
    patch: {
      runtime: configuration.driver,
      runtime_configuration_id: configuration.id,
      model: follows.model ? null : model.model,
      reasoning_effort: effort.effort,
      runtime_alias: configuration.command,
      runtime_session_id: null,
      fast_mode: resolveConfigurationFastMode(
        runtimeConfigurationSupportsFastMode(configuration, model.model),
        existing,
        input,
      ),
    },
  };
};

// A session with no model or effort runs on the CLI's own default and keeps doing so until one is
// asked for. The configuration's default model still stands in for the efforts and Fast mode it
// accepts, but the configuration then only supplies the command.
const followsCliDefaults = (
  existing: ChatSession,
  input: UpdateChatSessionInput,
): { model: boolean; effort: boolean } => ({
  model: existing.model === null && input.model === undefined,
  effort: existing.reasoning_effort === null && input.reasoningEffort === undefined,
});

const pickRuntimeConfigurationModel = <Model extends { model: string; isDefault: boolean }>(
  models: Model[],
  requestedModel: string | undefined,
  strictModel: boolean | undefined,
): Model | undefined => {
  if (requestedModel !== undefined) {
    const matched = models.find((item) => item.model === requestedModel);
    if (matched || strictModel) return matched;
  }
  return getDefaultRuntimeConfigurationModel(models);
};

const resolveConfigurationFastMode = (
  supportsFastMode: boolean,
  existing: ChatSession,
  input: UpdateChatSessionInput,
): boolean => {
  if (!supportsFastMode) return false;
  return input.fastMode !== undefined ? input.fastMode : Boolean(existing.fast_mode);
};

const resolveRuntimeConfigurationEffort = (
  levels: string[],
  existingEffort: string | null,
  requestedEffort: string | undefined,
  strict: boolean,
  defaultThinkingLevel: string | null = null,
  preferDefault = false,
): { success: true; effort: string } | { success: false; error: { code: "INVALID_EFFORT" } } => {
  if (requestedEffort !== undefined) {
    if (levels.includes(requestedEffort)) return { success: true, effort: requestedEffort };
    if (strict) return { success: false, error: { code: "INVALID_EFFORT" } };
  } else if (!preferDefault && existingEffort !== null && levels.includes(existingEffort)) {
    // Keep sticky effort for non-model edits (e.g. fast mode toggle).
    return { success: true, effort: existingEffort };
  }
  return {
    success: true,
    effort: pickConfiguredEffort(levels, existingEffort, defaultThinkingLevel),
  };
};

const pickConfiguredEffort = (
  levels: string[],
  existingEffort: string | null,
  defaultThinkingLevel: string | null,
): string => {
  if (defaultThinkingLevel && levels.includes(defaultThinkingLevel)) return defaultThinkingLevel;
  if (existingEffort !== null && levels.includes(existingEffort)) return existingEffort;
  return levels[0] ?? DEFAULT_EFFORT;
};
