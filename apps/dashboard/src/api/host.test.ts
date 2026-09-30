import { beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { apiUrl, authHeaders, getHostConfig, isRemoteHost, setHostConfig } = await import("./host");

beforeEach(() => {
  window.localStorage.clear();
});

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
