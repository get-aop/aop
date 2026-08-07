import { describe, expect, mock, test } from "bun:test";
import type { CodeHighlighterPlugin, HighlightOptions, HighlightResult } from "@streamdown/code";
import { createLazyCodeHighlighter } from "./lazy-code-highlighter";

const options: HighlightOptions = {
  code: "const ready = true;",
  language: "typescript",
  themes: ["github-light", "github-dark"],
};

const highlighted = {
  tokens: [[{ content: "const", offset: 0, htmlStyle: { color: "blue" } }]],
} as HighlightResult;

describe("createLazyCodeHighlighter", () => {
  test("loads the highlighter once and delivers the deferred result", async () => {
    const highlight = mock(
      (_options: HighlightOptions, callback?: (value: HighlightResult) => void) => {
        callback?.(highlighted);
        return null;
      },
    );
    const plugin = {
      name: "shiki",
      type: "code-highlighter",
      supportsLanguage: () => true,
      getSupportedLanguages: () => ["typescript"],
      getThemes: () => options.themes,
      highlight,
    } satisfies CodeHighlighterPlugin;
    const load = mock(async () => plugin);
    const lazy = createLazyCodeHighlighter(load);
    const firstResult = mock(() => undefined);
    const secondResult = mock(() => undefined);

    expect(lazy.highlight(options, firstResult)).toBeNull();
    expect(lazy.highlight(options, secondResult)).toBeNull();
    await Bun.sleep(0);

    expect(load).toHaveBeenCalledTimes(1);
    expect(highlight).toHaveBeenCalledTimes(2);
    expect(firstResult).toHaveBeenCalledWith(highlighted);
    expect(secondResult).toHaveBeenCalledWith(highlighted);
  });

  test("retries after a failed module load", async () => {
    const plugin = {
      name: "shiki",
      type: "code-highlighter",
      supportsLanguage: () => true,
      getSupportedLanguages: () => ["typescript"],
      getThemes: () => options.themes,
      highlight: (_options: HighlightOptions, callback?: (value: HighlightResult) => void) => {
        callback?.(highlighted);
        return null;
      },
    } satisfies CodeHighlighterPlugin;
    let attempt = 0;
    const load = mock(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("temporary load failure");
      return plugin;
    });
    const lazy = createLazyCodeHighlighter(load);
    const accept = mock(() => undefined);

    lazy.highlight(options, accept);
    await Bun.sleep(0);
    lazy.highlight(options, accept);
    await Bun.sleep(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(accept).toHaveBeenCalledWith(highlighted);
  });
});
