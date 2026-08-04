import { describe, expect, test } from "bun:test";
import { createProxyRequestInit } from "./dev-proxy";

describe("createProxyRequestInit", () => {
  test("does not forward a body for GET requests", () => {
    const request = new Request("http://localhost/api/chat-sessions");
    const headers = new Headers({ "accept-encoding": "gzip, deflate" });

    const init = createProxyRequestInit(request, headers);

    expect(init.body).toBeUndefined();
    expect(init.duplex).toBeUndefined();
    expect(new Headers(init.headers).get("accept-encoding")).toBe("identity");
  });

  test("forwards the body for POST requests", () => {
    const request = new Request("http://localhost/api/chat-sessions", {
      method: "POST",
      body: "{}",
    });

    const init = createProxyRequestInit(request, new Headers());

    expect(init.body).toBe(request.body);
    expect(init.duplex).toBe("half");
  });
});
