import { describe, expect, test } from "bun:test";
import { CUA_DRIVER_VERSION, EMPTY_CUA_LEASE } from "@aop/common";
import { computerUseCheck } from "./computer-use-check.ts";
import { BUSY_LEASE, cuaNoScreen, cuaStatus } from "./test-utils.ts";

const COMMAND = "aop-nightly computer-use setup";

describe("computerUseCheck", () => {
  test("ready: the driver, the screen, the browser and who holds computer use", () => {
    const check = computerUseCheck(
      { status: cuaStatus(), lease: BUSY_LEASE, wanted: true },
      COMMAND,
    );

    expect(check).toEqual({
      id: "computer-use",
      state: "ok",
      title: "Computer use",
      detail: `CUA Driver ${CUA_DRIVER_VERSION} · screen :99 · Google Chrome · in use by "Umbral CI retest", 1 thread waiting`,
      actions: [{ kind: "link", label: "Live view", target: "live-view" }],
    });
  });

  test("leaves out the lease when nobody holds it", () => {
    const check = computerUseCheck(
      { status: cuaStatus(), lease: EMPTY_CUA_LEASE, wanted: true },
      COMMAND,
    );

    expect(check.detail).toBe(`CUA Driver ${CUA_DRIVER_VERSION} · screen :99 · Google Chrome`);
  });

  test("names what is missing, with Fix when setup needs no password", () => {
    const check = computerUseCheck(
      { status: cuaNoScreen(), lease: EMPTY_CUA_LEASE, wanted: true },
      COMMAND,
    );

    expect(check).toMatchObject({
      state: "warning",
      detail: `Missing: Screen. CUA Driver ${CUA_DRIVER_VERSION} is installed.`,
      actions: [{ kind: "fix", label: "Fix" }],
    });
  });

  test("a step that needs root is a how-to with the one sudo command", () => {
    const base = cuaNoScreen();
    const status = {
      ...base,
      fix: {
        ...base.fix,
        sudoCommand: "sudo apt-get install -y xvfb openbox",
        missing: ["Xvfb", "openbox"],
      },
    };

    const check = computerUseCheck({ status, lease: EMPTY_CUA_LEASE, wanted: true }, COMMAND);

    expect(check.detail).toBe(
      `Missing: Screen, Xvfb, openbox. CUA Driver ${CUA_DRIVER_VERSION} is installed.`,
    );
    expect(check.actions).toEqual([
      {
        kind: "how-to",
        steps: [
          "Some of it needs root. On soulf, run this once in a terminal (it asks for your password):",
          "Then run `aop-nightly computer-use setup` there, or press Check again.",
        ],
        command: "sudo apt-get install -y xvfb openbox",
      },
    ]);
  });

  test("no driver at all is named first", () => {
    const status = cuaStatus({
      status: "not-installed",
      reason: "not-installed",
      version: null,
      path: null,
      checks: [],
      fix: { command: COMMAND, sudoCommand: null, missing: [], pinnedVersion: CUA_DRIVER_VERSION },
    });

    const check = computerUseCheck({ status, lease: EMPTY_CUA_LEASE, wanted: true }, COMMAND);

    expect(check).toMatchObject({ detail: "Missing: CUA Driver.", actions: [{ kind: "fix" }] });
  });

  test("macOS permissions only a terminal can ask for are a how-to with setup", () => {
    const status = cuaStatus({
      status: "not-ready",
      reason: "missing-permissions",
      detail: "CUA Driver lacks the macOS Accessibility permission.",
      checks: [
        {
          id: "accessibility",
          label: "Accessibility",
          required: true,
          ok: false,
          detail: "Not granted to Cua Driver.",
        },
      ],
      host: { name: "Marcelos-MacBook-Pro", platform: "darwin" },
    });

    const check = computerUseCheck(
      { status, lease: EMPTY_CUA_LEASE, wanted: true },
      "aop computer-use setup",
    );

    expect(check.detail).toBe(
      `Missing: Accessibility. CUA Driver ${CUA_DRIVER_VERSION} is installed.`,
    );
    expect(check.actions).toEqual([
      {
        kind: "how-to",
        steps: [
          "On Marcelos-MacBook-Pro, run this in a terminal. It starts CUA Driver and asks macOS for the permissions it needs.",
        ],
        command: "aop computer-use setup",
      },
    ]);
  });

  test("optional when no project uses computer use", () => {
    const notSetUp = computerUseCheck(
      { status: cuaNoScreen(), lease: EMPTY_CUA_LEASE, wanted: false },
      COMMAND,
    );
    const ready = computerUseCheck(
      { status: cuaStatus(), lease: EMPTY_CUA_LEASE, wanted: false },
      COMMAND,
    );

    expect(notSetUp).toEqual({
      id: "computer-use",
      state: "optional",
      title: "Computer use",
      detail: "Not set up · optional",
      actions: [],
    });
    expect(ready).toMatchObject({ state: "optional" });
    expect(ready.detail).toEndWith("· no project uses it");
  });
});
