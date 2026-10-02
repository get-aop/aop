import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { installFakeCliHost, makeCli } from "../agent-clis/test-utils";
import { makeEntry, makeProject, makeState, stubLiveProjects } from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { ShellStatus } = await import("./ShellStatus");
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { resetAgentClisForTests } = await import("../agent-clis/agent-cli-store");
const { closeSettingsDialog, getDialogs } = await import("./dialog-store");
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

describe("ShellStatus agent CLI notice", () => {
  test("names the CLI and the version out, and opens the Runtimes panel", async () => {
    installFakeCliHost();
    renderStatus();

    await waitFor(() =>
      expect(screen.getByTestId("cli-update-notice").getAttribute("title")).toBe(
        "Claude Code 2.1.286 available",
      ),
    );
    expect(screen.getByTestId("cli-update-notice").textContent).toBe(
      "Claude Code 2.1.286 available",
    );
    fireEvent.click(screen.getByTestId("cli-update-notice"));
    expect(getDialogs().settings).toEqual({ open: true, section: "runtimes" });
  });

  test("is absent when every CLI is up to date, or while its update runs", async () => {
    for (const cli of [
      makeCli({ updateAvailable: false }),
      makeCli({ update: { ...makeCli().update, state: "updating" } }),
    ]) {
      const host = installFakeCliHost({ clis: [cli] });
      const { unmount } = renderStatus();
      await waitFor(() => expect(host.calls).toContain("GET /agent-clis"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.queryByTestId("cli-update-notice") === null).toBe(true);
      unmount();
      resetAgentClisForTests(10);
    }
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
