import { describe, expect, test } from "bun:test";
import { mentionFacts, renderMrkdwn } from "./mrkdwn.ts";

const names: Record<string, string> = { U1: "Priya Rao", U2: "Marcelo" };
const userName = (id: string) => names[id] ?? null;

describe("mentionFacts", () => {
  test("finds people, groups and broadcasts", () => {
    expect(
      mentionFacts("hey <@U2> and <@U1|priya>, <!subteam^S9|@platform> <!here> <#C1|infra>"),
    ).toEqual({ users: ["U2", "U1"], groups: ["S9"], broadcast: true });
  });

  test("channel and everyone are broadcasts; links are not mentions", () => {
    expect(mentionFacts("<!channel>").broadcast).toBe(true);
    expect(mentionFacts("<!everyone>").broadcast).toBe(true);
    expect(mentionFacts("see <https://x.dev|docs> and <mailto:a@b.c|a>")).toEqual({
      users: [],
      groups: [],
      broadcast: false,
    });
  });
});

describe("renderMrkdwn", () => {
  test("names people, channels and groups", () => {
    expect(
      renderMrkdwn("<@U2> can you take <#C1|infra>? cc <!subteam^S9|@platform> <!here>", userName),
    ).toBe("@Marcelo can you take #infra? cc @platform @here");
  });

  test("falls back to the id for an unknown person", () => {
    expect(renderMrkdwn("ping <@U77>", userName)).toBe("ping @U77");
  });

  test("keeps links and undoes escapes", () => {
    expect(
      renderMrkdwn(
        "logs <https://ci.dev/1|here> &amp; <https://ci.dev/2> 1 &lt; 2 &gt; 0",
        userName,
      ),
    ).toBe("logs here (https://ci.dev/1) & https://ci.dev/2 1 < 2 > 0");
  });

  test("dates and mail links read as their labels", () => {
    expect(
      renderMrkdwn("<!date^1700000000^{date}|Nov 14> <mailto:a@b.c|Ana> <mailto:x@y.z>", userName),
    ).toBe("Nov 14 Ana x@y.z");
  });
});
