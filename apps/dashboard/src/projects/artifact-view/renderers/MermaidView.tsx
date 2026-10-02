import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/ui/spinner";
import { renderMermaid } from "../mermaid";
import { parseMermaidSvg } from "./mermaid-svg";

type Drawn =
  | { state: "drawing" }
  | { state: "drawn"; svg: SVGSVGElement }
  | { state: "failed"; error: string };

const ZOOM_STEP = 0.25;

/**
 * One Mermaid diagram, drawn by Mermaid under its strict security level, fitted to the view and
 * zoomable. A diagram that cannot be drawn says why and shows its source.
 */
export const MermaidView = ({ source }: { source: string }) => {
  const [drawn, setDrawn] = useState<Drawn>({ state: "drawing" });
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    let current = true;
    setDrawn({ state: "drawing" });
    renderMermaid(source)
      .then(parseMermaidSvg)
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
        <p className="text-meta text-blocked">This diagram can't be drawn: {drawn.error}</p>
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
      <SvgMarkup svg={drawn.svg} zoom={zoom} />
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
 * Mermaid's SVG, attached as a copy. At 100% it is fitted to the view, its width and its height,
 * so a tall flowchart is seen whole; zooming scales that, and the view scrolls.
 */
const SvgMarkup = ({ svg, zoom }: { svg: SVGSVGElement; zoom: number }) => {
  const frame = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const fit = useFitScale(frame, natural);
  useEffect(() => {
    const root = document.importNode(svg, true);
    const [, , width = 0, height = 0] = (root.getAttribute("viewBox") ?? "")
      .split(/[\s,]+/)
      .map(Number);
    root.removeAttribute("height");
    root.setAttribute("width", "100%");
    root.style.maxWidth = "none";
    holder.current?.replaceChildren(root);
    setNatural(width > 0 && height > 0 ? { width, height } : null);
  }, [svg]);
  const width = natural ? `${Math.round(natural.width * fit * zoom)}px` : `${zoom * 100}%`;
  return (
    <div ref={frame} className="absolute inset-0 overflow-auto px-6 pt-14 pb-6">
      <div ref={holder} className="artifact-mermaid-svg mx-auto" style={{ width }} />
    </div>
  );
};

// Up to twice its own size: a small diagram is not blown up into a poster.
const MAX_FIT = 2;

const useFitScale = (
  frame: React.RefObject<HTMLDivElement | null>,
  natural: { width: number; height: number } | null,
): number => {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = frame.current;
    if (!element || !natural) return;
    const measure = () => {
      const width = element.clientWidth - 48;
      const height = element.clientHeight - 56 - 24;
      if (width <= 0 || height <= 0) return;
      setScale(Math.min(width / natural.width, height / natural.height, MAX_FIT));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame, natural]);
  return scale;
};
