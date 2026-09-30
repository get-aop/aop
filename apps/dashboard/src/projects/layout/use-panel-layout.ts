import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  type LayoutMode,
  layoutModeFor,
  loadPanelPrefs,
  type PanelPrefs,
  panelWidthFor,
  savePanelPrefs,
} from "./panel-layout";

export interface PanelLayout {
  /** Attach to the element that holds both panes: its width decides the mode. */
  containerRef: RefObject<HTMLDivElement | null>;
  mode: LayoutMode;
  /** Whether the panel is on screen. */
  visible: boolean;
  /** The panel has the chat's room too. */
  expanded: boolean;
  /** The chat is out of sight (and its place is the panel's). */
  chatHidden: boolean;
  width: number;
  toggle: () => void;
  close: () => void;
  toggleExpanded: () => void;
  setWidth: (width: number) => void;
  /** Makes sure the chat can be seen: gives back its room, or takes the panel away. */
  revealChat: () => void;
}

/**
 * Where the panel is and how wide. On a wide screen it is a pane beside the chat whose open
 * state and width this browser remembers. On a narrower one it slides over the chat, and on a
 * phone it replaces the chat; there it is closed until the person asks for it (by a toggle or
 * by opening a thread), whatever the wide screen remembers. A screen that names a thread
 * always shows it, and closing the panel takes the thread off the address (`onCloseThread`).
 */
export const usePanelLayout = ({
  projectId,
  threadId,
  onCloseThread,
}: {
  /** Whose panel this is: the open state and width are remembered per project. */
  projectId: string;
  threadId: string | null;
  onCloseThread: () => void;
}): PanelLayout => {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(containerRef);
  const mode = containerWidth === null ? "side" : layoutModeFor(containerWidth);
  const [prefs, setPrefs] = useState<PanelPrefs>(() => loadPanelPrefs(projectId));
  const [transient, setTransient] = useState(threadId !== null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => savePanelPrefs(projectId, prefs), [projectId, prefs]);

  // Whoever names a thread (a link, a chip, a card, a reload) wants to see it.
  useEffect(() => {
    if (threadId === null) return;
    setPrefs((current) => (current.open ? current : { ...current, open: true }));
    setTransient(true);
  }, [threadId]);

  const visible = mode === "side" ? prefs.open : transient;
  const close = useCallback(() => {
    if (threadId !== null) onCloseThread();
    setPrefs((current) => ({ ...current, open: false }));
    setTransient(false);
    setExpanded(false);
  }, [threadId, onCloseThread]);
  const open = useCallback(() => {
    setPrefs((current) => ({ ...current, open: true }));
    setTransient(true);
  }, []);

  return {
    containerRef,
    mode,
    visible,
    expanded: visible && expanded,
    chatHidden: visible && (mode === "single" || (mode === "side" && expanded)),
    width: panelWidthFor(mode, prefs.width, containerWidth ?? Number.POSITIVE_INFINITY),
    toggle: visible ? close : open,
    close,
    toggleExpanded: () => setExpanded((current) => !current),
    revealChat: () => (mode === "side" ? setExpanded(false) : close()),
    setWidth: (width) =>
      setPrefs((current) => ({
        ...current,
        width: panelWidthFor(mode, width, containerWidth ?? Number.POSITIVE_INFINITY),
      })),
  };
};

// The room the panes share, which a collapsing sidebar or a dragged window changes.
const useContainerWidth = (ref: RefObject<HTMLDivElement | null>): number | null => {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const measured = element.getBoundingClientRect().width;
      // A layout that has no size yet (a test, a hidden tab) is not a narrow one.
      setWidth(measured > 0 ? measured : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
};
