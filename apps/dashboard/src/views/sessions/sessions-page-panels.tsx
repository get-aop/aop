import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { resolveMarkdownFilePath } from "./markdown-file-refs";
import { SessionDiffPanel } from "./SessionDiffPanel";
import { SessionMarkdownPanel } from "./SessionMarkdownPanel";

export const MarkdownPanelArea = ({
  panel,
  width,
  expanded,
  containerWidth,
  previousWidth,
  setWidth,
  setExpanded,
  onClose,
  showToast,
}: {
  panel: { path: string } | null;
  width: number;
  expanded: boolean;
  containerWidth?: number;
  previousWidth: { current: number };
  setWidth: Dispatch<SetStateAction<number>>;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
  showToast: (message: string) => void;
}) => {
  useEffect(() => {
    if (!panel || expanded || !containerWidth) return;
    setWidth((current) => clampPanelWidth(current, containerWidth));
  }, [containerWidth, expanded, panel, setWidth]);
  if (!panel) return null;
  const resize = (nextWidth: number) => {
    setExpanded(false);
    setWidth(clampPanelWidth(nextWidth, containerWidth));
  };
  const toggleExpand = () => {
    if (expanded) {
      setWidth(clampPanelWidth(previousWidth.current, containerWidth));
      setExpanded(false);
      return;
    }
    previousWidth.current = width;
    setWidth(Math.min((containerWidth ?? 1200) * 0.6, 960));
    setExpanded(true);
  };
  return (
    <>
      <MarkdownPanelSplitter width={width} onWidthChange={resize} />
      <SessionMarkdownPanel
        path={panel.path}
        width={width}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        onClose={onClose}
        showToast={showToast}
      />
    </>
  );
};

export const MarkdownPanelSplitter = ({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}) => {
  const [dragging, setDragging] = useState(false);
  const containerRight = useRef(window.innerWidth);
  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => onWidthChange(containerRight.current - event.clientX);
    const stop = () => {
      setDragging(false);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.style.userSelect = "";
    };
  }, [dragging, onWidthChange]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an adjustable ARIA separator must remain keyboard-interactive
    <button
      type="button"
      role="separator"
      aria-label="Resize side panel"
      title="Resize side panel"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      onPointerDown={(event) => {
        event.preventDefault();
        containerRight.current =
          event.currentTarget.parentElement?.getBoundingClientRect().right ?? window.innerWidth;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragging(true);
      }}
      onDoubleClick={() => onWidthChange(540)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onWidthChange(width + 24);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onWidthChange(width - 24);
        }
      }}
      className="group relative z-20 -mr-px w-px shrink-0 cursor-col-resize bg-transparent before:absolute before:inset-y-0 before:-left-[3px] before:w-2"
    >
      <span
        className={`pointer-events-none absolute inset-y-0 left-0 w-px transition-colors duration-150 ${
          dragging ? "bg-primary/60" : "bg-transparent group-hover:bg-border"
        }`}
      />
    </button>
  );
};

export const readStoredPanelWidth = (): number => {
  const value = Number.parseFloat(localStorage.getItem("aop:md-panel-width") ?? "540");
  return Number.isFinite(value) ? clampPanelWidth(value) : 540;
};

export const clampPanelWidth = (width: number, containerWidth = window.innerWidth): number =>
  Math.max(360, Math.min(width, Math.floor(containerWidth * 0.7)));

export const toggleSessionSidePanel = (input: {
  open: boolean;
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>;
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>;
  setDiffRefreshKey: Dispatch<SetStateAction<number>>;
}): void => {
  if (input.open) {
    input.setMdPanel(null);
    input.setDiffPanelOpen(false);
    return;
  }
  input.setDiffPanelOpen(true);
  input.setDiffRefreshKey((key) => key + 1);
};

export const toggleDiffPanel = (input: {
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>;
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>;
  setDiffRefreshKey: Dispatch<SetStateAction<number>>;
}): void => {
  input.setMdPanel(null);
  input.setDiffPanelOpen((open) => !open);
  input.setDiffRefreshKey((key) => key + 1);
};

export const openResolvedMarkdownFromChat = (
  path: string,
  workspacePath: string | null,
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>,
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>,
): void => {
  const resolvedPath = resolveMarkdownFilePath(path, workspacePath);
  if (resolvedPath) openMarkdownFromChat(resolvedPath, setDiffPanelOpen, setMdPanel);
};

