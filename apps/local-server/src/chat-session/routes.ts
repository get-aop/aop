import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateChatSessionInput } from "@aop/common";
import type { Context } from "hono";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import { createSSEStreamHelper } from "../events/sse-stream.ts";
import { getChatDelegation, listChatDelegations, readDelegationOutput } from "./delegation-runs.ts";
import { chatSessionAttachmentsDir, isSafeAttachmentFileName } from "./message-images.ts";
import {
  type AbortChatSessionResult,
  type ChatSessionServiceDeps,
  type CreateChatSessionResult,
  createChatSessionService,
  type GetChatSessionResult,
  type ResetRuntimeSessionResult,
  type RetryFreshChatRunResult,
  type RunTerminalResult,
  type SendChatMessageResult,
  type UpdateChatSessionResult,
  type UpdateChatWorkspaceResult,
} from "./service.ts";
import {
  createChatSessionEventQueue,
  getLatestChatSessionProgress,
  subscribeChatSession,
} from "./session-events.ts";

// Stay below the dashboard proxy's idle upstream timeout, matching the global event stream.
const CHAT_SSE_HEARTBEAT_INTERVAL_MS = 3_000;

export const createChatSessionRoutes = (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps = {},
) => {
  const routes = new Hono();
  const service = createChatSessionService(ctx, deps);

  routes.post("/", async (c) => {
    const body = await c.req
      .json<{ repoId?: unknown; scope?: unknown }>()
      .catch(() => ({}) as { repoId?: unknown; scope?: unknown });
    const result = await service.create(body);
    if (!result.success) {
      return mapCreateError(c, result);
    }
    return c.json({ session: result.session }, 201);
  });

  routes.get("/", async (c) => {
    return c.json(await service.list());
  });

  // Literal routes before /:sessionId so "delegations" never binds as a session id.
  routes.get("/delegations/active", async (c) => {
    return c.json({ delegations: await listChatDelegations(ctx) });
  });

  routes.get("/:sessionId/delegations", async (c) => {
    const sessionId = c.req.param("sessionId");
    const exists = await service.exists(sessionId);
    if (!exists) return c.json({ error: "Session not found" }, 404);
    return c.json({ delegations: await listChatDelegations(ctx, sessionId) });
  });

  routes.get("/:sessionId/delegations/:delegationId/output", async (c) => {
    const sessionId = c.req.param("sessionId");
    const exists = await service.exists(sessionId);
    if (!exists) return c.json({ error: "Session not found" }, 404);
    const delegation = await getChatDelegation(ctx, sessionId, c.req.param("delegationId"));
    if (!delegation) return c.json({ error: "Delegation not found" }, 404);
    const output = await readDelegationOutput(delegation.logFilePath);
    return c.json({ delegation, output });
  });

  routes.get("/:sessionId/stream", async (c) => {
    const sessionId = c.req.param("sessionId");
    const exists = await service.exists(sessionId);
    if (!exists) {
      return c.json({ error: "Session not found" }, 404);
    }

    return streamSSE(c, async (stream) => {
      const helper = createSSEStreamHelper(stream);
      const eventQueue = createChatSessionEventQueue((event) =>
        helper.sendEvent(event.type, event),
      );
      const unsubscribe = subscribeChatSession(sessionId, eventQueue.push);
      helper.registerCleanup(() => {
        eventQueue.clear();
        unsubscribe();
      });
      const connected = await helper.sendEvent("connected", { sessionId });
      if (!connected) return;
      const latestProgress = getLatestChatSessionProgress(sessionId);
      if (latestProgress) await helper.sendEvent(latestProgress.type, latestProgress);
      await service.ensureRecovery(sessionId);

      const pingInterval = setInterval(async () => {
        const sent = await helper.sendEvent("ping", { t: Date.now() });
        if (!sent) clearInterval(pingInterval);
      }, CHAT_SSE_HEARTBEAT_INTERVAL_MS);
      helper.registerCleanup(() => clearInterval(pingInterval));

      // Hono's stream.sleep can resolve after the response callback returns under Bun.
      // Keep the callback alive until the client aborts, matching the global event stream.
      await new Promise(() => {});
    });
  });

  routes.get("/:sessionId/location", async (c) => {
    const result = await service.location(c.req.param("sessionId"));
    if (!result.success) return mapSessionWorkspaceReadError(c, result.error);
    return c.json(result.location);
  });

  routes.put("/:sessionId/workspace", async (c) => {
    const body = await c.req.json<{ path?: unknown }>().catch(() => ({}) as { path?: unknown });
    const result = await service.setWorkspace(c.req.param("sessionId"), body.path);
    if (!result.success) return mapWorkspaceError(c, result);
    return c.json({ session: result.session });
  });

  routes.delete("/:sessionId/workspace", async (c) => {
    const result = await service.setWorkspace(c.req.param("sessionId"), null);
    if (!result.success) return mapWorkspaceError(c, result);
    return c.json({ session: result.session });
  });

  routes.get("/:sessionId", async (c) => {
    const result = await service.get(c.req.param("sessionId"));
    if (!result.success) {
      return mapGetError(c, result);
    }
    return c.json({ session: result.session });
  });

  routes.post("/:sessionId/abort", async (c) => {
    const result = await service.abort(c.req.param("sessionId"));
    if (!result.success) return mapAbortError(c, result);
    return c.json({ aborted: result.aborted, disposition: result.disposition });
  });

  routes.post("/:sessionId/reset-runtime", async (c) => {
    const result = await service.resetRuntime(c.req.param("sessionId"));
    if (!result.success) return mapResetRuntimeError(c, result);
    return c.json({
      reset: result.reset,
      clearedBinding: result.clearedBinding,
      cancelledRun: result.cancelledRun,
    });
  });

  routes.post("/:sessionId/runs/:runId/retry-fresh", async (c) => {
    const body = await c.req
      .json<{ confirmed?: unknown }>()
      .catch(() => ({}) as { confirmed?: unknown });
    const result = await service.retryFresh(
      c.req.param("sessionId"),
      c.req.param("runId"),
      body.confirmed,
    );
    if (!result.success) return mapRetryFreshError(c, result);
    return c.json(
      { message: result.message, session: result.session, existing: result.existing },
      result.existing ? 200 : 201,
    );
  });

  routes.patch("/:sessionId", async (c) => {
    const body = await c.req
      .json<UpdateChatSessionInput>()
      .catch(() => ({}) as UpdateChatSessionInput);
    const result = await service.update(c.req.param("sessionId"), body);
    if (!result.success) {
      return mapUpdateError(c, result);
    }
    return c.json({ session: result.session });
  });

  routes.post("/:sessionId/mark-read", async (c) => {
    const result = await service.markRead(c.req.param("sessionId"));
    if (!result.success) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json({ session: result.session });
  });

  routes.delete("/:sessionId", async (c) => {
    const result = await service.delete(c.req.param("sessionId"));
    if (!result.success) {
      if (result.error.code === "RUN_IN_PROGRESS") {
        return c.json({ error: "Cannot delete a session while a run is in progress" }, 409);
      }
      return c.json({ error: "Session not found" }, 404);
    }
    return c.body(null, 204);
  });

  routes.post("/:sessionId/messages", async (c) => {
    const body = await c.req
      .json<{
        content?: unknown;
        imageAttachments?: unknown;
        documentAttachments?: unknown;
        pastes?: unknown;
        midRunMode?: unknown;
        confirmToolInterrupt?: unknown;
        workflowId?: unknown;
        workflowArmed?: unknown;
        runtimeActions?: unknown;
      }>()
      .catch(
        () =>
          ({}) as {
            content?: unknown;
            imageAttachments?: unknown;
            documentAttachments?: unknown;
            pastes?: unknown;
            midRunMode?: unknown;
            confirmToolInterrupt?: unknown;
            workflowId?: unknown;
            workflowArmed?: unknown;
            runtimeActions?: unknown;
          },
      );
    const result = await service.sendMessage(c.req.param("sessionId"), {
      content: body.content,
      imageAttachments: body.imageAttachments,
      documentAttachments: body.documentAttachments,
      pastes: body.pastes,
      midRunMode: body.midRunMode,
      confirmToolInterrupt: body.confirmToolInterrupt,
      workflowId: body.workflowId,
      workflowArmed: body.workflowArmed,
      runtimeActions: body.runtimeActions,
    });
    if (!result.success) {
      return mapSendError(c, result);
    }
    return c.json(
      {
        message: result.message,
        session: result.session,
        ...(result.midRun ? { midRun: result.midRun } : {}),
        ...(result.queued !== undefined ? { queued: result.queued } : {}),
        ...(result.steered !== undefined ? { steered: result.steered } : {}),
      },
      201,
    );
  });

  routes.get("/:sessionId/attachments/:fileName", async (c) =>
    serveChatAttachment(c, service, c.req.param("sessionId"), c.req.param("fileName")),
  );

  routes.post("/:sessionId/terminal", async (c) => {
    const body = await c.req
      .json<{ command?: unknown }>()
      .catch(() => ({}) as { command?: unknown });
    const result = await service.runTerminal(c.req.param("sessionId"), body.command);
    if (!result.success) {
      return mapTerminalError(c, result);
    }
    return c.json({ lines: result.lines });
  });

  return routes;
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
};

