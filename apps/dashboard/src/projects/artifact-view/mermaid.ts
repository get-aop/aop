import type { Mermaid, MermaidConfig } from "mermaid";

/**
 * Mermaid, loaded on the first diagram only (it is about 1 MB, in its own chunks), set up for the
 * app's dark theme and its strictest security: labels cannot inject HTML or click handlers.
 */
const CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  fontFamily: '"Inter Variable", Inter, system-ui, sans-serif',
  themeVariables: {
    darkMode: true,
    background: "#161618",
    primaryColor: "#232328",
    primaryTextColor: "#ececec",
    primaryBorderColor: "#4a4a52",
    secondaryColor: "#1d1d21",
    tertiaryColor: "#1b1b1e",
    lineColor: "#8a8a92",
    textColor: "#ececec",
    mainBkg: "#232328",
    nodeBorder: "#4a4a52",
    clusterBkg: "#1b1b1e",
    clusterBorder: "#3a3a40",
    edgeLabelBackground: "#1b1b1e",
    actorBkg: "#232328",
    actorBorder: "#4a4a52",
    actorTextColor: "#ececec",
    signalColor: "#9c9ca3",
    signalTextColor: "#ececec",
    noteBkgColor: "#2a2a30",
    noteTextColor: "#ececec",
    noteBorderColor: "#4a4a52",
    fontSize: "14px",
  },
};

let loading: Promise<Mermaid> | null = null;

export const loadMermaid = (): Promise<Mermaid> => {
  loading ??= import("mermaid")
    .then(({ default: mermaid }) => {
      mermaid.initialize(CONFIG);
      return mermaid;
    })
    .catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
};

/** Whether `source` parses, and the parser's words when it does not. */
export const checkMermaid = async (
  source: string,
): Promise<{ valid: true } | { valid: false; error: string }> => {
  const mermaid = await loadMermaid();
  try {
    await mermaid.parse(source);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
};

let renders = 0;

/** The diagram as SVG markup, made by Mermaid under its strict security level. */
export const renderMermaid = async (source: string): Promise<string> => {
  const mermaid = await loadMermaid();
  renders += 1;
  const { svg } = await mermaid.render(`artifact-mermaid-${renders}`, source);
  return svg;
};

/**
 * Streamdown's diagram plugin, lazy: Streamdown asks for an instance up front and renders through
 * it, so the instance only loads Mermaid when a fence is drawn.
 */
export const lazyMermaidPlugin = {
  name: "mermaid" as const,
  type: "diagram" as const,
  language: "mermaid",
  getMermaid: () => ({
    initialize: () => undefined,
    render: async (id: string, source: string) => (await loadMermaid()).render(id, source),
  }),
};
