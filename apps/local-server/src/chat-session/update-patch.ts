import {
  getWorkflowModelOptions,
  isWorkflowRuntimeProvider,
  type UpdateChatSessionInput,
  WORKFLOW_THINKING_OPTIONS,
  type WorkflowRuntimeProvider,
  type WorkflowRuntimeReasoning,
} from "@aop/common";
import type { ChatSession } from "../db/schema.ts";

type PatchError =
  | { code: "INVALID_RUNTIME" }
  | { code: "INVALID_MODEL" }
  | { code: "INVALID_EFFORT" }
  | { code: "INVALID_FAST_MODE" }
  | { code: "INVALID_ACCESS_MODE" }
  | { code: "INVALID_SETTLED_OVERRIDE" }
  | { code: "INVALID_TITLE" };

export type BuildUpdatePatchResult =
  | { success: true; patch: Partial<ChatSession> }
  | { success: false; error: PatchError };

export const buildUpdatePatch = (
  existing: ChatSession,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult => {
  const patch: Partial<ChatSession> = {};

  const titleResult = applyTitle(patch, input);
  if (titleResult) return titleResult;

  applyFlags(patch, input);

  if (
    input.settledOverride !== undefined &&
    input.settledOverride !== "settled" &&
    input.settledOverride !== "active"
  ) {
    return { success: false, error: { code: "INVALID_SETTLED_OVERRIDE" } };
  }

  const runtimeResult = applyRuntime(patch, input);
  if (runtimeResult) return runtimeResult;

  const modelResult = applyModel(patch, existing, input);
  if (modelResult) return modelResult;

  const effortResult = applyEffort(patch, input);
  if (effortResult) return effortResult;

  const fastModeResult = applyFastMode(patch, existing, input);
  if (fastModeResult) return fastModeResult;

  const accessModeResult = applyRuntimeAccessMode(patch, input);
  if (accessModeResult) return accessModeResult;

  applyContextChips(patch, input);
  return { success: true, patch };
};

const applyContextChips = (patch: Partial<ChatSession>, input: UpdateChatSessionInput): void => {
  if (input.defaultWorkerId !== undefined) {
    patch.default_worker_id =
      input.defaultWorkerId === null || input.defaultWorkerId.trim() === ""
        ? null
        : input.defaultWorkerId.trim();
  }
  if (input.defaultWorkflowId !== undefined) {
    patch.default_workflow_id =
      input.defaultWorkflowId === null || input.defaultWorkflowId.trim() === ""
        ? null
        : input.defaultWorkflowId.trim();
  }
};

const applyTitle = (
  patch: Partial<ChatSession>,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult | null => {
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) return { success: false, error: { code: "INVALID_TITLE" } };
    patch.title = title;
    patch.named = input.named ?? true;
    return null;
  }
  if (input.named !== undefined) patch.named = input.named;
  return null;
};

const applyFlags = (patch: Partial<ChatSession>, input: UpdateChatSessionInput): void => {
  if (input.pinned !== undefined) patch.pinned = input.pinned;
};

const applyRuntime = (
  patch: Partial<ChatSession>,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult | null => {
  if (input.runtime === undefined) return null;
  if (!isWorkflowRuntimeProvider(input.runtime)) {
    return { success: false, error: { code: "INVALID_RUNTIME" } };
  }
  patch.runtime = input.runtime;
  patch.runtime_configuration_id = null;
  patch.model = getWorkflowModelOptions(input.runtime)[0] ?? "default";
  patch.runtime_session_id = null;
  return null;
};

const applyModel = (
  patch: Partial<ChatSession>,
  existing: ChatSession,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult | null => {
  if (input.model === undefined || input.runtime !== undefined) return null;
  const runtime = existing.runtime as WorkflowRuntimeProvider;
  if (
    !isWorkflowRuntimeProvider(runtime) ||
    !getWorkflowModelOptions(runtime).includes(input.model)
  ) {
    return { success: false, error: { code: "INVALID_MODEL" } };
  }
  patch.model = input.model;
  return null;
};

const applyEffort = (
  patch: Partial<ChatSession>,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult | null => {
  if (input.reasoningEffort === undefined) return null;
  const valid = WORKFLOW_THINKING_OPTIONS.some((option) => option.value === input.reasoningEffort);
  if (!valid) return { success: false, error: { code: "INVALID_EFFORT" } };
  patch.reasoning_effort = input.reasoningEffort as WorkflowRuntimeReasoning;
  return null;
};

const applyFastMode = (
  patch: Partial<ChatSession>,
  _existing: ChatSession,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult | null => {
  if (input.fastMode === undefined) return null;
  // Capability is configured per runtime in Runtime configuration; the session
  // stores the user preference. Runtimes that lack Fast ignore the flag.
  patch.fast_mode = input.fastMode;
  return null;
};

const applyRuntimeAccessMode = (
  patch: Partial<ChatSession>,
  input: UpdateChatSessionInput,
): BuildUpdatePatchResult | null => {
  if (input.runtimeAccessMode === undefined) return null;
  if (!RUNTIME_ACCESS_MODES.has(input.runtimeAccessMode)) {
    return { success: false, error: { code: "INVALID_ACCESS_MODE" } };
  }
  patch.runtime_access_mode = input.runtimeAccessMode;
  return null;
};

const RUNTIME_ACCESS_MODES = new Set([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
]);
