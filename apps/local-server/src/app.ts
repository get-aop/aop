import { extname } from "node:path";
import { getLogger, getTracerProvider } from "@aop/infra";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { type Context, Hono } from "hono";
import { createHostAgentCliService } from "./agent-cli/host-agent-cli-service.ts";
import { createAgentCliRoutes } from "./agent-cli/routes.ts";
import type { AgentCliService } from "./agent-cli/service.ts";
import { createArtifactRoutes } from "./artifact/routes.ts";
import { createAttachmentRoutes } from "./attachment/routes.ts";
import { createAttachmentService } from "./attachment/service.ts";
import { type AuthEnv, createApiAuth } from "./auth/api-auth.ts";
import { createApiCors } from "./auth/cross-origin.ts";
import { createOriginGuard } from "./auth/origin-guard.ts";
import { createAuthRoutes } from "./auth/routes.ts";
import { createChatSessionRoutes } from "./chat-session/routes.ts";
import { createComputerUseRoutes } from "./computer-use/routes.ts";
import { type ComputerUseService, computerUse } from "./computer-use/service.ts";
import type { LocalServerContext } from "./context.ts";
import { createEventStreamRoutes } from "./event-log/routes.ts";
import { createFsRoutes } from "./fs/routes.ts";
import { createHealthRoutes } from "./health/routes.ts";
import { maybeCompressJsonResponse } from "./http-compression.ts";
import { createLibraryRoutes } from "./library/routes.ts";
import { createMcpRoutes } from "./mcp/routes.ts";
import { createMcpSecretRoutes } from "./mcp/secret-routes.ts";
import { createProjectRoutes } from "./project/routes.ts";
import { createProjectServices, type ProjectServices } from "./project/services.ts";
import { createPullRequestWatchRoutes } from "./pull-request-watch/routes.ts";
import { listRepoSummaries } from "./repo/handlers.ts";
import { createRepoRoutes } from "./repo/routes";
import { createRuntimeConfigurationRoutes } from "./runtime-configuration/routes.ts";
import { createSessionGitRoutes } from "./session-git/routes.ts";
import { createSettingsRoutes } from "./settings/routes";
import { createSuggestionRoutes } from "./suggestion/routes.ts";
import { createThreadRoutes } from "./thread/routes.ts";
import { createHostUpdateService } from "./update/host-update-service.ts";
import { createUpdateRoutes } from "./update/routes.ts";
import type { UpdateService } from "./update/update-service.ts";
import { createUsageRoutes } from "./usage/routes.ts";

const logger = getLogger("api");

export interface EventsSSEOptions {
  heartbeatIntervalMs?: number;
}

export interface AppDependencies {
  ctx: LocalServerContext;
  startTimeMs: number;
  dashboardStaticPath?: string;
  dashboardDevOrigin?: string;
  /** Origins besides the API's own that may call it from a browser (`AOP_ALLOWED_ORIGINS`). */
  allowedOrigins?: readonly string[];
  eventsSSEOptions?: EventsSSEOptions;
  /** The project services the routes call; the server passes its own so its housekeeping shares them. */
  projectServices?: ProjectServices;
  /** The host's own release and its updates; the server passes its own so it can run the daily check. */
  updates?: UpdateService;
  /** The agent CLIs and their updates; the server passes its own so it can run the periodic check. */
  agentClis?: AgentCliService;
  /** CUA Driver's status; tests pass one that probes a fake driver. */
  computerUse?: ComputerUseService;
}

