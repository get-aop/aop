import { describe, expect, test } from "bun:test";
import type { Thread } from "@aop/common";
import { buildMentionNote, MENTIONS_MAX, mentionedThreadIds } from "./thread-mentions.ts";

const thread = (overrides: Partial<Thread> & Pick<Thread, "id">): Thread =>
  ({
    projectId: "proj_1",
    title: "Fix cold start",
    runtime: { provider: "claude-code", model: "m", effort: "high" },
    target: { kind: "host" },
    repoId: "repo_web",
    branch: null,
    steps: [],
    liveStatusLine: null,
    artifacts: [],
    repliesCount: 0,
    unread: false,
    lastActivityAt: "2026-09-30T10:00:00.000Z",
    createdAt: "2026-09-30T10:00:00.000Z",
    status: "idle",
    ...overrides,
  }) as Thread;

describe("thread mentions", () => {
  test("finds each thread a message links to once, in order", () => {
    expect(
      mentionedThreadIds(
        "Ask [Login](thread:isess_b) and [Docs \\] fix](thread:isess_a), then [Login](thread:isess_b) again; [web](https://x.dev) is not one",
      ),
    ).toEqual(["isess_b", "isess_a"]);
    expect(mentionedThreadIds("nothing here")).toEqual([]);
  });

  test("gives each mentioned thread's status, branch, pull request and brief", () => {
    const note = buildMentionNote([
      thread({
        id: "isess_a",
        title: "Fix login",
        status: "ready-for-review",
        branch: "aop/fix-login",
        artifacts: [
          { type: "pr", number: 12, url: "https://github.com/o/r/pull/12", state: "open" },
        ],
        description: "Users on Safari\nare logged out",
      }),
      thread({ id: "isess_b", title: "Notes" }),
    ]);

    expect(note[0]).toBe("--- added by AOP, not written by the person ---");
    expect(note).toContain(
      '- isess_a "Fix login" [ready-for-review] · branch aop/fix-login · pull request #12 (open) https://github.com/o/r/pull/12 · asked: Users on Safari are logged out',
    );
    expect(note).toContain('- isess_b "Notes" [idle] · no branch');
  });

  test("says nothing when no mentioned thread was found, and lists at most MENTIONS_MAX", () => {
    expect(buildMentionNote([])).toEqual([]);
    const many = Array.from({ length: MENTIONS_MAX + 3 }, (_, i) => thread({ id: `isess_${i}` }));

    expect(buildMentionNote(many).filter((line) => line.startsWith("- "))).toHaveLength(
      MENTIONS_MAX,
    );
  });
});
