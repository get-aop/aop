import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { CHANNELS, SetupCheckSchema } from "@aop/common";
import { reinstallCommand, serviceCheck } from "./service-check.ts";
import { HOST, NIGHTLY } from "./test-utils.ts";

describe("serviceCheck", () => {
  test("a systemd or launchd service is ok, named as the person finds it", () => {
    const systemd = serviceCheck(
      { kind: "systemd", unit: "aop-nightly-local-server.service" },
      NIGHTLY,
      HOST,
    );
    const launchd = serviceCheck({ kind: "launchd", label: "com.aop.local-server" }, NIGHTLY, HOST);

    expect(systemd).toEqual({
      id: "service",
      state: "ok",
      title: "Runs as a service",
      detail: "systemd user unit aop-nightly-local-server. Starts at boot, restarts after updates.",
      actions: [],
    });
    expect(launchd.detail).toBe(
      "launchd agent com.aop.local-server. Starts at login, restarts after updates.",
    );
  });

  test("the app's host and a source checkout are fine as they are", () => {
    const app = serviceCheck({ kind: "app" }, NIGHTLY, HOST);
    const source = serviceCheck({ kind: "source" }, NIGHTLY, HOST);

    expect(app).toMatchObject({ state: "ok", title: "Runs with the AOP Nightly app" });
    expect(source).toMatchObject({ state: "ok", title: "Runs from source", actions: [] });
  });

  test("a host started by hand or in the background gets the install command, not a fix", () => {
    const binaryPath = join(homedir(), ".aop-nightly", "bin", "aop-nightly");
    const background = serviceCheck({ kind: "background", binaryPath }, NIGHTLY, HOST);
    const manual = serviceCheck({ kind: "manual", binaryPath }, NIGHTLY, HOST);

    expect(background.state).toBe("warning");
    expect(background.detail).toContain("aop-nightly run --background");
    expect(manual.detail).toContain("stops when that terminal closes");
    expect(manual.actions).toEqual([
      {
        kind: "how-to",
        steps: [
          "On soulf, run this in a terminal. It installs AOP Nightly again and registers the service that starts it at boot and restarts it after updates.",
          "Projects, threads and settings stay as they are. Running turns carry on through the restart.",
        ],
        command: "curl -fsSL https://getaop.com/nightly/install.sh | sh",
      },
    ]);
    expect(SetupCheckSchema.safeParse(manual).success).toBe(true);
  });
});

describe("reinstallCommand", () => {
  const home = "/home/ada";

  test("leaves the folder to install.sh when the binary is in its default one", () => {
    expect(reinstallCommand(NIGHTLY, "/home/ada/.aop-nightly/bin/aop-nightly", home)).toBe(
      "curl -fsSL https://getaop.com/nightly/install.sh | sh",
    );
    expect(reinstallCommand(CHANNELS.stable, "/usr/local/bin/aop", home)).toBe(
      "curl -fsSL https://getaop.com/install.sh | sh",
    );
    expect(reinstallCommand(CHANNELS.stable, "/home/ada/.local/bin/aop", home)).toBe(
      "curl -fsSL https://getaop.com/install.sh | sh",
    );
  });

  test("keeps a --prefix install where it is", () => {
    expect(reinstallCommand(CHANNELS.stable, "/opt/tools/bin/aop", home)).toBe(
      "curl -fsSL https://getaop.com/install.sh | sh -s -- --prefix /opt/tools",
    );
  });
});
