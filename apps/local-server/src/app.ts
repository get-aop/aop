import { getLogger, getTracerProvider } from "@aop/infra";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAgentRoutes } from "./agent/routes.ts";
import { createChannelRoutes } from "./channel/routes.ts";
import { createChatSessionRoutes } from "./chat-session/routes.ts";
import type { LocalServerContext } from "./context.ts";
import { createCreateTaskRoutes } from "./create-task/routes.ts";
import { createEventsSSEHandler } from "./events/index.ts";
import { createLogStreamHandler } from "./events/log-routes.ts";
import { createExecHostRoutes } from "./exec-hosts/routes.ts";
import {
  isAllowedExternalUrl,
  openExternalUrl as openExternalUrlWithSystem,
} from "./external-url.ts";
import { createFsRoutes } from "./fs/routes.ts";
import { createHealthRoutes } from "./health/routes.ts";
import { maybeCompressJsonResponse } from "./http-compression.ts";
import { createMcpRoutes } from "./mcp/routes.ts";
import { createProviderRoutes } from "./providers/routes.ts";
import { createRepoRoutes } from "./repo/routes";
import { createReviewInboxRoutes } from "./review-inbox/routes.ts";
import { createRunTaskRoutes } from "./run-task/routes.ts";
import { createRuntimeConfigurationRoutes } from "./runtime-configuration/routes.ts";
import { createRuntimeEventRoutes } from "./runtime-events/routes.ts";
import { createRuntimeProfileRoutes } from "./runtime-profile/routes.ts";
import { createSchedulerRoutes } from "./scheduler/routes.ts";
import { createOriginGuard } from "./security/origin-guard.ts";
import { createSessionGitRoutes } from "./session-git/routes.ts";
import { createSettingsRoutes } from "./settings/routes";
import { createSignalRoutes } from "./signals/routes.ts";
import { getServerStatus } from "./status/handlers.ts";
import { resolveTaskByIdentifier } from "./task/handlers.ts";
import { createUpdateRoutes } from "./updates/routes.ts";
import { createAgentMemoryRoutes } from "./worker-memory/routes.ts";
import { createWorkflowRoutes } from "./workflow/routes.ts";

const logger = getLogger("api");

export type ServiceStatus = "running" | "stopped" | "disabled";

export interface OrchestratorStatus {
  watcher: ServiceStatus;
  ticker: ServiceStatus;
  processor: ServiceStatus;
  scheduler: ServiceStatus;
}

export interface EventsSSEOptions {
  heartbeatIntervalMs?: number;
}

export interface AppDependencies {
  ctx: LocalServerContext;
  startTimeMs: number;
  orchestratorStatus?: () => OrchestratorStatus;
  isReady?: () => boolean;
  triggerRefresh?: () => boolean;
  dashboardStaticPath?: string;
  dashboardDevOrigin?: string;
  eventsSSEOptions?: EventsSSEOptions;
  openExternalUrl?: (url: string) => Promise<void>;
}

