import type { ChatDocumentAttachment } from "@aop/common";
import { type ChatSessionDetail, type ChatSessionMessage, sendChatMessage } from "../../api/client";
import { requestConfirmation } from "../../components/ConfirmationHost";
import type { LocalCreateTaskImage } from "../../components/create-task-images";
import {
  localImageToAttachment,
  revokeLocalCreateTaskImages,
} from "../../components/create-task-images";

export const sendChatWithOptimistic = async (input: {
  sessionId: string;
  content: string;
  imagesSnapshot: LocalCreateTaskImage[];
  documentsSnapshot: ChatDocumentAttachment[];
  pastesSnapshot?: Array<{ index: number; lineCount: number; content: string }>;
  wasTyping: boolean;
  tempId: string;
  setTyping: (value: boolean) => void;
  setStreamProgress: (
    value: { thinking: string; content: string; commandGroups: [] } | null,
  ) => void;
  setDetail: (updater: (current: ChatSessionDetail | null) => ChatSessionDetail | null) => void;
  /** Restores the failed send only when the composer draft is still empty. */
  restoreFailedDraft?: (failed: {
    content: string;
    images: LocalCreateTaskImage[];
    documents: ChatDocumentAttachment[];
  }) => void;
  setMidRunHints: (
    updater: (
      current: Record<string, "queued" | "steered">,
    ) => Record<string, "queued" | "steered">,
  ) => void;
  /** When false after an in-flight send, skip writing mid-run hints for this session. */
  isActiveSession?: () => boolean;
  showToast: (message: string) => void;
  refreshList: () => Promise<unknown>;
}): Promise<void> => {
  if (!input.wasTyping) {
    input.setTyping(true);
    input.setStreamProgress({ thinking: "", content: "", commandGroups: [] });
  }
  try {
    const result = await sendWithToolInterruptConfirmation((confirmToolInterrupt) =>
      sendChatMessage(
        input.sessionId,
        // Persist compact display text; paste bodies travel separately for runtime expansion.
        input.content,
        input.imagesSnapshot.map(localImageToAttachment),
        input.documentsSnapshot,
        undefined,
        confirmToolInterrupt,
        input.pastesSnapshot,
      ),
    );
    revokeLocalCreateTaskImages(input.imagesSnapshot);
    input.setDetail((current) =>
      mergeSentMessage(current, input.sessionId, input.tempId, result.message),
    );
    const midRun = resolveMidRun(result);
    if (midRun && (input.isActiveSession?.() ?? true)) {
      input.setMidRunHints((current) => ({ ...current, [result.message.id]: midRun }));
      input.showToast(
        midRun === "queued"
          ? "Queued — runs after the current reply"
          : "Steering — interrupting the current reply",
      );
    }
    await input.refreshList();
  } catch (error) {
    if (!input.wasTyping) {
      input.setTyping(false);
      input.setStreamProgress(null);
    }
    input.setDetail((current) => dropOptimisticMessage(current, input.tempId));
    restoreFailedSend(input);
    input.showToast(formatSendError(error));
  }
};

export const sendWithToolInterruptConfirmation = async (
  send: (confirmToolInterrupt: boolean) => ReturnType<typeof sendChatMessage>,
  confirm: () => Promise<boolean> = confirmToolInterrupt,
): ReturnType<typeof sendChatMessage> => {
  try {
    return await send(false);
  } catch (error) {
    if (!isToolInterruptConfirmation(error) || !(await confirm())) throw error;
    return send(true);
  }
};

const isToolInterruptConfirmation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "TOOL_INTERRUPT_CONFIRMATION_REQUIRED";

const confirmToolInterrupt = (): Promise<boolean> =>
  requestConfirmation({
    title: "Interrupt running command?",
    message: "The assistant is running a command. Interrupt it and continue in a fresh session?",
    confirmLabel: "Interrupt and continue",
  });

const restoreFailedSend = (input: Parameters<typeof sendChatWithOptimistic>[0]): void => {
  // Only restore the failed payload when the draft is still empty — never clobber
  // text the user already started typing while the request was in flight.
  input.restoreFailedDraft?.({
    content: input.content,
    images: input.imagesSnapshot,
    documents: input.documentsSnapshot,
  });
};

const mergeSentMessage = (
  current: ChatSessionDetail | null,
  activeId: string,
  tempId: string,
  message: ChatSessionMessage,
): ChatSessionDetail | null => {
  if (!current || current.id !== activeId) return current;
  const withoutTemp = current.messages.filter((item) => item.id !== tempId);
  if (withoutTemp.some((item) => item.id === message.id)) return current;
  return { ...current, messages: [...withoutTemp, message] };
};

const dropOptimisticMessage = (
  current: ChatSessionDetail | null,
  tempId: string,
): ChatSessionDetail | null =>
  current
    ? { ...current, messages: current.messages.filter((item) => item.id !== tempId) }
    : current;

const resolveMidRun = (result: {
  midRun?: "queued" | "steered";
  steered?: boolean;
  queued?: boolean;
}): "queued" | "steered" | undefined => {
  if (result.midRun) return result.midRun;
  if (result.steered) return "steered";
  if (result.queued) return "queued";
  return undefined;
};

const formatSendError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Failed to send message";
  return message.includes("already in progress")
    ? "Could not send message while the assistant is busy — try again"
    : message;
};
