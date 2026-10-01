import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeCliHost, makeCli } from "./test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AgentCliPanel } = await import("./AgentCliPanel");
const { resetAgentClisForTests } = await import("./agent-cli-store");

const originalFetch = globalThis.fetch;

beforeEach(() => resetAgentClisForTests(10));

afterEach(() => {
  cleanup();
  resetAgentClisForTests();
  globalThis.fetch = originalFetch;
});

const updating = makeCli().update;

describe("AgentCliPanel", () => {
  test("shows the installed version, how and where it is installed, and the newer version", async () => {
    installFakeCliHost();
    render(<AgentCliPanel />);

    await waitFor(() => expect(screen.getByTestId("agent-cli-claude-code")).toBeTruthy());
    const row = screen.getByTestId("agent-cli-claude-code");
    expect(screen.getByTestId("agent-cli-version").textContent).toBe("2.1.285");
    expect(screen.getByTestId("agent-cli-update-available").textContent).toBe("2.1.286 available");
    expect(row.textContent).toContain("Native installer");
    expect(row.textContent).toContain(
      "/Users/me/.local/bin/claude → /Users/me/.local/share/claude/versions/2.1.285",
    );
    await waitFor(() => expect(screen.getByTestId("agent-cli-update")).toBeTruthy());
  });

  test("Update runs in the background: the button shows progress, then the result", async () => {
    const host = installFakeCliHost({
      onUpdate: (current) => {
        current.clis = [
          makeCli({ update: { ...updating, state: "updating", toVersion: "2.1.286" } }),
        ];
        // The host finishes a little later; the panel finds out by polling.
        setTimeout(() => {
          current.clis = [
            makeCli({
              version: "2.1.286",
              realPath: "/Users/me/.local/share/claude/versions/2.1.286",
              updateAvailable: false,
              update: { ...updating, state: "succeeded", toVersion: "2.1.286" },
            }),
          ];
        }, 40);
      },
    });
    render(<AgentCliPanel />);
    await waitFor(() => expect(screen.getByTestId("agent-cli-update")).toBeTruthy());

    fireEvent.click(screen.getByTestId("agent-cli-update"));

    await waitFor(() =>
      expect(screen.getByTestId("agent-cli-update-progress").textContent).toContain(
        "Updating to 2.1.286",
      ),
    );
    expect((screen.getByTestId("agent-cli-update") as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("agent-cli-update-done").textContent).toContain(
        "Updated to 2.1.286",
      ),
    );
    expect(screen.getByTestId("agent-cli-version").textContent).toBe("2.1.286");
    expect(screen.queryByTestId("agent-cli-update")).toBeNull();
    expect(host.calls).toContain("POST /agent-clis/claude-code/update");
  });

  test("an update waiting for runs in flight says so", async () => {
    installFakeCliHost({
      clis: [
        makeCli({
          installMethod: "npm",
          update: { ...updating, state: "waiting", deferredFor: 2 },
          activeRuns: { count: 2, versions: ["2.1.285"] },
        }),
      ],
    });
    render(<AgentCliPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("agent-cli-update-progress").textContent).toContain(
        "Waiting for 2 runs of Claude Code to finish",
      ),
    );
    expect(screen.getByTestId("agent-cli-runs").textContent).toContain(
      "2 runs in flight on 2.1.285",
    );
  });

  test("a failed update shows why and the command to run by hand", async () => {
    installFakeCliHost({
      clis: [
        makeCli({
          installMethod: "unknown",
          update: {
            ...updating,
            state: "failed",
            error: "AOP cannot tell how Claude Code was installed at /opt/claude",
            manualCommand:
              "claude update, or npm install --global @anthropic-ai/claude-code@latest",
            output: "npm ERR! EACCES",
          },
        }),
      ],
    });
    render(<AgentCliPanel />);

    await waitFor(() => expect(screen.getByTestId("agent-cli-update-failed")).toBeTruthy());
    expect(screen.getByTestId("agent-cli-update-failed").textContent).toContain(
      "AOP cannot tell how Claude Code was installed",
    );
    expect(screen.getByTestId("agent-cli-manual-command").textContent).toBe(
      "claude update, or npm install --global @anthropic-ai/claude-code@latest",
    );
    fireEvent.click(screen.getByText("Show output"));
    expect(screen.getByText("npm ERR! EACCES")).toBeTruthy();
  });

  test("a paired device sees the versions but no Update button", async () => {
    installFakeCliHost({ owner: false });
    render(<AgentCliPanel />);

    await waitFor(() => expect(screen.getByTestId("agent-cli-update-available")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByTestId("agent-cli-update")).toBeNull();
  });

  test("an up-to-date CLI has no Update button, and Check now asks the host", async () => {
    const host = installFakeCliHost({
      clis: [makeCli({ updateAvailable: false, latest: "2.1.285" })],
    });
    render(<AgentCliPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("agent-cli-check-state").textContent).toContain(
        "Up to date (latest is 2.1.285)",
      ),
    );
    expect(screen.queryByTestId("agent-cli-update")).toBeNull();
    fireEvent.click(screen.getByTestId("agent-clis-check"));
    await waitFor(() => expect(host.calls).toContain("POST /agent-clis/check"));
  });

  test("an offline check and a missing CLI say so", async () => {
    installFakeCliHost({
      clis: [
        makeCli({
          installed: false,
          path: null,
          realPath: null,
          version: null,
          installMethod: null,
          latest: null,
          updateAvailable: false,
          checkedAt: null,
          checkError: "fetch failed",
        }),
      ],
    });
    render(<AgentCliPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("agent-cli-version").textContent).toBe("not installed"),
    );
    expect(screen.getByTestId("agent-cli-check-state").textContent).toBe(
      "Could not check for a newer version: fetch failed",
    );
  });

  test("a refused update request shows the host's reason", async () => {
    installFakeCliHost({ updateStatus: 409 });
    render(<AgentCliPanel />);
    await waitFor(() => expect(screen.getByTestId("agent-cli-update")).toBeTruthy());

    fireEvent.click(screen.getByTestId("agent-cli-update"));

    await waitFor(() =>
      expect(screen.getByTestId("agent-clis-error").textContent).toContain("already running"),
    );
  });
});