export const createApp = (deps: AppDependencies) => {
  const { ctx, dashboardStaticPath, dashboardDevOrigin } = deps;
  const app = new Hono();

  app.use("*", httpInstrumentationMiddleware({ tracerProvider: getTracerProvider() }));

  // Loopback trust boundary: reject DNS-rebound hosts and cross-origin
  // browser requests. CORS headers are only needed in dev, where the
  // dashboard runs on its own origin; in production it is served
  // same-origin by this server and no cross-origin access is granted.
  app.use(
    "/api/*",
    createOriginGuard({ allowedOrigins: dashboardDevOrigin ? [dashboardDevOrigin] : [] }),
  );
  if (dashboardDevOrigin) {
    app.use(
      "/api/*",
      cors({
        origin: dashboardDevOrigin,
        allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowHeaders: ["Content-Type", "Authorization"],
        exposeHeaders: ["Content-Length"],
        credentials: true,
      }),
    );
  }

  app.use("/api/*", async (c, next) => {
    await next();
    c.res = await maybeCompressJsonResponse(c.req.raw, c.res);
  });

  // Request logging middleware — skip noisy endpoints (SSE, health)
  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/health") || path === "/api/events" || path.endsWith("/logs")) {
      return next();
    }

    const method = c.req.method;
    const start = Date.now();
    logger.info("{method} {path}", { method, path });

    await next();

    const status = c.res.status;
    const durationMs = Date.now() - start;
    if (status >= 400) {
      logger.warn("{method} {path} → {status} ({durationMs}ms)", {
        method,
        path,
        status,
        durationMs,
      });
    } else {
      logger.info("{method} {path} → {status} ({durationMs}ms)", {
        method,
        path,
        status,
        durationMs,
      });
    }
  });

  app.route(
    "/api/health",
    createHealthRoutes({
      ctx,
      startTimeMs: deps.startTimeMs,
      orchestratorStatus: deps.orchestratorStatus,
    }),
  );

  app.get("/api/status", async (c) => {
    const status = await getServerStatus(ctx);
    return c.json({
      ready: deps.isReady?.() ?? false,
      ...status,
    });
  });

  app.post("/api/refresh", async (c) => {
    const triggered = deps.triggerRefresh?.() ?? false;
    if (!triggered) {
      return c.json({ error: "Orchestrator not ready" }, 503);
    }
    return c.json({ ok: true, message: "Refresh triggered" });
  });

  app.post("/api/open-external", async (c) => {
    const body = await c.req.json<{ url?: unknown }>().catch(() => null);
    const url = typeof body?.url === "string" ? body.url : "";
    if (!isAllowedExternalUrl(url)) {
      return c.json({ error: "Only https URLs and loopback http URLs can be opened." }, 400);
    }

    try {
      await (deps.openExternalUrl ?? openExternalUrlWithSystem)(url);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open external URL.";
      return c.json({ error: message }, 500);
    }
  });

  app.get("/api/tasks/resolve/:identifier", async (c) => {
    const identifier = c.req.param("identifier");
    const task = await resolveTaskByIdentifier(ctx, identifier);

    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    return c.json({ task });
  });

  app.get("/api/events", createEventsSSEHandler(ctx, deps.eventsSSEOptions));
  app.get("/api/executions/:executionId/logs", createLogStreamHandler(ctx));
  app.route("/api", createRuntimeEventRoutes(ctx));

  app.route("/api/agents", createAgentRoutes(ctx));
  app.route("/api", createProviderRoutes());
  app.route("/api", createReviewInboxRoutes(ctx));
  app.route("/api", createSignalRoutes(ctx));
  app.route("/api/agent-memory", createAgentMemoryRoutes(ctx));
  app.route("/api/channels", createChannelRoutes(ctx));
  app.route("/api/chat-sessions", createChatSessionRoutes(ctx));
  app.route("/api/chat-sessions", createSessionGitRoutes(ctx));
  app.route("/api/mcp", createMcpRoutes(ctx));
  app.route("/api/workflows", createWorkflowRoutes(ctx));

  app.get("/api/metrics", async (c) => {
    const repoId = c.req.query("repoId");
    const metrics = await ctx.taskRepository.getMetrics(repoId);
    return c.json(metrics);
  });

  app.route("/api/agents", createAgentRoutes(ctx));
  app.route("/api/repos", createRepoRoutes(ctx));
  app.route("/api/settings", createSettingsRoutes(ctx));
  app.route("/api/exec-hosts", createExecHostRoutes(ctx));
  app.route("/api/runtime-profiles", createRuntimeProfileRoutes(ctx));
  app.route("/api/runtime-configuration", createRuntimeConfigurationRoutes(ctx));
  app.route("/api/create-task", createCreateTaskRoutes(ctx));
  app.route("/api/run-task", createRunTaskRoutes(ctx));
  app.route("/api/scheduler", createSchedulerRoutes(ctx));
  app.route("/api/fs", createFsRoutes(ctx));
  app.route("/api/updates", createUpdateRoutes());

  // Test-only endpoint to directly set task status (for E2E testing)
  if (process.env.AOP_TEST_MODE === "true") {
    app.patch("/api/tasks/:taskId/status", async (c) => {
      const taskId = c.req.param("taskId");
      const body = await c.req.json<{ status: string }>();

      const validStatuses = [
        "DRAFT",
        "READY",
        "RESUMING",
        "WORKING",
        "PAUSED",
        "BLOCKED",
        "DONE",
        "REMOVED",
      ];
      if (!validStatuses.includes(body.status)) {
        return c.json({ error: "Invalid status" }, 400);
      }

      const task = await ctx.taskRepository.get(taskId);
      if (!task) {
        return c.json({ error: "Task not found" }, 404);
      }

      const updated = await ctx.taskRepository.update(taskId, {
        status: body.status as
          | "DRAFT"
          | "READY"
          | "WORKING"
          | "PAUSED"
          | "BLOCKED"
          | "DONE"
          | "REMOVED",
      });

      return c.json({ ok: true, task: updated });
    });
  }

  if (dashboardStaticPath) {
    app.get("*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname.startsWith("/api/")) {
        return c.notFound();
      }

      const staticResponse = await serveStaticFile(dashboardStaticPath, pathname);
      if (staticResponse) return staticResponse;

      const spaResponse = await serveSpaFallback(dashboardStaticPath);
      if (spaResponse) return spaResponse;

      return c.notFound();
    });
  } else {
    app.get("*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname.startsWith("/api/")) {
        return c.notFound();
      }

      return c.html(renderDashboardUnavailablePage({ dashboardDevOrigin }), 503);
    });
  }

  return app;
};

