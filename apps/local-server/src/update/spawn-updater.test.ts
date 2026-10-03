import { describe, expect, test } from "bun:test";
import { updaterEnv } from "./spawn-updater.ts";

describe("updaterEnv", () => {
  test("drops an agent turn's session id, so a host started from a turn can still update itself", () => {
    expect(
      updaterEnv({ AOP_CHAT_SESSION_ID: "s1", AOP_LOCAL_SERVER_PORT: "25650", PATH: "/bin" }),
    ).toEqual({ AOP_LOCAL_SERVER_PORT: "25650", PATH: "/bin" });
  });
});
