import { describe, expect, test } from "bun:test";
import { chooseScreen, parseScreenHash } from "./screen-choice";
import { makeState } from "./test/fake-backend";

describe("parseScreenHash", () => {
  test("reads the screens the app asks for", () => {
    expect(parseScreenHash("#/connect")).toBe("connect");
    expect(parseScreenHash("#/host")).toBe("host");
    expect(parseScreenHash("#/status")).toBe("status");
    expect(parseScreenHash("#status")).toBe("status");
  });

  test("reads anything else as no request", () => {
    for (const hash of ["", "#", "#/", "#/dashboard", "#/connect/extra", "connect"]) {
      expect(parseScreenHash(hash)).toBeNull();
    }
  });
});

describe("chooseScreen", () => {
  test("a fresh install connects", () => {
    expect(chooseScreen(makeState(), null)).toBe("connect");
  });

  test("a client of a remote host shows how the connection is", () => {
    expect(chooseScreen(makeState({ mode: "remote" }), null)).toBe("status");
  });

  test("a Mac that runs its own host shows that host", () => {
    expect(chooseScreen(makeState({ mode: "local" }), null)).toBe("host");
  });

  test("a build that cannot run a host never shows the host screen", () => {
    const windows = makeState({ mode: "local", hostModeAvailable: false });

    expect(chooseScreen(windows, null)).toBe("connect");
    expect(chooseScreen(windows, "host")).toBe("connect");
  });

  test("an address that names a screen wins over the state, so Change host works from anywhere", () => {
    expect(chooseScreen(makeState({ mode: "remote" }), "connect")).toBe("connect");
    expect(chooseScreen(makeState({ mode: "local" }), "connect")).toBe("connect");
    expect(chooseScreen(makeState({ mode: "remote" }), "host")).toBe("host");
  });

  test("there is no status to show before a host is chosen", () => {
    expect(chooseScreen(makeState({ mode: null }), "status")).toBe("connect");
  });
});
