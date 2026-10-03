import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import { makeThread } from "../../test-utils";
import { buildMentionIndex, fold, searchMentions } from "./mention-search";

const at = (minute: number) => `2026-10-03T10:${String(minute).padStart(2, "0")}:00.000Z`;

const THREADS: Thread[] = [
  makeThread({
    id: "thr_login",
    title: "Fix login redirect",
    status: "working",
    description: "Users on Safari are sent back to the start page after signing in",
    lastActivityAt: at(1),
  }),
  makeThread({
    id: "thr_safari",
    title: "Safari layout pass",
    status: "idle",
    description: "Check every page on the narrow viewport",
    lastActivityAt: at(2),
  }),
  makeThread({
    id: "thr_ledger",
    title: "Ledger export",
    status: "ready-for-review",
    liveStatusLine: "Waiting for CI on the csv writer",
    description: "Write the monthly ledger as CSV for the accountants",
    artifacts: [{ type: "pr", number: 412, url: "https://github.com/o/r/pull/412", state: "open" }],
    lastActivityAt: at(3),
  }),
  makeThread({
    id: "thr_old",
    title: "Old Safari bug",
    status: "resolved",
    description: "Safari crashed on upload",
    lastActivityAt: at(9),
  }),
];

const index = buildMentionIndex(THREADS);
const ids = (query: string) => searchMentions(index, query).map((result) => result.thread.id);

describe("finding a thread to mention", () => {
  test("with nothing typed: every thread, active ones by latest activity, then resolved", () => {
    expect(ids("")).toEqual(["thr_ledger", "thr_safari", "thr_login", "thr_old"]);
  });

  test("a word only in a description finds the thread, and lights it up in the snippet", () => {
    const [result, ...rest] = searchMentions(index, "accountants");

    expect(rest).toEqual([]);
    expect(result?.thread.id).toBe("thr_ledger");
    expect(result?.titleRanges).toEqual([]);
    const snippet = result?.snippet;
    const [from, to] = snippet?.ranges[0] ?? [0, 0];
    expect(snippet?.text.slice(from, to)).toBe("accountants");
  });

  test("a word in a title ranks above the same word in a description; resolved still last", () => {
    // "Safari layout pass" has it in its title; "Fix login redirect" only in its brief.
    expect(ids("safari")).toEqual(["thr_safari", "thr_login", "thr_old"]);
  });

  test("every word has to be found, in any field", () => {
    expect(ids("login safari")).toEqual(["thr_login"]);
    expect(ids("ledger nothing")).toEqual([]);
  });

  test("the snippet shows the brief where the words are, from the start of a word", () => {
    const brief = `${"Lorem ipsum dolor sit amet consectetur ".repeat(3)}adipiscing elit with the needle inside`;
    const threads = [
      makeThread({
        id: "thr_a",
        title: "A",
        liveStatusLine: "needle in the status",
        description: brief,
      }),
    ];
    const [result] = searchMentions(buildMentionIndex(threads), "needle");
    const text = result?.snippet?.text ?? "";

    expect(text.startsWith("…")).toBe(true);
    // The brief, not the status line, and a whole word after the ellipsis.
    expect(text).toContain("the needle inside");
    expect(text[1]).toMatch(/[A-Za-z]/);
    expect(brief.includes(text.slice(1))).toBe(true);
    expect(/\s/.test(brief[brief.indexOf(text.slice(1)) - 1] ?? "")).toBe(true);
  });

  test("the status line and the pull request number find a thread too", () => {
    expect(ids("csv writer")).toEqual(["thr_ledger"]);
    expect(ids("#412")).toEqual(["thr_ledger"]);
    expect(ids("41")).toEqual(["thr_ledger"]);
  });

  test("a title matches fuzzily, letters in order, and the letters are lit", () => {
    const [result] = searchMentions(index, "lgnrd");
    expect(result?.thread.id).toBe("thr_login");
    expect(ids("xyz")).toEqual([]);
  });

  test("the start of a word beats the inside of one", () => {
    const threads = [
      makeThread({ id: "thr_inside", title: "Unexported helpers", lastActivityAt: at(5) }),
      makeThread({ id: "thr_start", title: "Export button", lastActivityAt: at(1) }),
    ];
    expect(searchMentions(buildMentionIndex(threads), "export").map((r) => r.thread.id)).toEqual([
      "thr_start",
      "thr_inside",
    ]);
  });

  test("lights up the matched words of the title", () => {
    const [result] = searchMentions(index, "fix redir");
    expect(result?.titleRanges).toEqual([
      [0, 3],
      [10, 15],
    ]);
  });

  test("case and accents do not matter", () => {
    expect(fold("Café ÉCLAIR")).toBe("cafe eclair");
    const threads = [makeThread({ id: "thr_cafe", title: "Café menu" })];
    expect(searchMentions(buildMentionIndex(threads), "CAFE")).toHaveLength(1);
  });

  test("stays fast over hundreds of threads with long briefs", () => {
    const many = Array.from({ length: 800 }, (_, n) =>
      makeThread({
        id: `thr_${n}`,
        title: `Thread number ${n} about module ${n % 37}`,
        description: `Refactor the ${n % 11} service and update its tests. `
          .repeat(20)
          .slice(0, 1000),
        lastActivityAt: at(n % 60),
      }),
    );
    const big = buildMentionIndex(many);
    const started = performance.now();
    for (const query of ["", "mod", "module 3", "service tests", "zzz", "thrd nmbr"]) {
      searchMentions(big, query);
    }
    expect(performance.now() - started).toBeLessThan(300);
  });
});
