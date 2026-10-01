import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createSettingsRepository, type SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";
import type { CliProbe } from "./probe.ts";
import { type AgentCliService, createAgentCliService } from "./service.ts";
import { isSpawnGateClosed } from "./spawn-gate.ts";
import {
  controlledCommand,
  fakeRuns,
  nativeProbe,
  npmProbe,
  testCli,
  waitUntil,
} from "./test-utils.ts";

describe("createAgentCliService", () => {
  let db: Kysely<Database>;
  let settings: SettingsRepository;
  let installed: CliProbe;
  let latest: string | Error;
  let probes: number;
  let fetches: number;
  let command: ReturnType<typeof controlledCommand>;
  let runs: ReturnType<typeof fakeRuns>;
  let service: AgentCliService;

  const build = (
    overrides: { isWritable?: (path: string) => Promise<boolean>; now?: () => number } = {},
  ) =>
    createAgentCliService({
      settings,
      runs,
      definitions: [testCli()],
      probe: async () => {
        probes++;
        return installed;
      },
      fetchLatest: async () => {
        fetches++;
        if (latest instanceof Error) throw latest;
        return latest;
      },
      runCommand: command.run,
      isWritable: overrides.isWritable ?? (async () => true),
      sleep: () => Bun.sleep(1),
      deferPollMs: 1,
      now: overrides.now,
    });

  const cliStatus = async () => (await service.status()).clis[0];

  beforeEach(async () => {
    db = await createTestDb();
    settings = createSettingsRepository(db);
    installed = nativeProbe("2.1.0");
    latest = "2.1.1";
    probes = 0;
    fetches = 0;
    command = controlledCommand();
    runs = fakeRuns();
    service = build();
  });

  afterEach(async () => {
    service.stop();
    await db.destroy();
  });

  test("reports the installed CLI, its install method and the newer version a check found", async () => {
    const before = await cliStatus();
    expect(before).toMatchObject({
      provider: "claude-code",
      label: "Claude Code",
      installed: true,
      path: "/home/me/.local/bin/claude",
      version: "2.1.0",
      installMethod: "native",
      updateCommand: "claude update",
      latest: null,
      updateAvailable: false,
      update: { state: "idle" },
    });

    const checked = (await service.check()).clis[0];
    expect(checked).toMatchObject({ latest: "2.1.1", updateAvailable: true, checkError: null });
    expect(checked?.checkedAt).not.toBeNull();
  });

  test("reports the settings, defaults first", async () => {
    expect(await service.status()).toMatchObject({ checkIntervalMinutes: 60, autoUpdate: false });
    await settings.set(SettingKey.AGENT_CLI_CHECK_INTERVAL, "0");
    await settings.set(SettingKey.AGENT_CLI_AUTO_UPDATE, "true");
    expect(await service.status()).toMatchObject({ checkIntervalMinutes: 0, autoUpdate: true });
  });

  test("an offline check says why, and the CLI is still shown as installed", async () => {
    latest = new Error("fetch failed");
    const status = (await service.check()).clis[0];
    expect(status).toMatchObject({
      latest: null,
      updateAvailable: false,
      checkError: "fetch failed",
      version: "2.1.0",
    });
  });

  test("a manual check runs at most once in a short while, however often it is asked", async () => {
    await service.check();
    await service.check();
    await service.check();
    expect(fetches).toBe(1);
  });

  test("status reuses a recent probe instead of spawning the CLI on every read", async () => {
    await service.status();
    await service.status();
    await service.status();
    expect(probes).toBe(1);
  });

  test("shows the runs in flight and the versions they started on, and the last run's version", async () => {
    runs.set(2);
    runs.lastVersion = "2.1.0";
    expect(await cliStatus()).toMatchObject({
      activeRuns: { count: 2, versions: ["2.1.0"] },
      lastRunVersion: "2.1.0",
    });
  });

  describe("update", () => {
    test("runs in the background: the request returns while the command is still running", async () => {
      await service.check();
      expect(await service.update("claude-code")).toEqual({ ok: true });

      await waitUntil(() => command.calls.length === 1);
      expect(command.calls[0]).toEqual(["/home/me/.local/bin/claude", "update"]);
      expect(await cliStatus()).toMatchObject({
        update: { state: "updating", trigger: "manual", fromVersion: "2.1.0", toVersion: "2.1.1" },
      });
      expect(isSpawnGateClosed("claude-code")).toBe(true);

      installed = nativeProbe("2.1.1");
      command.finish({ exitCode: 0, output: "Updated\n" });
      await waitUntil(() => !isSpawnGateClosed("claude-code"));
      await waitUntil(() => command.calls.length === 1);
      const done = await cliStatus();
      expect(done).toMatchObject({
        version: "2.1.1",
        updateAvailable: false,
        update: { state: "succeeded", toVersion: "2.1.1", output: "Updated\n" },
      });
    });

    test("only one update per CLI runs at a time", async () => {
      await service.check();
      const [first, second] = await Promise.all([
        service.update("claude-code"),
        service.update("claude-code"),
      ]);
      expect(first).toEqual({ ok: true });
      expect(second).toEqual({
        ok: false,
        status: 409,
        error: "An update of Claude Code is already running",
        manualCommand: null,
      });

      await waitUntil(() => command.calls.length === 1);
      expect(await service.update("claude-code")).toMatchObject({ ok: false, status: 409 });

      installed = nativeProbe("2.1.1");
      command.finish({ exitCode: 0, output: "" });
      await waitUntilState(service, "succeeded");
      // Once it has ended, the next update may start.
      expect(await service.update("claude-code")).toEqual({ ok: true });
      await waitUntil(() => command.calls.length === 2);
      command.finish({ exitCode: 0, output: "" });
      await waitUntilState(service, "succeeded");
    });

    test("an npm install waits for the runs in flight, then updates", async () => {
      installed = npmProbe("2.1.0");
      runs.set(2);
      await service.check();
      expect(await service.update("claude-code")).toEqual({ ok: true });

      await waitUntilState(service, "waiting");
      expect((await cliStatus())?.update.deferredFor).toBe(2);
      expect(command.calls).toEqual([]);
      // A second request while it waits is refused too: it is the same update.
      expect(await service.update("claude-code")).toMatchObject({ ok: false, status: 409 });

      runs.set(0);
      await waitUntil(() => command.calls.length === 1);
      expect(command.calls[0]).toEqual([
        "npm",
        "install",
        "--global",
        "@anthropic-ai/claude-code@latest",
      ]);
      installed = npmProbe("2.1.1");
      command.finish({ exitCode: 0, output: "" });
      await waitUntilState(service, "succeeded");
    });

    test("a failed update is reported with the command to run by hand", async () => {
      await service.check();
      await service.update("claude-code");
      await waitUntil(() => command.calls.length === 1);
      command.finish({ exitCode: 1, output: "Error: network\n" });
      await waitUntilState(service, "failed");
      expect((await cliStatus())?.update).toMatchObject({
        error: "`claude update` exited with code 1",
        manualCommand: "claude update",
        output: "Error: network\n",
      });
    });

    test("an unknown install method is refused with the command to run by hand", async () => {
      installed = { path: "/opt/claude", realPath: "/opt/claude", version: "2.1.0", error: null };
      const result = await service.update("claude-code");
      expect(result).toEqual({
        ok: false,
        status: 422,
        error: "AOP cannot tell how Claude Code was installed at /opt/claude",
        manualCommand: "claude update, or npm install --global @anthropic-ai/claude-code@latest",
      });
      expect((await cliStatus())?.update).toMatchObject({
        state: "failed",
        manualCommand: "claude update, or npm install --global @anthropic-ai/claude-code@latest",
      });
      expect(command.calls).toEqual([]);
    });

    test("an install the user cannot write to is refused, never retried with sudo", async () => {
      installed = npmProbe("2.1.0");
      service = build({ isWritable: async () => false });
      const result = await service.update("claude-code");
      expect(result).toMatchObject({
        ok: false,
        status: 422,
        error: expect.stringContaining("never updates with sudo"),
        manualCommand: "npm install --global @anthropic-ai/claude-code@latest",
      });
      expect(command.calls).toEqual([]);
    });

    test("a CLI that is not installed cannot be updated", async () => {
      installed = { path: null, realPath: null, version: null, error: null };
      expect(await service.update("claude-code")).toMatchObject({
        ok: false,
        status: 422,
        error: "Claude Code is not installed on the host",
      });
      expect(await cliStatus()).toMatchObject({ installed: false, installMethod: null });
    });

    test("installs the channel the person follows now, read when the update starts", async () => {
      installed = npmProbe("2.1.0");
      let channel = "latest";
      service = createAgentCliService({
        settings,
        runs,
        definitions: [testCli({ readChannel: async () => channel })],
        probe: async () => installed,
        fetchLatest: async () => "2.1.1",
        runCommand: command.run,
        isWritable: async () => true,
      });
      await service.check();
      channel = "stable";
      await service.update("claude-code");
      await waitUntil(() => command.calls.length === 1);
      expect(command.calls[0]?.at(-1)).toBe("@anthropic-ai/claude-code@stable");
      command.finish({ exitCode: 0, output: "" });
    });

    test("an unknown provider is a 404", async () => {
      expect(await service.update("cursor")).toMatchObject({ ok: false, status: 404 });
    });
  });

  describe("auto-update", () => {
    test("is off by default: a check that finds a newer version installs nothing", async () => {
      await service.check();
      await Bun.sleep(5);
      expect(command.calls).toEqual([]);
    });

    test("when on, a check that finds a newer version starts the update", async () => {
      await settings.set(SettingKey.AGENT_CLI_AUTO_UPDATE, "true");
      await service.check();
      await waitUntil(() => command.calls.length === 1);
      expect((await cliStatus())?.update).toMatchObject({ state: "updating", trigger: "auto" });
      installed = nativeProbe("2.1.1");
      command.finish({ exitCode: 0, output: "" });
    });

    test("an automatic update that failed is not retried for the same version", async () => {
      let clock = Date.now();
      service = build({ now: () => clock });
      await settings.set(SettingKey.AGENT_CLI_AUTO_UPDATE, "true");
      await service.check();
      await waitUntil(() => command.calls.length === 1);
      command.finish({ exitCode: 1, output: "" });
      await waitUntilState(service, "failed");

      clock += 60_000;
      await service.check();
      await Bun.sleep(5);
      expect(command.calls).toHaveLength(1);

      // A newer version than the one that failed is tried.
      latest = "2.1.2";
      clock += 60_000;
      await service.check();
      await waitUntil(() => command.calls.length === 2);
      command.finish({ exitCode: 1, output: "" });
      await waitUntilState(service, "failed");
    });

    test("when on, nothing runs while the CLI is up to date", async () => {
      await settings.set(SettingKey.AGENT_CLI_AUTO_UPDATE, "true");
      latest = "2.1.0";
      await service.check();
      await Bun.sleep(5);
      expect(command.calls).toEqual([]);
    });
  });
});

const waitUntilState = async (service: AgentCliService, state: string): Promise<void> => {
  const deadline = Date.now() + 2_000;
  while ((await service.status()).clis[0]?.update.state !== state) {
    if (Date.now() > deadline) throw new Error(`update never reached ${state}`);
    await Bun.sleep(2);
  }
};
