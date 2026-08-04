import {
  CHAT_DOCUMENT_LIMITS,
  type ChatActionPayload,
  type ChatDocumentAttachment,
  CREATE_TASK_IMAGE_LIMITS,
  formatRuntimeDelegationMarker,
  rewriteControlCommandMarker,
} from "@aop/common";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSessionDetail, ChatSessionMessage } from "../../api/client";
import type { LocalCreateTaskImage } from "../../components/create-task-images";
import {
  clipboardItemsToLocalCreateTaskImages,
  fileToLocalCreateTaskImage,
  mergeLocalCreateTaskImages,
  revokeLocalCreateTaskImages,
} from "../../components/create-task-images";
import { fileToChatDocument, mergeChatDocuments } from "./chat-documents";
import { type ComposerPasteEntry, expandPasteTokens } from "./composer-paste-collapse";
import {
  clearSessionComposerDraft,
  getSessionComposerDraft,
  updateSessionComposerDraft,
} from "./session-composer-drafts";
import {
  clearSessionReviewQueue,
  getSessionReviewQueue,
  removeSessionReviewComment,
  restoreSessionReviewQueueIfEmpty,
  updateSessionReviewComment,
  useSessionReviewQueue,
} from "./session-review-queue";
import { serializeReviewMessage } from "./session-review-serializer";
import { sendChatWithOptimistic } from "./sessions-page-model";

interface SessionComposerStateInput {
  active: ChatSessionDetail | null;
  typing: boolean;
  setTyping: (value: boolean) => void;
  setStreamProgress: (
    value: {
      thinking: string;
      content: string;
      commandGroups: [];
    } | null,
  ) => void;
  setDetail: (updater: (current: ChatSessionDetail | null) => ChatSessionDetail | null) => void;
  setMidRunHints: (
    updater: (
      current: Record<string, "queued" | "steered">,
    ) => Record<string, "queued" | "steered">,
  ) => void;
  isActiveSession?: (sessionId: string) => boolean;
  showToast: (message: string) => void;
  refreshList: () => Promise<unknown>;
  /** Active chat workflow run: locks the composer; clears the fire toggle on completion. */
  workflowRun?: import("./composer-types").WorkflowRunViewState | null;
}

