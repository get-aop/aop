import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { SettingKey } from "../settings/types.ts";
import {
  bypassBlockedReason,
  launchSkipsPermissions,
  ROOT_WITHOUT_SANDBOX,
  readPermissionBypass,
} from "./permission-bypass.ts";

const USER = { uid: 501, env: () => ({}) };
const ROOT = { uid: 0, env: () => ({}) };

describe("bypassBlockedReason", () => {
  test("a regular user can skip permission checks, and its env is never read", () => {
    let envRead = false;
    const reason = bypassBlockedReason({
      uid: 501,
      env: () => {
        envRead = true;
        return {};
      },
    });

    expect(reason).toBeNull();
    expect(envRead).toBe(false);
  });

  test("root outside a sandbox cannot, as Claude Code refuses the flag there", () => {
    expect(bypassBlockedReason(ROOT)).toBe(ROOT_WITHOUT_SANDBOX);
    expect(bypassBlockedReason({ uid: 0, env: () => ({ IS_SANDBOX: "true" }) })).toBe(
      ROOT_WITHOUT_SANDBOX,
    );
  });

  test("root in a sandbox the CLI recognises can", () => {
    expect(bypassBlockedReason({ uid: 0, env: () => ({ IS_SANDBOX: "1" }) })).toBeNull();
    expect(
      bypassBlockedReason({ uid: 0, env: () => ({ CLAUDE_CODE_BUBBLEWRAP: "1" }) }),
    ).toBeNull();
  });

  test("a platform with no uid (Windows) is never root", () => {
    expect(bypassBlockedReason({ uid: null, env: () => ({}) })).toBeNull();
  });
});

describe("reading the setting for a launch", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("off by default: no launch skips permission checks", async () => {
    expect(await readPermissionBypass(ctx.settingsRepository, USER)).toEqual({
      enabled: false,
      blockedReason: null,
    });
    expect(await launchSkipsPermissions(ctx.settingsRepository, USER)).toBe(false);
  });

  test("the next launch after the owner turns it on skips them, and the one after it is off again does not", async () => {
    await ctx.settingsRepository.set(SettingKey.AGENT_CLI_SKIP_PERMISSIONS, "true");
    expect(await launchSkipsPermissions(ctx.settingsRepository, USER)).toBe(true);

    await ctx.settingsRepository.set(SettingKey.AGENT_CLI_SKIP_PERMISSIONS, "false");
    expect(await launchSkipsPermissions(ctx.settingsRepository, USER)).toBe(false);
  });

  test("on a root host outside a sandbox, runs keep their checks and the panel says why", async () => {
    await ctx.settingsRepository.set(SettingKey.AGENT_CLI_SKIP_PERMISSIONS, "true");

    expect(await launchSkipsPermissions(ctx.settingsRepository, ROOT)).toBe(false);
    expect(await readPermissionBypass(ctx.settingsRepository, ROOT)).toEqual({
      enabled: true,
      blockedReason: ROOT_WITHOUT_SANDBOX,
    });
  });
});
