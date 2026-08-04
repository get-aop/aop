import { describe, expect, test } from "bun:test";
import { ExecHostConfigSchema, parseExecHostList } from "./exec-host-config.ts";

describe("ExecHostConfigSchema", () => {
  test("accepts a minimal valid config", () => {
    expect(
      ExecHostConfigSchema.parse({
        id: "ehost_1",
        name: "Desktop",
        host: "192.168.1.10",
        remoteRoot: "/home/user/aop-workspaces",
      }),
    ).toEqual({
      id: "ehost_1",
      name: "Desktop",
      host: "192.168.1.10",
      remoteRoot: "/home/user/aop-workspaces",
    });
  });

  test("accepts optional SSH fields", () => {
    expect(
      ExecHostConfigSchema.parse({
        id: "ehost_2",
        name: "LAN Mac",
        host: "mac.local",
        user: "marcelo",
        port: 2222,
        identityFile: "~/.ssh/id_ed25519_aop",
        remoteRoot: "/Users/marcelo/aop-remote",
      }),
    ).toEqual({
      id: "ehost_2",
      name: "LAN Mac",
      host: "mac.local",
      user: "marcelo",
      port: 2222,
      identityFile: "~/.ssh/id_ed25519_aop",
      remoteRoot: "/Users/marcelo/aop-remote",
    });
  });

  test("rejects missing host and remoteRoot", () => {
    const result = ExecHostConfigSchema.safeParse({
      id: "ehost_bad",
      name: "Broken",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid port", () => {
    expect(
      ExecHostConfigSchema.safeParse({
        id: "ehost_bad",
        name: "Broken",
        host: "host",
        port: 0,
        remoteRoot: "/tmp",
      }).success,
    ).toBe(false);
    expect(
      ExecHostConfigSchema.safeParse({
        id: "ehost_bad",
        name: "Broken",
        host: "host",
        port: 70000,
        remoteRoot: "/tmp",
      }).success,
    ).toBe(false);
  });

  test("trims name, host, and remoteRoot", () => {
    expect(
      ExecHostConfigSchema.parse({
        id: "ehost_3",
        name: "  Desktop  ",
        host: "  10.0.0.5  ",
        remoteRoot: "  /tmp/aop  ",
      }),
    ).toMatchObject({
      name: "Desktop",
      host: "10.0.0.5",
      remoteRoot: "/tmp/aop",
    });
  });
});

describe("parseExecHostList", () => {
  test("parses a JSON array of hosts", () => {
    const list = parseExecHostList(
      JSON.stringify([
        {
          id: "ehost_1",
          name: "Desktop",
          host: "192.168.1.10",
          remoteRoot: "/home/user/aop",
        },
      ]),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("ehost_1");
  });

  test("returns empty list for empty string or empty array", () => {
    expect(parseExecHostList("")).toEqual([]);
    expect(parseExecHostList("[]")).toEqual([]);
  });

  test("throws on invalid JSON or invalid host entries", () => {
    expect(() => parseExecHostList("not-json")).toThrow();
    expect(() => parseExecHostList(JSON.stringify([{ id: "x", name: "y" }]))).toThrow();
  });
});