const MIME_TYPES: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
};

const getMimeType = (path: string): string => {
  const ext = path.split(".").pop()?.toLowerCase();
  return MIME_TYPES[ext ?? ""] ?? "application/octet-stream";
};

// Content-hashed bundles (e.g. main-pgsvk45c.js) are immutable — their name changes when
// their content does — so they can be cached forever. index.html and unhashed assets MUST
// revalidate every load, otherwise a browser/WebView2 keeps serving a stale index.html that
// points at the previous bundle and app/dashboard updates never take effect.
const HASHED_ASSET = /-[0-9a-z]{8,}\.[0-9a-z]+$/i;

export const cacheControlFor = (filePath: string): string =>
  HASHED_ASSET.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache";

const serveStaticFile = async (basePath: string, pathname: string): Promise<Response | null> => {
  const filePath = pathname === "/" ? `${basePath}/index.html` : `${basePath}${pathname}`;

  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file, {
      headers: {
        "Content-Type": getMimeType(filePath),
        "Cache-Control": cacheControlFor(filePath),
      },
    });
  }
  return null;
};

const serveSpaFallback = async (basePath: string): Promise<Response | null> => {
  const indexFile = Bun.file(`${basePath}/index.html`);
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
    });
  }
  return null;
};

const renderDashboardUnavailablePage = (params: {
  dashboardDevOrigin?: string;
}): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dashboard unavailable</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0b0d12;
        color: #f5f5f4;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      main {
        width: min(42rem, calc(100vw - 2rem));
        padding: 1.5rem;
        border: 1px solid #262a33;
        border-radius: 0.75rem;
        background: #11141b;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1rem;
      }
      p, li {
        color: #b5bcc9;
        line-height: 1.6;
        font-size: 0.875rem;
      }
      code, a {
        color: #f59e0b;
      }
      ul {
        margin: 1rem 0 0;
        padding-left: 1.25rem;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Dashboard unavailable on this server</h1>
      <p>
        The local server is running, but it was started without the bundled dashboard assets.
        API routes are still available here, including <code>/api/health</code>.
      </p>
      <ul>
        <li>Installed mode: restart the user service so the built dashboard is served from this origin.</li>
        ${
          params.dashboardDevOrigin
            ? `<li>Dev mode: open <a href="${params.dashboardDevOrigin}">${params.dashboardDevOrigin}</a>.</li>`
            : ""
        }
        <li>If you expected the dashboard on this port, check whether a manual API-only server replaced the installed service.</li>
      </ul>
    </main>
  </body>
</html>`;
