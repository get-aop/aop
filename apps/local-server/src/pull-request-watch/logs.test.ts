import { describe, expect, test } from "bun:test";
import type { GhPullRequestCheck, RunGh } from "../github-cli/index.ts";
import { failureLogs, tailOf } from "./logs.ts";

const check = (link: string): GhPullRequestCheck => ({
  name: "test",
  workflow: "ci",
  state: "FAILURE",
  bucket: "fail",
  link,
  startedAt: null,
  completedAt: null,
  description: null,
});

const run = (id: number) => `https://github.com/acme/widget/actions/runs/${id}/job/1`;

describe("tailOf", () => {
  test("keeps the end of a log, without colour codes or blank lines, each line cut short", () => {
    const log = `\u001b[31mfirst\u001b[0m\n\n${"y".repeat(400)}\nlast   \n`;

    expect(tailOf(log)).toBe(`first\n${"y".repeat(300)}…\nlast`);
  });

  test("is bounded in lines and in size, and it is the end that survives", () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${index}`);
    const byLines = tailOf(lines.join("\n")).split("\n");
    expect(byLines).toHaveLength(60);
    expect(byLines.at(-1)).toBe("line 199");
    expect(byLines[0]).toBe("line 140");

    const wide = Array.from({ length: 60 }, (_, index) => `${index}`.padEnd(200, "z"));
    const bySize = tailOf(wide.join("\n"));
    expect(bySize.length).toBeLessThanOrEqual(4_000);
    expect(bySize.endsWith("59".padEnd(200, "z"))).toBe(true);
  });
});

describe("failureLogs", () => {
  const scripted = (logs: Record<string, string | Error>) => {
    const calls: string[][] = [];
    const runGh: RunGh = async (args) => {
      calls.push(args);
      const log = logs[args[2] ?? ""];
      if (log instanceof Error) return { exitCode: 1, stdout: "", stderr: log.message };
      return log === undefined
        ? { exitCode: 1, stdout: "", stderr: "run not found" }
        : { exitCode: 0, stdout: log, stderr: "" };
    };
    return { runGh, calls };
  };

  test("reads each failing run once, whatever number of its checks fail", async () => {
    const gh = scripted({ "100": "boom in 100", "101": "boom in 101" });

    const logs = await failureLogs(gh.runGh, "/repo", [
      check(run(100)),
      check(run(100)),
      check(run(101)),
      check("https://ci.example.com/build/7"),
    ]);

    expect(logs).toEqual({ "100": "boom in 100", "101": "boom in 101" });
    expect(gh.calls).toEqual([
      ["run", "view", "100", "--log-failed"],
      ["run", "view", "101", "--log-failed"],
    ]);
  });

  test("leaves out a run whose log cannot be read, and reads no more than three", async () => {
    const gh = scripted({ "1": new Error("HTTP 502"), "2": "two", "3": "three", "4": "four" });

    const logs = await failureLogs(
      gh.runGh,
      "/repo",
      [1, 2, 3, 4].map((id) => check(run(id))),
    );

    expect(logs).toEqual({ "2": "two", "3": "three" });
    expect(gh.calls).toHaveLength(3);
  });
});