export const createApp = (deps: AppDependencies) => {
  const { ctx, dashboardStaticPath, dashboardDevOrigin } = deps;
  const app = new Hono<AuthEnv>();

  app.use("*", httpInstrumentationMiddleware({ tracerProvider: getTracerProvider() }));

  // Trust boundary: reject cross-site browser requests, then require a device token, its
  // session cookie, or a direct request from the host itself (see auth/). The dashboard this
  // host serves is same-origin and needs no CORS; a page served from an allowed origin (the
  // desktop app's bundled dashboard, the dev dashboard) is granted it after the guard.
  const allowedOrigins = [
    ...(dashboardDevOrigin ? [dashboardDevOrigin] : []),
    ...(deps.allowedOrigins ?? []),
  ];
  app.use("/api/*", createOriginGuard({ allowedOrigins }));
  app.use("/api/*", createApiCors(allowedOrigins));

  app.use("/api/*", createApiAuth(ctx.authService));

  app.use("/api/*", async (c, next) => {
    await next();
    c.res = await maybeCompressJsonResponse(c.req.raw, c.res);
  });

  // Request logging middleware — skip the noisy health endpoint
  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.startsWith("/api/health")) {
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

  app.route("/api/health", createHealthRoutes({ ctx, startTimeMs: deps.startTimeMs }));

  app.get("/api/status", async (c) => c.json(await listRepoSummaries(ctx)));

  app.route("/api/auth", createAuthRoutes(ctx));
  app.route("/api/projects", createEventStreamRoutes(ctx, deps.eventsSSEOptions));
  app.route("/api/chat-sessions", createChatSessionRoutes(ctx));
  app.route("/api/chat-sessions", createSessionGitRoutes(ctx));
  const projects = deps.projectServices ?? createProjectServices(ctx);
  app.route("/api/mcp", createMcpRoutes(ctx, projects));
  app.route("/api/mcp-secret", createMcpSecretRoutes());
  app.route("/api/projects", createProjectRoutes(projects));
  app.route("/api/projects", createAttachmentRoutes(createAttachmentService(ctx)));
  app.route("/api/projects", createLibraryRoutes(projects.library));
  app.route("/api/projects", createArtifactRoutes(projects.artifacts, projects.visualize));
  app.route("/api", createThreadRoutes(projects));
  app.route("/api", createSuggestionRoutes(projects));
  app.route("/api", createPullRequestWatchRoutes(projects));
  app.route("/api/repos", createRepoRoutes(ctx));
  app.route(
    "/api/settings",
    createSettingsRoutes(ctx, { runCapChanged: () => projects.chat.dispatchQueuedRuns() }),
  );
  app.route("/api/updates", createUpdateRoutes(deps.updates ?? createHostUpdateService(ctx)));
  app.route(
    "/api/agent-clis",
    createAgentCliRoutes(deps.agentClis ?? createHostAgentCliService(ctx)),
  );
  app.route("/api/computer-use", createComputerUseRoutes(deps.computerUse ?? computerUse));
  app.route("/api/runtime-configuration", createRuntimeConfigurationRoutes(ctx));
  app.route("/api/fs", createFsRoutes(ctx));
  app.route("/api/usage", createUsageRoutes(ctx));

  // An MCP client whose token is refused looks for OAuth metadata, and then registers itself, at
  // these paths. The host has neither, and a dashboard page in their place fails the client with
  // a SyntaxError instead of a plain refusal.
  const noOAuth = (c: Context) => c.json({ error: NO_OAUTH }, 404);
  app.all("/.well-known/*", noOAuth);
  app.post("/register", noOAuth);

  if (dashboardStaticPath) {
    app.get("*", async (c) => {
      const pathname = new URL(c.req.url).pathname;
      if (pathname.startsWith("/api/")) {
        return c.notFound();
      }

      const staticResponse = await serveStaticFile(dashboardStaticPath, pathname);
      if (staticResponse) return staticResponse;

      const spaResponse = await serveSpaFallback(dashboardStaticPath, pathname);
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

// What the model of a refused run reads, since Claude Code passes it on as the call's error.
const NO_OAUTH =
  "This AOP host has no OAuth server. Its MCP endpoint refused the token in the URL: the session ended, or the host's MCP secret was rotated. The next turn gets a new token.";

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

// The dashboard's router owns only paths without an extension. A missing font or bundle gets a
// 404: answered with index.html, it would fail in the browser without a trace.
const serveSpaFallback = async (basePath: string, pathname: string): Promise<Response | null> => {
  if (extname(pathname) !== "") return null;
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
