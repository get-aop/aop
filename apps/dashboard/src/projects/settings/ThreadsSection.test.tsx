import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Project } from "@aop/common";
import type { ApiCall, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeProject } from "../test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, screen, waitFor, within } = await import("@testing-library/react");
const { ThreadsSection } = await import("./ThreadsSection");
const { NotificationsSection } = await import("./NotificationsSection");
const { choose, renderSection, savePhase } = await import("./section-test-utils");
const { refreshAgentClis, resetAgentClisForTests } = await import(
  "../../agent-clis/agent-cli-store"
);
const { getDialogs, resetDialogs } = await import("../../shell/dialog-store");

let api: ReturnType<typeof mockApi> | undefined;
let hostBypass = false;

const agentClis = (call: ApiCall) =>
  call.method === "GET" && call.path === "/agent-clis"
    ? Response.json({
        clis: [],
        checkIntervalMinutes: 60,
        autoUpdate: false,
        skipPermissions: { enabled: hostBypass, blockedReason: null },
      })
    : undefined;

const project = makeProject({ id: "p1", name: "Checkout" });
const editsOnly = makeProject({ id: "p1", name: "Checkout", threadAccess: "auto-accept-edits" });

const renderThreads = async (current: Project = project) => {
  const rendered = await renderSection(ThreadsSection, current, agentClis);
  api = rendered.api;
  await act(() => refreshAgentClis());
  return rendered;
};

beforeEach(() => {
  hostBypass = false;
  resetDialogs();
});

afterEach(() => {
  cleanup();
  api?.restore();
  resetAgentClisForTests();
});

describe("thread access", () => {
  test("a new project starts on full access, with one warning sized as a note", async () => {
    await renderThreads();
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "full-access",
    );
    const warning = screen.getByTestId("settings-full-access-warning");
    expect(warning.textContent).toContain("can run any command on this host");
    expect(warning.getAttribute("data-tone")).toBe("warn");
    expect(screen.queryByTestId("settings-thread-access-overridden")).toBeNull();
  });

  test("Edit files says other commands are denied and has no warning", async () => {
    await renderThreads(editsOnly);
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
    const description = screen.getByTestId("settings-thread-access-description").textContent;
    expect(description).toContain("denied");
    expect(description).toContain("no approval prompt");
  });

  test("choosing full access asks first, then saves it", async () => {
    await renderThreads(editsOnly);
    await choose("settings-thread-access", "Full access");

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Give threads full access?")).toBeTruthy();
    expect(api?.writes()).toEqual([]);

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ threadAccess: "full-access" });
    await waitFor(() => expect(savePhase("settings-thread-access")).toBe("saved"));
  });

  test("declining the question saves nothing and keeps Edit files", async () => {
    await renderThreads(editsOnly);
    await choose("settings-thread-access", "Full access");
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(api?.writes()).toEqual([]);
    expect(screen.getByTestId("settings-thread-access").getAttribute("data-value")).toBe(
      "auto-accept-edits",
    );
  });

  test("going back to editing files needs no question and saves at once", async () => {
    const { rerender } = await renderThreads();
    await choose("settings-thread-access", "Edit files");

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ threadAccess: "auto-accept-edits" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    rerender(editsOnly);
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
  });

  test("while the host skips permission checks, one note says it is overridden and links to Runtimes", async () => {
    hostBypass = true;
    await renderThreads();

    const note = await screen.findByTestId("settings-thread-access-overridden");
    expect(note.textContent).toContain("every thread runs with full access");
    // The override replaces the full-access warning: the row never warns twice.
    expect(screen.queryByTestId("settings-full-access-warning")).toBeNull();
    expect(screen.queryAllByRole("alert")).toEqual([]);

    fireEvent.click(screen.getByTestId("settings-thread-access-runtimes"));
    expect(getDialogs().settings).toEqual({ open: true, section: "runtimes" });
  });
});

describe("automation", () => {
  test("fixing pull requests saves turning it off at once", async () => {
    await renderThreads();
    const toggle = screen.getByTestId("settings-auto-fix");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(toggle);
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ autoFixPullRequests: false });
  });

  test("auto-continue is on by default, and a project that has it off saves turning it on", async () => {
    await renderThreads(makeProject({ id: "p1", name: "Checkout", autoContinue: false }));
    const toggle = screen.getByTestId("settings-auto-continue");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("Auto-continue when usage limits reset")).toBeTruthy();

    fireEvent.click(toggle);
    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ autoContinue: true });
  });

  test("a refused change says why on its own row", async () => {
    const rendered = await renderSection(ThreadsSection, project, (call) =>
      call.method === "PATCH"
        ? Response.json({ error: "The project is archived" }, { status: 409 })
        : agentClis(call),
    );
    api = rendered.api;
    fireEvent.click(screen.getByTestId("settings-auto-fix"));

    expect((await screen.findByTestId("settings-error")).textContent).toBe(
      "The project is archived",
    );
    expect(savePhase("settings-auto-fix")).toBe("error");
    expect(savePhase("settings-auto-continue")).toBe("idle");
  });
});

describe("NotificationsSection", () => {
  test("saves the level the person picks, at once", async () => {
    const rendered = await renderSection(NotificationsSection, project);
    api = rendered.api;
    await choose("settings-notifications", "Off");

    await waitFor(() => expect(api?.writes()).toHaveLength(1));
    expect(api?.writes()[0]?.body).toEqual({ notificationLevel: "off" });
  });
});
