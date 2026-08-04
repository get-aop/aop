import { useCallback, useEffect, useState } from "react";
import { ErrorBoundary } from "@/ui/error-boundary";
import { useAppZoom } from "./app-zoom";
import { initDelegationCenter } from "./components/delegations/delegation-center";
import { GhAvailabilityProvider } from "./hooks/gh-availability";
import { useConnectionStatus } from "./hooks/useConnectionStatus";
import { useTaskEvents } from "./hooks/useTaskEvents";
import { AppShell } from "./shell/AppShell";
import { openAttachRepoDialog, openSettingsDialog } from "./shell/dialog-store";
import { KitPage } from "./ui/kit-page";
import { SessionsPage } from "./views/sessions/SessionsPage";
import { TaskDetail } from "./views/TaskDetail";

type Route = "sessions" | "detail" | "kit";

interface RouterState {
  route: Route;
  taskId?: string;
  taskFilePath?: string;
  /** Sessions preload: open chat about this task (`/?task=<id>`). */
  focusTaskId?: string;
}

/**
 * One page: Sessions is the app. Every legacy route redirects to "/" (or
 * /tasks/:id) with history.replaceState (PLAN §3).
 */
const LEGACY_REDIRECTS = new Set([
  "/chat",
  "/pool",
  "/workers",
  "/metrics",
  "/workflows",
  "/settings",
]);

const parseRoute = (): RouterState => {
  const path = window.location.pathname;

  if (isKitRoute(path)) {
    return { route: "kit" };
  }

  const taskMatch = path.match(/^\/tasks\/(.+)$/);
  if (taskMatch) {
    const query = new URLSearchParams(window.location.search);
    return {
      route: "detail",
      taskId: taskMatch[1],
      taskFilePath: query.get("file") ?? undefined,
    };
  }

  if (LEGACY_REDIRECTS.has(path) || path.startsWith("/workflows/")) {
    window.history.replaceState({}, "", "/");
    return { route: "sessions" };
  }

  const query = new URLSearchParams(window.location.search);
  return { route: "sessions", focusTaskId: query.get("task") ?? undefined };
};

/** Dev-only kitchen sink for the Graphite kit (PLAN phase 2). */
const isKitRoute = (path: string): boolean =>
  path === "/__kit" && process.env.NODE_ENV !== "production";

export const App = () => {
  const [routerState, setRouterState] = useState<RouterState>(parseRoute);
  const taskEvents = useTaskEvents();
  const connection = useConnectionStatus({
    connected: taskEvents.connected,
    tasks: taskEvents.tasks,
  });
  useAppZoom();

  // Rebuild delegated-specialist cards from persisted runs; streams keep them live.
  useEffect(() => {
    void initDelegationCenter();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setRouterState(parseRoute());
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setRouterState(parseRoute());
  };

  const consumeFocusTaskIntent = useCallback(() => {
    if (!routerState.focusTaskId) return;
    window.history.replaceState({}, "", "/");
    setRouterState((current) => ({ ...current, focusTaskId: undefined }));
  }, [routerState.focusTaskId]);

  if (routerState.route === "kit") {
    // Dev-only kitchen sink renders chromeless, outside the app shell.
    return (
      <div className="h-screen overflow-y-auto bg-canvas">
        <KitPage />
      </div>
    );
  }

  return (
    <GhAvailabilityProvider>
      <AppShell connection={connection} onReposChanged={() => void taskEvents.refresh()}>
        <ErrorBoundary>
          {routerState.route === "detail" && routerState.taskId ? (
            <TaskDetail
              taskId={routerState.taskId}
              tasks={taskEvents.tasks}
              initialFilePath={routerState.taskFilePath}
              onClose={() => navigate("/")}
              onNavigate={navigate}
            />
          ) : (
            <SessionsPage
              repos={taskEvents.repos}
              tasks={taskEvents.tasks}
              focusTaskId={routerState.focusTaskId}
              onFocusTaskConsumed={consumeFocusTaskIntent}
              onNavigate={navigate}
              onAttachRepo={openAttachRepoDialog}
              onOpenWorkerDialog={() => openSettingsDialog("general")}
            />
          )}
        </ErrorBoundary>
      </AppShell>
    </GhAvailabilityProvider>
  );
};
