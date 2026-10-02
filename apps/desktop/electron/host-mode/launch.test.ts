import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HostClient } from "../connection/host-client";
import { fakeHostClient } from "../connection/test-utils";
import {
  buildHostLaunch,
  createHealthWaiter,
  createPortProbe,
  guiSafePath,
  resolveHostExecutable,
  resolveLogDir,
  spawnHostServer,
  tailscaleHint,
} from "./launch";

describe("buildHostLaunch", () => {
  const launch = buildHostLaunch({
    executable: "/Applications/AOP.app/Contents/Resources/aop",
    port: 25150,
    logDir: "/Users/me/.aop/logs",
    baseEnv: {
      HOME: "/Users/me",
      PATH: "/usr/bin:/custom/bin",
      LANG: "en_US.UTF-8",
      UNSET: undefined,
    },
  });

  test("runs the bundled server's `run` command", () => {
    expect(launch.program).toBe("/Applications/AOP.app/Contents/Resources/aop");
    expect(launch.args).toEqual(["run"]);
  });

  test("keeps the server on loopback, whatever the app itself was started with", () => {
    const widened = buildHostLaunch({
      executable: "aop",
      port: 25150,
      logDir: "/logs",
      baseEnv: { AOP_BIND_HOST: "0.0.0.0" },
    });

    expect(launch.env.AOP_BIND_HOST).toBe("127.0.0.1");
    expect(widened.env.AOP_BIND_HOST).toBe("127.0.0.1");
  });

  test("names the port, the log folder and production mode", () => {
    expect(launch.env).toMatchObject({
      AOP_LOCAL_SERVER_PORT: "25150",
      AOP_LOG_DIR: "/Users/me/.aop/logs",
      NODE_ENV: "production",
    });
  });

  test("passes the rest of the environment on, without undefined entries", () => {
    expect(launch.env.LANG).toBe("en_US.UTF-8");
    expect("UNSET" in launch.env).toBe(false);
  });
});

describe("guiSafePath", () => {
  test("adds the places a Finder-launched app cannot see, ahead of the inherited PATH", () => {
    const path = guiSafePath("/Users/me", "/usr/bin:/custom/bin").split(":");

    expect(path.slice(0, 3)).toEqual([
      "/Users/me/.local/bin",
      "/Users/me/.bun/bin",
      "/opt/homebrew/bin",
    ]);
    expect(path).toContain("/custom/bin");
  });

  test("lists each directory once", () => {
    const path = guiSafePath("/Users/me", "/usr/bin:/usr/bin:/opt/homebrew/bin").split(":");

    expect(new Set(path).size).toBe(path.length);
  });

  test("copes with no HOME and no PATH", () => {
    expect(guiSafePath(undefined, undefined)).toStartWith("/opt/homebrew/bin");
  });
});

describe("resolveHostExecutable", () => {
  test("uses the server that ships in the app's resources", () => {
    expect(resolveHostExecutable({}, "/res", (path) => path === "/res/aop")).toBe(
      join("/res", "aop"),
    );
  });

  test("lets the environment name another, for development", () => {
    expect(resolveHostExecutable({ AOP_DESKTOP_HOST_PATH: "/dev/aop" }, "/res", () => true)).toBe(
      "/dev/aop",
    );
  });

  test("is null where the app ships no server, so host mode is not offered", () => {
    expect(resolveHostExecutable({}, "/res", () => false)).toBeNull();
  });
});

describe("resolveLogDir", () => {
  test("defaults to the folder the server itself logs to", () => {
    expect(resolveLogDir({ HOME: "/Users/me" })).toBe(join("/Users/me", ".aop", "logs"));
    expect(resolveLogDir({ HOME: "/Users/me", AOP_LOG_DIR: "/elsewhere" })).toBe("/elsewhere");
    expect(resolveLogDir({ HOME: "/Users/me" }, ".aop-nightly")).toBe(
      join("/Users/me", ".aop-nightly", "logs"),
    );
  });
});

describe("createPortProbe", () => {
  const probeWith = (health: Awaited<ReturnType<HostClient["health"]>>) =>
    createPortProbe(fakeHostClient({ health: async () => health }))();

  test("finds an AOP host and its version", async () => {
    expect(
      await probeWith({
        status: "ok",
        health: { service: "aop", version: "0.9.51", apiVersion: 1, minClientApiVersion: 1 },
      }),
    ).toEqual({ kind: "aop", version: "0.9.51" });
  });

  test("calls a port free only when the connection is refused", async () => {
    expect(await probeWith({ status: "unreachable", message: "", failure: "refused" })).toEqual({
      kind: "free",
    });
    expect(await probeWith({ status: "unreachable", message: "", failure: "timeout" })).toEqual({
      kind: "occupied",
    });
  });

  test("calls a port occupied when something answers that is not AOP", async () => {
    expect(await probeWith({ status: "not-aop" })).toEqual({ kind: "occupied" });
  });
});

describe("createHealthWaiter", () => {
  test("returns the version as soon as the host answers, asking again while it does not", async () => {
    let asked = 0;
    const client = fakeHostClient({
      health: async () => {
        asked += 1;
        return asked < 3
          ? { status: "unreachable", message: "", failure: "refused" }
          : {
              status: "ok",
              health: { service: "aop", version: "1.2.3", apiVersion: 1, minClientApiVersion: 1 },
            };
      },
    });
    const sleeps: number[] = [];

    const version = await createHealthWaiter(client, async (ms) => void sleeps.push(ms), 10, 250)();

    expect(version).toBe("1.2.3");
    expect(sleeps).toEqual([250, 250]);
  });

  test("gives up with null after its attempts", async () => {
    const client = fakeHostClient({
      health: async () => ({ status: "unreachable", message: "", failure: "refused" }),
    });

    expect(await createHealthWaiter(client, async () => {}, 3, 1)()).toBeNull();
  });
});

describe("tailscaleHint", () => {
  test("is the command docs/HOST.md gives, for the port the host listens on", async () => {
    const hint = tailscaleHint(25150);
    const doc = await Bun.file(join(import.meta.dir, "../../../../docs/HOST.md")).text();

    expect(hint.serveCommand).toBe("tailscale serve --bg --https=443 http://127.0.0.1:25150");
    expect(doc).toContain(hint.serveCommand);
    expect(doc).toContain(hint.resetCommand);
  });

  test("points at the port the person chose", () => {
    expect(tailscaleHint(25360).serveCommand).toEndWith("http://127.0.0.1:25360");
  });
});

describe("spawnHostServer", () => {
  const launch = (program: string, args: string[]) => ({
    program,
    args,
    env: { PATH: process.env.PATH ?? "" },
  });

  test("reports the exit code of a process that ends", async () => {
    const child = spawnHostServer(launch(process.execPath, ["-e", "process.exit(3)"]));

    expect(await child.exited).toEqual({ code: 3 });
  });

  test("reports why a program that does not exist could not start", async () => {
    const child = spawnHostServer(launch("/nonexistent/aop", ["run"]));

    const result = await child.exited;

    expect(result.code).toBeNull();
    expect(result.error).toContain("ENOENT");
  });

  test("ends a process it is told to kill", async () => {
    const child = spawnHostServer(launch(process.execPath, ["-e", "setInterval(() => {}, 1000)"]));

    child.kill("SIGTERM");

    expect((await child.exited).code).toBeNull();
  });
});
