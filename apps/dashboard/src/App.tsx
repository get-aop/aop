import { ErrorBoundary } from "@/ui/error-boundary";
import { useAppZoom } from "./app-zoom";
import { AuthGate } from "./auth/AuthGate";
import { RuntimeConfigurationProvider } from "./hooks/runtime-configuration";
import { InboxPage } from "./inbox/InboxPage";
import { ProjectPage } from "./projects/ProjectPage";
import { ProjectsIndex } from "./projects/ProjectsIndex";
import { ProjectsProvider } from "./projects/ProjectsProvider";
import { AppShell } from "./shell/AppShell";
import { useRoute } from "./shell/router";
import { KitPage } from "./ui/kit-page";

/** Dev-only kitchen sink for the Graphite kit (PLAN phase 2). */
const isKitRoute = (): boolean =>
  window.location.pathname === "/__kit" && process.env.NODE_ENV !== "production";

/**
 * Projects are the app: `/` lists them, `/projects/:id` is a project's home, and the
 * coordinator chat, a thread and the project settings are screens of that project.
 */
export const App = () => {
  useAppZoom();

  if (isKitRoute()) {
    // Dev-only kitchen sink renders chromeless, outside the app shell.
    return (
      <div className="h-screen overflow-y-auto bg-canvas">
        <KitPage />
      </div>
    );
  }

  return (
    <AuthGate>
      <RuntimeConfigurationProvider>
        <ProjectsProvider>
          <AppShell>
            <ErrorBoundary>
              <RouteView />
            </ErrorBoundary>
          </AppShell>
        </ProjectsProvider>
      </RuntimeConfigurationProvider>
    </AuthGate>
  );
};

const RouteView = () => {
  const route = useRoute();
  if (route.name === "projects") return <ProjectsIndex />;
  if (route.name === "inbox") return <InboxPage itemId={route.itemId} />;
  return <ProjectPage route={route} />;
};
