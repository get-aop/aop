import { GlobeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { BrowserPane } from "./BrowserPane";
import { desktopBrowser } from "./desktop-browser";
import { closeBrowserView } from "./open-browser-view";

/**
 * The AOP Browser's place in the project grid: the chat's column, over the chat. It mounts the
 * first time the browser is shown and stays mounted after, so its pages live on while the chat is
 * in front. Out of sight it is parked outside the window instead of hidden (`display: none` and
 * `visibility: hidden` both upset a macOS webview), and inert, so neither the mouse nor Tab
 * reaches it. Being in the page, not a native view on top of it, it never covers the app's
 * dialogs, menus or the threads panel: they draw over it like over any other element.
 */
export const BrowserColumn = ({
  projectId,
  shown,
  coveredByPanel,
}: {
  projectId: string;
  shown: boolean;
  /** The threads panel covers the chat's column (expanded, or the one pane on a phone). */
  coveredByPanel: boolean;
}) => {
  const [opened, setOpened] = useState(shown);
  useEffect(() => {
    if (shown) setOpened(true);
  }, [shown]);
  if (!opened) return null;

  const visible = browserPlacement({ shown, coveredByPanel }) === "column";
  const bridge = desktopBrowser();
  return (
    <section
      data-testid="browser-column"
      data-shown={visible}
      aria-label="AOP Browser"
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        visible
          ? "col-start-1 row-start-2"
          : "pointer-events-none fixed top-0 -left-[200vw] h-screen w-[60vw]",
      )}
    >
      {bridge ? (
        <BrowserPane projectId={projectId} shown={visible} bridge={bridge} />
      ) : (
        <BrowserUnavailable />
      )}
    </section>
  );
};

/** Where the browser goes: in the chat's column, or parked out of the window. */
export const browserPlacement = ({
  shown,
  coveredByPanel,
}: {
  shown: boolean;
  coveredByPanel: boolean;
}): "column" | "parked" => (shown && !coveredByPanel ? "column" : "parked");

/**
 * A plain browser (a paired device) has no AOP Browser. Its address can still be opened here by
 * hand (an old link, a bookmark), so it says why and leads back to the chat.
 */
const BrowserUnavailable = () => (
  <div
    data-testid="browser-unavailable"
    className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
  >
    <GlobeIcon className="size-6 text-text-subtle" aria-hidden="true" />
    <h2 className="text-title font-semibold text-text">The AOP Browser is in the desktop app</h2>
    <p className="max-w-md text-meta text-text-muted">
      A web page cannot embed other sites the way the app can, and most refuse to be framed. Links
      from your chats open in a new tab here.
    </p>
    <Button size="sm" variant="outline" onClick={closeBrowserView}>
      Back to the coordinator
    </Button>
  </div>
);
