import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { layoutOf } from "./install-layout.ts";
import {
  detectRestartPlan,
  LAUNCHD_LABEL,
  type RestartTools,
  restartHost,
  SYSTEMD_UNIT,
} from "./restart.ts";
import { scratchDir } from "./test-utils.ts";

const layout = layoutOf("/opt/aop/bin/aop");

const planInput = async (os: string, alive = false) => {
  const home = await scratchDir("home");
  return {
    home,
    input: {
      layout,
      home,
      os,
      pidFile: join(home, "server.pid"),
      port: 25150,
      runsBinary: () => alive,
    },
  };
};

const recordingTools = (exitCode = 0) => {
  const commands: string[][] = [];
  const killed: number[] = [];
  const tools: RestartTools = {
    run: async (command) => {
      commands.push(command);
      return exitCode;
    },
    kill: (pid) => killed.push(pid),
    waitUntilDown: async () => true,
  };
  return { tools, commands, killed };
};

describe("detectRestartPlan", () => {
  test("finds the launchd service install.sh registered for this binary", async () => {
    const { home, input } = await planInput("darwin");
    const agents = join(home, "Library", "LaunchAgents");
    await mkdir(agents, { recursive: true });
    await writeFile(
      join(agents, `${LAUNCHD_LABEL}.plist`),
      `<string>${layout.binaryPath}</string>`,
    );

    expect(await detectRestartPlan(input)).toEqual({
      kind: "launchd",
      plist: join(agents, `${LAUNCHD_LABEL}.plist`),
    });
  });

  test("ignores a launchd service that runs a different binary", async () => {
    const { home, input } = await planInput("darwin");
    const agents = join(home, "Library", "LaunchAgents");
    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, `${LAUNCHD_LABEL}.plist`), "<string>/somewhere/else/aop</string>");

    expect(await detectRestartPlan(input)).toEqual({ kind: "manual" });
  });

  test("finds the systemd user unit for this binary", async () => {
    const { home, input } = await planInput("linux");
    const units = join(home, ".config", "systemd", "user");
    await mkdir(units, { recursive: true });
    await writeFile(join(units, SYSTEMD_UNIT), `ExecStart=${layout.binaryPath} run --port 25150\n`);

    expect(await detectRestartPlan(input)).toEqual({ kind: "systemd" });
  });

  test("treats a live pid file as a host started with `aop run --background`", async () => {
    const { home, input } = await planInput("linux", true);
    await writeFile(join(home, "server.pid"), "777\n");

    expect(await detectRestartPlan(input)).toEqual({
      kind: "background",
      pidFile: join(home, "server.pid"),
      pid: 777,
      port: 25150,
    });
  });

  test("is manual when nothing supervises the host, or its pid is stale", async () => {
    const stale = await planInput("linux", false);
    await writeFile(join(stale.home, "server.pid"), "777");

    expect(await detectRestartPlan(stale.input)).toEqual({ kind: "manual" });
    expect(await detectRestartPlan((await planInput("linux")).input)).toEqual({ kind: "manual" });
  });
});

describe("restartHost", () => {
  test("launchd: unloads and loads the plist the way install.sh does", async () => {
    const { tools, commands } = recordingTools();

    await restartHost({ kind: "launchd", plist: "/p.plist" }, layout, tools);

    expect(commands).toEqual([
      ["launchctl", "unload", "/p.plist"],
      ["launchctl", "load", "-w", "/p.plist"],
    ]);
  });

  test("systemd: restarts the user unit", async () => {
    const { tools, commands } = recordingTools();

    await restartHost({ kind: "systemd" }, layout, tools);

    expect(commands).toEqual([["systemctl", "--user", "restart", SYSTEMD_UNIT]]);
  });

  test("background: stops the old host, waits for its port, starts the new binary", async () => {
    const { tools, commands, killed } = recordingTools();

    await restartHost({ kind: "background", pidFile: "/x", pid: 31, port: 26000 }, layout, tools);

    expect(killed).toEqual([31]);
    expect(commands).toEqual([[layout.binaryPath, "run", "--background", "--port", "26000"]]);
  });

  test("background: gives up when the old host will not stop", async () => {
    const { tools, commands } = recordingTools();
    tools.waitUntilDown = async () => false;

    await expect(
      restartHost({ kind: "background", pidFile: "/x", pid: 31, port: 26000 }, layout, tools),
    ).rejects.toThrow("The old host did not stop");
    expect(commands).toEqual([]);
  });

  test("reports a service manager that refuses", async () => {
    const { tools } = recordingTools(1);

    await expect(restartHost({ kind: "systemd" }, layout, tools)).rejects.toThrow(
      "systemctl restart failed (exit 1)",
    );
  });

  test("a host nothing supervises cannot be restarted", async () => {
    await expect(restartHost({ kind: "manual" }, layout, recordingTools().tools)).rejects.toThrow(
      "not started as a service",
    );
  });
});
