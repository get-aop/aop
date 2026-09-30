import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import type { ChatSessionDetail, ChatSessionSummary } from "../../api/client";
import { getRuntimeProfiles } from "../../api/client";
import { useSSE } from "../../hooks/useSSE";
import type { StreamProgressUpdate } from "./session-stream-progress";

import { bootstrapSessions, handleSessionStreamEvent } from "./sessions-page-helpers";
import type { WorkspaceBindingViewError } from "./sessions-page-internals";
import { showBootstrapWorkspaceError } from "./sessions-page-internals";
import { sessionStreamUrlFor } from "./sessions-page-model";

interface PrefillInput {
  refreshList: () => Promise<ChatSessionSummary[]>;
  loadDetail: (sessionId: string) => Promise<ChatSessionDetail | null>;
  markSessionRead: (sessionId: string | null) => Promise<void>;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setWorkspaceError: Dispatch<SetStateAction<WorkspaceBindingViewError | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  setRuntimeProfiles: Dispatch<SetStateAction<import("@aop/common").RuntimeProfile[]>>;
}

/** One-shot page prefill: bootstrap sessions and runtime profiles. */
export const useSessionsPagePrefill = (input: PrefillInput) => {
  const { refreshList, loadDetail, markSessionRead } = input;

  useEffect(() => {
    void bootstrapSessions(refreshList, async (id) => {
      const detail = await loadDetail(id);
      void markSessionRead(id);
      return detail;
    }).catch((error) =>
      showBootstrapWorkspaceError(
        error,
        input.setDetail,
        input.setWorkspaceError,
        input.setDetailLoading,
      ),
    );
    void getRuntimeProfiles()
      .then(input.setRuntimeProfiles)
      .catch(() => input.setRuntimeProfiles([]));
  }, [
    refreshList,
    loadDetail,
    markSessionRead,
    input.setDetail,
    input.setDetailLoading,
    input.setRuntimeProfiles,
    input.setWorkspaceError,
  ]);
};

interface StreamInput {
  activeId: string | null;
  activeIdRef: MutableRefObject<string | null>;
  assistantStateGenerationRef: MutableRefObject<number>;
  skipConnectedReloadRef: MutableRefObject<string | null>;
  setTyping: (value: boolean) => void;
  setStreamProgress: (value: StreamProgressUpdate) => void;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setMidRunHints: Dispatch<SetStateAction<Record<string, "queued" | "steered">>>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  openSessionById: (sessionId: string) => void;
  markSessionRead: (sessionId: string | null) => Promise<void>;
}

/** Live session event stream for the active session. */
export const SESSION_STREAM_EVENT_TYPES = [
  "connected",
  "assistant-typing",
  "assistant-progress",
  "assistant-final",
  "session-updated",
  "ping",
] as const;

export const useSessionsPageStream = (input: StreamInput) => {
  const streamUrl = sessionStreamUrlFor(input.activeId);
  const { connected } = useSSE({
    url: streamUrl,
    eventTypes: [...SESSION_STREAM_EVENT_TYPES],
    onMessage: (event, data) =>
      handleSessionStreamEvent(event, data, {
        activeIdRef: input.activeIdRef,
        assistantStateGenerationRef: input.assistantStateGenerationRef,
        skipConnectedReloadRef: input.skipConnectedReloadRef,
        setTyping: input.setTyping,
        setStreamProgress: input.setStreamProgress,
        setDetail: input.setDetail,
        setMidRunHints: input.setMidRunHints,
        refreshList: input.refreshList,
        reloadDetail: input.reloadDetailQuiet,
        onOpenSession: input.openSessionById,
        onMarkSessionRead: input.markSessionRead,
      }),
  });

  return { connected };
};
