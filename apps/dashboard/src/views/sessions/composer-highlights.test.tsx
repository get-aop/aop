import { afterEach, describe, expect, test } from "bun:test";
import { createRef } from "react";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, render, screen } = await import("@testing-library/react");
const { ComposerHighlightLayer, parseMentionTokens } = await import("./composer-highlights");

afterEach(cleanup);

const sources = {
  workers: [
    { id: "k1", name: "K1" },
    { id: "pair", name: "Pair Programmer" },
  ],
  workflows: ["landing-page"],
  repos: [{ id: "repo", name: "aop-mono", path: "/workspace/aop-mono" }],
};

describe("parseMentionTokens", () => {
  test("parses all mention kinds and preserves exact ranges", () => {
    const input = "%K1 #landing-page ~aop-mono $CC_BROWSER_USE";
    expect(parseMentionTokens(input, sources)).toEqual([
      { kind: "worker", start: 0, end: 3, id: "k1", label: "K1" },
      { kind: "workflow", start: 4, end: 17, id: "landing-page", label: "landing-page" },
      { kind: "repo", start: 18, end: 27, id: "repo", label: "aop-mono" },
      {
        kind: "control",
        start: 28,
        end: 43,
        id: "CC_BROWSER_USE",
        label: "CC_BROWSER_USE",
      },
    ]);
  });

  test("matches longest names with spaces case-insensitively", () => {
    expect(parseMentionTokens("ask %pair programmer now", sources)).toEqual([
      { kind: "worker", start: 4, end: 20, id: "pair", label: "Pair Programmer" },
    ]);
  });

  test("ignores unknown and non-boundary sigils", () => {
    expect(parseMentionTokens("email%K1 %unknown", sources)).toEqual([]);
  });
});

test("ComposerHighlightLayer renders control and mention marks without changing text", () => {
  const input = "%K1 $CC_BROWSER_USE";
  const tokens = parseMentionTokens(input, sources);
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
  expect(screen.getByText("%K1").getAttribute("data-kind")).toBe("worker");
  expect(screen.getByText("$CC_BROWSER_USE").getAttribute("data-kind")).toBe("control");
});
