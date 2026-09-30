import { useEffect } from "react";
import { ErrorBoundary } from "@/ui/error-boundary";
import { useAppZoom } from "./app-zoom";
import { useHostEvents } from "./hooks/useHostEvents";
import { AppShell } from "./shell/AppShell";
import { openAttachRepoDialog } from "./shell/dialog-store";
import { KitPage } from "./ui/kit-page";
import { SessionsPage } from "./views/sessions/SessionsPage";

/**
 * One page: Sessions is the app. Every legacy route redirects to "/" with
 * history.replaceState (PLAN §3).
 */
const LEGACY_REDIRECTS = new Set([
  "/chat",
  "/pool",
  "/workers",
  "/metrics",
  "/workflows",
  "/settings",
]);

const LEGACY_PREFIXES = ["/workflows/", "/tasks/"];

const redirectLegacyRoute = (): void => {
  const path = window.location.pathname;
  if (LEGACY_REDIRECTS.has(path) || LEGACY_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    window.history.replaceState({}, "", "/");
  }
};

/** Dev-only kitchen sink for the Graphite kit (PLAN phase 2). */
const isKitRoute = (): boolean =>
  window.location.pathname === "/__kit" && process.env.NODE_ENV !== "production";

export const App = () => {
  const host = useHostEvents();
  useAppZoom();

  useEffect(redirectLegacyRoute, []);

  if (isKitRoute()) {
    // Dev-only kitchen sink renders chromeless, outside the app shell.
    return (
      <div className="h-screen overflow-y-auto bg-canvas">
        <KitPage />
      </div>
    );
  }

  return (
    <AppShell connected={host.connected} onReposChanged={() => void host.refresh()}>
      <ErrorBoundary>
        <SessionsPage repos={host.repos} onAttachRepo={openAttachRepoDialog} />
      </ErrorBoundary>
    </AppShell>
  );
};
