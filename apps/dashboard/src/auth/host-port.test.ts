import { afterEach, describe, expect, test } from "bun:test";
import { CHANNELS } from "@aop/common";
import { setManagedHostConfig } from "../api/host";
import { pairingCodeCommand, pairingHostPort } from "./host-port";

afterEach(() => setManagedHostConfig(null));

describe("pairingHostPort", () => {
  test("a host behind a proxy on the scheme's default port falls back to the channel's port", () => {
    expect(pairingHostPort(CHANNELS.stable, "https://mac.tail1234.ts.net")).toBe(25150);
    expect(pairingHostPort(CHANNELS.nightly, "https://mac.tail1234.ts.net")).toBe(25650);
    expect(pairingHostPort(CHANNELS.nightly, null)).toBe(25650);
  });

  test("a page the host serves on a port names that port, whatever the channel", () => {
    expect(pairingHostPort(CHANNELS.stable, "http://aop.localhost:25650")).toBe(25650);
    expect(pairingHostPort(CHANNELS.nightly, "http://127.0.0.1:25999")).toBe(25999);
  });

  test("the dev dashboard's own port is not the host's", () => {
    expect(pairingHostPort(CHANNELS.stable, "http://localhost:25160")).toBe(25150);
  });

  test("an unreadable origin falls back to the channel's port", () => {
    expect(pairingHostPort(CHANNELS.stable, "not a url")).toBe(25150);
  });

  test("a client pointed at another host reads that host's port", () => {
    setManagedHostConfig({ baseUrl: "http://192.168.1.20:25888", token: null });
    expect(pairingHostPort(CHANNELS.stable)).toBe(25888);
  });
});

describe("pairingCodeCommand", () => {
  test("asks the host on loopback, where the owner needs no pairing", () => {
    expect(pairingCodeCommand(25650)).toBe(
      "curl -s -X POST http://127.0.0.1:25650/api/auth/pairing-codes",
    );
  });
});