const mimeForAttachment = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
};

const serveChatAttachment = async (
  c: Context,
  service: ReturnType<typeof createChatSessionService>,
  sessionId: string,
  fileName: string,
) => {
  if (!isSafeAttachmentFileName(fileName)) {
    return c.json({ error: "Invalid attachment" }, 400);
  }
  if (!(await service.exists(sessionId))) {
    return c.json({ error: "Session not found" }, 404);
  }
  try {
    const bytes = await readFile(join(chatSessionAttachmentsDir(sessionId), fileName));
    return new Response(bytes, {
      headers: {
        "Content-Type": mimeForAttachment(fileName),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return c.json({ error: "Attachment not found" }, 404);
  }
};

const mapCreateError = (
  c: Context,
  result: Extract<CreateChatSessionResult, { success: false }>,
) => {
  switch (result.error.code) {
    case "INVALID_REPO":
      return c.json({ error: "repoId is required" }, 400);
    case "REPO_NOT_FOUND":
      return c.json({ error: "Repository not found" }, 404);
  }
};

const mapGetError = (c: Context, result: Extract<GetChatSessionResult, { success: false }>) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
    case "WORKSPACE_BINDING_ERROR":
      return mapSessionWorkspaceReadError(c, result.error);
  }
};

const mapAbortError = (c: Context, result: Extract<AbortChatSessionResult, { success: false }>) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
  }
};

