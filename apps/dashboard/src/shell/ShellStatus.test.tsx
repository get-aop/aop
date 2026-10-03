import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakeCliHost, makeCli } from "../agent-clis/test-utils";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { cleanup, render, screen, waitFor } = await import("@testing-library/react");
const { ShellStatus } = await import("./ShellStatus");
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { resetAgentClisForTests } = await import("../agent-clis/agent-cli-store");
const { closeSettingsDialog } = await import("./dialog-store");
type ProjectsState = ReturnType<typeof makeState>;

const originalFetch = globalThis.fetch;

beforeEach(() => resetAgentClisForTests(10));

afterEach(() => {
  cleanup();
  closeSettingsDialog();
  resetAgentClisForTests();
  globalThis.fetch = originalFetch;
});

const renderStatus = (state: ProjectsState = makeState([])) =>
  render(
    <ProjectsProvider live={stubLiveProjects(state).live}>
      <ShellStatus testId="status" />
    </ProjectsProvider>,
  );

describe("ShellStatus updates", () => {
  test("shows the Updates button for a newer agent CLI, and nothing when all is current", async () => {
    installFakeCliHost();
    const { unmount } = renderStatus();
    expect(await screen.findByTestId("updates-button")).toBeTruthy();
    unmount();

    const host = installFakeCliHost({ clis: [makeCli({ updateAvailable: false })] });
    resetAgentClisForTests(10);
    renderStatus();
    await waitFor(() => expect(host.calls).toContain("GET /agent-clis"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("updates-button")).toBeNull();
  });
});

describe("ShellStatus host connection", () => {
  test("says when the host is out of reach", () => {
    installFakeCliHost();
    renderStatus(makeState([makeEntry(makeProject())], { reachable: false }));
    expect(screen.getByTestId("host-offline-notice").getAttribute("title")).toBe(
      "Host unreachable",
    );
  });

  test("says nothing while connected, or while a project's stream reconnects", () => {
    installFakeCliHost();
    renderStatus(makeState([makeEntry(makeProject(), [], { connection: "reconnecting" })]));
    expect(screen.queryByTestId("host-offline-notice") === null).toBe(true);
  });
});
