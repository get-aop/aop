import { describe, expect, test } from "bun:test";
import { CHANNELS } from "@aop/common";
import { parseServeStatus, reachableCheck } from "./reachable-check.ts";
import { HOST, NIGHTLY } from "./test-utils.ts";

// What `tailscale serve status --json` printed on a host serving AOP Nightly and two other apps.
const SOULF = {
  TCP: { "25650": { HTTPS: true }, "443": { HTTPS: true }, "8443": { HTTPS: true } },
  Web: {
    "soulf.tailffbdec.ts.net:25650": { Handlers: { "/": { Proxy: "http://127.0.0.1:25650" } } },
    "soulf.tailffbdec.ts.net:443": {
      Handlers: {
        "/": { Proxy: "http://127.0.0.1:3000" },
        "/dflash": { Proxy: "http://127.0.0.1:8016" },
      },
    },
    "soulf.tailffbdec.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8016" } } },
  },
};

describe("parseServeStatus", () => {
  test("lists the https URLs whose root proxies to this host's port", () => {
    expect(parseServeStatus(SOULF, 25650)).toEqual({
      addresses: ["https://soulf.tailffbdec.ts.net:25650"],
      httpsDefaultTaken: true,
    });
    expect(parseServeStatus(SOULF, 25150)).toEqual({ addresses: [], httpsDefaultTaken: true });
  });

  test("drops the default port, and reads a foreground serve too", () => {
    const status = {
      Foreground: {
        session1: {
          TCP: { "443": { HTTPS: true } },
          Web: { "mac.tail1.ts.net:443": { Handlers: { "/": { Proxy: "localhost:25150" } } } },
        },
      },
    };

    expect(parseServeStatus(status, 25150)).toEqual({
      addresses: ["https://mac.tail1.ts.net"],
      httpsDefaultTaken: false,
    });
  });

  test("ignores a path mount, another host's proxy and anything that is not a serve config", () => {
    const status = {
      Web: {
        "a.ts.net:443": { Handlers: { "/aop": { Proxy: "http://127.0.0.1:25150" } } },
        "b.ts.net:8443": { Handlers: { "/": { Proxy: "http://10.0.0.2:25150" } } },
      },
    };

    expect(parseServeStatus(status, 25150).addresses).toEqual([]);
    expect(parseServeStatus(null, 25150)).toEqual({ addresses: [], httpsDefaultTaken: false });
    expect(parseServeStatus({}, 25150)).toEqual({ addresses: [], httpsDefaultTaken: false });
  });
});

describe("reachableCheck", () => {
  test("is ok with the addresses tailscale serve publishes", () => {
    const check = reachableCheck(
      {
        tailscale: true,
        addresses: ["https://soulf.tailffbdec.ts.net:25650"],
        httpsDefaultTaken: true,
      },
      25650,
      HOST,
      NIGHTLY,
    );

    expect(check).toEqual({
      id: "reachable",
      state: "ok",
      title: "Reachable from your other devices",
      detail: "https://soulf.tailffbdec.ts.net:25650 (tailscale serve)",
      actions: [],
    });
  });

  test("without one, only this computer can reach it, and the how-to has the serve command", () => {
    const check = reachableCheck(
      { tailscale: true, addresses: [], httpsDefaultTaken: false },
      25150,
      HOST,
      CHANNELS.stable,
    );

    expect(check.state).toBe("warning");
    expect(check.detail).toBe("Only this computer can reach it.");
    expect(check.actions).toEqual([
      {
        kind: "how-to",
        steps: [
          "On soulf, publish AOP on your tailnet over HTTPS. Then open the https address `tailscale serve status` prints, from any of your devices.",
        ],
        command: "tailscale serve --bg --https=443 http://127.0.0.1:25150",
      },
    ]);
  });

  test("serves https on the host's own port where 443 is taken or is stable's, and asks for Tailscale when it is missing", () => {
    const free = { tailscale: true, addresses: [], httpsDefaultTaken: false };
    const taken = reachableCheck(
      { ...free, httpsDefaultTaken: true },
      25150,
      HOST,
      CHANNELS.stable,
    );
    const nightly = reachableCheck(free, 25650, HOST, NIGHTLY);
    const missing = reachableCheck({ ...free, tailscale: false }, 25650, HOST, NIGHTLY);

    expect(taken.actions[0]).toMatchObject({
      command: "tailscale serve --bg --https=25150 http://127.0.0.1:25150",
    });
    expect(nightly.actions[0]).toMatchObject({
      command: "tailscale serve --bg --https=25650 http://127.0.0.1:25650",
    });
    const steps = missing.actions[0]?.kind === "how-to" ? missing.actions[0].steps : [];
    expect(steps[0]).toStartWith("Install Tailscale on soulf");
    expect(steps).toHaveLength(2);
  });
});
