import type { TerminalLine } from "@aop/common";
import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect } from "react";
import type { ChatSessionDetail, ChatSessionSummary } from "../../api/client";
import { getRuntimeProfiles, getWorkflowDetails } from "../../api/client";
import { useSSE } from "../../hooks/useSSE";
import type { AssistantStreamProgress } from "./sessions-page-helpers";
import { bootstrapSessions, handleSessionStreamEvent } from "./sessions-page-helpers";
import type { WorkspaceBindingViewError } from "./sessions-page-internals";
import { showBootstrapWorkspaceError } from "./sessions-page-internals";
import { sessionStreamUrlFor } from "./sessions-page-model";

interface PrefillInput {
  refreshList: () => Promise<ChatSessionSummary[]>;
  loadDetail: (sessionId: string) => Promise<ChatSessionDetail | null>;
  markSessionRead: (sessionId: string | null) => Promise<void>;
  setAgents: Dispatch<SetStateAction<import("../../types").Agent[]>>;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setWorkspaceError: Dispatch<SetStateAction<WorkspaceBindingViewError | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  setRuntimeProfiles: Dispatch<SetStateAction<import("@aop/common").RuntimeProfile[]>>;
  setWorkflowOptions: Dispatch<
    SetStateAction<
      Array<{
        id: string;
        name: string;
        stepCount: number;
        stepTypes: string[];
        steps: Array<{
          id: string;
          type: string;
          provider?: string;
          model?: string;
          reasoning?: string;
          fastMode?: boolean;
        }>;
      }>
    >
  >;
}

/** One-shot page prefill: bootstrap sessions, runtime profiles, workflow catalog. */
export const useSessionsPagePrefill = (input: PrefillInput) => {
  const { refreshList, loadDetail, markSessionRead } = input;

  useEffect(() => {
    void bootstrapSessions(
      refreshList,
      async (id) => {
        const detail = await loadDetail(id);
        void markSessionRead(id);
        return detail;
      },
      input.setAgents,
    ).catch((error) =>
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
    void getWorkflowDetails()
      .then((workflows) =>
        input.setWorkflowOptions(
          workflows
            .filter((workflow) => workflow.active)
            .map((workflow) => ({
              id: workflow.id,
              name: workflow.name,
              stepCount: workflow.stepCount,
              stepTypes: workflow.steps.map((step) => step.type),
              steps: workflow.steps.map((step) => ({
                id: step.id,
                type: step.type,
                ...(step.agent
                  ? {
                      provider: step.agent.provider,
                      model: step.agent.model,
                      reasoning: step.agent.reasoning,
                      fastMode: step.agent.fastMode,
                    }
                  : {}),
              })),
            })),
        ),
      )
      .catch(() => input.setWorkflowOptions([]));
    // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot prefill; do not re-run on tasks[] SSE identity
  }, [
    refreshList,
    loadDetail,
    markSessionRead,
    input.setAgents,
    input.setDetail,
    input.setDetailLoading,
    input.setRuntimeProfiles,
    input.setWorkflowOptions,
    input.setWorkspaceError,
  ]);
};

interface StreamInput {
  activeId: string | null;
  activeIdRef: MutableRefObject<string | null>;
  assistantStateGenerationRef: MutableRefObject<number>;
  skipConnectedReloadRef: MutableRefObject<string | null>;
  setTyping: (value: boolean) => void;
  setStreamProgress: (value: AssistantStreamProgress | null) => void;
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setMidRunHints: Dispatch<SetStateAction<Record<string, "queued" | "steered">>>;
  setTermLines: Dispatch<SetStateAction<TerminalLine[]>>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  reloadDetailQuiet: (sessionId: string) => Promise<ChatSessionDetail | null>;
  onOpenWorkerDialog?: () => void;
  openSessionById: (sessionId: string) => void;
  markSessionRead: (sessionId: string | null) => Promise<void>;
  setWorkflowRun: (
    run:
      | import("./sessions-page-helpers-stream").WorkflowRunStreamState
      | null
      | ((
          current: import("./sessions-page-helpers-stream").WorkflowRunStreamState | null,
        ) => import("./sessions-page-helpers-stream").WorkflowRunStreamState | null),
  ) => void;
}

/** Live session/terminal/delegation event stream for the active session. */
export const useSessionsPageStream = (input: StreamInput) => {
  const streamUrl = sessionStreamUrlFor(input.activeId);
  const { connected } = useSSE({
    url: streamUrl,
    eventTypes: [
      "connected",
      "assistant-typing",
      "assistant-progress",
      "assistant-final",
      "session-updated",
      "terminal-line",
      "delegation-updated",
      "delegation-progress",
      "ping",
    ],
    onMessage: (event, data) =>
      handleSessionStreamEvent(event, data, {
        activeIdRef: input.activeIdRef,
        assistantStateGenerationRef: input.assistantStateGenerationRef,
        skipConnectedReloadRef: input.skipConnectedReloadRef,
        setTyping: input.setTyping,
        setStreamProgress: input.setStreamProgress,
        setDetail: input.setDetail,
        setMidRunHints: input.setMidRunHints,
        setTermLines: input.setTermLines,
        refreshList: input.refreshList,
        reloadDetail: input.reloadDetailQuiet,
        onOpenWorkerDialog: input.onOpenWorkerDialog,
        onOpenSession: input.openSessionById,
        onMarkSessionRead: input.markSessionRead,
        setWorkflowRun: input.setWorkflowRun,
      }),
  });

  return { connected };
};
