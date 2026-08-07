import type { CodeHighlighterPlugin, HighlightOptions, HighlightResult } from "@streamdown/code";

type LoadCodeHighlighter = () => Promise<CodeHighlighterPlugin>;

const DEFAULT_THEMES: ReturnType<CodeHighlighterPlugin["getThemes"]> = [
  "github-light",
  "github-dark",
];

export const createLazyCodeHighlighter = (load: LoadCodeHighlighter): CodeHighlighterPlugin => {
  let loaded: CodeHighlighterPlugin | null = null;
  let pending: Promise<CodeHighlighterPlugin> | null = null;

  const loadOnce = (): Promise<CodeHighlighterPlugin> => {
    if (loaded) return Promise.resolve(loaded);
    pending ??= load()
      .then((plugin) => {
        loaded = plugin;
        return plugin;
      })
      .catch((error) => {
        pending = null;
        throw error;
      });
    return pending;
  };

  return {
    name: "shiki",
    type: "code-highlighter",
    supportsLanguage: (language) => loaded?.supportsLanguage(language) ?? true,
    getSupportedLanguages: () => loaded?.getSupportedLanguages() ?? [],
    getThemes: () => loaded?.getThemes() ?? DEFAULT_THEMES,
    highlight: (options: HighlightOptions, callback?: (result: HighlightResult) => void) => {
      if (loaded) return loaded.highlight(options, callback);
      void loadOnce()
        .then((plugin) => {
          const result = plugin.highlight(options, callback);
          if (result) callback?.(result);
        })
        .catch(() => undefined);
      return null;
    },
  };
};

export const lazyCodeHighlighter = createLazyCodeHighlighter(async () => {
  const { code } = await import("@streamdown/code");
  return code;
});
