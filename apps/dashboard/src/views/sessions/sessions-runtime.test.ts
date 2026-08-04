import { describe, expect, test } from "bun:test";
import {
  applySlashCommandInsert,
  CHAT_COMMANDS,
  filterSlashCommands,
  formatRelativeTime,
  getEffectiveCmd,
  isExactLeadingSlashCommand,
  matchSlashToken,
  parseMessageSegments,
  resolveUserMessageDisplay,
} from "./sessions-runtime";

describe("sessions-runtime", () => {
  test("lists every supported AOP and CLI slash command", () => {
    expect(CHAT_COMMANDS).toHaveLength(15);
    expect(CHAT_COMMANDS.map((c) => c.cmd)).toEqual([
      "/implement",
      "/review",
      "/audit",
      "/test",
      "/security",
      "/task create",
      "/task batch",
      "/task start",
      "/assign",
      "/worker",
      "/workflow",
      "/skill",
      "/status",
      "/clear",
      "/goal",
    ]);
  });

  test("offers /task batch while typing and renders it as a command chip", () => {
    expect(filterSlashCommands("/task b").map((c) => c.cmd)).toEqual(["/task batch"]);
    expect(filterSlashCommands("/task ").map((c) => c.cmd)).toEqual([
      "/task create",
      "/task batch",
      "/task start",
    ]);
    expect(parseMessageSegments("/task batch Add dark mode. Add CSV export.")).toEqual([
      { kind: "command", text: "/task batch" },
      { kind: "text", text: " Add dark mode. Add CSV export." },
    ]);
  });

  test("filters the five Quick Action commands", () => {
    expect(filterSlashCommands("/re").map((command) => command.cmd)).toEqual(["/review"]);
    expect(filterSlashCommands("/sec").map((command) => command.cmd)).toEqual(["/security"]);
    expect(filterSlashCommands("/test").map((command) => command.cmd)).toEqual(["/test"]);
  });

  test("filters slash commands only on bare /prefix", () => {
    expect(filterSlashCommands("/ta").map((c) => c.cmd)).toEqual([
      "/task create",
      "/task batch",
      "/task start",
    ]);
    expect(filterSlashCommands("/task c").map((c) => c.cmd)).toEqual(["/task create"]);
    expect(filterSlashCommands("/task Fix")).toEqual([]);
    expect(filterSlashCommands("/g").map((c) => c.cmd)).toEqual(["/goal"]);
    expect(filterSlashCommands("task")).toEqual([]);
    expect(filterSlashCommands("please /st", 10).map((c) => c.cmd)).toEqual(["/status"]);
    expect(filterSlashCommands("path /tmp/foo", 13)).toEqual([]);
    expect(filterSlashCommands("word/status", 11)).toEqual([]);
  });

  test("matches and replaces only the caret-local slash token", () => {
    const token = matchSlashToken("please /st more", 10);
    expect(token).toEqual({ start: 7, end: 10, query: "/st" });
    expect(token).not.toBeNull();
    if (!token) throw new Error("expected slash token");
    expect(applySlashCommandInsert("please /st more", token, "/status ")).toEqual({
      draft: "please /status  more",
      caret: 15,
    });
    expect(matchSlashToken("/tmp/foo", 8)).toBeNull();
    expect(matchSlashToken("word/status", 11)).toBeNull();
  });

  test("parses command and mention segments", () => {
    const segs = parseMessageSegments("/task create Fix teardown %K6 please", ["K6", "K1"]);
    expect(segs).toEqual([
      { kind: "command", text: "/task create" },
      { kind: "text", text: " Fix teardown " },
      { kind: "mention", text: "%K6" },
      { kind: "text", text: " please" },
    ]);
  });

  test("does not highlight bare runtime words in history text", () => {
    expect(parseMessageSegments("codex please fix the flaky test")).toEqual([
      { kind: "text", text: "codex please fix the flaky test" },
    ]);
    expect(parseMessageSegments("use OpenCode for this")).toEqual([
      { kind: "text", text: "use OpenCode for this" },
    ]);
  });

  test("history badges only appear when transport markers are present", () => {
    expect(resolveUserMessageDisplay("codex please fix the flaky test")).toEqual({
      displayText: "codex please fix the flaky test",
      badges: [],
    });
    const delegated = resolveUserMessageDisplay(
      "Fix the flaky test $DELEGATE_CODEX[gpt-5.4;extra-high]",
    );
    expect(delegated.displayText).toBe("Fix the flaky test");
    expect(delegated.badges).toHaveLength(1);
    expect(delegated.badges[0]?.kind).toBe("delegation");
    expect(delegated.badges[0]?.label).toContain("Codex");
    expect(delegated.badges[0]?.label).toContain("extra-high");

    const controlled = resolveUserMessageDisplay("inspect billing $CX_BROWSER_USE[gpt-5.5;medium]");
    expect(controlled.displayText).toBe("inspect billing");
    expect(controlled.badges[0]?.kind).toBe("control");
    expect(controlled.badges[0]?.label).toContain("Codex Browser");
  });

  test("does not style paths or unknown slash text as commands", () => {
    expect(parseMessageSegments("Open ~/workspace and /unknown")).toEqual([
      { kind: "text", text: "Open ~/workspace and /unknown" },
    ]);
  });

  test("uses alias when set for the effective command", () => {
    expect(getEffectiveCmd("claude-code", null)).toBe("claude");
    expect(getEffectiveCmd("claude-code", "cpe")).toBe("cpe");
  });

  test("formats relative times", () => {
    const now = Date.parse("2026-07-09T12:00:00.000Z");
    expect(formatRelativeTime("2026-07-09T11:59:30.000Z", now)).toBe("now");
    expect(formatRelativeTime("2026-07-09T11:48:00.000Z", now)).toBe("12m");
    expect(formatRelativeTime("2026-07-09T10:00:00.000Z", now)).toBe("2h");
  });

  test("slash insert form is command plus trailing space", () => {
    const match = filterSlashCommands("/ass")[0];
    expect(match?.cmd).toBe("/assign");
    expect(`${match?.cmd} `).toBe("/assign ");
  });

  test("detects exact leading deterministic commands for immediate execution", () => {
    expect(isExactLeadingSlashCommand("/status")).toBe(true);
    expect(isExactLeadingSlashCommand("/status", 7)).toBe(true);
    expect(isExactLeadingSlashCommand("/goal")).toBe(true);
    expect(isExactLeadingSlashCommand("/st")).toBe(false);
    expect(isExactLeadingSlashCommand("please /status", 14)).toBe(false);
    expect(isExactLeadingSlashCommand("/status now")).toBe(false);
  });
});
