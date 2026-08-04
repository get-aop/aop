import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const timelineCss = readFileSync(join(import.meta.dir, "chat-timeline.css"), "utf8");
const indexCss = readFileSync(join(import.meta.dir, "../../index.css"), "utf8");

const declaredTokens = (): Set<string> => {
  const names = new Set<string>();
  for (const source of [indexCss, timelineCss]) {
    for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(match[1] as string);
  }
  return names;
};

/** `var(--x)` references without a fallback value. */
const requiredTokens = (source: string): string[] =>
  [...source.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1] as string);

describe("chat timeline tokens", () => {
  test("every token the chat markdown uses is declared", () => {
    const declared = declaredTokens();
    const missing = [...new Set(requiredTokens(timelineCss))].filter(
      (token) => !declared.has(token),
    );
    expect(missing).toEqual([]);
  });

  test("code chips tint their background instead of painting the muted text color", () => {
    // The muted token is a foreground color; using it raw as a fill left near-white text
    // on a gray pill. The inline-code rule must tint the fill and keep the text color.
    expect(timelineCss).not.toContain("background: var(--color-text-muted);");
    const inlineCode = timelineCss.match(/\.chat-markdown :not\(pre\) > code \{([\s\S]*?)\}/)?.[1];
    expect(inlineCode).toContain("color: var(--color-text);");
    expect(inlineCode).toMatch(
      /background: color-mix\([^;]*var\(--color-text-muted\)[^;]*transparent\);/,
    );
  });
});

describe("draft session layout", () => {
  test("the draft chat thread spans the shell so its column stays centered", () => {
    const rule = indexCss.match(
      /\.session-conversation-body--draft \.session-chat-thread-shell,[\s\S]*?\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule).toContain("width: 100%;");
  });
});
