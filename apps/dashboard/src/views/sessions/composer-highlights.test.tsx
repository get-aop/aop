import { afterEach, describe, expect, test } from "bun:test";
import { createRef } from "react";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { ComposerHighlightLayer, parseMentionTokens } = await import("./composer-highlights");

afterEach(cleanup);

const sources = {
  repos: [
    { id: "repo", name: "aop-mono", path: "/workspace/aop-mono" },
    { id: "repo-2", name: "aop-mono docs", path: "/workspace/aop-mono-docs" },
    { id: "unnamed", name: null, path: "/workspace/unnamed" },
  ],
};

describe("parseMentionTokens", () => {
  test("parses a repo mention and preserves its exact range", () => {
    expect(parseMentionTokens("look at ~aop-mono please", sources)).toEqual([
      { kind: "repo", start: 8, end: 17, id: "repo", label: "aop-mono" },
    ]);
  });

  test("matches the longest name with spaces, case-insensitively", () => {
    expect(parseMentionTokens("~AOP-MONO DOCS now", sources)).toEqual([
      { kind: "repo", start: 0, end: 14, id: "repo-2", label: "aop-mono docs" },
    ]);
  });

  test("labels an unnamed repo by its id", () => {
    expect(parseMentionTokens("in ~unnamed.", sources)).toEqual([
      { kind: "repo", start: 3, end: 11, id: "unnamed", label: "unnamed" },
    ]);
  });

  test("ignores unknown, prefix-only, and non-boundary sigils", () => {
    expect(parseMentionTokens("~unknown", sources)).toEqual([]);
    expect(parseMentionTokens("~aop-monorepo", sources)).toEqual([]);
    expect(parseMentionTokens("email~aop-mono", sources)).toEqual([]);
  });

  test("no longer highlights the retired % # $ sigils", () => {
    expect(parseMentionTokens("%aop-mono #aop-mono $aop-mono", sources)).toEqual([]);
  });
});

test("ComposerHighlightLayer renders repo and paste marks without changing text", () => {
  const input = "~aop-mono [paste #1 +5 lines]";
  const tokens = [
    ...parseMentionTokens(input, sources),
    {
      kind: "paste" as const,
      start: 10,
      end: input.length,
      id: "paste-1",
      label: "[paste #1 +5 lines]",
    },
  ];
  render(
    <ComposerHighlightLayer
      input={input}
      tokens={tokens}
      textareaRef={createRef<HTMLTextAreaElement>()}
    />,
  );

  const layer = screen.getByTestId("composer-highlight-layer");
  expect(layer.textContent).toBe(input);
  expect(layer.className).toContain("composer-text-surface");
  expect(screen.getByText("~aop-mono").getAttribute("data-kind")).toBe("repo");
  expect(screen.getByText("[paste #1 +5 lines]").getAttribute("data-kind")).toBe("paste");
});
