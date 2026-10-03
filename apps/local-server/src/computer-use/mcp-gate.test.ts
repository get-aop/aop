import { describe, expect, test } from "bun:test";
import { createDriverClient } from "./driver-client.ts";
import { createDriverPool } from "./driver-pool.ts";
import { createCuaGate, LEASE_INSTRUCTIONS } from "./mcp-gate.ts";
import { A, B, fakeDriver, leaseClock, type Rpc, settle, sseMessages } from "./test-utils.ts";

const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args, _meta: { progressToken: id } },
});

const setup = (options: { maxWaitMs?: number; progressEveryMs?: number } = {}) => {
  const driver = fakeDriver();
  const { lease, clock, tick } = leaseClock();
  const pool = createDriverPool(async () => createDriverClient(driver.spawn));
  lease.setCleanup((threadId) => pool.endThread(threadId));
  const gate = createCuaGate({
    lease,
    pool,
    maxWaitMs: options.maxWaitMs ?? 60_000,
    progressEveryMs: options.progressEveryMs ?? 60_000,
  });
  return { driver, lease, pool, gate, clock, tick };
};

const jsonOf = async (response: Response | Promise<Response>): Promise<Rpc> =>
  (await (await response).json()) as Rpc;

const textOf = (message: Rpc | undefined): string => message?.result?.content?.[0]?.text ?? "";

describe("CUA gate", () => {
  test("initialize answers with the driver's own answer and the lease's rules", async () => {
    const { gate } = setup();
    const response = await gate.handle(A, { jsonrpc: "2.0", id: 1, method: "initialize" });
    const body = await jsonOf(response);
    expect(body.result?.serverInfo?.name).toBe("cua-driver");
    expect(body.result?.capabilities).toEqual({ tools: {}, resources: {} });
    expect(body.result?.instructions).toBe(
      `cua-driver: computer-use automation.\n\n${LEASE_INSTRUCTIONS}`,
    );
  });

  test("server/discover (MCP 2026-07-28) passes through with the lease's rules after the driver's", async () => {
    const { gate } = setup();
    const response = await jsonOf(
      gate.handle(A, { jsonrpc: "2.0", id: 9, method: "server/discover", params: {} }),
    );
    expect(response.id).toBe(9);
    expect(response.result?.instructions).toBe(`1:server/discover\n\n${LEASE_INSTRUCTIONS}`);
  });

  test("everything but a tool call passes through without the lease", async () => {
    const { gate, lease, driver } = setup();
    lease.tryAcquire(B);
    const listed = await jsonOf(gate.handle(A, { jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(listed.result?.tools?.map((t) => t.name)).toEqual(["click"]);
    const notified = await gate.handle(A, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notified.status).toBe(202);
    expect(driver.calls).toEqual(["1:initialize", "1:notifications/initialized", "1:tools/list"]);
  });

  test("the first thread's call runs at once, as plain JSON, in its own driver process", async () => {
    const { gate, lease, driver } = setup();
    const response = await gate.handle(A, call(3, "click"));
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(textOf(await jsonOf(response))).toBe("1:click");
    expect(lease.holderId()).toBe(A.id);

    await gate.handle(B, { jsonrpc: "2.0", id: 4, method: "tools/list" });
    expect(driver.started()).toBe(2);
  });

  test("another thread's call waits, hears where it stands, and runs once the holder ends its session", async () => {
    const { gate, lease, driver } = setup({ progressEveryMs: 5 });
    await gate.handle(A, call(1, "browser_prepare", { session: "a" }));
    const waiting = await gate.handle(B, call(2, "click"));
    expect(waiting.headers.get("content-type")).toBe("text/event-stream");
    const body = waiting.text();
    await Bun.sleep(30);
    expect(lease.waitOf(B.id)?.position).toBe(1);
    expect(driver.calls.filter((c) => c.endsWith(":click"))).toEqual([]);

    const ended = await gate.handle(A, call(3, "end_session", { session: "a" }));
    expect(textOf(await jsonOf(ended))).toBe("1:end_session");

    const messages = sseMessages(await body);
    const progress = messages.filter((m) => m.method === "notifications/progress");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]?.params?.progressToken).toBe(2);
    expect(progress[0]?.params?.message).toBe(
      `Waiting for computer use: "${A.title}" is using it; this thread is next in line.`,
    );
    const result = messages.at(-1);
    expect(result?.id).toBe(2);
    expect(textOf(result)).toBe("2:click");
    expect(lease.holderId()).toBe(B.id);
  });

  test("giving the lease back ends the sessions the holder left open and its driver", async () => {
    const { gate, lease, driver } = setup();
    await gate.handle(A, call(1, "browser_prepare", { session: "web" }));
    await gate.handle(A, call(2, "list_windows"));
    await gate.handle(A, call(3, "end_session", { session: "web" }));
    await settle();
    await settle();
    expect(lease.holderId()).toBeNull();
    // The implicit session `list_windows` used is ended by the host; "web" was ended by A.
    expect(driver.calls.filter((c) => c.includes("end_session"))).toEqual([
      "1:tools/call:end_session",
      "1:tools/call:end_session",
    ]);
    expect(driver.ended()).toBe(1);
  });

  test("a call that waits too long says so and keeps the thread's place", async () => {
    const { gate, lease } = setup({ maxWaitMs: 10 });
    await gate.handle(A, call(1, "click"));
    const response = await gate.handle(B, call(2, "click"));
    const [last] = sseMessages(await response.text()).slice(-1);
    expect(last?.result?.isError).toBe(true);
    expect(last?.result?.resultType).toBe("complete");
    expect(textOf(last)).toContain("The call did not run. This thread keeps its place");
    expect(lease.waitOf(B.id)?.position).toBe(1);
  });

  test("a waiting call the client drops leaves the line", async () => {
    const { gate, lease } = setup();
    await gate.handle(A, call(1, "click"));
    const abort = new AbortController();
    const response = await gate.handle(B, call(2, "click"), abort.signal);
    const body = response.text();
    await settle();
    expect(lease.waitOf(B.id)).not.toBeNull();
    abort.abort();
    await body;
    expect(lease.waitOf(B.id)).toBeNull();
  });

  test("the holder's turn ending hands the lease to the next caller and ends the holder's driver", async () => {
    const { gate, lease, driver } = setup();
    await gate.handle(A, call(1, "click"));
    const waiting = (await gate.handle(B, call(2, "click"))).text();
    await lease.runEnded(A.id);
    expect(textOf(sseMessages(await waiting).at(-1))).toBe("2:click");
    expect(driver.ended()).toBe(1);
  });

  test("the idle timeout never cuts a call that is still running", async () => {
    const { gate, lease, clock, tick, driver } = setup();
    const running = gate.handle(A, call(1, "hold"));
    await settle();
    clock.advance(10 * 60_000);
    tick();
    await settle();
    expect(lease.holderId()).toBe(A.id);
    driver.releaseHeld();
    expect(textOf(await jsonOf(running))).toBe("1:hold");
  });
});

describe("the driver pool on host shutdown", () => {
  test("ends every thread's open sessions before its driver process", async () => {
    const { gate, pool, driver } = setup();
    await gate.handle(A, call(1, "browser_prepare", { session: "web" }));

    await pool.closeAll();

    expect(driver.calls.at(-1)).toBe("1:tools/call:end_session");
    expect(driver.ended()).toBe(1);
  });
});