export const useSessionComposer = (input: SessionComposerStateInput) => {
  const [, setRevision] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const sessionId = input.active?.id ?? null;
  const draft = getSessionComposerDraft(sessionId);
  const reviewComments = useSessionReviewQueue(sessionId);
  const pendingImages = draft.images;
  const pendingDocuments = draft.documents;
  const pastes = draft.pastes;
  const runtimeDelegation = draft.runtimeDelegation;
  const controlSelection = draft.controlSelection;
  const runtimeActions = draft.runtimeActions;
  const workflowSelection = draft.workflowSelection;
  const workflowArmed = draft.workflowArmed;

  const updateDraft = useCallback(
    (targetSessionId: string, update: Parameters<typeof updateSessionComposerDraft>[1]) => {
      const next = updateSessionComposerDraft(targetSessionId, update);
      setRevision((current) => current + 1);
      return next;
    },
    [],
  );

  const clear = useCallback(() => {
    if (!sessionId) return;
    revokeLocalCreateTaskImages(getSessionComposerDraft(sessionId).images);
    clearSessionComposerDraft(sessionId);
    setRevision((current) => current + 1);
  }, [sessionId]);

  const addImages = useCallback(
    (targetSessionId: string, incoming: LocalCreateTaskImage[]) => {
      if (incoming.length === 0) return;
      const current = getSessionComposerDraft(targetSessionId);
      const merged = mergeLocalCreateTaskImages(current.images, incoming);
      if (typeof merged === "string") {
        revokeLocalCreateTaskImages(incoming);
        input.showToast(merged);
        return;
      }
      updateDraft(targetSessionId, (draft) => ({ ...draft, images: merged }));
    },
    [input.showToast, updateDraft],
  );

  const attachImages = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !sessionId) return;
      const targetSessionId = sessionId;
      try {
        const incoming: LocalCreateTaskImage[] = [];
        for (const file of Array.from(files)) {
          incoming.push(await fileToLocalCreateTaskImage(file));
        }
        addImages(targetSessionId, incoming);
      } catch (error) {
        input.showToast(error instanceof Error ? error.message : "Failed to add image");
      }
    },
    [addImages, input.showToast, sessionId],
  );

  const pasteImages = useCallback(
    async (items: DataTransferItemList) => {
      if (!sessionId) return;
      const targetSessionId = sessionId;
      try {
        addImages(targetSessionId, await clipboardItemsToLocalCreateTaskImages(items));
      } catch (error) {
        input.showToast(error instanceof Error ? error.message : "Failed to paste image");
      }
    },
    [addImages, input.showToast, sessionId],
  );

  const removeImage = useCallback(
    (id: string) => {
      if (!sessionId) return;
      updateDraft(sessionId, (current) => {
        const target = current.images.find((image) => image.id === id);
        if (target) revokeLocalCreateTaskImages([target]);
        return { ...current, images: current.images.filter((image) => image.id !== id) };
      });
    },
    [sessionId, updateDraft],
  );

  const attachDocuments = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || !sessionId) return;
      const targetSessionId = sessionId;
      try {
        const incoming = await Promise.all(Array.from(files).map(fileToChatDocument));
        const merged = mergeChatDocuments(
          getSessionComposerDraft(targetSessionId).documents,
          incoming,
        );
        if (typeof merged === "string") {
          input.showToast(merged);
          return;
        }
        updateDraft(targetSessionId, (draft) => ({ ...draft, documents: merged }));
      } catch (error) {
        input.showToast(error instanceof Error ? error.message : "Failed to add document");
      }
    },
    [input.showToast, sessionId, updateDraft],
  );

  const sendUnchecked = async (override?: string): Promise<void> => {
    if (!input.active) return;
    const sessionId = input.active.id;
    const snapshot = composerSendSnapshot(sessionId, override);
    if (!snapshot) return;
    const {
      displayContent,
      imagesSnapshot,
      documentsSnapshot,
      pastesSnapshot,
      delegationSnapshot,
      runtimeActionsSnapshot,
      workflowSelectionSnapshot,
      workflowArmedSnapshot,
      reviewSnapshot,
      typedSnapshot,
      isSlashCommand,
    } = snapshot;
    // Composer draft keeps compact tokens; the chat bubble shows expanded paste bodies.
    // Armed workflow runs render no proposal card — the run status line replaces it.
    const optimisticAction = workflowArmedSnapshot
      ? null
      : composerAction(runtimeActionsSnapshot, workflowSelectionSnapshot);
    const tempId = appendOptimisticUser(
      input.setDetail,
      sessionId,
      expandPasteTokens(displayContent, pastesSnapshot),
      imagesSnapshot,
      documentsSnapshot,
      optimisticAction,
    );
    updateDraft(sessionId, () => ({
      input: "",
      images: [],
      documents: [],
      pastes: [],
      runtimeDelegation: null,
      controlSelection: null,
      runtimeActions: [],
      // The fire toggle and its selection stay until the run completes.
      workflowSelection: workflowArmedSnapshot ? draft.workflowSelection : null,
      workflowArmed: draft.workflowArmed,
    }));
    // Drain the review queue at send time; restored below only if the send fails.
    if (!isSlashCommand) clearSessionReviewQueue(sessionId);
    await sendChatWithOptimistic({
      sessionId,
      content: displayContent,
      requestContent: displayContent,
      imagesSnapshot,
      documentsSnapshot,
      pastesSnapshot: pastesSnapshot.map(({ index, lineCount, content: pasteContent }) => ({
        index,
        lineCount,
        content: pasteContent,
      })),
      wasTyping: input.typing,
      tempId,
      setTyping: input.setTyping,
      setStreamProgress: input.setStreamProgress,
      setDetail: input.setDetail,
      runtimeDelegationSnapshot: delegationSnapshot,
      runtimeActionsSnapshot,
      workflowSelectionSnapshot,
      workflowArmed: workflowArmedSnapshot,
      restoreFailedDraft: restoreFailedComposerState({
        sessionId,
        updateDraft,
        reviewSnapshot,
        typedSnapshot,
        pastesSnapshot,
      }),
      setMidRunHints: input.setMidRunHints,
      isActiveSession: () => (sessionId ? (input.isActiveSession?.(sessionId) ?? true) : false),
      showToast: input.showToast,
      refreshList: input.refreshList,
    });
  };

  const send = async (override?: string): Promise<void> => {
    const orchestrationModes = [
      Boolean(runtimeDelegation),
      Boolean(controlSelection),
      runtimeActions.length > 0,
      Boolean(workflowSelection),
    ].filter(Boolean).length;
    if (orchestrationModes > 1) {
      input.showToast("Choose one orchestration mode before sending.");
      return;
    }
    if (workflowArmed && !workflowSelection) {
      input.showToast("Select a workflow before arming the fire button.");
      return;
    }
    if (runtimeDelegation && input.typing) {
      input.showToast("Wait for the current reply before delegating to another runtime.");
      return;
    }
    await sendUnchecked(override);
  };

  // Auto-disarm: when the workflow run finishes, the fire toggle flips off.
  const previousWorkflowRunRef = useRef(input.workflowRun);
  useEffect(() => {
    const wasRunning = previousWorkflowRunRef.current !== null;
    previousWorkflowRunRef.current = input.workflowRun;
    if (wasRunning && input.workflowRun === null) {
      if (sessionId) updateDraft(sessionId, (draft) => ({ ...draft, workflowArmed: false }));
    }
  }, [input.workflowRun, sessionId, updateDraft]);

  return {
    input: draft.input,
    reviewComments,
    updateReviewComment: (id: string, note: string) => {
      if (sessionId) updateSessionReviewComment(sessionId, id, note);
    },
    removeReviewComment: (id: string) => {
      if (sessionId) removeSessionReviewComment(sessionId, id);
    },
    pendingImages,
    pendingDocuments,
    pastes,
    runtimeDelegation,
    controlSelection,
    runtimeActions,
    workflowSelection,
    imageLimitReached: pendingImages.length >= CREATE_TASK_IMAGE_LIMITS.maxCount,
    documentLimitReached: pendingDocuments.length >= CHAT_DOCUMENT_LIMITS.maxCount,
    imageInputRef,
    documentInputRef,
    setInput: (value: string) => {
      if (sessionId) updateDraft(sessionId, (draft) => ({ ...draft, input: value }));
    },
    setPastes: (nextPastes: ComposerPasteEntry[]) => {
      if (sessionId) updateDraft(sessionId, (draft) => ({ ...draft, pastes: nextPastes }));
    },
    setRuntimeDelegation: (delegation: typeof runtimeDelegation) => {
      if (sessionId)
        updateDraft(sessionId, (draft) => ({ ...draft, runtimeDelegation: delegation }));
    },
    setControlSelection: (selection: typeof controlSelection) => {
      if (sessionId) updateDraft(sessionId, (draft) => ({ ...draft, controlSelection: selection }));
    },
    setRuntimeActions: (actions: typeof runtimeActions) => {
      if (sessionId) updateDraft(sessionId, (draft) => ({ ...draft, runtimeActions: actions }));
    },
    setWorkflowSelection: (selection: typeof workflowSelection) => {
      if (sessionId)
        updateDraft(sessionId, (draft) => ({ ...draft, workflowSelection: selection }));
    },
    workflowArmed,
    setWorkflowArmed: (armed: boolean) => {
      if (sessionId) updateDraft(sessionId, (draft) => ({ ...draft, workflowArmed: armed }));
    },
    clear,
    attachImages,
    pasteImages,
    removeImage,
    attachDocuments,
    removeDocument: (id: string) => {
      if (sessionId) {
        updateDraft(sessionId, (draft) => ({
          ...draft,
          documents: draft.documents.filter((document) => document.id !== id),
        }));
      }
    },
    send,
  };
};

