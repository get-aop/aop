import { afterEach, describe, expect, test } from "bun:test";
import type { ChatSession } from "../db/schema.ts";
import { createAuthenticatedMcpUrl } from "../mcp/auth.ts";
import {
  createProjectStack,
  insertProjectSession,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";
import { createDriverClient } from "./driver-client.ts";
import { createDriverPool } from "./driver-pool.ts";
import { createCuaGateRoutes } from "./gate-routes.ts";
import { createCuaGate } from "./mcp-gate.ts";
import { fakeDriver, leaseClock, type Rpc, sseMessages } from "./test-utils.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path());
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  const { lease } = leaseClock();
  const driver = fakeDriver();
  const pool = createDriverPool(async () => createDriverClient(driver.spawn));
  lease.setCleanup((threadId) => pool.endThread(threadId));
  const gate = createCuaGate({ lease, pool, maxWaitMs: 60_000 });
  s.app.route(
    "/api/mcp/cua",
    createCuaGateRoutes(s.ctx, s.services, () => gate),
  );
  for (const id of ["isess_one", "isess_two"]) {
    await insertProjectSession(s.db, { id, projectId: created.project.id, kind: "thread" });
  }
  const coordinator = (await s.ctx.chatSessionRepository.getCoordinator(
    created.project.id,
  )) as ChatSession;
  return { s, lease, coordinator };
};

const post = (s: ProjectStack, url: string | URL, body: unknown) =>
  s.app.request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const gateUrl = (sessionId: string) =>
  createAuthenticatedMcpUrl("http://localhost/api/mcp/cua", sessionId);

const click = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "click" } };

describe("the CUA gate's route", () => {
  test("a thread's session gets through on its AOP token, and its first call takes the lease", async () => {
    const { s, lease } = await setup();

    const response = await post(s, gateUrl("isess_one"), click);

    expect(response.status).toBe(200);
    expect(((await response.json()) as Rpc).result?.content?.[0]?.text).toBe("1:click");
    expect(lease.holderId()).toBe("isess_one");
  });

  test("another thread's call waits in line as an event stream", async () => {
    const { s, lease } = await setup();
    await post(s, gateUrl("isess_one"), click);

    const waiting = await post(s, gateUrl("isess_two"), { ...click, id: 2 });
    const body = waiting.text();
    expect(waiting.headers.get("content-type")).toBe("text/event-stream");
    expect(lease.state().queue.map((waiter) => [waiter.threadId, waiter.position])).toEqual([
      ["isess_two", 1],
    ]);

    await lease.release("isess_one", "end-session");
    expect(sseMessages(await body).at(-1)?.result?.content?.[0]?.text).toBe("2:click");
  });

  test("the coordinator, a missing token and another session's token are refused", async () => {
    const { s, coordinator } = await setup();
    const forged = new URL(gateUrl("isess_one"));
    forged.searchParams.set("sessionId", "isess_two");

    expect((await post(s, gateUrl(coordinator.id), click)).status).toBe(401);
    expect((await post(s, "http://localhost/api/mcp/cua", click)).status).toBe(401);
    expect((await post(s, forged, click)).status).toBe(401);
  });

  test("a body that is not JSON-RPC is a bad request, and GET is not offered", async () => {
    const { s } = await setup();

    expect((await post(s, gateUrl("isess_one"), { hello: true })).status).toBe(400);
    expect((await s.app.request(gateUrl("isess_one"))).status).toBe(405);
  });
});
