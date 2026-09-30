import { describe, expect, test } from "bun:test";
import { classifyNetworkError, createHostClient, describeNetworkError } from "./host-client";
import { fakeDevice, HOST, healthyBody, scriptedFetch } from "./test-utils";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

describe("health", () => {
  test("reads the host's versions from the public health route, with no credentials", async () => {
    const host = scriptedFetch(() => json(healthyBody()));

    const result = await createHostClient(HOST, host.fetch).health();

    expect(result).toEqual({
      status: "ok",
      health: {
        service: "aop",
        version: "0.9.51",
        apiVersion: 1,
        minClientApiVersion: 1,
      },
    });
    expect(host.requests[0]).toMatchObject({
      url: `${HOST}/api/health`,
      method: "GET",
      credentials: "omit",
    });
    expect(host.requests[0]?.headers.authorization).toBeUndefined();
  });

  test("says not-aop for an answer that is not an AOP host, including a host too old to report versions", async () => {
    for (const response of [
      json({ ok: true, service: "aop", uptime: 1 }),
      json({ hello: "world" }),
      new Response("<html>Welcome to nginx</html>"),
      json({ error: "nope" }, 404),
    ]) {
      const host = scriptedFetch(() => response.clone());

      expect((await createHostClient(HOST, host.fetch).health()).status).toBe("not-aop");
    }
  });

  test("says unreachable, in words, when there is no answer", async () => {
    const host = scriptedFetch(() => {
      throw new TypeError("net::ERR_CONNECTION_REFUSED");
    });

    expect(await createHostClient(HOST, host.fetch).health()).toEqual({
      status: "unreachable",
      message: "The host refused the connection. Check that AOP is running on it.",
      failure: "refused",
    });
  });
});

describe("principal", () => {
  test("sends the bearer token and reports who the host thinks this is", async () => {
    const host = scriptedFetch(() => json({ kind: "device", device: fakeDevice() }));

    const result = await createHostClient(HOST, host.fetch).principal("aop_t");

    expect(result.status).toBe("ok");
    expect(host.requests[0]?.url).toBe(`${HOST}/api/auth/me`);
    expect(host.requests[0]?.headers.authorization).toBe("Bearer aop_t");
  });

  test("sends no header for the owner on the host's own Mac", async () => {
    const host = scriptedFetch(() => json({ kind: "owner" }));

    await createHostClient("http://127.0.0.1:25150", host.fetch).principal(null);

    expect(host.requests[0]?.headers.authorization).toBeUndefined();
  });

  test("a 401 means the host does not know this device", async () => {
    const host = scriptedFetch(() => json({ code: "UNAUTHENTICATED" }, 401));

    expect(await createHostClient(HOST, host.fetch).principal("aop_revoked")).toEqual({
      status: "unauthorized",
    });
  });

  test("any other failure is not read as a revoked token", async () => {
    const host = scriptedFetch(() => json({ error: "boom" }, 500));

    expect((await createHostClient(HOST, host.fetch).principal("aop_t")).status).toBe("failed");
  });
});

describe("pair", () => {
  test("trades the code and the device's name for a token", async () => {
    const host = scriptedFetch(() => json({ device: fakeDevice(), token: "aop_fresh" }, 201));

    const result = await createHostClient(HOST, host.fetch).pair("K7QM-4XNP", "Work laptop");

    expect(result).toEqual({ status: "paired", token: "aop_fresh" });
    expect(host.requests[0]).toMatchObject({
      url: `${HOST}/api/auth/pair`,
      method: "POST",
      credentials: "omit",
    });
    expect(JSON.parse(host.requests[0]?.body ?? "{}")).toEqual({
      code: "K7QM-4XNP",
      name: "Work laptop",
    });
  });

  test("tells a wrong code from a rate limit, and keeps how long to wait", async () => {
    const wrong = scriptedFetch(() => json({ code: "INVALID_PAIRING_CODE" }, 401));
    const limited = scriptedFetch(() =>
      json({ code: "RATE_LIMITED" }, 429, { "Retry-After": "42" }),
    );
    const limitedWithoutHeader = scriptedFetch(() => json({}, 429));

    expect(await createHostClient(HOST, wrong.fetch).pair("X", "n")).toEqual({
      status: "wrong-code",
    });
    expect(await createHostClient(HOST, limited.fetch).pair("X", "n")).toEqual({
      status: "rate-limited",
      retryAfterSeconds: 42,
    });
    expect(await createHostClient(HOST, limitedWithoutHeader.fetch).pair("X", "n")).toEqual({
      status: "rate-limited",
      retryAfterSeconds: null,
    });
  });

  test("does not call a reply without a token a success", async () => {
    const host = scriptedFetch(() => json({ device: fakeDevice() }, 201));

    expect((await createHostClient(HOST, host.fetch).pair("X", "n")).status).toBe("failed");
  });
});

describe("createPairingCode", () => {
  test("gets a code on the host's own Mac", async () => {
    const host = scriptedFetch(() =>
      json({ code: "K7QM-4XNP", expiresAt: "2026-09-30T12:10:00.000Z" }, 201),
    );

    expect(
      await createHostClient("http://127.0.0.1:25150", host.fetch).createPairingCode(),
    ).toEqual({ status: "ok", code: "K7QM-4XNP", expiresAt: "2026-09-30T12:10:00.000Z" });
    expect(host.requests[0]).toMatchObject({
      url: "http://127.0.0.1:25150/api/auth/pairing-codes",
      method: "POST",
    });
  });

  test("says not-owner when the host will not hand a code to this caller", async () => {
    for (const status of [401, 403]) {
      const host = scriptedFetch(() => json({ code: "HOST_ONLY" }, status));

      expect(await createHostClient(HOST, host.fetch).createPairingCode()).toEqual({
        status: "not-owner",
      });
    }
  });
});

describe("signOut", () => {
  test("asks the host to remove this device, and never throws when it cannot", async () => {
    const away = scriptedFetch(() => {
      throw new TypeError("net::ERR_INTERNET_DISCONNECTED");
    });
    const host = scriptedFetch(() => new Response(null, { status: 204 }));

    await createHostClient(HOST, host.fetch).signOut("aop_t");
    await createHostClient(HOST, away.fetch).signOut("aop_t");

    expect(host.requests[0]).toMatchObject({ url: `${HOST}/api/auth/session`, method: "DELETE" });
    expect(host.requests[0]?.headers.authorization).toBe("Bearer aop_t");
  });
});

describe("describeNetworkError", () => {
  test("explains the failures a person can fix", () => {
    const cases: [unknown, RegExp][] = [
      [new TypeError("net::ERR_NAME_NOT_RESOLVED"), /could not be found.*Tailscale/],
      [new TypeError("net::ERR_CERT_AUTHORITY_INVALID"), /certificate/],
      [new DOMException("The operation timed out.", "TimeoutError"), /did not answer in time/],
      [new TypeError("net::ERR_INTERNET_DISCONNECTED"), /cannot reach the network/],
      [
        Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }),
        /refused/,
      ],
      [new Error("something else"), /Could not reach the host/],
    ];

    for (const [error, expected] of cases) expect(describeNetworkError(error)).toMatch(expected);
  });

  test("sorts a failure by what can be done about it", () => {
    expect(classifyNetworkError(new TypeError("net::ERR_CONNECTION_REFUSED"))).toBe("refused");
    expect(classifyNetworkError(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
    expect(classifyNetworkError(new TypeError("net::ERR_NAME_NOT_RESOLVED"))).toBe("not-found");
    expect(classifyNetworkError("???")).toBe("other");
  });
});