const mapResetRuntimeError = (
  c: Context,
  result: Extract<ResetRuntimeSessionResult, { success: false }>,
) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
  }
};

const mapRetryFreshError = (
  c: Context,
  result: Extract<RetryFreshChatRunResult, { success: false }>,
) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
    case "RUN_NOT_RETRYABLE":
      return c.json({ error: "Only startup-timeout runs can be retried fresh" }, 409);
    case "CONFIRMATION_REQUIRED":
      return c.json(
        {
          error: "Confirm that the previous runtime may already have changed files before retrying",
        },
        400,
      );
    case "RUN_IN_PROGRESS":
      return c.json({ error: "A run is already in progress for this session" }, 409);
  }
};

const mapUpdateError = (
  c: Context,
  result: Extract<UpdateChatSessionResult, { success: false }>,
) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
    case "INVALID_RUNTIME":
      return c.json({ error: "Invalid runtime" }, 400);
    case "INVALID_MODEL":
      return c.json({ error: "Invalid model for runtime" }, 400);
    case "INVALID_EFFORT":
      return c.json({ error: "Invalid reasoning effort" }, 400);
    case "INVALID_FAST_MODE":
      return c.json({ error: "Fast mode is only available for Codex CLI" }, 400);
    case "INVALID_ACCESS_MODE":
      return c.json({ error: "Invalid runtime access mode" }, 400);
    case "INVALID_SETTLED_OVERRIDE":
      return c.json({ error: "settledOverride must be settled or active" }, 400);
    case "INVALID_TITLE":
      return c.json({ error: "Title is required" }, 400);
    case "RUNTIME_PROFILE_NOT_FOUND":
      return c.json({ error: "Runtime profile not found" }, 404);
    case "RUNTIME_CONFIGURATION_NOT_FOUND":
      return c.json({ error: "Runtime configuration not found" }, 404);
    case "RUN_IN_PROGRESS":
      return c.json({ error: "Cannot settle or change runtime while a run is in progress" }, 409);
  }
};

