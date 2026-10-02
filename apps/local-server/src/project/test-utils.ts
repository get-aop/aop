import { afterAll, beforeAll } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectSettings } from "@aop/common";
import { buildProjectSettings } from "@aop/common/test-utils";
import { ClaudeCodeProvider, type LLMProvider, type RunOptions } from "@aop/llm-provider";
import { FAKE_CLI_PATH } from "@aop/llm-provider/test-fixtures";
import { Hono } from "hono";
import type { Insertable, Kysely } from "kysely";
import { createArtifactRoutes } from "../artifact/routes.ts";
import { createAttachmentRoutes } from "../attachment/routes.ts";
import { createAttachmentService } from "../attachment/service.ts";
import { waitForPendingChatReplies } from "../chat-session/service.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { ChatSessionKind, ChatSessionsTable, Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import type { RunGh } from "../github-cli/index.ts";
import { createLibraryRoutes } from "../library/routes.ts";
import { createAuthenticatedMcpUrl } from "../mcp/auth.ts";
import { createMcpRoutes } from "../mcp/routes.ts";
import { createPullRequestWatchRoutes } from "../pull-request-watch/routes.ts";
import type { PullRequestWatcherDeps } from "../pull-request-watch/watcher.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { createSuggestionRoutes } from "../suggestion/routes.ts";
import type { ThreadGitDeps } from "../thread/git.ts";
import { attachBareOrigin } from "../thread/git-test-utils.ts";
import { createThreadRoutes } from "../thread/routes.ts";
import { createProjectRoutes } from "./routes.ts";
import { createProjectServices, type ProjectServices } from "./services.ts";

export const projectSettings = (overrides: Partial<ProjectSettings> = {}): ProjectSettings =>
  buildProjectSettings({
    name: "Checkout revamp",
    goal: "Ship the new checkout",
    instructions: "Keep pull requests small.",
    thread: { provider: "claude-code", model: "claude-opus-4-8", effort: "high" },
    ...overrides,
  });

/** Inserts a bare project row, bypassing the repository, for tests of the schema itself. */
export const insertProjectRow = async (db: Kysely<Database>, id: string): Promise<void> => {
  await db
    .insertInto("projects")
    .values({
      id,
      name: id,
      coordinator_provider: "claude-code",
      coordinator_model: null,
      coordinator_effort: null,
      thread_provider: "claude-code",
      thread_model: null,
      thread_effort: null,
    })
    .execute();
};

type SessionColumns = Partial<Insertable<ChatSessionsTable>>;

/**
 * Inserts a chat_sessions row that belongs to a project. A thread starts `working`; a
 * coordinator has no state. `columns` overrides any column, valid or not.
 */
export const insertProjectSession = async (
  db: Kysely<Database>,
  session: { id: string; projectId: string; kind: ChatSessionKind },
  columns: SessionColumns = {},
): Promise<void> => {
  await db
    .insertInto("chat_sessions")
    .values({
      id: session.id,
      repo_id: null,
      title: session.id,
      runtime: "claude-code",
      runtime_configuration_id: null,
      model: "claude-opus-4-8",
      reasoning_effort: "medium",
      runtime_alias: null,
      runtime_session_id: null,
      workspace_path: null,
      created_at: "2026-09-30T09:00:00.000Z",
      updated_at: "2026-09-30T09:00:00.000Z",
      project_id: session.projectId,
      kind: session.kind,
      state: session.kind === "thread" ? "working" : null,
      last_activity_at: "2026-09-30T09:00:00.000Z",
      ...columns,
    })
    .execute();
};

// The one guard between a suite and a real model call: run the real adapter, but only when it
// is about to spawn the fake CLI. Any other executable fails the turn instead of reaching `claude`.
export const fakeOnlyClaude: LLMProvider = {
  name: "claude-code",
  run: (options) => {
    const provider = new ClaudeCodeProvider();
    const [executable] = provider.buildCommand(options);
    if (executable !== FAKE_CLI_PATH) {
      throw new Error(`Refusing to spawn ${executable}; this suite only runs the fake CLI`);
    }
    return provider.run(options);
  },
};

/** Points AOP_HOME at a scratch directory for the file's tests: run logs and the fake's sessions live there. */
export const useTempAopHome = (): { path: () => string } => {
  let home = "";
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.AOP_HOME;
    home = mkdtempSync(join(tmpdir(), "aop-project-"));
    process.env.AOP_HOME = home;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.AOP_HOME;
    else process.env.AOP_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  return { path: () => home };
};

/** Registers the fake CLI as the first runtime configuration, so projects run on it. */
export const registerFakeRuntime = async (db: Kysely<Database>): Promise<void> => {
  const configurations = createRuntimeConfigurationRepository(db);
  const provider = await configurations.createProvider({
    name: "Fake CLI",
    command: FAKE_CLI_PATH,
    driver: "claude-code",
  });
  await configurations.createModel(provider.id, {
    description: "Fake model",
    model: "fake-model",
    thinkingLevels: [],
  });
  const others = (await configurations.list())
    .map(({ id }) => id)
    .filter((id) => id !== provider.id);
  await configurations.reorderProviders([provider.id, ...others]);
};