const composerSendSnapshot = (sessionId: string, override?: string) => {
  const draft = getSessionComposerDraft(sessionId);
  const reviewSnapshot = getSessionReviewQueue(sessionId);
  const typedSnapshot = (override ?? draft.input).trim();
  // Slash commands must reach the server verbatim; the review queue drains on
  // the next ordinary message instead of changing command semantics.
  const isSlashCommand = typedSnapshot.startsWith("/");
  const content = isSlashCommand
    ? typedSnapshot
    : serializeReviewMessage(reviewSnapshot, typedSnapshot);
  if (!content && draft.images.length === 0 && draft.documents.length === 0) return null;

  const withControl = draft.controlSelection
    ? rewriteControlCommandMarker(content, draft.controlSelection)
    : content;
  // Compact paste tokens stay in the request payload; bodies ship as `pastes`
  // and the chat bubble expands them for display.
  const displayContent = draft.runtimeDelegation
    ? `${withControl} ${formatRuntimeDelegationMarker(draft.runtimeDelegation)}`
    : withControl;
  return {
    content,
    requestContent: displayContent,
    displayContent,
    imagesSnapshot: draft.images,
    documentsSnapshot: draft.documents,
    pastesSnapshot: draft.pastes,
    delegationSnapshot: draft.runtimeDelegation,
    runtimeActionsSnapshot: draft.runtimeActions,
    workflowSelectionSnapshot: draft.workflowSelection,
    workflowArmedSnapshot: draft.workflowArmed,
    reviewSnapshot,
    typedSnapshot,
    isSlashCommand,
  };
};

