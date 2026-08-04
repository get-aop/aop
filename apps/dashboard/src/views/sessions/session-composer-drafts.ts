import type {
  ChatDocumentAttachment,
  ChatRuntimeActionSelection,
  ChatWorkflowSelection,
  ControlCommandSelection,
  RuntimeDelegationSelection,
} from "@aop/common";
import type { LocalCreateTaskImage } from "../../components/create-task-images";
import type { ComposerPasteEntry } from "./composer-paste-collapse";

export interface SessionComposerDraft {
  input: string;
  images: LocalCreateTaskImage[];
  documents: ChatDocumentAttachment[];
  /** Large clipboard pastes collapsed to `[paste #N +lines]` tokens in `input`. */
  pastes: ComposerPasteEntry[];
  runtimeDelegation: RuntimeDelegationSelection | null;
  controlSelection: ControlCommandSelection | null;
  runtimeActions: ChatRuntimeActionSelection[];
  workflowSelection: ChatWorkflowSelection | null;
  /** Fire toggle: the next message runs through the selected workflow. */
  workflowArmed: boolean;
}

const drafts = new Map<string, SessionComposerDraft>();

export const getSessionComposerDraft = (sessionId: string | null): SessionComposerDraft => {
  if (!sessionId) return emptyDraft();
  return drafts.get(sessionId) ?? emptyDraft();
};

export const updateSessionComposerDraft = (
  sessionId: string,
  update: (current: SessionComposerDraft) => SessionComposerDraft,
): SessionComposerDraft => {
  const next = update(getSessionComposerDraft(sessionId));
  drafts.set(sessionId, next);
  return next;
};

export const clearSessionComposerDraft = (sessionId: string): void => {
  drafts.delete(sessionId);
};

const emptyDraft = (): SessionComposerDraft => ({
  input: "",
  images: [],
  documents: [],
  pastes: [],
  runtimeDelegation: null,
  controlSelection: null,
  runtimeActions: [],
  workflowSelection: null,
  workflowArmed: false,
});
