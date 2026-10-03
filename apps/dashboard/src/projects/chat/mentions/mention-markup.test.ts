import { describe, expect, test } from "bun:test";
import {
  applyEdit,
  draftOf,
  insertMention,
  markupOf,
  mentionAt,
  mentionLink,
  messagePieces,
} from "./mention-markup";

const MARKUP = "Ask [Fix login](thread:thr_1) and [Docs](thread:thr_2) today";

describe("the wire format", () => {
  test("a mention is the thread link the coordinator reads, its title escaped", () => {
    expect(mentionLink("Fix login", "thr_1")).toBe("[Fix login](thread:thr_1)");
    expect(mentionLink("Use [beta] \\ flag", "thr_2")).toBe(
      "[Use \\[beta\\] \\\\ flag](thread:thr_2)",
    );
  });

  test("a message is cut into its words and the threads it mentions", () => {
    expect(messagePieces(MARKUP)).toEqual([
      { kind: "text", text: "Ask " },
      { kind: "mention", threadId: "thr_1", title: "Fix login" },
      { kind: "text", text: " and " },
      { kind: "mention", threadId: "thr_2", title: "Docs" },
      { kind: "text", text: " today" },
    ]);
    expect(messagePieces("[Use \\[beta\\]](thread:thr_3)")).toEqual([
      { kind: "mention", threadId: "thr_3", title: "Use [beta]" },
    ]);
    // Other links and a broken one are words.
    expect(messagePieces("see [site](https://x.dev) [x](thread:)")).toEqual([
      { kind: "text", text: "see [site](https://x.dev) [x](thread:)" },
    ]);
  });

  test("the box shows each mention as @title, and turns back into the same message", () => {
    const draft = draftOf(MARKUP);

    expect(draft.text).toBe("Ask @Fix login and @Docs today");
    expect(draft.mentions).toEqual([
      { threadId: "thr_1", title: "Fix login", start: 4, end: 14 },
      { threadId: "thr_2", title: "Docs", start: 19, end: 24 },
    ]);
    expect(markupOf(draft)).toBe(MARKUP);
    expect(markupOf(draftOf("[Use \\[beta\\]](thread:thr_3)"))).toBe(
      "[Use \\[beta\\]](thread:thr_3)",
    );
  });
});

describe("editing around chips", () => {
  const draft = draftOf(MARKUP);

  test("Backspace right after a chip removes the whole chip", () => {
    // "Ask @Fix login| and" with the "n" deleted.
    const next = applyEdit(draft, "Ask @Fix logi and @Docs today", 13);

    expect(next.draft.text).toBe("Ask  and @Docs today");
    expect(next.caret).toBe(4);
    expect(markupOf(next.draft)).toBe("Ask  and [Docs](thread:thr_2) today");
  });

  test("deleting a selection that cuts into a chip takes the chip with it", () => {
    // "Ask @Fix lo" + "gin and " selected and deleted.
    const next = applyEdit(draft, "Ask @Fix lo@Docs today", 11);

    expect(next.draft.text).toBe("Ask @Docs today");
    expect(markupOf(next.draft)).toBe("Ask [Docs](thread:thr_2) today");
  });

  test("typing before a chip moves it; typing inside one makes it plain words", () => {
    const before = applyEdit(draft, "Please ask @Fix login and @Docs today", 7);
    expect(markupOf(before.draft)).toBe(
      "Please ask [Fix login](thread:thr_1) and [Docs](thread:thr_2) today",
    );
    expect(before.draft.mentions.map((mention) => mention.start)).toEqual([11, 26]);

    const inside = applyEdit(draft, "Ask @Fix the login and @Docs today", 13);
    expect(markupOf(inside.draft)).toBe("Ask @Fix the login and [Docs](thread:thr_2) today");
  });

  test("the chip the cursor is in or right after", () => {
    expect(mentionAt(draft, 14)?.threadId).toBe("thr_1");
    expect(mentionAt(draft, 4)).toBeUndefined();
    expect(mentionAt(draft, 16)).toBeUndefined();
  });
});

describe("picking a thread", () => {
  test("replaces the @query with a chip and a space, the cursor after it", () => {
    const draft = draftOf("Ping @log about [Docs](thread:thr_2)");
    const next = insertMention(draft, 5, 9, { id: "thr_1", title: "Fix  login\n" });

    expect(next.draft.text).toBe("Ping @Fix login about @Docs");
    expect(next.caret).toBe(16);
    expect(markupOf(next.draft)).toBe("Ping [Fix login](thread:thr_1) about [Docs](thread:thr_2)");
  });

  test("adds a space only where there is none", () => {
    const next = insertMention(draftOf("@fi"), 0, 3, { id: "thr_1", title: "Fix" });

    expect(next.draft.text).toBe("@Fix ");
    expect(markupOf(next.draft)).toBe("[Fix](thread:thr_1) ");
  });
});
