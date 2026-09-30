import { afterAll, describe, expect, test } from "bun:test";
import { createMcpConnection } from "./mcp-client";

interface RpcRequest {
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
  id?: number;
}

interface FakeServer {
  url: string;
  requests: Array<{ method: string; path: string; headers: Headers; body: RpcRequest }>;
}

const servers: Array<ReturnType<typeof Bun.serve>> = [];
afterAll(() => {
  for (const server of servers) server.stop(true);
});

/** A tiny MCP endpoint. `onCall` builds the `tools/call` response body. */
const serve = (
  options: { tools?: string[]; onCall?: (request: RpcRequest) => unknown; status?: number } = {},
): FakeServer => {
  const requests: FakeServer["requests"] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const body = (await request.json()) as RpcRequest;
      const url = new URL(request.url);
      requests.push({
        method: request.method,
        path: `${url.pathname}${url.search}`,
        headers: request.headers,
        body,
      });
      if (options.status) return new Response("nope", { status: options.status });
      return respond(body, options);
    },
  });
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}/api/mcp?sessionId=s1&accessToken=t1`, requests };
};

const respond = (
  body: RpcRequest,
  options: { tools?: string[]; onCall?: (r: RpcRequest) => unknown },
) => {
  const rpc = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id ?? null, result });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "initialize") return rpc({ protocolVersion: "2024-11-05", capabilities: {} });
  if (body.method === "tools/list") {
    return rpc({ tools: (options.tools ?? ["thread_spawn"]).map((name) => ({ name })) });
  }
  const called = options.onCall?.(body) ?? { content: [{ type: "text", text: "ok" }] };
  return Response.json(
    "error" in Object(called)
      ? { jsonrpc: "2.0", id: body.id, ...(called as object) }
      : { jsonrpc: "2.0", id: body.id, result: called },
  );
};

const methods = (server: FakeServer): string[] => server.requests.map((r) => r.body.method);

describe("createMcpConnection", () => {
  test("initializes, lists tools once, then calls the tool with the URL exactly as given", async () => {
    const server = serve({ tools: ["thread_spawn", "thread_list"] });
    const aop = createMcpConnection(server.url);

    const first = await aop.callTool("thread_spawn", { title: "Fix login" });
    const second = await aop.callTool("thread_list", {});

    expect(first).toEqual({ text: "ok", isError: false });
    expect(second).toEqual({ text: "ok", isError: false });
    expect(methods(server)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "tools/call",
    ]);
    const call = server.requests[3];
    expect(call?.body.params).toEqual({ name: "thread_spawn", arguments: { title: "Fix login" } });
    expect(call?.path).toBe("/api/mcp?sessionId=s1&accessToken=t1");
    expect(call?.headers.get("content-type")).toBe("application/json");
    expect(call?.headers.get("accept")).toBe("application/json, text/event-stream");
    expect(server.requests[0]?.body).toMatchObject({
      params: { protocolVersion: "2024-11-05", clientInfo: { name: "fake-claude" } },
    });
  });

  test("sends nothing until the first call", async () => {
    const server = serve();

    createMcpConnection(server.url);

    expect(server.requests).toEqual([]);
  });

  test("a tool the server did not list is refused without a tools/call", async () => {
    const server = serve({ tools: ["thread_list"] });
    const aop = createMcpConnection(server.url);

    const result = await aop.callTool("thread_spawn", {});

    expect(result).toEqual({
      text: "No such tool available: mcp__aop__thread_spawn",
      isError: true,
    });
    expect(methods(server)).not.toContain("tools/call");
  });

  test("joins text blocks and passes isError through", async () => {
    const server = serve({
      onCall: () => ({
        content: [
          { type: "text", text: "line one" },
          { type: "text", text: "line two" },
        ],
        isError: true,
      }),
    });

    const result = await createMcpConnection(server.url).callTool("thread_spawn", {});

    expect(result).toEqual({ text: "line one\nline two", isError: true });
  });

  test("a JSON-RPC error becomes an error result carrying its message", async () => {
    const server = serve({
      onCall: () => ({
        error: { code: -32000, message: "Repository is not part of this project" },
      }),
    });

    const result = await createMcpConnection(server.url).callTool("thread_spawn", {});

    expect(result).toEqual({ text: "Repository is not part of this project", isError: true });
  });

  test.each([
    ["a plain object", { message: "hello" }],
    ["a string", "hello"],
    ["a non-text block", [{ type: "image", data: "x" }]],
    ["a text block without text", [{ type: "text" }]],
    ["missing", null],
  ])("rejects a tool result whose content is %s", async (_label, content) => {
    const server = serve({ onCall: () => ({ content, isProposal: false }) });

    const result = await createMcpConnection(server.url).callTool("thread_spawn", {});

    expect(result).toEqual({ text: "invalid MCP tool result", isError: true });
  });

  test("an HTTP error during the handshake makes every call unreachable, without retrying", async () => {
    const server = serve({ status: 401 });
    const aop = createMcpConnection(server.url);

    const first = await aop.callTool("thread_spawn", {});
    const second = await aop.callTool("thread_spawn", {});

    expect(first).toEqual({ text: "MCP server aop unreachable: HTTP 401", isError: true });
    expect(second).toEqual(first);
    expect(methods(server)).toEqual(["initialize"]);
  });

  test("a server that is not listening is reported as unreachable", async () => {
    const probe = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const url = `http://127.0.0.1:${probe.port}/api/mcp`;
    probe.stop(true);

    const result = await createMcpConnection(url).callTool("thread_spawn", {});

    expect(result.isError).toBe(true);
    expect(result.text).toStartWith("MCP server aop unreachable: ");
  });
});
