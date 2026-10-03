import { describe, expect, test } from "bun:test";
import { draftOf } from "./mention-markup";
import { isInCode, MENTION_QUERY_MAX, mentionQueryAt } from "./mention-trigger";

// The query at the end of `text`, as if the cursor were there.
const queryAtEnd = (text: string) => mentionQueryAt(draftOf(text), draftOf(text).text.length);

describe("when @ starts a mention", () => {
  test("at the start, after a space or an opening bracket, with what follows up to the cursor", () => {
    expect(queryAtEnd("@")).toEqual({ start: 0, query: "" });
    expect(queryAtEnd("ask @fix lo")).toEqual({ start: 4, query: "fix lo" });
    expect(queryAtEnd("(@docs")).toEqual({ start: 1, query: "docs" });
    expect(queryAtEnd("line one\n@pay")).toEqual({ start: 9, query: "pay" });
  });

  test("the cursor decides: text after it is not part of the query", () => {
    const draft = draftOf("ask @fix the rest");
    expect(mentionQueryAt(draft, 8)).toEqual({ start: 4, query: "fix" });
    expect(mentionQueryAt(draft, 3)).toBeNull();
  });

  test("not in an email or after a word", () => {
    expect(queryAtEnd("mail ana@example")).toBeNull();
    expect(queryAtEnd("x@")).toBeNull();
    expect(queryAtEnd("v1@beta")).toBeNull();
  });

  test("not in inline code or a fenced block", () => {
    expect(queryAtEnd("use `@decorator")).toBeNull();
    expect(queryAtEnd("use ``a ` @scope")).toBeNull();
    expect(queryAtEnd("```ts\n@Component")).toBeNull();
    expect(queryAtEnd("~~~\nnpm i @aop/common")).toBeNull();
    // Closed code is behind the cursor: the @ is prose again.
    expect(queryAtEnd("use `x` and @docs")).toEqual({ start: 12, query: "docs" });
    expect(queryAtEnd("```\ncode\n```\n@docs")).toEqual({ start: 13, query: "docs" });
  });

  test("not across a line, after a space, or once the query is long", () => {
    expect(queryAtEnd("@fix\nmore")).toBeNull();
    expect(queryAtEnd("@ fix")).toBeNull();
    expect(queryAtEnd(`@${"a".repeat(MENTION_QUERY_MAX + 1)}`)).toBeNull();
    expect(queryAtEnd(`@${"a".repeat(MENTION_QUERY_MAX)}`)?.query).toHaveLength(MENTION_QUERY_MAX);
  });

  test("not from a chip already in the box", () => {
    expect(queryAtEnd("[Fix login](thread:thr_1)")).toBeNull();
    expect(queryAtEnd("[Fix](thread:thr_1) more")).toBeNull();
    expect(queryAtEnd("[Fix](thread:thr_1) @do")).toEqual({ start: 5, query: "do" });
  });
});

test("isInCode reads fences and inline spans before the point", () => {
  expect(isInCode("a `b", 4)).toBe(true);
  expect(isInCode("a `b` c", 7)).toBe(false);
  expect(isInCode("````\n```\nx", 10)).toBe(true);
});
