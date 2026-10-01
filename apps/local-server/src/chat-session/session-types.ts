import type {
  ChatAbortDisposition,
  ChatActionPayload,
  ChatSessionSummary,
  TurnPart,
} from "@aop/common";
import type {
  ChatMessage,
  ChatRun,
  ChatRunFailureKind,
  ChatRunInterruptionKind,
} from "../db/schema.ts";
import type {
  ChatMessageDocumentDto,
  ChatMessageImageDto,
  StoredChatArtifact,
} from "./message-images.ts";
import type { MessageOrigin } from "./message-origin.ts";
import type { CreateProviderFn } from "./runtime-engine.ts";

/** The shared wire contract; kept as an alias so no app owns a private copy. */
export type ChatSessionDto = ChatSessionSummary;

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  action: ChatActionPayload | null;
  /** What an assistant reply's turn produced, in order; empty for the person's messages. */
  parts: TurnPart[];
  createdAt: string;
  /** User-attached images for this message (empty for assistant replies). */
  images: ChatMessageImageDto[];
  /** User-attached documents for this message (empty for assistant replies). */
  documents: ChatMessageDocumentDto[];
  /** Workspace files created or changed by the assistant runtime. */
  artifacts?: StoredChatArtifact[];
  runStatus?: ChatRun["status"];
  interruptionKind?: ChatRunInterruptionKind | null;
  failureKind?: ChatRunFailureKind | null;
  contextStrategy?: ChatRun["context_strategy"];
  workspacePath?: string | null;
  timeoutPolicy?: string | null;
  retryOfRunId?: string | null;
  disposition?: ChatMessage["disposition"];
  runId?: string;
}

export interface ChatSessionDetailDto extends ChatSessionDto {
  messages: ChatMessageDto[];
  assistantActive: boolean;
  /** Discoverable runtime actions for the Skills submenu and direct slash invocation. */
  skills: string[];
}

export type CreateChatSessionResult =
  | { success: true; session: ChatSessionDto }
  | { success: false; error: { code: "INVALID_REPO" } | { code: "REPO_NOT_FOUND" } };

export type GetChatSessionResult =
  | { success: true; session: ChatSessionDetailDto }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } | WorkspaceBindingFailure };

export type WorkspaceBindingFailure = {
  code: "WORKSPACE_BINDING_ERROR";
  message: string;
  path: string | null;
  resettable: boolean;
};

export type AbortChatSessionResult =
  | { success: true; aborted: boolean; disposition: ChatAbortDisposition }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } };

export type ResetRuntimeSessionResult =
  | { success: true; reset: true; clearedBinding: boolean; cancelledRun: boolean }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } };
export type MarkChatSessionReadResult =
  | { success: true; session: ChatSessionDto }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } };

export type UpdateChatWorkspaceResult =
  | { success: true; session: ChatSessionDto }
  | {
      success: false;
      error: { code: "SESSION_NOT_FOUND" } | WorkspaceBindingFailure;
    };
export type RetryFreshChatRunResult =
  | { success: true; message: ChatMessageDto; session: ChatSessionDto; existing: boolean }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "RUN_NOT_RETRYABLE" }
        | { code: "CONFIRMATION_REQUIRED" }
        | { code: "RUN_IN_PROGRESS" };
    };
export type DeleteChatSessionResult =
  | { success: true }
  | {
      success: false;
      error: { code: "SESSION_NOT_FOUND" } | { code: "RUN_IN_PROGRESS" };
    };

export type UpdateChatSessionResult =
  | { success: true; session: ChatSessionDto }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "INVALID_RUNTIME" }
        | { code: "INVALID_MODEL" }
        | { code: "INVALID_EFFORT" }
        | { code: "INVALID_FAST_MODE" }
        | { code: "INVALID_ACCESS_MODE" }
        | { code: "INVALID_SETTLED_OVERRIDE" }
        | { code: "INVALID_TITLE" }
        | { code: "RUNTIME_CONFIGURATION_NOT_FOUND" }
        | { code: "RUN_IN_PROGRESS" }
        | { code: "MODEL_LOCKED" }
        | { code: "REPOSITORY_REQUIRED" };
    };

export type SendChatMessageResult =
  | {
      success: true;
      message: ChatMessageDto;
      session: ChatSessionDto;
      /**
       * Mid-run handling when the assistant was already active:
       * - queued: wait for the current reply, then process this message
       * - steered: written into the running turn, which takes it after the step it is on
       */
      midRun?: "queued" | "steered";
      /** @deprecated Prefer midRun — kept for older clients. */
      queued?: boolean;
      steered?: boolean;
    }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "INVALID_CONTENT"; message?: string }
        | { code: "INVALID_MID_RUN_MODE" }
        | { code: "INVALID_IMAGES"; message: string }
        | { code: "INVALID_DOCUMENTS"; message: string }
        | { code: "RUNTIME_CONFIGURATION_NOT_FOUND" }
        | { code: "TOOL_INTERRUPT_CONFIRMATION_REQUIRED" }
        | { code: "RUN_IN_PROGRESS" };
    };

export interface SendChatMessageInput {
  content: unknown;
  imageAttachments?: unknown;
  documentAttachments?: unknown;
  /** Compact-token paste bodies; display text keeps `[paste #N +lines]`. */
  pastes?: unknown;
  midRunMode?: unknown;
  confirmToolInterrupt?: unknown;
  /** Set by the server, never by an HTTP body: the message was written by the coordinator, not the person. */
  origin?: MessageOrigin | null;
}

export interface ChatSessionServiceDeps {
  createProviderFn?: CreateProviderFn;
  recoveryPollIntervalMs?: number;
  /** Test seam for holding accepted work before provider preparation starts. */
  beforeAssistantReply?: (run: ChatRun) => Promise<void>;
  /** Test seam for observing queued lifecycle ownership before durable claim. */
  beforeQueuedRunClaim?: (sessionId: string) => Promise<void>;
  /** How long a coordinator's inbox stays quiet before its thread reports start a run (default 2 s). */
  coordinatorWakeWindowMs?: number;
}

export interface CreateChatSessionInput {
  repoId?: unknown;
  scope?: unknown;
}
