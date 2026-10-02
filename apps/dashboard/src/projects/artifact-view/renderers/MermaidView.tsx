import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/ui/spinner";
import { renderMermaid } from "../mermaid";

type Drawn =
  | { state: "drawing" }
  | { state: "drawn"; svg: string }
  | { state: "failed"; error: string };

const ZOOM_STEP = 0.25;

/**
 * One Mermaid diagram, drawn by Mermaid under its strict security level, fitted to the view and
 * zoomable. A diagram that does not parse says why and shows its source.
 */
export const MermaidView = ({ source }: { source: string }) => {
  const [drawn, setDrawn] = useState<Drawn>({ state: "drawing" });
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let current = true;
    setDrawn({ state: "drawing" });
    renderMermaid(source)
      .then((svg) => current && setDrawn({ state: "drawn", svg }))
      .catch((error: unknown) => {
        if (current)
          setDrawn({
            state: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      current = false;
    };
  }, [source]);

  if (drawn.state === "drawing") {
    return (
      <div className="flex items-center gap-2 p-6 text-meta text-text-subtle">
        <Spinner className="size-3.5" /> Drawing the diagram…
      </div>
    );
  }
  if (drawn.state === "failed") {
    return (
      <div data-testid="artifact-mermaid-error" className="p-6">
        <p className="text-meta text-blocked">This diagram does not parse: {drawn.error}</p>
        <pre className="mt-3 whitespace-pre-wrap rounded-card border border-border bg-raised p-3 font-mono text-[13px] text-text-muted">
          {source}
        </pre>
      </div>
    );
  }
  return (
    <div data-testid="artifact-mermaid" className="relative min-h-0 flex-1">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 rounded-row border border-border bg-overlay/90 p-0.5 shadow-sm">
        <ZoomButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z - ZOOM_STEP))}>
          <MinusIcon />
        </ZoomButton>
        <button
          type="button"
          data-testid="mermaid-zoom-reset"
          title="Fit to the view"
          onClick={() => setZoom(1)}
          className="h-7 min-w-12 rounded-sm px-1.5 text-meta tabular-nums text-text-muted hover:bg-hover hover:text-text"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ZoomButton label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + ZOOM_STEP))}>
          <PlusIcon />
        </ZoomButton>
        <ZoomButton label="Fit" onClick={() => setZoom(1)}>
          <ScanIcon />
        </ZoomButton>
      </div>
      <div className="overflow-auto p-6 pt-14">
        <SvgMarkup svg={drawn.svg} zoom={zoom} />
      </div>
    </div>
  );
};

const ZoomButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    className="grid size-7 place-items-center rounded-sm text-text-subtle hover:bg-hover hover:text-text [&_svg]:size-3.5"
  >
    {children}
  </button>
);

/**
 * Mermaid's SVG, parsed as XML and attached as nodes: nothing in it runs (a script parsed this
 * way never executes), and Mermaid's strict level already left out scripts and handlers.
 */
const SvgMarkup = ({ svg, zoom }: { svg: string; zoom: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = parsed.documentElement;
    if (root.nodeName !== "svg") return;
    root.removeAttribute("height");
    root.setAttribute("width", "100%");
    root.style.maxWidth = "none";
    ref.current?.replaceChildren(document.importNode(root, true));
  }, [svg]);
  return (
    <div
      ref={ref}
      className="artifact-mermaid-svg mx-auto transition-[width] duration-150"
      style={{ width: `${zoom * 100}%` }}
    />
  );
};
