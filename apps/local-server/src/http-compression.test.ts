import { describe, expect, test } from "bun:test";
import { maybeCompressJsonResponse } from "./http-compression.ts";

describe("maybeCompressJsonResponse", () => {
  test("gzip compresses large JSON responses when the client accepts it", async () => {
    const payload = JSON.stringify({ value: "a".repeat(2_000) });
    const request = new Request("http://localhost/api/test", {
      headers: { "accept-encoding": "gzip, deflate" },
    });

    const response = await maybeCompressJsonResponse(
      request,
      new Response(payload, { headers: { "content-type": "application/json" } }),
    );

    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    expect(
      await new Response(response.body?.pipeThrough(new DecompressionStream("gzip"))).text(),
    ).toBe(payload);
  });

  test("leaves small JSON and event streams uncompressed", async () => {
    const request = new Request("http://localhost/api/test", {
      headers: { "accept-encoding": "gzip" },
    });
    const small = await maybeCompressJsonResponse(
      request,
      new Response('{"ok":true}', { headers: { "content-type": "application/json" } }),
    );
    const stream = await maybeCompressJsonResponse(
      request,
      new Response("data: ping\n\n", { headers: { "content-type": "text/event-stream" } }),
    );

    expect(small.headers.get("content-encoding")).toBeNull();
    expect(stream.headers.get("content-encoding")).toBeNull();
  });

  test("does not gzip when the client explicitly rejects gzip", async () => {
    const payload = JSON.stringify({ value: "a".repeat(2_000) });
    const response = await maybeCompressJsonResponse(
      new Request("http://localhost/api/test", {
        headers: { "accept-encoding": "br, gzip;q=0" },
      }),
      new Response(payload, { headers: { "content-type": "application/json" } }),
    );

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(payload);
  });
});
