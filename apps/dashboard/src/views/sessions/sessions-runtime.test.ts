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
} from "./sessions-runtime";

describe("sessions-runtime", () => {
  test("lists every supported AOP and CLI slash command", () => {
    expect(CHAT_COMMANDS).toHaveLength(3);
    expect(CHAT_COMMANDS.map((c) => c.cmd)).toEqual(["/skill", "/clear", "/goal"]);
  });

  test("does not offer legacy task/worker commands", () => {
    expect(filterSlashCommands("/task")).toEqual([]);
    expect(filterSlashCommands("/assign")).toEqual([]);
    expect(filterSlashCommands("/worker")).toEqual([]);
    expect(filterSlashCommands("/status")).toEqual([]);
  });

  test("does not offer Quick Action or workflow commands", () => {
    for (const command of ["/implement", "/review", "/audit", "/test", "/security", "/workflow"]) {
      expect(filterSlashCommands(command)).toEqual([]);
    }
  });

  test("filters slash commands only on bare /prefix", () => {
    expect(filterSlashCommands("/ta")).toEqual([]);
    expect(filterSlashCommands("/task c")).toEqual([]);
    expect(filterSlashCommands("/task Fix")).toEqual([]);
    expect(filterSlashCommands("/g").map((c) => c.cmd)).toEqual(["/goal"]);
    expect(filterSlashCommands("task")).toEqual([]);
    expect(filterSlashCommands("please /sk", 10).map((c) => c.cmd)).toEqual(["/skill"]);
    expect(filterSlashCommands("path /tmp/foo", 13)).toEqual([]);
    expect(filterSlashCommands("word/skill", 11)).toEqual([]);
  });

  test("matches and replaces only the caret-local slash token", () => {
    const token = matchSlashToken("please /sk more", 10);
    expect(token).toEqual({ start: 7, end: 10, query: "/sk" });
    expect(token).not.toBeNull();
    if (!token) throw new Error("expected slash token");
    expect(applySlashCommandInsert("please /sk more", token, "/skill ")).toEqual({
      draft: "please /skill  more",
      caret: 14,
    });
    expect(matchSlashToken("/tmp/foo", 8)).toBeNull();
    expect(matchSlashToken("word/skill", 11)).toBeNull();
  });

  test("parses command segments and leaves %mentions as plain text", () => {
    const segs = parseMessageSegments("/skill tdd Fix teardown %K6 please");
    expect(segs).toEqual([
      { kind: "command", text: "/skill" },
      { kind: "text", text: " tdd Fix teardown %K6 please" },
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
    const match = filterSlashCommands("/sk")[0];
    expect(match?.cmd).toBe("/skill");
    expect(`${match?.cmd} `).toBe("/skill ");
  });

  test("detects exact leading deterministic commands for immediate execution", () => {
    expect(isExactLeadingSlashCommand("/clear")).toBe(true);
    expect(isExactLeadingSlashCommand("/clear", 6)).toBe(true);
    expect(isExactLeadingSlashCommand("/goal")).toBe(true);
    expect(isExactLeadingSlashCommand("/cl")).toBe(false);
    expect(isExactLeadingSlashCommand("please /clear", 14)).toBe(false);
    expect(isExactLeadingSlashCommand("/clear now")).toBe(false);
  });
});