export const openMarkdownFromChat = (
  path: string,
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>,
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>,
): void => {
  setDiffPanelOpen(false);
  setMdPanel({ path });
};

export const useDiffPanelRunCompletionRefresh = (
  assistantActive: boolean,
  diffPanelOpen: boolean,
  previousAssistantActive: { current: boolean },
  setDiffRefreshKey: Dispatch<SetStateAction<number>>,
): void => {
  useEffect(() => {
    const wasActive = previousAssistantActive.current;
    previousAssistantActive.current = assistantActive;
    if (!diffPanelOpen || !wasActive || assistantActive) return;
    setDiffRefreshKey((key) => key + 1);
  }, [assistantActive, diffPanelOpen, previousAssistantActive, setDiffRefreshKey]);
};

export const SessionSidePanelSlot = ({
  diffPanelOpen,
  activeSessionId,
  mdPanel,
  mdPanelWidth,
  mdPanelExpanded,
  containerWidth,
  previousMdPanelWidth,
  setMdPanelWidth,
  setMdPanelExpanded,
  setMdPanel,
  setDiffPanelOpen,
  showToast,
  diffRefreshKey,
}: {
  diffPanelOpen: boolean;
  activeSessionId: string | undefined;
  mdPanel: { path: string } | null;
  mdPanelWidth: number;
  mdPanelExpanded: boolean;
  containerWidth: number | undefined;
  previousMdPanelWidth: { current: number };
  setMdPanelWidth: Dispatch<SetStateAction<number>>;
  setMdPanelExpanded: Dispatch<SetStateAction<boolean>>;
  setMdPanel: Dispatch<SetStateAction<{ path: string } | null>>;
  setDiffPanelOpen: Dispatch<SetStateAction<boolean>>;
  showToast: (message: string) => void;
  diffRefreshKey: number;
}) => {
  if (diffPanelOpen && activeSessionId) {
    return (
      <DiffPanelArea
        sessionId={activeSessionId}
        width={mdPanelWidth}
        expanded={mdPanelExpanded}
        containerWidth={containerWidth}
        previousWidth={previousMdPanelWidth}
        setWidth={setMdPanelWidth}
        setExpanded={setMdPanelExpanded}
        onClose={() => setDiffPanelOpen(false)}
        showToast={showToast}
        refreshKey={diffRefreshKey}
      />
    );
  }
  return (
    <MarkdownPanelArea
      panel={mdPanel}
      width={mdPanelWidth}
      expanded={mdPanelExpanded}
      containerWidth={containerWidth}
      previousWidth={previousMdPanelWidth}
      setWidth={setMdPanelWidth}
      setExpanded={setMdPanelExpanded}
      onClose={() => setMdPanel(null)}
      showToast={showToast}
    />
  );
};

export const DiffPanelArea = ({
  sessionId,
  width,
  expanded,
  containerWidth,
  previousWidth,
  setWidth,
  setExpanded,
  onClose,
  showToast,
  refreshKey,
}: {
  sessionId: string;
  width: number;
  expanded: boolean;
  containerWidth?: number;
  previousWidth: { current: number };
  setWidth: Dispatch<SetStateAction<number>>;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  onClose: () => void;
  showToast: (message: string) => void;
  refreshKey: number;
}) => {
  useEffect(() => {
    if (expanded || !containerWidth) return;
    setWidth((current) => clampPanelWidth(current, containerWidth));
  }, [containerWidth, expanded, setWidth]);
  const resize = (nextWidth: number) => {
    setExpanded(false);
    setWidth(clampPanelWidth(nextWidth, containerWidth));
  };
  const toggleExpand = () => {
    if (expanded) {
      setWidth(clampPanelWidth(previousWidth.current, containerWidth));
      setExpanded(false);
      return;
    }
    previousWidth.current = width;
    setWidth(Math.min((containerWidth ?? 1200) * 0.6, 960));
    setExpanded(true);
  };
  return (
    <>
      <MarkdownPanelSplitter width={width} onWidthChange={resize} />
      <SessionDiffPanel
        sessionId={sessionId}
        width={width}
        expanded={expanded}
        onToggleExpand={toggleExpand}
        onClose={onClose}
        showToast={showToast}
        refreshKey={refreshKey}
      />
    </>
  );
};
