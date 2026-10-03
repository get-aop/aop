import { describe, expect, test } from "bun:test";
import { INBOX_DEFAULT_RULES, type InboxRules } from "@aop/common";
import { matchesKeyword, matchMessage, strongerReason } from "./matcher.ts";
import { incomingMessage } from "./test-utils.ts";

const rules = (patch: Partial<InboxRules> = {}): InboxRules => ({
  ...INBOX_DEFAULT_RULES,
  ...patch,
});

describe("matchMessage", () => {
  test("a plain channel message from someone else does not need the person", () => {
    expect(matchMessage(incomingMessage(), rules(), false)).toBeNull();
  });

  test("each trigger gives its reason", () => {
    expect(matchMessage(incomingMessage({ mentionsMe: true }), rules(), false)).toBe("mention");
    expect(
      matchMessage(
        incomingMessage({ conversation: { id: "D1", name: "Jonas", kind: "dm" } }),
        rules(),
        false,
      ),
    ).toBe("dm");
    expect(
      matchMessage(
        incomingMessage({ conversation: { id: "G1", name: "Jonas, Ana", kind: "group-dm" } }),
        rules(),
        false,
      ),
    ).toBe("dm");
    expect(matchMessage(incomingMessage({ threadId: "1.0" }), rules(), true)).toBe("thread-reply");
    expect(matchMessage(incomingMessage({ mentionsMyGroup: true }), rules(), false)).toBe("group");
    expect(matchMessage(incomingMessage({ broadcast: true }), rules(), false)).toBe("broadcast");
    expect(
      matchMessage(
        incomingMessage({ text: "the deploy-check failed" }),
        rules({ keywords: ["deploy-check"] }),
        false,
      ),
    ).toBe("keyword");
  });

  test("the strongest reason wins when several apply", () => {
    const everything = incomingMessage({
      mentionsMe: true,
      broadcast: true,
      mentionsMyGroup: true,
    });
    expect(matchMessage(everything, rules(), true)).toBe("mention");
    expect(matchMessage({ ...everything, mentionsMe: false }, rules(), true)).toBe("thread-reply");
  });

  test("the person's own messages never need them", () => {
    expect(
      matchMessage(incomingMessage({ fromMe: true, mentionsMe: true }), rules(), true),
    ).toBeNull();
  });

  test("a trigger that is off does not count", () => {
    const off = rules({ mentions: false, broadcasts: false });
    expect(matchMessage(incomingMessage({ mentionsMe: true }), off, false)).toBeNull();
    expect(matchMessage(incomingMessage({ broadcast: true }), off, false)).toBeNull();
  });

  test("a muted channel keeps nothing, not even a direct mention", () => {
    const muted = rules({ channels: { C1: { mode: "muted" } } });
    expect(matchMessage(incomingMessage({ mentionsMe: true }), muted, true)).toBeNull();
  });

  test("a direct-mentions-only channel keeps direct mentions only", () => {
    const direct = rules({ channels: { C1: { mode: "direct-only" } } });
    expect(matchMessage(incomingMessage({ mentionsMe: true }), direct, false)).toBe("mention");
    expect(matchMessage(incomingMessage({ broadcast: true }), direct, false)).toBeNull();
    expect(matchMessage(incomingMessage({ mentionsMyGroup: true }), direct, false)).toBeNull();
    expect(matchMessage(incomingMessage({ threadId: "1.0" }), direct, true)).toBeNull();
  });
});

describe("matchesKeyword", () => {
  test("matches whole words and phrases, ignoring case", () => {
    expect(matchesKeyword("Deploy-Check is red", ["deploy-check"])).toBe(true);
    expect(matchesKeyword("ship the AOP release", ["aop release"])).toBe(true);
    expect(matchesKeyword("soap opera", ["aop"])).toBe(false);
    expect(matchesKeyword("aop_x", ["aop"])).toBe(false);
    expect(matchesKeyword("anything", [])).toBe(false);
  });

  test("treats keyword text literally", () => {
    expect(matchesKeyword("cost is $5 (approx)", ["$5 (approx)"])).toBe(true);
    expect(matchesKeyword("a.b", ["a*b"])).toBe(false);
  });
});

describe("strongerReason", () => {
  test("keeps the reason listed first", () => {
    expect(strongerReason("broadcast", "mention")).toBe("mention");
    expect(strongerReason("dm", "keyword")).toBe("dm");
    expect(strongerReason("group", "group")).toBe("group");
  });
});
