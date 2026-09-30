import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { apiUrl, authHeaders, getHostConfig, isRemoteHost, setHostConfig, setManagedHostConfig } =
  await import("./host");

// Both are process-wide and bun runs every test file in one process, so the last test's host
// would otherwise turn a later file's relative API paths into absolute ones.
const resetHostConfig = () => {
  window.localStorage.clear();
  setManagedHostConfig(null);
};

beforeEach(resetHostConfig);
afterEach(resetHostConfig);

describe("host config", () => {
  test("defaults to the page's own origin with no token", () => {
    expect(getHostConfig()).toEqual({ baseUrl: null, token: null });
    expect(apiUrl("/projects")).toBe("/api/projects");
    expect(authHeaders()).toEqual({});
    expect(isRemoteHost()).toBe(false);
  });

  test("a configured host prefixes every API path and sends its token as a bearer header", () => {
    setHostConfig({ baseUrl: "https://mac.tail1234.ts.net/", token: "aop_secret" });

    expect(getHostConfig().baseUrl).toBe("https://mac.tail1234.ts.net");
    expect(apiUrl("/projects/p1/stream?after=4")).toBe(
      "https://mac.tail1234.ts.net/api/projects/p1/stream?after=4",
    );
    expect(authHeaders()).toEqual({ Authorization: "Bearer aop_secret" });
    expect(isRemoteHost()).toBe(true);
  });

  test("clearing both fields returns to the default", () => {
    setHostConfig({ baseUrl: "https://host", token: "t" });
    setHostConfig({ baseUrl: null, token: null });

    expect(window.localStorage.getItem("aop:host:v1")).toBeNull();
    expect(getHostConfig()).toEqual({ baseUrl: null, token: null });
  });

  test("stored garbage falls back to the default instead of breaking every request", () => {
    for (const garbage of ["not json", "42", '{"baseUrl":7,"token":[]}']) {
      window.localStorage.setItem("aop:host:v1", garbage);
      expect(getHostConfig()).toEqual({ baseUrl: null, token: null });
    }
  });
});

describe("managed host config", () => {
  test("is what the desktop app's main process decided, and wins over local storage", () => {
    setHostConfig({ baseUrl: "https://stored.example", token: "stored" });
    setManagedHostConfig({ baseUrl: "https://mac.tail1234.ts.net/", token: "aop_keychain" });

    expect(getHostConfig()).toEqual({
      baseUrl: "https://mac.tail1234.ts.net",
      token: "aop_keychain",
    });
    expect(apiUrl("/projects")).toBe("https://mac.tail1234.ts.net/api/projects");
    expect(authHeaders()).toEqual({ Authorization: "Bearer aop_keychain" });
  });

  test("never writes the token to local storage, even when a pairing screen tries to", () => {
    setManagedHostConfig({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_keychain" });

    setHostConfig({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_other" });

    expect(window.localStorage.length).toBe(0);
    expect(getHostConfig().token).toBe("aop_keychain");
  });

  test("a host running on the owner's own Mac has a base URL and no token", () => {
    setManagedHostConfig({ baseUrl: "http://127.0.0.1:25150", token: null });

    expect(isRemoteHost()).toBe(true);
    expect(authHeaders()).toEqual({});
  });

  test("clearing it returns to local storage", () => {
    setHostConfig({ baseUrl: "https://stored.example", token: "stored" });
    setManagedHostConfig({ baseUrl: "https://mac.tail1234.ts.net", token: "aop_keychain" });
    setManagedHostConfig(null);

    expect(getHostConfig()).toEqual({ baseUrl: "https://stored.example", token: "stored" });
  });
});
