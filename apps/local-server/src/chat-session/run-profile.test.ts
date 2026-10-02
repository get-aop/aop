import { describe, expect, test } from "bun:test";
import { bypassesPermissions, READ_ONLY_ACCESS, runProfileFor } from "./run-profile.ts";

const ON = { skipPermissions: true };

describe("bypassesPermissions, what a run records", () => {
  test("a thread with full access bypasses them even with the host setting off", () => {
    expect(
      bypassesPermissions(runProfileFor({ kind: "thread", runtime_access_mode: "full-access" })),
    ).toBe(true);
  });

  test("the coordinator and an Edit files thread do not, until the host setting is on", () => {
    const coordinator = { kind: "coordinator", runtime_access_mode: "full-access" } as const;
    const editing = { kind: "thread", runtime_access_mode: "auto-accept-edits" } as const;

    expect(bypassesPermissions(runProfileFor(coordinator))).toBe(false);
    expect(bypassesPermissions(runProfileFor(editing))).toBe(false);
    expect(bypassesPermissions(runProfileFor(coordinator, ON))).toBe(true);
    expect(bypassesPermissions(runProfileFor(editing, ON))).toBe(true);
  });

  test("a read-only thread never does", () => {
    expect(
      bypassesPermissions(
        runProfileFor({ kind: "thread", runtime_access_mode: READ_ONLY_ACCESS }, ON),
      ),
    ).toBe(false);
  });
});