export interface McpToolResponse {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export interface McpResponse {
  result?: McpToolResponse & { tools?: { name: string; inputSchema: Record<string, unknown> }[] };
  error?: { code: number; message: string };
}

export interface ProjectStack {
  ctx: LocalServerContext;
  db: Kysely<Database>;
  services: ProjectServices;
  app: Hono;
  /** Registered repositories, as `{ id, path }`; with `origin` each also has its bare remote's path. */
  repos: { id: string; path: string; origin?: string }[];
  api: <T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: T }>;
  /** A JSON-RPC request to the MCP endpoint, signed as the given chat session. */
  mcp: (
    sessionId: string,
    method: string,
    params?: unknown,
  ) => Promise<{ status: number; body: McpResponse }>;
  /** Calls one MCP tool as a session and returns its result; a JSON-RPC error fails the test. */
  callTool: (sessionId: string, name: string, args?: unknown) => Promise<McpToolResponse>;
  /** The options of every provider run the engine started, in order: what each session asked the CLI for. */
  runs: RunOptions[];
  /** Waits for every reply and recovery the engine is running to finish. */
  settle: () => Promise<void>;
  cleanup: () => Promise<void>;
}

/**
 * A migrated database, the project and thread routes over the real chat engine, and the fake CLI
 * as the only runtime. With `mcp`, the app also listens on a real port and the runs the engine
 * starts are pointed at it, so the fake reaches the AOP MCP endpoint over HTTP like Claude would.
 */
export const createProjectStack = async (
  aopHome: string,
  options: {
    repos?: number;
    mcp?: boolean;
    /** Gives every repo a bare repository as its origin, so branches push somewhere real. */
    origin?: boolean;
    /** The seams of the git side of threads; `runGh` defaults to one that refuses, never the real `gh`. */
    git?: ThreadGitDeps;
    /** The seams of the pull request watcher: its clock, its randomness, its pace and its cap. */
    watch?: PullRequestWatcherDeps;
    /** The quiet window before thread reports wake the coordinator; short by default so suites stay fast. */
    wakeWindowMs?: number;
  } = {},
): Promise<ProjectStack> => {
  const db = await createTestDb();
  const ctx = createCommandContext(db);
  const repos: ProjectStack["repos"] = [];
  for (let index = 0; index < (options.repos ?? 1); index += 1) {
    const path = join(aopHome, `repo-${crypto.randomUUID()}`);
    mkdirSync(path, { recursive: true });
    const id = `repo_test_${index}`;
    await createTestRepo(db, id, path);
    repos.push({ id, path, ...(options.origin && { origin: attachBareOrigin(path) }) });
  }
  await registerFakeRuntime(db);

  const runs: RunOptions[] = [];
  const recordingProvider: LLMProvider = {
    name: "claude-code",
    run: (options) => {
      runs.push(options);
      return fakeOnlyClaude.run(options);
    },
  };
  const services = createProjectServices(
    ctx,
    {
      createProviderFn: () => recordingProvider,
      recoveryPollIntervalMs: 20,
      coordinatorWakeWindowMs: options.wakeWindowMs ?? 25,
    },
    { runGh: refusingGh, ...options.git },
    options.watch,
  );
  const app = new Hono();
  app.route("/api/mcp", createMcpRoutes(ctx, services));
  app.route("/api/projects", createProjectRoutes(services));
  app.route("/api/projects", createAttachmentRoutes(createAttachmentService(ctx)));
  app.route("/api/projects", createLibraryRoutes(services.library));
  app.route("/api/projects", createArtifactRoutes(services.artifacts, services.visualize));
  app.route("/api", createThreadRoutes(services));
  app.route("/api", createSuggestionRoutes(services));
  app.route("/api", createPullRequestWatchRoutes(services));

  const previousMcpUrl = process.env.AOP_MCP_URL;
  const server = options.mcp
    ? Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch })
    : null;
  // Without a listener, a run that reaches for the MCP endpoint fails at once instead of finding
  // whatever else listens on the default port.
  process.env.AOP_MCP_URL = `http://127.0.0.1:${server?.port ?? 1}/api/mcp`;

  const request = async (
    sessionId: string,
    method: string,
    params?: unknown,
  ): Promise<{ status: number; body: McpResponse }> => {
    const url = createAuthenticatedMcpUrl("http://localhost/api/mcp", sessionId);
    const response = await app.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return { status: response.status, body: (await response.json()) as McpResponse };
  };

  return {
    ctx,
    db,
    services,
    app,
    repos,
    api: async (method, path, body) => {
      const response = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, body: (text ? JSON.parse(text) : null) as never };
    },
    runs,
    mcp: request,
    callTool: async (sessionId, name, args = {}) => {
      const { body } = await request(sessionId, "tools/call", { name, arguments: args });
      if (!body.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(body.error)}`);
      return body.result;
    },
    settle: waitForPendingChatReplies,
    cleanup: async () => {
      await waitForPendingChatReplies();
      await server?.stop(true);
      if (previousMcpUrl === undefined) delete process.env.AOP_MCP_URL;
      else process.env.AOP_MCP_URL = previousMcpUrl;
      await db.destroy();
    },
  };
};

/** The `gh` of a suite that did not ask for one: it is never the real GitHub CLI. */
const refusingGh: RunGh = async () => ({
  exitCode: 1,
  stdout: "",
  stderr: "gh is not available in this test",
});

/** Polls until `probe` returns something other than undefined; the fake settles within a few seconds. */
export const eventually = async <T>(
  probe: () => Promise<T | undefined> | T | undefined,
  description: string,
  timeoutMs = 15_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
};
