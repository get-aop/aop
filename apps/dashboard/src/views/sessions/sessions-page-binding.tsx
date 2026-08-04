import type { Dispatch, SetStateAction } from "react";
import type { ChatSessionDetail } from "../../api/client";
import { type ChatSessionSummary, getChatSession, setChatSessionWorkspace } from "../../api/client";

export interface WorkspaceBindingViewError {
  message: string;
  path: string | null;
  resettable: boolean;
}

export const fetchAndStoreSessionDetail = async (input: {
  sessionId: string;
  generation: number;
  currentGeneration: { current: number };
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>;
  setDetailLoading: Dispatch<SetStateAction<boolean>>;
  setWorkspaceError: Dispatch<SetStateAction<WorkspaceBindingViewError | null>>;
}): Promise<ChatSessionDetail | null> => {
  try {
    const session = await getChatSession(input.sessionId);
    if (input.generation === input.currentGeneration.current) input.setDetail(session);
    return session;
  } catch (error) {
    const workspaceBindingError = toWorkspaceBindingViewError(error);
    if (!workspaceBindingError) throw error;
    if (input.generation === input.currentGeneration.current) {
      input.setDetail(null);
      input.setWorkspaceError(workspaceBindingError);
    }
    return null;
  } finally {
    if (input.generation === input.currentGeneration.current) input.setDetailLoading(false);
  }
};

export const resetUnavailableWorkspaceBinding = async (input: {
  sessionId: string | null;
  setWorkspaceError: Dispatch<SetStateAction<WorkspaceBindingViewError | null>>;
  loadDetail: (sessionId: string) => Promise<ChatSessionDetail | null>;
  refreshList: () => Promise<ChatSessionSummary[]>;
  showToast: (message: string) => void;
}): Promise<void> => {
  if (!input.sessionId) return;
  try {
    await setChatSessionWorkspace(input.sessionId, null);
    input.setWorkspaceError(null);
    await Promise.all([input.loadDetail(input.sessionId), input.refreshList()]);
    input.showToast("Workspace reset to repository root");
  } catch (error) {
    input.showToast(error instanceof Error ? error.message : "Could not reset workspace");
  }
};

export const showBootstrapWorkspaceError = (
  error: unknown,
  setDetail: Dispatch<SetStateAction<ChatSessionDetail | null>>,
  setWorkspaceError: Dispatch<SetStateAction<WorkspaceBindingViewError | null>>,
  setDetailLoading: Dispatch<SetStateAction<boolean>>,
): void => {
  const workspaceBindingError = toWorkspaceBindingViewError(error);
  if (!workspaceBindingError) return;
  setDetail(null);
  setWorkspaceError(workspaceBindingError);
  setDetailLoading(false);
};

export const visibleWorkspaceError = (
  detailLoading: boolean,
  active: ChatSessionDetail | null,
  error: WorkspaceBindingViewError | null,
): WorkspaceBindingViewError | null => (!detailLoading && !active ? error : null);

export const toWorkspaceBindingViewError = (error: unknown): WorkspaceBindingViewError | null => {
  if (!isWorkspaceBindingApiError(error)) return null;
  return {
    message: error.message,
    path: error.details?.path ?? null,
    resettable: error.details?.resettable === true,
  };
};

export const isWorkspaceBindingApiError = (
  error: unknown,
): error is {
  message: string;
  code: string;
  details?: { path?: string | null; resettable?: boolean };
} =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof (error as { message?: unknown }).message === "string" &&
  "code" in error &&
  (error as { code?: unknown }).code === "WORKSPACE_BINDING_ERROR";

export const WorkspaceBindingErrorPanel = ({
  error,
  sessionId,
  onReset,
}: {
  error: WorkspaceBindingViewError | null;
  sessionId: string | null;
  onReset: () => void;
}) => {
  if (!error) return null;
  return (
    <div
      data-testid="workspace-binding-error"
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        padding: 24,
        color: "var(--color-text-muted)",
      }}
    >
      <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>
        <strong style={{ color: "var(--color-text)" }}>Chat workspace is unavailable</strong>
        <span>{error.message}</span>
        {error.path ? <code style={{ overflowWrap: "anywhere" }}>{error.path}</code> : null}
        {error.resettable && sessionId ? (
          <button type="button" className="aop-pill" onClick={onReset}>
            Reset to repository root
          </button>
        ) : null}
      </div>
    </div>
  );
};
