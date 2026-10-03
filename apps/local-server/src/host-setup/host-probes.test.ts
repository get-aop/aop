import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildChannel } from "@aop/common";
import type { ComputerUseService } from "../computer-use/service.ts";
import type { LocalServerContext } from "../context.ts";
import { createTestContext } from "../db/test-utils.ts";
import type { GithubService } from "../github/index.ts";
import { projectSettings } from "../project/test-utils.ts";
import type { RuntimeReadiness } from "../runtime-configuration/readiness.ts";
import { SettingKey } from "../settings/types.ts";
import { createHostProbes, hostFacts, readUpdateInstall } from "./host-probes.ts";
import { BUSY_LEASE, cuaStatus } from "./test-utils.ts";

describe("host probes", () => {
  let ctx: LocalServerContext;
  const freshAsked: boolean[] = [];

  const readiness: RuntimeReadiness = {
    check: async (target, options) => {
      freshAsked.push(options?.fresh === true);
      return {
        runtimeId: target.id,
        path: "/usr/bin/claude",
        version: "2.1.288",
        auth: "logged-in",
        ready: true,
        reason: null,
        checkedAt: "2026-10-03T09:00:00.000Z",
      };
    },
    blockReason: async () => null,
  };
  const github = {
    authStatus: async () => ({ authenticated: true, login: "ada" }),
  } as unknown as GithubService;
  const computerUse: ComputerUseService = {
    cuaStatus: async () => cuaStatus(),
    serversFor: async () => undefined,
  };
  const probes = () =>
    createHostProbes({
      ctx,
      github,
      computerUse,
      lease: () => BUSY_LEASE,
      port: 25650,
      startTimeMs: Date.now(),
      readiness,
      env: {},
    });

  beforeEach(async () => {
    ctx = await createTestContext();
    freshAsked.length = 0;
  });

  afterEach(async () => {
    await ctx.db.destroy();
  });

  test("reads Claude Code as the built-in runtime, and whether it is the default", async () => {
    const look = await probes().claude(true);

    expect(look?.status).toMatchObject({ runtimeId: "claude-code", version: "2.1.288" });
    expect(look?.isDefault).toBe(true);
    expect(freshAsked).toEqual([true]);
  });

  test("computer use is wanted once a project lets its threads use it", async () => {
    expect((await probes().computerUse(false)).wanted).toBe(false);

    const project = await ctx.projectRepository.create({
      id: "prj_1",
      ...projectSettings({ name: "Checkout" }),
    });
    await ctx.projectRepository.setComputerUse(project.id, "cua");
    const look = await probes().computerUse(false);

    expect(look.wanted).toBe(true);
    expect(look.lease).toEqual(BUSY_LEASE);
    expect(look.status.status).toBe("ready");
  });

  test("a source run is reported as source for both the service and updates", async () => {
    const p = probes();

    expect(await p.service()).toEqual({ kind: "source" });
    expect((await p.updates()).block).toBe("source");
  });

  test("the update look follows update_check", async () => {
    await ctx.settingsRepository.set(SettingKey.UPDATE_CHECK, "false");

    expect((await probes().updates()).checking).toBe(false);
  });

  test("the host's facts: a short name, this channel, dev from source", () => {
    const facts = hostFacts({ port: 25650, startTimeMs: Date.now() - 5_000, env: {} });

    expect(facts.hostName).not.toContain(".");
    expect(facts.channel.id).toBe(buildChannel().id);
    expect(facts.version).toBe("dev");
    expect(facts.uptimeSeconds()).toBeGreaterThanOrEqual(5);
  });
});

describe("readUpdateInstall", () => {
  test("follows update_auto_apply on Nightly and always asks on Stable", async () => {
    const ctx = await createTestContext();
    try {
      await ctx.settingsRepository.set(SettingKey.UPDATE_AUTO_APPLY, "true");
      const on = await readUpdateInstall(ctx.settingsRepository);
      await ctx.settingsRepository.set(SettingKey.UPDATE_AUTO_APPLY, "false");
      const off = await readUpdateInstall(ctx.settingsRepository);

      const nightly = buildChannel().id === "nightly";
      expect(on).toEqual({ mode: nightly ? "idle" : "ask", window: null });
      expect(off).toEqual({ mode: "ask", window: null });
    } finally {
      await ctx.db.destroy();
    }
  });
});