type FailedSendPayload = Parameters<
  NonNullable<Parameters<typeof sendChatWithOptimistic>[0]["restoreFailedDraft"]>
>[0];

/** Restores queue + draft after a failed send, unless the user already started over. */
const restoreFailedComposerState =
  (context: {
    sessionId: string;
    updateDraft: (
      sessionId: string,
      update: Parameters<typeof updateSessionComposerDraft>[1],
    ) => unknown;
    reviewSnapshot: ReturnType<typeof getSessionReviewQueue>;
    typedSnapshot: string;
    pastesSnapshot: ComposerPasteEntry[];
  }) =>
  (failed: FailedSendPayload): void => {
    restoreSessionReviewQueueIfEmpty(context.sessionId, context.reviewSnapshot);
    context.updateDraft(context.sessionId, (draft) => {
      const draftInUse =
        draft.input.trim().length > 0 ||
        draft.images.length > 0 ||
        draft.documents.length > 0 ||
        draft.pastes.length > 0 ||
        draft.runtimeDelegation !== null ||
        draft.runtimeActions.length > 0 ||
        draft.workflowSelection !== null;
      if (draftInUse) return draft;
      return {
        ...draft,
        // Comments are restored to the queue, so only the typed text goes back.
        input: context.reviewSnapshot.length > 0 ? context.typedSnapshot : failed.content,
        images: failed.images,
        documents: failed.documents,
        pastes: context.pastesSnapshot,
        runtimeDelegation: failed.runtimeDelegation,
        runtimeActions: failed.runtimeActions,
        workflowSelection: failed.workflowSelection,
      };
    });
  };

const appendOptimisticUser = (
  setDetail: SessionComposerStateInput["setDetail"],
  sessionId: string,
  content: string,
  images: LocalCreateTaskImage[],
  documents: ChatDocumentAttachment[],
  action: ChatActionPayload | null,
): string => {
  const tempId = `local-${Date.now()}`;
  const optimistic: ChatSessionMessage = {
    id: tempId,
    sessionId,
    role: "user",
    content,
    action,
    createdAt: new Date().toISOString(),
    images: images.map((image) => ({
      id: image.id,
      mimeType: image.mimeType,
      url: image.previewUrl,
    })),
    documents: documents.map((document) => ({
      id: document.id,
      mimeType: document.mimeType,
      fileName: document.fileName,
      url: "",
    })),
  };
  setDetail((current) =>
    current?.id === sessionId
      ? { ...current, messages: [...current.messages, optimistic] }
      : current,
  );
  return tempId;
};

const composerAction = (
  runtimeActions: import("@aop/common").ChatRuntimeActionSelection[],
  workflowSelection: import("@aop/common").ChatWorkflowSelection | null,
): ChatActionPayload | null => {
  if (workflowSelection) {
    return {
      type: "workflow-run",
      id: workflowSelection.workflowId,
      label: "Workflow",
      sub: workflowSelection.name,
      meta: `${workflowSelection.stepCount} steps`,
      status: "proposed",
      proposal: {
        workflowId: workflowSelection.workflowId,
        workflowName: workflowSelection.name,
      },
    };
  }
  if (runtimeActions.length === 0) return null;
  return {
    type: "runtime-actions",
    label: "Runtime actions",
    sub: runtimeActions
      .map((action) => `${action.runtimeConfigurationName ?? action.provider} ${action.intent}`)
      .join(" · "),
    meta: `${runtimeActions.length} actions`,
    status: "live",
    proposal: { actions: runtimeActions },
  };
};
