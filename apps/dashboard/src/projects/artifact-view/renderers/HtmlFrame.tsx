import { ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { HTML_ARTIFACT_CSP, HTML_ARTIFACT_SANDBOX, htmlArtifactDocument } from "./html-frame";

/**
 * An HTML artifact, running in a sandbox: scripts on an opaque origin (no cookies, storage,
 * parent or AOP API), no network (the CSP, set on the frame and inside the document), no forms,
 * popups or navigation of the app. A page that navigates itself away is put back.
 */
export const HtmlFrame = ({ html, title }: { html: string; title: string }) => {
  const doc = useMemo(() => htmlArtifactDocument(html), [html]);
  const loads = useRef(0);
  const [left, setLeft] = useState(false);
  const [generation, setGeneration] = useState(0);
  return (
    <div data-testid="artifact-html" className="flex min-h-0 flex-1 flex-col">
      <p className="flex items-center gap-1.5 border-b border-border px-4 py-1.5 text-meta text-text-subtle">
        {left ? (
          <>
            <TriangleAlertIcon aria-hidden="true" className="size-3.5 text-waiting" />
            <span data-testid="artifact-html-navigated">
              The page tried to leave; it was put back.
            </span>
          </>
        ) : (
          <>
            <ShieldCheckIcon aria-hidden="true" className="size-3.5" />
            Sandboxed: scripts run with no network and no access to AOP.
          </>
        )}
      </p>
      <iframe
        key={generation}
        data-testid="artifact-html-frame"
        title={title}
        sandbox={HTML_ARTIFACT_SANDBOX}
        // Chromium and Electron apply it to the frame; the document carries it too, for the rest.
        {...{ csp: HTML_ARTIFACT_CSP }}
        referrerPolicy="no-referrer"
        srcDoc={doc}
        onLoad={() => {
          loads.current += 1;
          if (loads.current > 1) {
            loads.current = 0;
            setLeft(true);
            setGeneration((value) => value + 1);
          }
        }}
        className="min-h-[60vh] w-full flex-1 border-0 bg-white"
      />
    </div>
  );
};
