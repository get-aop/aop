import { useCallback } from "react";
import { cn } from "@/lib/cn";
import { navigate, projectPath, type Route } from "../../shell/router";
import { CoordinatorChatPane } from "../chat/CoordinatorChatPane";
import { focusCoordinatorComposer } from "../chat/focus-composer";
import type { ChatModel, ProjectChat } from "../chat/project-chat";
import { ProjectTopBar } from "../ProjectTopBar";
import type { ProjectEntry } from "../projects-state";
import { PanelDivider } from "./PanelDivider";
import { CHAT_MIN_WIDTH } from "./panel-layout";
import { PanelFrame, ThreadsPanel } from "./ThreadsPanel";
import { useOverviewFilters } from "./use-overview-filters";
import { type PanelLayout, usePanelLayout } from "./use-panel-layout";

type ProjectScreen = Extract<Route, { name: "project" | "thread" }>;

/**
 * The project screen in three panes: the projects sidebar (the shell's), the coordinator chat,
 * which is always here, and the threads panel beside it. `/projects/:id` has the panel on its
 * overview; `/projects/:id/threads/:threadId` has it on that thread.
 *
 * One grid holds them: the top bar over the chat, and the panel in a column of its own from the
 * top of the screen, so its header shares the top bar's row. When the panel covers the chat
 * (expanded, or on a phone) or is closed, the top bar spans the screen.
 */
export const ProjectLayout = ({
  entry,
  route,
  chat,
  model,
  settingsOpen = false,
}: {
  entry: ProjectEntry;
  route: ProjectScreen;
  chat: ProjectChat;
  model: ChatModel;
  /** The settings dialog is open over this screen: the top bar marks its gear. */
  settingsOpen?: boolean;
}) => {
  const { project, threads, threadsLoaded, threadsError } = entry;
  const threadId = route.name === "thread" ? route.threadId : null;
  const leaveThread = useCallback(() => navigate(projectPath(project.id)), [project.id]);
  const layout = usePanelLayout({ projectId: project.id, threadId, onCloseThread: leaveThread });
  const filters = useOverviewFilters();
  const { revealChat } = layout;

  // A thread starts from what the person tells the coordinator, so this goes to its composer.
  const startThread = useCallback(() => {
    revealChat();
    focusCoordinatorComposer();
  }, [revealChat]);

  return (
    <div
      ref={layout.containerRef}
      data-testid="project-layout"
      data-mode={layout.mode}
      data-panel-open={layout.visible}
      data-panel-beside-top-bar={layout.besideTopBar}
      style={{ gridTemplateColumns: gridColumns(layout) }}
      className="relative grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <ProjectTopBar
        entry={entry}
        panel={{ visible: layout.visible, toggle: layout.toggle }}
        settingsOpen={settingsOpen}
        className={cn("row-start-1", layout.besideTopBar ? "col-start-1" : "col-span-full")}
      />
      {/* Hidden, never unmounted: the chat keeps its stream, its scroll place and its draft. */}
      <section
        data-testid="chat-column"
        aria-label="Coordinator chat"
        className={cn(
          "col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col",
          layout.chatHidden && "hidden",
        )}
      >
        <CoordinatorChatPane
          project={project}
          threads={threads}
          threadsLoaded={threadsLoaded}
          threadsError={threadsError}
          chat={chat}
          model={model}
          active={!layout.chatHidden}
        />
      </section>
      {layout.visible && layout.mode === "side" && !layout.expanded ? (
        <PanelDivider
          width={layout.width}
          containerRef={layout.containerRef}
          onResize={layout.setWidth}
        />
      ) : null}
      {layout.visible ? (
        <PanelFrame layout={layout}>
          <ThreadsPanel
            entry={entry}
            threadId={threadId}
            layout={layout}
            filters={filters}
            onNewThread={startThread}
          />
        </PanelFrame>
      ) : null}
    </div>
  );
};

/**
 * The chat's column, the divider's, and the panel's when it sits beside the chat. Its width is
 * the person's, held to what leaves the chat its minimum even before the screen is measured.
 */
const gridColumns = (layout: PanelLayout): string => {
  const sidePane = layout.visible && layout.mode === "side" && !layout.expanded;
  const panel = sidePane ? `min(${layout.width}px, calc(100% - ${CHAT_MIN_WIDTH}px))` : "auto";
  return `minmax(0, 1fr) auto ${panel}`;
};