const mapWorkspaceError = (
  c: Context,
  result: Extract<UpdateChatWorkspaceResult, { success: false }>,
) =>
  result.error.code === "SESSION_NOT_FOUND"
    ? c.json({ error: "Session not found" }, 404)
    : mapSessionWorkspaceReadError(c, result.error);

const mapSessionWorkspaceReadError = (
  c: Context,
  error:
    | { code: "SESSION_NOT_FOUND" }
    | {
        code: "WORKSPACE_BINDING_ERROR";
        message: string;
        path: string | null;
        resettable: boolean;
      },
) =>
  error.code === "SESSION_NOT_FOUND"
    ? c.json({ error: "Session not found" }, 404)
    : c.json(
        {
          code: error.code,
          error: error.message,
          path: error.path,
          resettable: error.resettable,
        },
        409,
      );

const mapSendError = (c: Context, result: Extract<SendChatMessageResult, { success: false }>) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
    case "INVALID_CONTENT":
      return c.json({ error: result.error.message ?? "Message content is required" }, 400);
    case "INVALID_MID_RUN_MODE":
      return c.json({ error: "midRunMode must be queue or steer" }, 400);
    case "TOOL_INTERRUPT_CONFIRMATION_REQUIRED":
      return c.json(
        {
          code: result.error.code,
          error: "The assistant is running a tool. Confirm before interrupting it.",
        },
        409,
      );
    case "INVALID_IMAGES":
    case "INVALID_DOCUMENTS":
      return c.json({ error: result.error.message }, 400);
    case "RUNTIME_CONFIGURATION_NOT_FOUND":
      return c.json({ error: "Runtime configuration not found" }, 404);
    case "INVALID_ORCHESTRATION":
      return c.json({ error: result.error.message }, 400);
    case "WORKFLOW_NOT_FOUND":
      return c.json({ error: "Workflow is no longer available" }, 404);
    case "WORKFLOW_RUN_IN_PROGRESS":
      return c.json(
        {
          code: "WORKFLOW_RUN_IN_PROGRESS",
          error: "A workflow run is already in progress for this session",
        },
        409,
      );
    case "REPOSITORY_REQUIRED":
      return c.json({ error: "Choose a repository before running a workflow" }, 400);
    case "RUN_IN_PROGRESS":
      return c.json({ error: "A run is already in progress for this session" }, 409);
  }
};

const mapTerminalError = (c: Context, result: Extract<RunTerminalResult, { success: false }>) => {
  switch (result.error.code) {
    case "SESSION_NOT_FOUND":
      return c.json({ error: "Session not found" }, 404);
    case "REPO_NOT_FOUND":
      return c.json({ error: "Repository not found" }, 404);
    case "INVALID_COMMAND":
      return c.json({ error: "command is required" }, 400);
  }
};
