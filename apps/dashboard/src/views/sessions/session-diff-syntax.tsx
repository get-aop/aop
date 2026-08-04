import { code, type HighlightOptions, type HighlightResult } from "@streamdown/code";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

const LANGUAGE_BY_EXTENSION: Record<string, HighlightOptions["language"]> = {
  c: "c",
  cc: "cpp",
  cpp: "cpp",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "shellscript",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
};

const highlightCache = new Map<string, HighlightResult>();

export const languageForDiffPath = (path: string): HighlightOptions["language"] | null => {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
};

export const DiffSyntax = ({ path, text }: { path: string; text: string }) => {
  const language = languageForDiffPath(path);
  const cacheKey = language ? `${language}:${text}` : "";
  const [result, setResult] = useState<HighlightResult | null>(() =>
    cacheKey ? (highlightCache.get(cacheKey) ?? null) : null,
  );

  useEffect(() => {
    if (!language || !cacheKey) return;
    let active = true;
    const accept = (next: HighlightResult) => {
      highlightCache.set(cacheKey, next);
      if (active) setResult(next);
    };
    const immediate = code.highlight({ code: text, language, themes: code.getThemes() }, accept);
    if (immediate) accept(immediate);
    return () => {
      active = false;
    };
  }, [cacheKey, language, text]);

  const tokens = result?.tokens[0];
  return (
    <span
      data-syntax-language={language ?? undefined}
      data-syntax-highlighted={tokens ? "true" : undefined}
    >
      {tokens ? renderTokens(tokens) : text}
    </span>
  );
};

const renderTokens = (tokens: HighlightResult["tokens"][number]): ReactNode =>
  tokens.map((token) => (
    <span
      key={`${token.offset}:${token.content}`}
      className="session-diff-syntax-token"
      style={token.htmlStyle as CSSProperties}
    >
      {token.content}
    </span>
  ));
