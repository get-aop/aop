import { describe, expect, test } from "bun:test";
import { probeHost } from "./probe";
import { fakeHostClient, HOST } from "./test-utils";

const health = (apiVersion: number, minClientApiVersion: number) => ({
  status: "ok" as const,
  health: { service: "aop" as const, version: "1.2.3", apiVersion, minClientApiVersion },
});

describe("probeHost", () => {
  test("is connected when the host speaks this API and knows this device", async () => {
    expect(await probeHost(fakeHostClient(), HOST, "aop_t")).toEqual({
      status: "connected",
      host: HOST,
      hostVersion: "0.9.51",
    });
  });

  test("reports an unreachable host without asking who the device is", async () => {
    let asked = false;
    const client = fakeHostClient({
      health: async () => ({
        status: "unreachable",
        message: "The host refused the connection.",
        failure: "refused",
      }),
      principal: async () => {
        asked = true;
        return { status: "unauthorized" };
      },
    });

    expect(await probeHost(client, HOST, "aop_t")).toEqual({
      status: "unreachable",
      host: HOST,
      message: "The host refused the connection.",
    });
    expect(asked).toBe(false);
  });

  test("reports something that is not an AOP host", async () => {
    const client = fakeHostClient({ health: async () => ({ status: "not-aop" }) });

    expect(await probeHost(client, HOST, "aop_t")).toEqual({
      status: "incompatible",
      host: HOST,
      reason: "not-aop",
      hostVersion: null,
    });
  });

  test("reports a host from another API version before it reads any 401", async () => {
    const hostOlderThanApp = fakeHostClient({
      health: async () => health(1, 1),
      principal: async () => ({ status: "unauthorized" }),
    });
    const hostNewerThanApp = fakeHostClient({
      health: async () => health(9, 8),
      principal: async () => ({ status: "unauthorized" }),
    });

    expect(await probeHost(hostOlderThanApp, HOST, "t", 3)).toMatchObject({
      status: "incompatible",
      reason: "host-too-old",
      hostVersion: "1.2.3",
    });
    expect(await probeHost(hostNewerThanApp, HOST, "t", 3)).toMatchObject({
      status: "incompatible",
      reason: "client-too-old",
    });
  });

  test("reports a token the host no longer accepts", async () => {
    const client = fakeHostClient({ principal: async () => ({ status: "unauthorized" }) });

    expect(await probeHost(client, HOST, "aop_revoked")).toEqual({
      status: "unauthorized",
      host: HOST,
    });
  });

  test("reports a host that answered health and then failed as unreachable, not as a revoked device", async () => {
    const client = fakeHostClient({
      principal: async () => ({ status: "failed", message: "The host answered 500." }),
    });

    expect(await probeHost(client, HOST, "aop_t")).toEqual({
      status: "unreachable",
      host: HOST,
      message: "The host answered 500.",
    });
  });
});
