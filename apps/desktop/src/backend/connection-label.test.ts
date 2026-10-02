import { describe, expect, test } from "bun:test";
import { connectionLabel, hostName, windowTitle } from "./connection-label";
import type { ConnectionState } from "./types";

const HOST = "https://mac.tail1234.ts.net";

describe("connectionLabel", () => {
  const cases: [ConnectionState, string][] = [
    [{ status: "unconfigured" }, "No host chosen"],
    [{ status: "connecting", host: HOST }, "Connecting to mac.tail1234.ts.net…"],
    [{ status: "connected", host: HOST, hostVersion: "1" }, "Connected to mac.tail1234.ts.net"],
    [{ status: "unreachable", host: HOST, message: "x" }, "Cannot reach mac.tail1234.ts.net"],
    [{ status: "unauthorized", host: HOST }, "mac.tail1234.ts.net does not accept this device"],
    [
      { status: "incompatible", host: HOST, reason: "client-too-old", hostVersion: "2" },
      "mac.tail1234.ts.net needs a newer AOP app",
    ],
    [
      { status: "incompatible", host: HOST, reason: "host-too-old", hostVersion: "0" },
      "mac.tail1234.ts.net needs an update",
    ],
    [
      {
        status: "incompatible",
        host: "http://127.0.0.1:25150",
        reason: "not-aop",
        hostVersion: null,
      },
      "127.0.0.1:25150 needs an AOP host",
    ],
  ];

  test.each(cases)("%j reads %p", (state, label) => {
    expect(connectionLabel(state)).toBe(label);
  });
});

describe("windowTitle", () => {
  test("is the app's name until there is a host to name", () => {
    expect(windowTitle({ status: "unconfigured" })).toBe("AOP");
    expect(windowTitle({ status: "connected", host: HOST, hostVersion: "1" })).toBe(
      "AOP · Connected to mac.tail1234.ts.net",
    );
  });

  test("appends the asides that apply and skips the ones that do not", () => {
    const connected = { status: "connected", host: HOST, hostVersion: "1" } as const;

    expect(
      windowTitle(connected, ["Update available (0.10.0)", null, "host 0.10.0 is newer"]),
    ).toBe(
      "AOP · Connected to mac.tail1234.ts.net · Update available (0.10.0) · host 0.10.0 is newer",
    );
    expect(windowTitle({ status: "unconfigured" }, ["Update available (0.10.0)"])).toBe(
      "AOP · Update available (0.10.0)",
    );
  });

  test("AOP Nightly's title names it, so it is never taken for the stable app", () => {
    expect(windowTitle({ status: "unconfigured" }, [], "AOP Nightly")).toBe("AOP Nightly");
    expect(
      windowTitle({ status: "connected", host: HOST, hostVersion: "1" }, [], "AOP Nightly"),
    ).toStartWith("AOP Nightly · Connected to");
  });
});

describe("hostName", () => {
  test("shows the host and port, not the scheme", () => {
    expect(hostName("http://127.0.0.1:25150")).toBe("127.0.0.1:25150");
    expect(hostName("not a url")).toBe("not a url");
  });
});
